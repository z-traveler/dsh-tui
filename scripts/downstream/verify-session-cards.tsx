/**
 * 工单 01：通用命令结果、显式技能加载与通用上下文通知的端到端回归（真实
 * translator + channel + 渲染）。
 *
 * 观察面从持久化事实开始：`sessionCards` 开启时，DSH 的 `command/run` +
 * `command/done` 形成同一命令实体（按 commandId 配对），投影出一张默认折叠、
 * 可展开读到完整正文的命令卡；显式技能加载（`skill-invocation` 来源）与
 * `form: 'notice'` 的通用上下文通知各自投影出独立卡片。关闭开关时转录保持上游形态。
 *
 * 覆盖：
 *   1. 命令卡：一条 success 记录一张卡，完整正文（>200 行、>65536 码元、
 *      单行 >4000 显示单元）存进 row.text 且不截断，命令名/输入/状态/seq/时间
 *      锚点保留；
 *   2. 去重与省略：`coveredBySeq`（既有专属呈现）不出卡，成功但无正文不出卡，
 *      错误记录出错误卡；
 *   3. 恢复：durable 日志重放（initialHistory）得到同样的行，实时与恢复一致；
 *   4. 技能卡：独立记录（不是用户气泡、不改 lastUserText、不产生模型消息），
 *      用户原文那行单独保留；
 *   5. 通用通知卡：任意生产者 kind、无 name/message 仍出卡，保留消息 id/seq/time、
 *      摘要与完整正文；同来源多条独立，replacement 隐藏，关闭开关不出卡；
 *   6. 内存约束：窗口折叠把正文降到预览、`loadOlder` 按 commandId/seq 从日志恢复；
 *   7. 渲染（Chat 真实按键）：折叠只显示标签 + 摘要，Ctrl+O 展开后能读到正文
 *      末尾，点击行同样展开，40/100 列不越界；
 *   8. 展开/折叠不执行命令、不新增行、不请求模型。
 *
 * 运行：node --import tsx/esm scripts/downstream/verify-session-cards.tsx
 */
import '../lib/fake-home.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'zh'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'

import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentSession, SessionCapabilities } from '../../src/agent/session.js'
import type { AgentEvent } from '../../src/agent/events.js'
import type { ChatRow } from '../../src/adapter/ports/channel-view.js'

// 环境变量与语言必须在 UI 模块求值前定好（i18n 在 import 时解析）。
const [
  React,
  { Terminal: XTerm },
  { render, AlternateScreen, ThemeProvider },
  { Chat },
  { createChannel },
  { QuestionStore },
  { ApprovalStore },
  { settled, settle, sleep, viewportLines },
  { foldRows, foldBack },
  { Config },
  { createDshTranslator },
] = await Promise.all([
  import('react'),
  import('@xterm/headless'),
  import('../../src/ui.js'),
  import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/channel.js'),
  import('../../src/dsh-adapter/questions.js'),
  import('../../src/dsh-adapter/approvals.js'),
  import('../lib/term-test.mjs'),
  import('../../src/dsh-adapter/channel/transcript.js'),
  import('../../src/dsh-adapter/index.js'),
  import('../../src/dsh-adapter/backend/translate.js'),
])

let failed = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

check('默认配置：省略 sessionCards 时开启卡片', Config({}).sessionCards === true)
check('显式配置：sessionCards: false 仍可关闭卡片', Config({ sessionCards: false }).sessionCards === false)

/** 一条超长正文：>200 行、>65536 码元，含中文/emoji 与一条 >4000 显示单元的行。 */
const LONG_LINE = '中文😀'.repeat(2500)
const BODY_LINES = Array.from({ length: 260 }, (_, index) => index === 0
  ? 'HEAD: the report opens here'
  : index === 130
    ? LONG_LINE
    : `REPORT-${index + 1} 中文😀`)
BODY_LINES[BODY_LINES.length - 1] = 'END-OF-REPORT-BODY'
const BODY = BODY_LINES.join('\n')

/** 一条确定的命令结果事实（翻译器对 command/run + command/done 的输出）。 */
const commandResult = (
  seq: number,
  result: { commandId?: string; name?: string; args?: string; outcome?: 'success' | 'error'; text?: string; coveredBySeq?: number },
): AgentEvent => ({
  type: 'command.result',
  commandId: result.commandId ?? 'cmd-1',
  name: result.name ?? 'model-context',
  ...(result.args === undefined ? {} : { args: result.args }),
  outcome: result.outcome ?? 'success',
  text: result.text ?? '',
  ...(result.coveredBySeq === undefined ? {} : { coveredBySeq: result.coveredBySeq }),
  seq,
  time: 1_700_000_000_000 + seq,
})

/** 一条显式技能加载事实：正文是 core 当时注入的 canonical 文本。 */
const SKILL_BODY = '<skill_content name="alpha">\n<skill_instructions>\nALPHA-MARKER: follow the alpha guide.\n</skill_instructions>\n</skill_content>'
const skillLoad = (seq: number, name = 'alpha', body = SKILL_BODY): AgentEvent => ({ type: 'skill.invocation', seq, time: 1_700_000_000_000 + seq, name, body })

/** 一条通用上下文通知：任意生产者的 DSH `user/message` + `form: 'notice'`。 */
const NOTICE_SUMMARY = '\u001b[31mCONTEXT-NOTICE-SUMMARY\u001b[0m: fallback context unavailable 中文😀'
const NOTICE_BODY = [
  'NOTICE-HEAD 中文😀',
  'ANSI: \u001b[31mRED-CONTEXT-MARKER\u001b[0m',
  '通知😀'.repeat(120),
  'END-OF-NOTICE-BODY',
].join('\n')
const noticeMessage = (options: {
  seq: number
  id?: string
  kind?: string
  form?: string
  summary?: unknown
  omitSummary?: boolean
  body?: string
  surfaceOp?: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
}): SessionEvent => ({
  type: 'user/message',
  seq: options.seq,
  time: 1_700_000_000_000 + options.seq,
  ...(options.surfaceOp === undefined ? {} : { surfaceOp: options.surfaceOp }),
  data: {
    id: options.id ?? `msg-notice-${options.seq}`,
    role: 'user',
    source: {
      kind: options.kind ?? 'acme-context',
      form: options.form ?? 'notice',
      ...(options.omitSummary === true ? {} : { summary: options.summary ?? NOTICE_SUMMARY }),
    },
    content: [{ type: 'text', text: options.body ?? NOTICE_BODY }],
  },
} as unknown as SessionEvent)
const noticeTranslatorDeps = { tools: () => undefined, scope: () => ({}), attachments: () => undefined }
const translateNotices = (events: readonly SessionEvent[]): AgentEvent[] => {
  const translator = createDshTranslator(noticeTranslatorDeps)
  return events.flatMap(event => translator.translateEvent(event))
}

const prompt = (id: string, text: string, seq: number): AgentEvent => ({
  type: 'user.message', id, anchor: String(seq), seq, time: 1_700_000_000_000 + seq, source: 'user', text, blocks: [{ type: 'text', text }],
})

interface FakeSession extends AgentSession {
  readonly submits: { text: string; placement: string }[]
  emit(events: readonly AgentEvent[]): void
}

function fakeSession(sessionId: string, capabilities: Omit<SessionCapabilities, 'native'> = {}, status: AgentSession['status'] = 'idle'): FakeSession {
  const listeners = new Set<(batch: readonly AgentEvent[], meta: { replay: boolean; wake: 'sync' }) => void>()
  const session: FakeSession = {
    ref: { backendId: 'fixture', sessionId },
    cwd: '/fixture',
    status,
    capabilities: { ...capabilities, native: {} },
    submits: [],
    history: () => Promise.resolve([]),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    submit(input, placement) {
      session.submits.push({ text: input.text, placement })
      return Promise.resolve({ accepted: true })
    },
    cancel: () => Promise.resolve({ stillQueued: [] }),
    dispose: () => Promise.resolve(),
    emit(events) {
      for (const listener of [...listeners]) listener(events, { replay: false, wake: 'sync' })
    },
  }
  return session
}

const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }

function open(session: AgentSession, options: { sessionCards?: boolean; history?: readonly AgentEvent[] } = {}) {
  return createChannel(host as never, session, {
    model: 'fixture-model',
    provider: '',
    cwd: '/fixture',
    activity: false,
    backendLabel: 'Fixture',
    // A decorated frame would be measured as content: no splash logo, no
    // scrollbar gutter, so a width assertion is about the card itself.
    minimalUi: true,
    whale: false,
    whaleIdle: false,
    scrollGutter: 'hidden',
    ...(options.sessionCards === undefined ? {} : { sessionCards: options.sessionCards }),
    ...(options.history === undefined ? {} : { initialHistory: options.history }),
  })
}

const commandRows = (channel: { rows: readonly ChatRow[] }) => channel.rows.filter(row => row.kind === 'command')
const skillRows = (channel: { rows: readonly ChatRow[] }) => channel.rows.filter(row => row.kind === 'skill')
const noticeRows = (channel: { rows: readonly ChatRow[] }) => channel.rows.filter(row => row.kind === 'context-notice')

// ── 1. 命令卡：完整正文、命令事实与锚点 ─────────────────────────────────
{
  const session = fakeSession('cards-command')
  const channel = open(session)
  check('默认通道：省略 sessionCards 时开启卡片', channel.sessionCardsEnabled === true)
  session.emit([commandResult(3, { args: ' raw', text: BODY })])
  check('命令卡：一条 command.result 出一张卡',
    await settled(() => commandRows(channel).length === 1),
    JSON.stringify(channel.rows.map(row => row.kind)))
  const row = commandRows(channel)[0]
  check('命令卡：正文完整存进行内（>200 行、>65536 码元、单行 >4000 显示单元都不截断）',
    row?.text === BODY && row.text.includes('END-OF-REPORT-BODY') && row.text.includes(LONG_LINE))
  check('命令卡：保留命令名、输入、状态与序列/时间锚点',
    row?.command?.name === 'model-context' && row.command.args === ' raw' && row.command.status === 'success'
      && row.seq === 3 && row.time === 1_700_000_000_003,
    JSON.stringify({ command: row?.command, seq: row?.seq, time: row?.time }))
  check('命令卡：命令结果不进入用户/助手行，也不投递模型输入',
    channel.rows.every(entry => entry.kind === 'command') && session.submits.length === 0)
  channel.releaseContributions()
}

// ── 2. 去重与省略 ───────────────────────────────────────────────────────
{
  const session = fakeSession('cards-dedupe')
  const channel = open(session, { sessionCards: true })
  session.emit([
    commandResult(1, { commandId: 'cmd-compact', name: 'compact', text: 'Compacted 12 history items.', coveredBySeq: 99 }),
    commandResult(2, { commandId: 'cmd-silent', name: 'alpha', text: '' }),
    commandResult(3, { commandId: 'cmd-fail', name: 'permission', outcome: 'error', text: 'preset rejected: unknown preset' }),
  ])
  const rows = commandRows(channel)
  check('去重：已有专属呈现（coveredBySeq）与无正文成功命令都不出卡；错误出错误卡',
    await settled(() => rows.length === 1) && rows[0]!.command?.status === 'error'
      && rows[0]!.text === 'preset rejected: unknown preset'
      && rows[0]!.command?.name === 'permission',
    JSON.stringify(rows.map(row => ({ command: row.command, text: row.text }))))
  channel.releaseContributions()
}

// ── 3. 恢复：durable 重放得到同样的行 ────────────────────────────────────
{
  const history: AgentEvent[] = [prompt('u1', '/model-context raw', 1), commandResult(2, { args: ' raw', text: BODY })]
  const session = fakeSession('cards-replay')
  const channel = open(session, { history })
  const live = (() => {
    const liveSession = fakeSession('cards-live')
    const liveChannel = open(liveSession)
    liveSession.emit([prompt('u1', '/model-context raw', 1), commandResult(2, { args: ' raw', text: BODY })])
    return liveChannel
  })()
  const shape = (rows: readonly ChatRow[]) => rows.map(row => ({ kind: row.kind, text: row.text, command: row.command, seq: row.seq }))
  check('恢复：重放与实时得到同一张命令卡',
    await settled(() => commandRows(channel).length === 1) && commandRows(live).length === 1
      && JSON.stringify(shape(commandRows(channel))) === JSON.stringify(shape(commandRows(live))),
    JSON.stringify(shape(commandRows(channel))))
  check('恢复：用户那一行仍是用户行（命令卡不是用户消息）',
    channel.rows.filter(row => row.kind === 'user').length === 1 && commandRows(channel)[0]?.text === BODY)
  channel.releaseContributions()
  live.releaseContributions()
}

// ── 4. 技能卡：独立记录，不生成人工气泡 ─────────────────────────────────
{
  const session = fakeSession('cards-skill')
  const channel = open(session)
  session.emit([
    prompt('u2', '/alpha', 1),
    skillLoad(2),
    { type: 'assistant.message', seq: 3, anchor: '3', turn: 1, step: 1, attemptId: 'a1', time: 3, blocks: [{ type: 'text', text: 'ok' }], canonical: true },
  ])
  const rows = skillRows(channel)
  check('技能卡：显式加载出一条独立技能卡，正文是当时注入的完整文本',
    await settled(() => rows.length === 1) && rows[0]!.skill?.name === 'alpha' && rows[0]!.text === SKILL_BODY,
    JSON.stringify(rows.map(row => ({ skill: row.skill, text: row.text.slice(0, 40) }))))
  check('技能卡：用户原文那行单独保留，没有新增人工气泡',
    channel.rows.filter(row => row.kind === 'user').length === 1
      && channel.rows.find(row => row.kind === 'user')!.text === '/alpha')
  check('技能卡：不改变 lastUserText（回退锚点仍是用户那一行）',
    channel.lastUserText === '/alpha', channel.lastUserText)
  check('技能卡：不产生模型输入，也不生成助手消息之外的模型事实',
    session.submits.length === 0 && channel.rows.filter(row => row.kind === 'assistant').length === 1)
  channel.releaseContributions()
}

// One busy input still owns one backend submission, not one per skill fact.
{
  const session = fakeSession('cards-running-multiple', {}, 'running')
  const channel = open(session)
  session.emit([{ type: 'turn.start', turn: 1, origin: 'user', time: 1_700_000_000_000 }])
  check('运行中多技能：场景开始时 channel 确实 working', channel.working === true)
  channel.submit('#skill:alpha #skill:beta')
  check('运行中多技能：一条输入只投递一次', await settled(() => session.submits.length === 1)
    && session.submits[0]?.text === '#skill:alpha #skill:beta')
  session.emit([skillLoad(60, 'alpha'), skillLoad(61, 'beta', 'BETA-RUNNING-INSTRUCTIONS-END')])
  check('运行中多技能：逐条持久加载事实分别出卡，保留顺序且不追加投递',
    await settled(() => skillRows(channel).length === 2)
      && skillRows(channel).map(row => row.skill?.name).join(',') === 'alpha,beta'
      && skillRows(channel)[1]?.text === 'BETA-RUNNING-INSTRUCTIONS-END'
      && session.submits.length === 1 && channel.working === true)
  channel.releaseContributions()
}

// ── 5. 开关关闭：保持上游形态 ───────────────────────────────────────────
{
  const session = fakeSession('cards-off')
  const channel = open(session, { sessionCards: false, history: [prompt('u3', '/model-context raw', 1), commandResult(2, { args: ' raw', text: BODY }), prompt('u4', '/alpha', 3), skillLoad(4)] })
  check('关闭开关：命令结果与技能加载都不出卡片（上游形态）',
    await settled(() => channel.rows.length >= 2)
      && commandRows(channel).length === 0 && skillRows(channel).length === 0
      && channel.rows.every(row => row.kind === 'user' || row.kind === 'assistant' || row.kind === 'turn-summary' || row.kind === 'notice'),
    JSON.stringify(channel.rows.map(row => row.kind)))
  channel.releaseContributions()
}

// ── 6. 通用上下文通知卡：任意生产者、完整正文、身份与恢复 ─────────────────
{
  const [event] = translateNotices([noticeMessage({ seq: 30, surfaceOp: 'append' })])
  check('通知卡：DSH 合法 notice（未知生产者、无 name/message）→ context.notice，保留 id/seq/time/摘要/完整正文',
    event?.type === 'context.notice' && event.id === 'msg-notice-30' && event.seq === 30
      && event.time === 1_700_000_000_030 && event.summary === NOTICE_SUMMARY && event.body === NOTICE_BODY,
    JSON.stringify(event))
  const session = fakeSession('cards-notice-live')
  const channel = open(session)
  session.emit([event!])
  const rows = noticeRows(channel)
  check('通知卡：投影为独立卡行，正文完整、摘要与消息身份/序号/时间保留，不是用户气泡',
    await settled(() => rows.length === 1)
      && rows[0]!.text === NOTICE_BODY && rows[0]!.contextNotice?.messageId === 'msg-notice-30'
      && rows[0]!.contextNotice?.summary === NOTICE_SUMMARY && rows[0]!.seq === 30 && rows[0]!.time === 1_700_000_000_030
      && channel.rows.filter(row => row.kind === 'user').length === 0,
    JSON.stringify(rows.map(row => ({ kind: row.kind, seq: row.seq, text: row.text.slice(0, 20) }))))
  check('通知卡：不产生额外 toast/通知，也不投递模型输入', channel.notifications.length === 0 && session.submits.length === 0)
  channel.releaseContributions()
}

// Producer provenance and exact whitespace are durable, not inferred render text.
{
  const body = '\n  INDENTED-NOTICE-BODY\n\n'
  const [event] = translateNotices([noticeMessage({ seq: 39, body })])
  check('通知卡：保留来源标识和正文的首尾空白',
    event?.type === 'context.notice' && 'source' in event && event.source === 'acme-context' && event.body === body)
  const session = fakeSession('cards-notice-provenance')
  const channel = open(session, { history: [event!] })
  check('通知卡：投影保留实际来源而不是仅有形态标签',
    JSON.stringify(noticeRows(channel)[0]?.contextNotice).includes('acme-context'))
  channel.releaseContributions()
}

// 同来源多条独立；replacement 副本隐藏；实时与恢复同形。
{
  const live = translateNotices([
    noticeMessage({ seq: 31, surfaceOp: 'append', summary: 'first notice' }),
    noticeMessage({ seq: 32, id: 'msg-notice-second', surfaceOp: 'append', summary: 'second notice' }),
  ])
  const session = fakeSession('cards-notice-multiple')
  const channel = open(session)
  session.emit(live)
  const rows = noticeRows(channel)
  check('通知卡：同来源的多条通知各自一张卡，摘要互不覆盖',
    await settled(() => rows.length === 2)
      && rows[0]!.contextNotice?.summary === 'first notice' && rows[1]!.contextNotice?.summary === 'second notice'
      && rows[0]!.seq === 31 && rows[1]!.seq === 32,
    JSON.stringify(rows.map(row => ({ seq: row.seq, summary: row.contextNotice?.summary }))))
  const [replacement] = translateNotices([noticeMessage({ seq: 33, surfaceOp: { op: 'replace', startSeq: 31, endSeq: 32 } })])
  check('通知卡：replacement 副本是模型面材料，翻译为隐藏注入而不是通知卡',
    replacement?.type === 'user.message' && replacement.source === 'injected' && replacement.text === '')
  session.emit([replacement!])
  check('通知卡：隐藏的 replacement 不加行、不产生用户气泡',
    await settled(() => noticeRows(channel).length === 2) && channel.rows.length === 2)
  const replaySession = fakeSession('cards-notice-replay')
  const replayChannel = open(replaySession, { history: live })
  const shape = (target: { rows: readonly ChatRow[] }) => target.rows.map(row => ({ kind: row.kind, text: row.text, notice: row.contextNotice, seq: row.seq, time: row.time }))
  check('通知卡：durable 重放与实时得到同形的卡片',
    await settled(() => noticeRows(replayChannel).length === 2) && JSON.stringify(shape(replayChannel)) === JSON.stringify(shape(channel)),
    JSON.stringify(shape(replayChannel)))
  channel.releaseContributions()
  replayChannel.releaseContributions()
}

{
  const history = translateNotices([noticeMessage({ seq: 34, surfaceOp: 'append' })])
  const session = fakeSession('cards-notice-off')
  const channel = open(session, { sessionCards: false, history })
  check('通知卡：sessionCards 关闭时不产生新卡，转录保持上游形态',
    await settled(() => channel.rows.length === 0) && noticeRows(channel).length === 0,
    JSON.stringify(channel.rows.map(row => row.kind)))
  channel.releaseContributions()
}

// A first-party producer follows exactly the same generic form contract.
{
  const session = fakeSession('cards-subagent-settled')
  const channel = open(session, { history: translateNotices([noticeMessage({ seq: 38, kind: 'subagent-settled', summary: 'Child settled' })]) })
  check('通知卡：核心 subagent-settled 也按 form 显示，不生成人工气泡',
    noticeRows(channel).length === 1 && channel.rows.every(row => row.kind !== 'user'))
  channel.releaseContributions()
}

// ── 7. 内存约束：窗口折叠 + 按持久锚点从日志恢复 ─────────────────────────
{
  const rows: ChatRow[] = [
    { id: 0, kind: 'command', text: BODY, seq: 2, time: 1, command: { commandId: 'cmd-1', name: 'model-context', args: ' raw', status: 'success' } },
    { id: 1, kind: 'user', text: 'after', seq: 3, anchor: '3' },
  ]
  check('内存：超出窗口时命令卡被折叠成预览（正文不再常驻）', foldRows(rows, 1, undefined, () => true) === 1 && (rows[0]!.text.length < 240) && rows[0]!.command?.name === 'model-context')
  const events = [
    { type: 'command/run', seq: 1, time: 1, data: { commandId: 'cmd-1', name: 'model-context', args: ' raw', source: { kind: 'user' } } },
    { type: 'command/done', seq: 2, time: 1, data: { commandId: 'cmd-1', kind: 'success', text: BODY } },
  ] as unknown as readonly SessionEvent[]
  check('内存：loadOlder 按 commandId 从日志恢复完整正文', foldBack(rows, events) === 1 && rows[0]!.text === BODY && rows[0]!.folded !== true)
}

{
  const rows: ChatRow[] = [
    { id: 0, kind: 'context-notice', text: NOTICE_BODY, seq: 35, time: 1_700_000_000_035, contextNotice: { messageId: 'msg-notice-35', source: 'acme-context', summary: NOTICE_SUMMARY } },
    { id: 1, kind: 'user', text: 'after', seq: 36, anchor: '36' },
  ]
  check('内存：通知卡超出窗口时正文降为预览，摘要/消息身份/序号保留',
    foldRows(rows, 1, undefined, () => true) === 1 && rows[0]!.text.length < NOTICE_BODY.length
      && rows[0]!.folded === true && rows[0]!.contextNotice?.messageId === 'msg-notice-35'
      && rows[0]!.contextNotice?.summary === NOTICE_SUMMARY && rows[0]!.seq === 35)
  check('内存：loadOlder 按通知消息的持久 seq 恢复完整正文（不读技能文件、不重注入）',
    foldBack(rows, [noticeMessage({ seq: 35, surfaceOp: 'append' })]) === 1
      && rows[0]!.text === NOTICE_BODY && rows[0]!.folded !== true
      && rows[0]!.contextNotice?.messageId === 'msg-notice-35')
}

// ── 8/9. 渲染：折叠/展开、点击、40/100 列、不执行命令 ────────────────────
class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}

async function mountChat(node: React.ReactNode, columns: number, fullscreen: boolean) {
  const rows = 40
  const terminal = new XTerm({ cols: columns, rows, scrollback: 200, allowProposedApi: true })
  class Output extends Writable {
    columns = columns
    rows = rows
    isTTY = true
    _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
  }
  const stdout = new Output()
  const input = new Input()
  const content = <ThemeProvider theme="dark">{node}</ThemeProvider>
  const instance = await render(fullscreen ? <AlternateScreen mouseTracking>{content}</AlternateScreen> : content, {
    stdout: stdout as never, stdin: input as never, stderr: stdout as never, exitOnCtrlC: false, patchConsole: false,
  })
  return {
    input,
    lines: () => viewportLines(terminal, rows),
    screen: () => viewportLines(terminal, rows).join('\n'),
    async close() { await instance.unmount(); terminal.dispose(); input.destroy() },
  }
}

for (const { columns, fullscreen } of [
  { columns: 100, fullscreen: false },
  { columns: 40, fullscreen: false },
  { columns: 100, fullscreen: true },
]) {
  const label = `${fullscreen ? 'fullscreen' : 'inline'} ${columns} 列`
  const history: AgentEvent[] = [
    prompt('u5', '/model-context raw', 1),
    commandResult(2, { args: ' raw', text: BODY }),
    prompt('u6', '/alpha', 3),
    skillLoad(4),
  ]
  const session = fakeSession(`cards-render-${columns}-${fullscreen}`)
  const channel = open(session, { sessionCards: true, history })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={fullscreen} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    columns,
    fullscreen,
  )
  const rowCount = channel.rows.length
  try {
    check(`${label}：默认折叠只显示标题与摘要（正文末尾不在屏上）`,
      await settled(() => h.screen().includes('/model-context raw') && h.screen().includes('HEAD: the report opens here'))
        && !h.screen().includes('END-OF-REPORT-BODY'),
      h.screen().split('\n').filter(line => line.includes('model-context')).join(' | '))
    check(`${label}：技能卡默认折叠显示名称与「已加载指令」`,
      await settled(() => h.screen().includes('[技能] alpha') && h.screen().includes('已加载指令'))
        && !h.screen().includes('ALPHA-MARKER'),
      h.screen().split('\n').filter(line => line.includes('技能')).join(' | '))
    // Ctrl+O：既有的全局展开开关，展开后能读到正文末尾。
    h.input.write('\x0f')
    check(`${label}：Ctrl+O 展开后读到命令正文末尾（不受旧 200 行/65536 码元限制）`,
      await settled(() => h.screen().includes('END-OF-REPORT-BODY')),
      h.screen().split('\n').slice(-4).join(' | '))
    check(`${label}：展开后技能卡正文完整可见`,
      await settled(() => h.screen().includes('ALPHA-MARKER')))
    const cardLines = h.lines().filter(line => /REPORT-|中文😀|END-OF-REPORT-BODY|⏵|\[技能\]/.test(line))
    check(`${label}：展开含中文/emoji 超长行时每行不越界`,
      cardLines.length > 0 && cardLines.every(line => displayWidth(line) <= columns),
      JSON.stringify(cardLines.filter(line => displayWidth(line) > columns).slice(0, 5).map(line => [displayWidth(line), line])))
    check(`${label}：展开/折叠不执行命令、不新增行、不投递模型输入`,
      channel.rows.length === rowCount && session.submits.length === 0 && commandRows(channel).length === 1)
    h.input.write('\x0f')
    check(`${label}：再次 Ctrl+O 收起到摘要`, await settled(() => !h.screen().includes('END-OF-REPORT-BODY')))
    // 逐行展开：点击卡片行（既有的 expandedRows 手势）。Inline 模式交给终端
    // 原生鼠标行为（应用不接管指针），所以只在 fullscreen 断言点击。
    const lines = h.lines()
    // 卡行带 `⏵` 标记：fullscreen 顶部还有一条 sticky 提示头，同样含用户原文。
    const cardRow = lines.findIndex(line => line.includes('⏵ /model-context'))
    check(`${label}：折叠时能找到命令卡行`, cardRow >= 0)
    if (cardRow >= 0 && fullscreen) {
      const col = lines[cardRow]!.indexOf('/model-context') + 2
      h.input.write(`\x1b[<0;${col};${cardRow + 1}M`)
      h.input.write(`\x1b[<0;${col};${cardRow + 1}m`)
      check(`${label}：点击命令卡行逐行展开正文`,
        await settled(() => h.screen().includes('END-OF-REPORT-BODY')))
    }
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

// 通用通知卡渲染：默认折叠显示来源标签与摘要，Ctrl+O 展开完整正文；
// 40/100 列下 CJK/emoji/ANSI 都不越界且不显示原始转义序列。
for (const { columns, fullscreen } of [
  { columns: 100, fullscreen: false },
  { columns: 40, fullscreen: false },
]) {
  const label = `通知卡 ${fullscreen ? 'fullscreen' : 'inline'} ${columns} 列`
  const history = translateNotices([noticeMessage({ seq: 40, surfaceOp: 'append' })])
  const session = fakeSession(`notice-render-${columns}-${fullscreen}`)
  const channel = open(session, { sessionCards: true, history })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={fullscreen} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    columns,
    fullscreen,
  )
  const rowCount = channel.rows.length
  try {
    check(`${label}：默认折叠只显示中性标签与摘要（正文末尾不在屏上）`,
      await settled(() => h.screen().includes('[通知]') && h.screen().includes('acme-context') && h.screen().includes('CONTEXT-NOTICE-SUMMARY'))
        && !h.screen().includes('END-OF-NOTICE-BODY') && !h.screen().includes('\u001b[31m'),
      h.screen().split('\n').filter(line => line.includes('[通知]') || line.includes('CONTEXT-NOTICE')).join(' | '))
    h.input.write('\x0f')
    check(`${label}：Ctrl+O 展开完整持久正文（ANSI 被清理、CJK/emoji 保留、末尾可见）`,
      await settled(() => h.screen().includes('END-OF-NOTICE-BODY') && h.screen().includes('RED-CONTEXT-MARKER'))
        && !h.screen().includes('\u001b[31m'),
      h.screen().split('\n').slice(-4).join(' | '))
    const noticeLines = h.lines().filter(line => /\[通知\]|CONTEXT-NOTICE|NOTICE-HEAD|RED-CONTEXT|通知😀|END-OF-NOTICE/.test(line))
    check(`${label}：含中文/emoji 的正文每一行都不越界`,
      noticeLines.length > 0 && noticeLines.every(line => displayWidth(line) <= columns),
      JSON.stringify(noticeLines.filter(line => displayWidth(line) > columns).slice(0, 5).map(line => [displayWidth(line), line])))
    check(`${label}：展开/折叠不新增行、不投递模型输入`, channel.rows.length === rowCount && session.submits.length === 0)
    h.input.write('\x0f')
    check(`${label}：再次 Ctrl+O 收起到摘要`, await settled(() => !h.screen().includes('END-OF-NOTICE-BODY')))
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

// 点击既有逐行展开手势（inline 模式交给终端原生鼠标行为，只在 fullscreen 断言）。
{
  const history = translateNotices([noticeMessage({ seq: 41, surfaceOp: 'append' })])
  const session = fakeSession('notice-render-click')
  const channel = open(session, { sessionCards: true, history })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    100,
    true,
  )
  try {
    await settled(() => h.screen().includes('[通知]'))
    const lines = h.lines()
    const noticeRow = lines.findIndex(line => line.includes('[通知]'))
    check('通知卡：折叠时能找到通知卡行', noticeRow >= 0)
    if (noticeRow >= 0) {
      const col = lines[noticeRow]!.indexOf('[通知]') + 2
      h.input.write(`\x1b[<0;${col};${noticeRow + 1}M`)
      h.input.write(`\x1b[<0;${col};${noticeRow + 1}m`)
      check('通知卡：点击卡行逐行展开完整正文',
        await settled(() => h.screen().includes('END-OF-NOTICE-BODY')))
    }
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

// ── 9. 消息选择里按 Enter 展开（既有的逐行展开手势）──────────────────────
// `enterSelection` 就地从 channel.rows 按 SELECTABLE_KINDS 取最后一条可选行：
// 这条断言同时保护卡行进入可选集合与普通行的选择定位。
async function mountSelectionCase(sessionId: string, history: readonly AgentEvent[], columns = 100) {
  const session = fakeSession(sessionId)
  const channel = open(session, { sessionCards: true, history })
  const controller: { current: unknown } = { current: null }
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={controller as never} />,
    columns,
    false,
  )
  const enter = async () => {
    h.input.write('\x1b[1;2A')
    // 等选择模式真的画出来（状态行提示）再送 Enter：否则按键落在上一帧的
    // 闭包里（selectionActive 还是 false），会被输入框吃掉。
    await settle(() => h.screen().includes('esc 返回输入') || controller.current !== null)
    await settle(() => h.screen().includes('esc 返回输入'))
    h.input.write('\r')
  }
  return { channel, h, session, enter, close: async () => { await h.close(); channel.releaseContributions() } }
}

{
  const { h, enter, close } = await mountSelectionCase('cards-select-command', [commandResult(1, { args: ' raw', text: 'SELECTION-MARKER\nsecond line' })])
  try {
    check('消息选择：命令卡是可选行，默认折叠',
      await settled(() => h.screen().includes('⏵ /model-context raw')) && !h.screen().includes('second line'))
    await enter()
    check('消息选择：Enter 展开命令卡正文', await settled(() => h.screen().includes('second line')),
      h.screen().split('\n').filter(line => line.includes('MARKER') || line.includes('second')).join(' | '))
    // 固定窗:墙钟 Enter 确认有 80ms 去抖（lastModalEnterAt），收起必须等它过期。
    await sleep(120)
    h.input.write('\r')
    check('消息选择：再按 Enter 收起命令卡', await settled(() => !h.screen().includes('second line')))
  } finally {
    await close()
  }
}

{
  const { h, enter, close } = await mountSelectionCase('cards-select-skill', [prompt('u9', '/alpha', 1), skillLoad(2)])
  try {
    check('消息选择：技能卡默认折叠', await settled(() => h.screen().includes('[技能] alpha')) && !h.screen().includes('ALPHA-MARKER'))
    await enter()
    check('消息选择：Enter 展开技能卡正文（最后一条可选行是技能卡）',
      await settled(() => h.screen().includes('ALPHA-MARKER')),
      h.screen().split('\n').filter(line => line.includes('MARKER')).join(' | '))
  } finally {
    await close()
  }
}

{
  const history = translateNotices([noticeMessage({ seq: 42, surfaceOp: 'append' })])
  const { h, enter, close } = await mountSelectionCase('cards-select-notice', history)
  try {
    check('消息选择：通知卡是可选行，默认折叠', await settled(() => h.screen().includes('[通知]')) && !h.screen().includes('END-OF-NOTICE-BODY'))
    await enter()
    check('消息选择：Enter 展开通知卡完整正文',
      await settled(() => h.screen().includes('END-OF-NOTICE-BODY')),
      h.screen().split('\n').filter(line => line.includes('NOTICE')).join(' | '))
  } finally {
    await close()
  }
}

{
  // 选择定位的保护：最后一条可选行是普通用户行时，Enter 展开的是那一行，
  // 命令卡保持折叠（光标没有跑到别处）。
  const longUserLine = `USER-FOLDED-LINE-${'y'.repeat(1200)}`
  const { h, enter, close } = await mountSelectionCase('cards-select-user', [
    prompt('u10', '/model-context raw', 1),
    commandResult(2, { args: ' raw', text: 'CARD-BODY-MARKER\nCARD-SECOND-LINE' }),
    prompt('u11', longUserLine, 3),
  ])
  try {
    check('消息选择：进入选择后普通用户行带折叠标记',
      await settled(() => h.screen().includes('已折叠')), h.screen().split('\n').slice(-6).join(' | '))
    await enter()
    check('消息选择：Enter 展开最后一条可选（用户）行，命令卡仍折叠',
      await settled(() => !h.screen().includes('已折叠')) && !h.screen().includes('CARD-SECOND-LINE'))
  } finally {
    await close()
  }
}

console.log(failed === 0 ? 'verify-session-cards OK' : `verify-session-cards: ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)

/** 显示宽度：不依赖渲染器的最小实现（CJK/emoji 宽 2），ANSI 已由解析后的屏幕文本去掉。 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text.replace(/\x1b\[[0-9;]*m/g, '')) {
    const code = char.codePointAt(0) ?? 0
    width += (code >= 0x1100 && (
      code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)
    )) ? 2 : 1
  }
  return width
}
