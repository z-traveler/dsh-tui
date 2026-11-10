/**
 * 工单 02：通用自定义卡片的端到端回归（官方 Session 记录 → 真实 DSH 翻译器 →
 * 共享投影器 → 真实 Chat 渲染；窗口折叠与日志恢复；技能与命令的共享宿主）。
 *
 * 观察面从持久化事实开始：官方 `appendPluginRecord` 把 `plugin:dsh-tui/card`
 * 记录写进真实 Session；只有这条载体被翻译成 `card.upsert`，其余插件记录仍走
 * 既有 renderer 缝隙，坏载荷被丢弃而不是显示。投影按业务 `(type, id)` 更新同一
 * 张卡（保留行 id、初始 seq/time 与位置，记最新内容 seq），窗口折叠释放完整展示，
 * `foldBack`/`loadOlder` 用当前 host presenter 从日志恢复最新状态。
 *
 * 覆盖：
 *   1. 翻译器：有效/坏载荷/非本载体；同 id 更新序列；
 *   2. 共享投影：同 id 同卡更新、不同类型同 id 隔离、旧 seq/重放不重复、
 *      无 presenter/异常 presenter 降级、sessionCards 关闭、reset 隔离；
 *   3. 恢复：真实 Session 重放与分叉取最新状态；DSH foldRows/foldBack（含折叠
 *      期间到达的更新）；中性 transcript 翻页（restoreFoldedRows/
 *      projectHistorySlice/prependHistoryRows 的身份去重）；
 *   4. 命令展示适配：真实 host 注册 `command/<name>` 接管，data 字段与
 *      dsh-context 契约一致（commandId/name/args/outcome/text），未注册命令保持原卡；
 *   5. 技能卡：仍由正式 skill.invocation 事实驱动，共享宿主展示，不新增记录；
 *   6. 真实 Chat（40/100 列、inline/fullscreen）：标题/摘要、展开末尾、Markdown、
 *      表格字面量（竖线/换行不清失）、中文/emoji、逐行 Enter/点击、同长度更新
 *      仍改变高度、无模型投递。
 *
 * 运行：node --import tsx/esm scripts/downstream/verify-custom-card-flow.tsx
 */
import '../lib/fake-home.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'zh'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
process.env.DSH_TUI_ADAPTER_MODE = 'new'

import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import type { Session as DshSession, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentSession, SessionCapabilities } from '../../src/agent/session.js'
import type { AgentEvent } from '../../src/agent/events.js'
import type { TuiCardRecord, TuiCardView } from '../../src/agent/cards.js'
import type { ChatRow } from '../../src/adapter/ports/channel-view.js'

// 工单 05 的写入桥落在 `src/cards-dsh.ts`（公开入口 ./cards/dsh）之前，验证脚本
// 直接调用官方导出（ADR0013 记录的下游私有例外），这里只为这次调用补类型声明。
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:dsh-tui/card': TuiCardRecord
  }
}

const [
  React,
  { Terminal: XTerm },
  { render, AlternateScreen, ThemeProvider },
  { Chat },
  { createChannel },
  { QuestionStore },
  { ApprovalStore },
  { settled, settle, viewportLines },
  { foldRows, foldBack },
  { Config },
  { createDshTranslator, dshEmits },
  { Context },
  { Session, appendPluginRecord, pluginRecordOf },
  { TuiRendererRuntime, getHostRenderers },
  { mountAdmitted, mountAdmissionHost, testManifest },
  { anchoredRow, prependHistoryRows, projectHistorySlice, restoreFoldedRows },
  { cardPlainText, TUI_CARD_RECORD_TYPE },
  { createProjectorHarness },
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
  import('@deepseek-ai/cordis'),
  import('@deepseek-ai/dsh-session'),
  import('../../src/dsh-adapter/renderers.js'),
  import('../lib/plugin-test-utils.js'),
  import('../../src/channel/history-restore.js'),
  import('../../src/cards.js'),
  import('../lib/projector-harness.js'),
])

let failed = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

check('默认配置：省略 sessionCards 时开启卡片', Config({}).sessionCards === true)
check('DSH 翻译器声明会发出 card.upsert', dshEmits('card.upsert') === true)

// ── 真实宿主面：tuiRenderers 行 + 一个准入插件注册展示适配 ─────────────────
const root = new Context()
await root.plugin(TuiRendererRuntime)
await mountAdmissionHost(root, 'custom card flow')
const rendererHost = getHostRenderers(root.get('tuiRenderers'))!

const ALPHA_BODY = '<skill_content name="alpha">\n<skill_instructions>\nALPHA-MARKER: follow the alpha guide.\n</skill_instructions>\n</skill_content>'

/** 一张卡的快照（producer 侧构造，随后经官方 appendPluginRecord 写入）。 */
function cardRecord(options: {
  id?: string
  type?: string
  title?: string
  summary?: string
  body?: string
  rows?: number
}): TuiCardRecord {
  const title = options.title ?? 'Report'
  return {
    version: 1,
    type: options.type ?? 'acme/report',
    id: options.id ?? 'report-1',
    data: {
      title,
      rows: options.rows ?? 1,
      ...(options.summary === undefined ? {} : { summary: options.summary }),
      ...(options.body === undefined ? {} : { body: options.body }),
    },
    fallback: {
      title,
      ...(options.summary === undefined ? {} : { summary: options.summary }),
      body: `FALLBACK-BODY ${title}`,
    },
  }
}

/**
 * 同一张卡的一个提交快照（card.upsert）：用来构造“滞后于实时更新的记录读取”。
 * seq 就是提交位置；恢复路径必须按它判断新旧。
 */
function cardSnapshot(seq: number, title: string, body: string, id = 'stale-1'): AgentEvent {
  return { type: 'card.upsert', record: cardRecord({ id, title, body }), seq, time: 1_700_000_000_000 + seq }
}

/** acme 的展示适配：Markdown 正文 + 结构化表格（单元含竖线与换行）。 */
function reportView(title: string, summary: string, body: string): TuiCardView {
  return {
    title,
    label: 'acme',
    summary,
    blocks: [
      { kind: 'markdown', text: `## ${title}\n\n- **粗体** 与 \`行内代码\`\n- 中文😀 行` },
      {
        kind: 'table',
        columns: ['producer', 'command'],
        rows: [
          ['dsh-context', 'a|b 竖线'],
          ['多行单元', '第一行\n第二行'],
        ],
      },
      { kind: 'text', text: body },
    ],
  }
}

/** dsh-context 风格的命令展示适配：只读 name/outcome/text。 */
function contextView(data: TuiCardRecord['data']): TuiCardView {
  const record = data as { name: string; outcome: string; text: string }
  return {
    title: `Command ${record.name}`,
    label: 'dsh-context',
    summary: record.outcome,
    blocks: [{ kind: 'markdown', text: `**${record.text}**` }],
  }
}

let readingPresentations = 0
let admitted = await mountAdmitted(root, 'custom-card-presenter', testManifest({ id: 'com.example.custom-card-flow' }))
await admitted.context.inject(['tuiRenderers'], (ctx) => {
  const renderers = ctx.get('tuiRenderers')!
  renderers.registerCard('acme/report', (data) => {
    const record = data as { title: string; summary?: string; body?: string }
    return reportView(record.title, record.summary ?? '', record.body ?? 'TAIL-OF-CARD-BODY')
  })
  renderers.registerCard('acme/throw', () => { throw new Error('presenter failed') })
  // 原始 HTML 包装的正文：块级 wrapper 与行内 XML 都是记录里的事实。
  renderers.registerCard('acme/html', () => ({
    title: 'HTML 卡',
    blocks: [
      { kind: 'markdown', text: '<system-reminder>\nCARD_HTML_END\n</system-reminder>' },
      { kind: 'markdown', text: 'before <context-notes>INLINE_XML_END</context-notes> after' },
    ],
  }))
  renderers.registerCard('command/report', contextView)
  renderers.registerCard('acme/reading', () => {
    readingPresentations++
    return {
      title: 'Readable overview',
      preview: [{ kind: 'text', text: 'OVERVIEW_VISIBLE' }],
      blocks: [{ kind: 'text', text: 'DETAIL_ONLY_VISIBLE' }],
    }
  })
  // 声明紧凑密度的卡片：同一份展示契约，只多一个 `density: 'compact'`。
  renderers.registerCard('acme/compact', (data) => {
    const record = data as { title: string; body?: string }
    return {
      label: '上下文',
      title: record.title,
      density: 'compact',
      blocks: [{ kind: 'text', text: record.body ?? 'COMPACT-BODY' }],
    }
  })
  // 同一份内容不声明密度：用来对照紧凑密度到底少掉了哪几行。
  renderers.registerCard('acme/plain', (data) => {
    const record = data as { title: string; body?: string }
    return {
      label: '上下文',
      title: record.title,
      blocks: [{ kind: 'text', text: record.body ?? 'COMPACT-BODY' }],
    }
  })
})

/** Cordis 风格的最小宿主上下文：只有 tuiRenderers 服务是真的。 */
const hostContext = {
  on: () => () => undefined,
  get: (name: string) => (name === 'tuiRenderers' ? root.get('tuiRenderers') : undefined),
  logger: { warn() {}, info() {}, debug() {} },
}

// ── 1. 官方 Session 记录 → 真实翻译器 ──────────────────────────────────────
const translatorDeps = { tools: () => undefined, scope: () => ({}), attachments: () => undefined }
const liveSession: DshSession = Session.create('card-flow-live')
const v1 = cardRecord({ title: '报告 v1', summary: '第一版' })
const seq1 = appendPluginRecord(liveSession, TUI_CARD_RECORD_TYPE, v1)
const v2 = cardRecord({ title: '报告 v2', summary: '第二版' })
const seq2 = appendPluginRecord(liveSession, TUI_CARD_RECORD_TYPE, v2)
const seq3 = appendPluginRecord(liveSession, TUI_CARD_RECORD_TYPE, cardRecord({ type: 'acme/other', title: '另一类' }))
const seqInvalid = appendPluginRecord(liveSession, TUI_CARD_RECORD_TYPE, { ...v1, version: 2 } as never)
const seqNote = appendPluginRecord(liveSession, 'plugin:acme/note', { title: 'note', lines: ['x'] } as never)
const liveEvents = liveSession.snapshotEvents()
const translator = createDshTranslator(translatorDeps)
const perEvent = liveEvents.map(event => translator.translateEvent(event))
const translationOf = (seq: number): readonly AgentEvent[] => perEvent[liveEvents.findIndex(event => event.seq === seq)] ?? []
const recordAt = (seq: number) => pluginRecordOf(liveEvents.find(event => event.seq === seq)!)!

{
  const [first] = translationOf(seq1)
  check('翻译器：官方载体记录 → card.upsert，保留完整快照、提交 seq 与 time',
    first?.type === 'card.upsert' && first.record.type === 'acme/report'
      && first.record.id === 'report-1' && first.seq === seq1 && first.time === recordAt(seq1).time
      && first.record.fallback?.title === '报告 v1',
    JSON.stringify(first))
  const [second] = translationOf(seq2)
  check('翻译器：同 id 的第二次提交是同一身份、更新的 seq 与新内容',
    second?.type === 'card.upsert' && second.record.id === 'report-1'
      && second.seq > seq1 && second.record.fallback?.title === '报告 v2')
  const [third] = translationOf(seq3)
  check('翻译器：类型不同的同 id 是另一身份',
    third?.type === 'card.upsert' && third.record.id === 'report-1' && third.record.type === 'acme/other')
  check('翻译器：坏载荷快照被丢弃，不成为卡片事件',
    translationOf(seqInvalid).length === 0)
  check('翻译器：其他插件记录仍走通用 renderer 缝隙（不被当成卡片）',
    translationOf(seqNote).some(event => event.type === 'custom' && event.nativeType === 'plugin:acme/note'))
}

// ── 2. 共享投影：更新、隔离、去重、降级、开关、reset ────────────────────────
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

function open(session: AgentSession, options: { sessionCards?: boolean; history?: readonly AgentEvent[] } = {}, services = hostContext) {
  return createChannel(services as never, session, {
    model: 'fixture-model',
    provider: '',
    cwd: '/fixture',
    activity: false,
    backendLabel: 'Fixture',
    minimalUi: true,
    whale: false,
    whaleIdle: false,
    scrollGutter: 'hidden',
    ...(options.sessionCards === undefined ? {} : { sessionCards: options.sessionCards }),
    ...(options.history === undefined ? {} : { initialHistory: options.history }),
  })
}

const cardRows = (target: { rows: readonly ChatRow[] }) => target.rows.filter(row => row.kind === 'card')
const cardIdentity = (row: ChatRow) => `${row.card?.type}/${row.card?.id}`

// The direct launcher creates its channel before the profile mounts services.
{
  let visible = false
  const lateHost = { ...hostContext, get: (name: string) => visible ? hostContext.get(name) : undefined }
  const session = fakeSession('late-card-service')
  const channel = open(session, {}, lateHost)
  visible = true
  session.emit(translationOf(seq1))
  check('入口：通道创建后才出现的展示服务仍能接管卡片',
    await settled(() => cardRows(channel)[0]?.card?.view?.title === '报告 v1' && cardRows(channel)[0]?.card?.view?.label === 'acme'))
  session.emit([{ type: 'command.result', commandId: 'late-command', name: 'report', outcome: 'success', text: 'late body', seq: 80, time: 80 }])
  check('入口：晚挂载的命令展示适配也使用当前宿主注册表',
    await settled(() => channel.rows.find(row => row.command?.commandId === 'late-command')?.card?.view?.title === 'Command report'))
  channel.releaseContributions()
}

{
  const session = fakeSession('card-flow-live-updates')
  const channel = open(session)
  session.emit(translationOf(seq1))
  const first = cardRows(channel)[0]
  check('投影：一条记录一张卡行，标题/摘要来自展示适配',
    await settled(() => cardRows(channel).length === 1)
      && first?.card?.view?.title === '报告 v1' && first.card.view.summary === '第一版'
      && first.seq === seq1 && first.time === recordAt(seq1).time,
    JSON.stringify({ card: first?.card, seq: first?.seq }))
  const rowId = first?.id
  check('投影：行正文是可读纯文本（供搜索与折叠预览）',
    first !== undefined && first.text === cardPlainText(first.card!.view!)
      && first.text.includes('报告 v1') && first.text.includes('TAIL-OF-CARD-BODY'))
  session.emit(translationOf(seq2))
  const updated = cardRows(channel)[0]
  check('投影：同类型同 id 更新同一行（不新增卡片、行 id/初始 seq/time 不变）',
    await settled(() => updated?.card?.latestSeq === seq2)
      && cardRows(channel).length === 1 && updated.id === rowId
      && updated.seq === seq1 && updated.card.view?.title === '报告 v2'
      && updated.text.includes('报告 v2') && !updated.text.includes('报告 v1'),
    JSON.stringify({ rows: cardRows(channel).length, latestSeq: updated?.card?.latestSeq }))
  session.emit(translationOf(seq3))
  check('投影：不同类型同 id 各自一行，身份互不覆盖',
    await settled(() => cardRows(channel).length === 2)
      && cardRows(channel)[1]!.card?.type === 'acme/other' && cardRows(channel)[1]!.card?.view?.title === '另一类')
  session.emit([...translationOf(seq1), ...translationOf(seq2)])
  check('投影：重复投递旧 seq 不新增行、不回退内容',
    await settled(() => cardRows(channel).length === 2)
      && cardRows(channel)[0]!.card?.latestSeq === seq2
      && cardRows(channel)[0]!.card?.view?.title === '报告 v2')
  check('投影：卡片不投递模型输入，也不成为用户/助手行',
    session.submits.length === 0 && channel.rows.every(row => row.kind === 'card'))
  channel.releaseContributions()
}

{
  // 无展示适配与异常展示适配：都降级到记录自己的可读内容。
  const channel = open(fakeSession('card-flow-fallback'), {
    history: [
      { type: 'card.upsert', record: cardRecord({ type: 'acme/unregistered' }), seq: 5, time: 5 },
      { type: 'card.upsert', record: cardRecord({ type: 'acme/throw', id: 'throw-1' }), seq: 6, time: 6 },
    ],
  })
  check('降级：没有展示适配时读记录自己的降级内容',
    await settled(() => cardRows(channel).length === 2)
      && cardRows(channel)[0]!.card?.view?.title === 'Report'
      && cardRows(channel)[0]!.text.includes('FALLBACK-BODY'),
    JSON.stringify(cardRows(channel).map(row => row.card?.view?.title)))
  check('降级：展示适配抛错时同样降级，不破坏会话',
    cardRows(channel)[1]!.card?.view?.title === 'Report' && cardRows(channel)[1]!.text.includes('FALLBACK-BODY'))
  channel.releaseContributions()
}

{
  const channel = open(fakeSession('card-flow-off'), { sessionCards: false, history: translationOf(seq1) })
  check('开关：sessionCards 关闭时不产生卡片行', await settled(() => channel.rows.length === 0) && cardRows(channel).length === 0)
  channel.releaseContributions()
}

{
  // reset（/clear、adoption）后身份账本一起清空：同一身份可以重新出现。
  const harness = createProjectorHarness({ sessionCards: true, renderer: rendererHost })
  harness.apply([{ type: 'card.upsert', record: cardRecord({}), seq: 5, time: 5 }], false)
  const before = cardRows(harness.state).length
  harness.projector.reset()
  harness.state.rows.length = 0
  harness.apply([{ type: 'card.upsert', record: cardRecord({ title: 'reset 后' }), seq: 1, time: 1 }], false)
  check('隔离：reset 清空卡片身份账本后，低 seq 的同身份记录重新成为一张卡',
    before === 1 && cardRows(harness.state).length === 1
      && cardRows(harness.state)[0]!.card?.latestSeq === 1
      && cardRows(harness.state)[0]!.card?.view?.title === 'reset 后')
  harness.projector.reset()
  harness.state.rows.length = 0
  harness.apply([{ type: 'card.upsert', record: cardRecord({ id: 'other-session-card' }), seq: 1, time: 1 }], true)
  check('隔离：重放（新会话种子）按提交 seq 重建，不沿用旧会话的身份',
    cardRows(harness.state).length === 1 && cardRows(harness.state)[0]!.card?.id === 'other-session-card')
}

// ── 3. 恢复：真实 Session 重放/分叉 + DSH 折叠 + 中性翻页 ──────────────────
const replayEvents = (session: DshSession): AgentEvent[] => createDshTranslator(translatorDeps).translateReplay(session.snapshotEvents())

{
  const replayChannel = open(fakeSession('card-flow-replay'), { history: replayEvents(liveSession) })
  check('恢复：真实日志重放得到最新状态（同 id 一张卡，内容是最新快照）',
    await settled(() => cardRows(replayChannel).length === 2)
      && cardRows(replayChannel)[0]!.card?.latestSeq === seq2
      && cardRows(replayChannel)[0]!.card?.view?.title === '报告 v2',
    JSON.stringify(cardRows(replayChannel).map(row => [row.card?.type, row.card?.view?.title])))
  // 分叉：新 Session 以旧日志为种子，之后追加第三次更新。
  const forked = Session.create('card-flow-fork', liveSession.snapshotEvents())
  const forkSeq = appendPluginRecord(forked, TUI_CARD_RECORD_TYPE, cardRecord({ title: '报告 v3' }))
  const forkChannel = open(fakeSession('card-flow-fork'), { history: replayEvents(forked) })
  check('恢复：分叉会话重放取最新快照（原身份一张卡、标题为分叉后的更新）',
    await settled(() => cardRows(forkChannel).length === 2)
      && cardRows(forkChannel)[0]!.card?.view?.title === '报告 v3'
      && cardRows(forkChannel)[0]!.card?.latestSeq === forkSeq,
    JSON.stringify(cardRows(forkChannel).map(row => [row.card?.type, row.card?.view?.title, row.card?.latestSeq])))
  replayChannel.releaseContributions()
  forkChannel.releaseContributions()
}

{
  // DSH 窗口折叠：释放完整展示；折叠期间到达的更新不长期保留正文；foldBack 取最新。
  const harness = createProjectorHarness({ sessionCards: true, renderer: rendererHost })
  harness.apply(translationOf(seq1), false)
  const rows = harness.state.rows as ChatRow[]
  const folded = foldRows(rows, 0, undefined, () => true)
  check('折叠：超出窗口的卡片降为预览，完整展示被释放（身份与最新 seq 保留）',
    folded === 1 && rows[0]!.folded === true && rows[0]!.card?.view === undefined
      && rows[0]!.card?.latestSeq === seq1 && rows[0]!.card?.type === 'acme/report'
      && rows[0]!.text.length <= 220,
    JSON.stringify({ folded, text: rows[0]!.text.slice(0, 40) }))
  // 折叠期间到达的更新：投影只更新身份与预览，不重新保留完整正文。
  const lateSeq = appendPluginRecord(liveSession, TUI_CARD_RECORD_TYPE, cardRecord({ title: '折叠期间更新' }))
  harness.apply(createDshTranslator(translatorDeps).translateEvent(liveSession.snapshotEvents().find(event => event.seq === lateSeq)!), false)
  check('折叠：折叠期间到达的更新只留预览与最新身份（不重新保留完整展示块）',
    cardRows(harness.state).length === 1
      && cardRows(harness.state)[0]!.card?.view === undefined
      && cardRows(harness.state)[0]!.card?.latestSeq === lateSeq
      && cardRows(harness.state)[0]!.text.includes('折叠期间更新')
      && cardRows(harness.state)[0]!.text.length <= 220,
    JSON.stringify({ latestSeq: cardRows(harness.state)[0]!.card?.latestSeq, lateSeq, text: cardRows(harness.state)[0]!.text.slice(0, 40) }))
  // foldBack：用当前 host presenter 从整份日志恢复最新快照（含折叠期间的更新）。
  const restored = foldBack(rows, liveSession.snapshotEvents(), {
    call: () => undefined,
    result: () => undefined,
    card: record => rendererHost.presentCard(record),
  })
  check('恢复：foldBack 用当前 presenter 从日志恢复最新快照（折叠期间的更新也生效）',
    restored === 1 && rows[0]!.folded !== true && rows[0]!.card?.view?.title === '折叠期间更新'
      && rows[0]!.text.includes('TAIL-OF-CARD-BODY') && rows[0]!.card?.latestSeq === lateSeq,
    JSON.stringify({ restored, title: rows[0]!.card?.view?.title, latestSeq: rows[0]!.card?.latestSeq }))
  check('恢复：行 id 与初始 seq 不变（恢复不重排、不换行）',
    rows[0]!.id === 0 && rows[0]!.seq === seq1)
  check('恢复：foldBack 标 restored（与该行类型的中性恢复同一规则，避免下一次折叠立即撤销）',
    rows[0]!.restored === true)
  // 下一次窗口折叠 pass 跳过 restored 行：恢复出来的正文保持可读。
  const refolded = foldRows(rows, 0, undefined, () => true)
  check('恢复：随后的折叠 pass 不再释放恢复过的卡片正文（仍是最新快照）',
    refolded === 0 && rows[0]!.folded !== true && rows[0]!.card?.view?.title === '折叠期间更新'
      && rows[0]!.text.includes('TAIL-OF-CARD-BODY') && rows[0]!.card?.latestSeq === lateSeq,
    JSON.stringify({ refolded, folded: rows[0]!.folded, title: rows[0]!.card?.view?.title }))
  // 没有 presenter（bare embedder）时恢复读记录自己的降级内容，而不是留空。
  const bare: ChatRow[] = [{
    id: 1,
    kind: 'card',
    text: '预览',
    seq: seq1,
    folded: true,
    card: { type: 'acme/report', id: 'report-1', latestSeq: seq1 },
  }]
  foldBack(bare, liveSession.snapshotEvents())
  check('恢复：host 没有 presenter 时也恢复可读正文（记录自己的降级内容）',
    bare[0]!.folded !== true && bare[0]!.restored === true && bare[0]!.text.includes('FALLBACK-BODY'))
  // 陈旧日志前缀：调用方只给到更旧的记录（不含已接受的最新快照）时，foldBack 不能回滚
  // 已接受的内容，而是保持折叠预览直到有知道新 seq 的快照。
  const staleRow: ChatRow = {
    id: 9,
    kind: 'card',
    text: '折叠期间更新',
    seq: seq1,
    time: 1,
    folded: true,
    card: { type: 'acme/report', id: 'report-1', latestSeq: lateSeq + 3 },
  }
  const staleRestored = foldBack([staleRow], liveSession.snapshotEvents(), {
    call: () => undefined,
    result: () => undefined,
    card: record => rendererHost.presentCard(record),
  })
  check('恢复：陈旧日志前缀不能把已接受的新快照回滚（保持折叠预览与最新 seq）',
    staleRestored === 0 && staleRow.folded === true && staleRow.card?.view === undefined
      && staleRow.card?.latestSeq === lateSeq + 3 && staleRow.text === '折叠期间更新',
    JSON.stringify({ staleRestored, latestSeq: staleRow.card?.latestSeq, folded: staleRow.folded }))
}

{
  // 中性 transcript 翻页：restoreFoldedRows / projectHistorySlice / prependHistoryRows。
  const older: AgentEvent[] = [
    { type: 'user.message', id: 'older-user', anchor: 'older-user', seq: 1, time: 1, source: 'user', text: 'OLDER-USER-ROW', blocks: [] },
    { type: 'card.upsert', record: cardRecord({ title: '早期快照' }), seq: 2, time: 2 },
    { type: 'card.upsert', record: cardRecord({ id: 'only-in-older', title: '只在旧页' }), seq: 3, time: 3 },
  ]
  const recent: AgentEvent[] = [
    { type: 'card.upsert', record: cardRecord({ title: '当前快照' }), seq: 20, time: 20 },
    { type: 'user.message', id: 'recent-user', anchor: 'recent-user', seq: 21, time: 21, source: 'user', text: 'RECENT-USER-ROW', blocks: [] },
  ]
  let paged = false
  const session = fakeSession('card-flow-paging', {
    transcript: {
      record: () => [...older, ...recent],
      hasOlder: () => !paged,
      older: () => { paged = true; return older },
    },
  })
  const channel = open(session, { history: recent })
  await settled(() => cardRows(channel).length === 1)
  const rows = channel.rows as ChatRow[]
  const foldedCount = foldRows(rows, 1, undefined, row => anchoredRow(row))
  check('中性翻页：卡片行可折叠（身份在日志里，restorable 判定成立）',
    foldedCount === 1 && cardRows(channel)[0]!.folded === true && cardRows(channel)[0]!.card?.view === undefined)
  const restored = channel.loadOlder()
  const card = cardRows(channel)[0]!
  check('中性翻页：loadOlder 先从记录恢复折叠卡（当前 host presenter）',
    restored === 1 && card.folded !== true && card.restored === true
      && card.card?.view?.title === '当前快照' && card.text.includes('TAIL-OF-CARD-BODY'),
    JSON.stringify({ restored, title: card.card?.view?.title }))
  const prepended = channel.loadOlder()
  const identities = cardRows(channel).map(cardIdentity)
  check('中性翻页：旧页前置按身份去重（同一张卡不出现第二行），仅旧页有的卡照常出现',
    prepended > 0 && identities.length === 2
      && identities.includes('acme/report/report-1') && identities.includes('acme/report/only-in-older')
      && cardRows(channel).find(row => row.card?.id === 'report-1')?.card?.view?.title === '当前快照',
    JSON.stringify(identities))
  check('中性翻页：旧页的行是 restored（不再被折叠），用户行保持原样',
    cardRows(channel).every(row => row.restored === true)
      && channel.rows.some(row => row.kind === 'user' && row.text === 'OLDER-USER-ROW'))
  channel.releaseContributions()
}

{
  // 纯函数面：旧切片带着开关与 renderer 走同一个投影器；前置去重稳定。
  const slice = projectHistorySlice(
    [{ type: 'card.upsert', record: cardRecord({ title: '旧页卡' }), seq: 4, time: 4 }],
    'preview',
    { sessionCards: true, renderer: rendererHost },
  )
  check('中性翻页：旧切片经过同一投影器（开关 + 当前 renderer 都带上）',
    slice.length === 1 && slice[0]!.kind === 'card' && slice[0]!.card?.view?.title === '旧页卡')
  const rows: ChatRow[] = [{ id: 0, kind: 'card', text: 'x', seq: 9, card: { type: 'acme/report', id: 'report-1', latestSeq: 9 } }]
  const added = prependHistoryRows(rows, slice.map(row => ({ ...row })))
  check('中性翻页：已存在的身份不再前置一次', added === 0 && rows.length === 1)
}

{
  // 滞后的记录读取：折叠后已接受了 seq9 的实时快照，但恢复时拿到的记录只到 seq1。
  // 不能把旧正文当成“完整当前内容”写回；保持折叠预览与最新 seq，等新鲜记录。
  const harness = createProjectorHarness({ sessionCards: true, renderer: rendererHost })
  harness.apply([cardSnapshot(1, 'state1', 'BODY-STATE-1')], false)
  foldRows(harness.state.rows, 0, undefined, () => true)
  harness.apply([cardSnapshot(9, 'state9', 'BODY-STATE-9')], false)
  const row = cardRows(harness.state)[0]!
  const stable = { id: row.id, seq: row.seq, time: row.time }
  const present = (record: TuiCardRecord) => rendererHost.presentCard(record)
  check('陈旧记录：折叠期间已接受 seq9 后，行是折叠预览（无完整展示）',
    row.folded === true && row.card?.latestSeq === 9 && row.card?.view === undefined
      && row.text.includes('state9') && row.text.length <= 220)
  const staleRestored = restoreFoldedRows(harness.state.rows, [cardSnapshot(1, 'state1', 'BODY-STATE-1')], present)
  check('陈旧记录：只含 seq1 的记录不能回滚 seq9（不回滚、不假装正文完整）',
    staleRestored === 0 && row.folded === true && row.card?.latestSeq === 9
      && row.card?.view === undefined && row.text.includes('state9') && !row.text.includes('state1')
      && row.id === stable.id && row.seq === stable.seq && row.time === stable.time,
    JSON.stringify({ staleRestored, latestSeq: row.card?.latestSeq, text: row.text.slice(0, 40) }))
  const freshRestored = restoreFoldedRows(
    harness.state.rows,
    [cardSnapshot(1, 'state1', 'BODY-STATE-1'), cardSnapshot(9, 'state9', 'BODY-STATE-9')],
    present,
  )
  check('新鲜记录：知道了 seq9 的记录恢复完整最新正文，行 id/初始 seq/time 不变',
    freshRestored === 1 && row.folded !== true && row.card?.latestSeq === 9
      && row.card?.view?.title === 'state9' && row.text.includes('BODY-STATE-9')
      && row.id === stable.id && row.seq === stable.seq && row.time === stable.time,
    JSON.stringify({ freshRestored, title: row.card?.view?.title }))
  // 再回到“折叠后只有更旧 seq5 读取”的情形：仍然不能回滚（靠 seq fence，不是靠 restored 过滤）。
  delete row.restored
  foldRows(harness.state.rows, 0, undefined, () => true)
  const rollback = restoreFoldedRows(harness.state.rows, [cardSnapshot(5, 'state5', 'BODY-STATE-5')], present)
  check('旧 seq5 记录不能把已恢复的 seq9 内容回滚',
    rollback === 0 && row.folded === true && row.card?.latestSeq === 9
      && row.text.includes('state9') && !row.text.includes('state5'))
}

{
  // 真实 core loadOlder：实时更新已接受后，记录读取仍滞后（只到 seq1）时不能回滚；
  // 下一份包含 seq9 的记录才恢复完整正文。
  let recordSource: AgentEvent[] = [cardSnapshot(1, 'state1', 'BODY-STATE-1')]
  const session = fakeSession('card-flow-load-older-stale', {
    transcript: {
      record: () => recordSource,
      hasOlder: () => false,
      older: () => [],
    },
  })
  const channel = open(session, { history: [cardSnapshot(1, 'state1', 'BODY-STATE-1')] })
  await settled(() => cardRows(channel).length === 1)
  const row = cardRows(channel)[0]!
  const stable = { id: row.id, seq: row.seq, time: row.time }
  foldRows(channel.rows as ChatRow[], 0, undefined, candidate => anchoredRow(candidate))
  session.emit([cardSnapshot(9, 'state9', 'BODY-STATE-9')])
  await settled(() => row.card?.latestSeq === 9)
  const staleRestored = channel.loadOlder()
  check('真实 loadOlder：滞后记录不回滚已接受的 seq9（保持折叠预览与行身份）',
    staleRestored === 0 && row.folded === true && row.card?.latestSeq === 9
      && row.card?.view === undefined && row.text.includes('state9') && !row.text.includes('state1')
      && row.id === stable.id && row.seq === stable.seq && row.time === stable.time,
    JSON.stringify({ staleRestored, latestSeq: row.card?.latestSeq, folded: row.folded }))
  recordSource = [cardSnapshot(1, 'state1', 'BODY-STATE-1'), cardSnapshot(9, 'state9', 'BODY-STATE-9')]
  const freshRestored = channel.loadOlder()
  check('真实 loadOlder：新鲜记录恢复 seq9 的完整正文，行身份/初始锚点不变',
    freshRestored === 1 && row.folded !== true && row.card?.latestSeq === 9
      && row.card?.view?.title === 'state9' && row.text.includes('BODY-STATE-9')
      && row.id === stable.id && row.seq === stable.seq && row.time === stable.time)
  // 之后的窗口再折叠一次，而记录又只到更旧的 seq5：不允许把 seq9 回滚。
  delete row.restored
  foldRows(channel.rows as ChatRow[], 0, undefined, candidate => anchoredRow(candidate))
  recordSource = [cardSnapshot(5, 'state5', 'BODY-STATE-5')]
  const rollback = channel.loadOlder()
  check('真实 loadOlder：旧 seq5 读取不能把已恢复的 seq9 回滚',
    rollback === 0 && row.folded === true && row.card?.latestSeq === 9
      && row.text.includes('state9') && !row.text.includes('state5'))
  channel.releaseContributions()
}

{
  // 旧页前置的卡片 + 之后的实时更新：同一身份必须更新那一行，不新增第二张卡。
  const older: AgentEvent[] = [
    { type: 'card.upsert', record: cardRecord({ id: 'paged-1', title: '旧页卡' }), seq: 3, time: 3 },
  ]
  const recent: AgentEvent[] = [
    { type: 'user.message', id: 'recent-after-page', anchor: 'recent-after-page', seq: 20, time: 20, source: 'user', text: 'RECENT-AFTER-PAGE', blocks: [] },
  ]
  let paged = false
  const session = fakeSession('card-flow-paged-update', {
    transcript: {
      record: () => [...older, ...recent],
      hasOlder: () => !paged,
      older: () => { paged = true; return older },
    },
  })
  const channel = open(session, { history: recent })
  await settled(() => channel.rows.length === 1)
  const prepended = channel.loadOlder()
  const pagedRow = cardRows(channel)[0]
  check('旧页卡片：前置后是一行完整卡片（标题来自旧页快照）',
    prepended > 0 && pagedRow?.card?.id === 'paged-1' && pagedRow.card.view?.title === '旧页卡'
      && pagedRow.seq === 3 && pagedRow.restored === true,
    JSON.stringify({ prepended, card: pagedRow?.card }))
  const pagedRowId = pagedRow?.id
  session.emit([{ type: 'card.upsert', record: cardRecord({ id: 'paged-1', title: '更新后的卡' }), seq: 50, time: 50 }])
  const updated = cardRows(channel)[0]
  check('旧页卡片：实时更新落到那一行（同一身份、不新增第二张卡、行 id/初始 seq 不变）',
    await settled(() => updated?.card?.latestSeq === 50)
      && cardRows(channel).length === 1 && updated.id === pagedRowId && updated.seq === 3
      && updated.card?.view?.title === '更新后的卡' && updated.text.includes('更新后的卡')
      && !updated.text.includes('旧页卡'),
    JSON.stringify({ rows: cardRows(channel).map(row => [row.id, row.card?.latestSeq, row.card?.view?.title]) }))
  session.emit([{ type: 'card.upsert', record: cardRecord({ id: 'paged-1', title: '回退的旧内容' }), seq: 40, time: 40 }])
  check('旧页卡片：低于已应用 seq 的投递不回退内容（latestSeq 仍是最新）',
    await settled(() => true) && cardRows(channel).length === 1
      && cardRows(channel)[0]!.card?.latestSeq === 50
      && cardRows(channel)[0]!.card?.view?.title === '更新后的卡')
  session.emit([{ type: 'card.upsert', record: cardRecord({ id: 'paged-1', type: 'acme/other', title: '另一类' }), seq: 51, time: 51 }])
  check('旧页卡片：不同类型同 id 仍是另一张卡，不合并到旧页那一行',
    await settled(() => cardRows(channel).length === 2)
      && cardRows(channel).map(row => row.card?.type).join(',') === 'acme/report,acme/other'
      && cardRows(channel)[1]!.seq === 51)
  channel.releaseContributions()
}

// ── 4. 命令展示适配：真实 host 注册，data 契约与 dsh-context 一致 ───────────
{
  const session = fakeSession('card-flow-command')
  const channel = open(session)
  session.emit([{
    type: 'command.result', commandId: 'cmd-1', name: 'report', args: ' raw', outcome: 'success', text: 'COMMAND-RESULT-BODY', seq: 7, time: 7,
  }])
  check('命令：注册了 command/<name> 展示适配的命令行保留命令事实，并由共享宿主展示',
    await settled(() => channel.rows.some(row => row.kind === 'command' && row.card?.view !== undefined))
      && channel.rows[0]!.command?.commandId === 'cmd-1' && channel.rows[0]!.command?.name === 'report'
      && channel.rows[0]!.card?.type === 'command/report' && channel.rows[0]!.card?.id === 'cmd-1'
      && channel.rows[0]!.card?.view?.title === 'Command report'
      && channel.rows[0]!.card?.view?.summary === 'success',
    JSON.stringify(channel.rows[0]?.card?.view))
  session.emit([{ type: 'command.result', commandId: 'cmd-2', name: 'unregistered', outcome: 'success', text: 'PLAIN-COMMAND-BODY', seq: 8, time: 8 }])
  check('命令：未注册展示适配的命令保持原有通用卡（无 card 视图，正文完整）',
    await settled(() => channel.rows.length === 2)
      && channel.rows[1]!.card === undefined && channel.rows[1]!.text === 'PLAIN-COMMAND-BODY'
      && channel.rows[1]!.command?.name === 'unregistered')
  channel.releaseContributions()
}

{
  // data 契约：投影交给展示适配的就是 dsh-context 适配器读的字段。
  const captured: unknown[] = []
  admitted = await mountAdmitted(root, 'custom-card-command-contract', testManifest({ id: 'com.example.custom-card-command-contract' }))
  await admitted.context.inject(['tuiRenderers'], (ctx) => {
    ctx.get('tuiRenderers')!.registerCard('command/model-context', (data) => {
      captured.push(data)
      return { title: 'model-context', blocks: [{ kind: 'text', text: JSON.stringify(data) }] }
    })
  })
  const session = fakeSession('card-flow-command-contract')
  const channel = open(session)
  session.emit([{ type: 'command.result', commandId: 'cmd-ctx', name: 'model-context', outcome: 'error', text: 'boom', seq: 9, time: 9 }])
  await settled(() => captured.length === 1)
  check('命令：data 契约是 {commandId,name,outcome,text}（args 缺失时省略而不是 undefined）',
    JSON.stringify(captured[0]) === JSON.stringify({ commandId: 'cmd-ctx', name: 'model-context', outcome: 'error', text: 'boom' }),
    JSON.stringify(captured[0]))
  channel.releaseContributions()
  await admitted.fiber.dispose()
}

// ── 5. 技能卡：正式 skill.invocation 事实 + 共享宿主 ────────────────────────
const skillLoad = (seq: number, name = 'alpha', body = ALPHA_BODY): AgentEvent => ({ type: 'skill.invocation', seq, time: 1_700_000_000_000 + seq, name, body })
const prompt = (id: string, text: string, seq: number): AgentEvent => ({
  type: 'user.message', id, anchor: String(seq), seq, time: 1_700_000_000_000 + seq, source: 'user', text, blocks: [{ type: 'text', text }],
})

{
  const session = fakeSession('card-flow-skill')
  const channel = open(session)
  session.emit([prompt('u1', '/alpha', 1), skillLoad(2), { type: 'assistant.message', seq: 3, anchor: '3', turn: 1, step: 1, attemptId: 'a1', time: 3, blocks: [{ type: 'text', text: 'ok' }], canonical: true }])
  const rows = channel.rows.filter(row => row.kind === 'skill')
  check('技能卡：仍由正式 skill.invocation 事实驱动（独立行、正文是当时注入的指令）',
    await settled(() => rows.length === 1) && rows[0]!.skill?.name === 'alpha' && rows[0]!.text === ALPHA_BODY
      && rows[0]!.seq === 2 && rows[0]!.time === 1_700_000_000_002)
  check('技能卡：用户原文那行单独保留，不产生人工气泡或模型输入',
    channel.rows.filter(row => row.kind === 'user').length === 1 && session.submits.length === 0)
  check('技能卡：不新增 plugin record 事实（行上没有卡片身份）', rows[0]!.card === undefined)
  channel.releaseContributions()
}

// ── 6. 真实 Chat：共享宿主、字面量表格、更新与交互 ─────────────────────────
class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}

async function mountChat(node: React.ReactNode, columns: number, fullscreen: boolean, theme: 'dark' | 'light' = 'dark') {
  const rows = 40
  const terminal = new XTerm({ cols: columns, rows, scrollback: 400, allowProposedApi: true })
  class Output extends Writable {
    columns = columns
    rows = rows
    isTTY = true
    _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
  }
  const stdout = new Output()
  const input = new Input()
  const content = <ThemeProvider theme={theme}>{node}</ThemeProvider>
  const instance = await render(fullscreen ? <AlternateScreen mouseTracking>{content}</AlternateScreen> : content, {
    stdout: stdout as never, stdin: input as never, stderr: stdout as never, exitOnCtrlC: false, patchConsole: false,
  })
  return {
    input,
    lines: () => viewportLines(terminal, rows),
    screen: () => viewportLines(terminal, rows).join('\n'),
    /** A cell's background paint ('default' | 'palette:N' | 'rgb:N'). */
    bgAt: (x: number, y: number): string => {
      const cell = terminal.buffer.active.getLine(y)?.getCell(x)
      if (cell === undefined || cell.isBgDefault()) return 'default'
      return cell.isBgPalette() ? `palette:${cell.getBgColor()}` : `rgb:${cell.getBgColor() & 0xffffff}`
    },
    async close() { await instance.unmount(); terminal.dispose(); input.destroy() },
  }
}

const chatHistory: AgentEvent[] = [...translationOf(seq1), ...translationOf(seq2), prompt('u2', '/report', 30), skillLoad(31)]

for (const { columns, fullscreen } of [
  { columns: 100, fullscreen: false },
  { columns: 40, fullscreen: false },
  { columns: 100, fullscreen: true },
]) {
  const label = `${fullscreen ? 'fullscreen' : 'inline'} ${columns} 列`
  const session = fakeSession(`card-chat-${columns}-${fullscreen}`)
  const channel = open(session, { history: chatHistory })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={fullscreen} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    columns,
    fullscreen,
  )
  const rowCount = channel.rows.length
  try {
    check(`${label}：折叠只显示标签/标题/摘要（正文末尾不在屏上）`,
      await settled(() => h.screen().includes('[acme]') && h.screen().includes('报告 v2') && h.screen().includes('第二版'))
        && !h.screen().includes('TAIL-OF-CARD-BODY'),
      h.lines().filter(line => line.includes('acme') || line.includes('报告')).join(' | '))
    check(`${label}：技能卡经共享宿主显示名称与「已加载指令」`,
      await settled(() => h.screen().includes('[技能] alpha') && h.screen().includes('已加载指令'))
        && !h.screen().includes('ALPHA-MARKER'))
    h.input.write('\x0f')
    check(`${label}：Ctrl+O 展开后卡片正文末尾可见`,
      await settled(() => h.screen().includes('TAIL-OF-CARD-BODY')))
    check(`${label}：Markdown 正文按渲染器解析（标题/粗体/列表），表格单元的字面竖线不清失`,
      h.screen().includes('粗体') && h.screen().includes('a|b 竖线') && h.screen().includes('第一行'))
    check(`${label}：多行表格单元的内容不被截断`, h.screen().includes('第二行'))
    check(`${label}：展开后技能卡正文完整可见`, await settled(() => h.screen().includes('ALPHA-MARKER')))
    const cardLines = h.lines().filter(line => /acme|报告|TAIL-OF-CARD-BODY|粗体|a\|b|多行|第一行|第二行|\[技能\]|ALPHA/.test(line))
    check(`${label}：含中文/emoji 与宽表格的行不越界`,
      cardLines.length > 0 && cardLines.every(line => displayWidth(line) <= columns),
      JSON.stringify(cardLines.filter(line => displayWidth(line) > columns).slice(0, 3)))
    check(`${label}：展开/折叠不新增行、不投递模型输入`,
      channel.rows.length === rowCount && session.submits.length === 0)
    // 同长度更新：标题字数不变但正文变化，布局必须失效重算。
    session.emit([{
      type: 'card.upsert',
      record: cardRecord({ title: '报告 v9', summary: '第三版', body: 'UPDATED-CARD-BODY!' }),
      seq: 90,
      time: 90,
    }])
    check(`${label}：同长度的卡片更新仍使布局失效（新正文可见、仍是一张卡）`,
      await settled(() => h.screen().includes('UPDATED-CARD-BODY!') && channel.rows.filter(row => row.kind === 'card').length === 1)
        && h.screen().includes('报告 v9') && !h.screen().includes('报告 v2'),
      h.screen().split('\n').slice(-3).join(' | '))
    h.input.write('\x0f')
    check(`${label}：再次 Ctrl+O 收起到标题与摘要`, await settled(() => !h.screen().includes('UPDATED-CARD-BODY!')))
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

// 显式 cardStyles.kinds.custom 卡面：同一个共享宿主组件实时兑现背景/边框/内边距，
// 内容列宽跟随卡面收窄（Markdown/表格不越界、不丢内容）；默认 legacy 保持既有外观。
{
  const { applyCardStyles, getCardStyleConfig } = await import('../../src/cardStyles.js')
  const previous = getCardStyleConfig()
  const hasBorder = (h: { lines: () => string[] }): boolean => {
    const lines = h.lines()
    const header = lines.findIndex(line => line.includes('[acme]'))
    return header >= 0 && lines[header]!.includes('│')
      && /^[┌╭]─*[┐╮]\s*$/u.test(lines[header - 2] ?? '')
  }
  try {
    for (const { columns, fullscreen } of [
      { columns: 100, fullscreen: false },
      { columns: 40, fullscreen: false },
    ]) {
      const label = `卡面 ${columns} 列`
      // 每一轮都从默认外观开始，上一轮的显式卡面不影响这一轮的 legacy 断言。
      applyCardStyles(previous)
      const session = fakeSession(`card-surface-${columns}-${fullscreen}`)
      const channel = open(session, { history: translationOf(seq1) })
      const h = await mountChat(
        <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
          fullscreen={fullscreen} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
        columns,
        fullscreen,
      )
      try {
        // 先验默认 legacy：与既有卡片行一致的平铺外观（无边框、两个字符缩进、无底色）。
        const legacy = await settled(() => h.screen().includes('[acme]'))
          ? h.lines().find(line => line.includes('[acme]')) ?? ''
          : ''
        const legacyRow = h.lines().findIndex(line => line.includes('[acme]'))
        check(`${label}：默认 legacy 保持既有外观（无边框、缩进 2、无卡面底色）`,
          legacy.startsWith('  [acme]') && !legacy.includes('│')
            && legacyRow >= 0 && h.bgAt(2, legacyRow) === 'default',
          JSON.stringify({ legacy, bg: legacyRow >= 0 ? h.bgAt(2, legacyRow) : 'none' }))
        // 同一个已挂载的卡片行：配置改动实时生效（不需要重挂载/重放）。
        applyCardStyles({ preset: 'legacy', kinds: { custom: { background: 'toolCardBackgroundDim', border: 'single', paddingX: 1, paddingY: 1 } } })
        check(`${label}：显式 kinds.custom 的背景/边框/内边距实时生效`, await settled(() => hasBorder(h)),
          h.lines().slice(Math.max(0, h.lines().findIndex(line => line.includes('[acme]')) - 3)).slice(0, 4).join(' | '))
        const header = h.lines().findIndex(line => line.includes('[acme]'))
        check(`${label}：卡面底色与内边距真正落在那一行（不是只画了边框）`,
          header >= 0 && h.bgAt(1, header) !== 'default'
            && h.lines()[header]!.indexOf('[acme]') === 4,
          JSON.stringify({ bg: header >= 0 ? h.bgAt(1, header) : 'none', at: header >= 0 ? h.lines()[header]!.indexOf('[acme]') : -1 }))
        h.input.write('\x0f')
        check(`${label}：卡面下的展开正文完整（Markdown/表格字面量/末尾标记都在）`,
          await settled(() => h.screen().includes('TAIL-OF-CARD-BODY'))
            && h.screen().includes('粗体') && h.screen().includes('a|b 竖线') && h.screen().includes('第二行'))
        const surfaceLines = h.lines()
        check(`${label}：带边框/内边距的卡片每一行都不越界`,
          surfaceLines.every(line => displayWidth(line) <= columns),
          JSON.stringify(surfaceLines.filter(line => displayWidth(line) > columns).slice(0, 3)))
        // 同一张卡原地更新：行数不变，新内容落在同一卡面里。
        session.emit([{
          type: 'card.upsert',
          record: cardRecord({ title: '卡面更新', summary: '更新摘要', body: 'SURFACE-UPDATE-BODY' }),
          seq: 91,
          time: 91,
        }])
        check(`${label}：卡面里的同卡更新原地生效（仍是一张卡、新正文可见）`,
          await settled(() => h.screen().includes('SURFACE-UPDATE-BODY') && h.screen().includes('卡面更新'))
            && channel.rows.filter(row => row.kind === 'card').length === 1
            && hasBorder(h),
          h.screen().split('\n').filter(line => line.includes('卡面') || line.includes('SURFACE')).join(' | '))
      } finally {
        await h.close()
        channel.releaseContributions()
      }
    }
  } finally {
    applyCardStyles(previous)
  }
}

// 单卡片密度（`TuiCardView.density: 'compact'`）：同一份展示适配声明的紧凑密度
// 只去掉这一张卡的卡面（底色/边框/内边距/间隔），同屏的普通卡片照旧，宿主原有
// 的 Ctrl+O 展开也照旧。浅/深主题与 40/80 列的单元格回归在
// verify-custom-card-density.tsx；这里验证投影 → 卡面 → 折叠手势的完整链路。
{
  const { applyCardStyles, getCardStyleConfig } = await import('../../src/cardStyles.js')
  const previous = getCardStyleConfig()
  /** 同一份内容的两种密度：只有紧凑的那一张少掉方案呼吸行与卡面上下内边距。 */
  const densityHistory = (type: string): AgentEvent[] => [
    { type: 'card.upsert', record: cardRecord({ type, id: 'density-1', title: '2条 · 导入2', body: 'COMPACT-BODY-MARKER' }), seq: 70, time: 70 },
    { type: 'card.upsert', record: cardRecord({ title: '相邻普通卡', body: 'NEIGHBOUR-BODY-MARKER' }), seq: 71, time: 71 },
  ]
  const mountDensity = async (type: string, columns: number, sessionId: string) => {
    const channel = open(fakeSession(sessionId), { history: densityHistory(type) })
    const h = await mountChat(
      <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
        fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
      columns,
      false,
    )
    return { channel, h }
  }
  try {
    applyCardStyles({ preset: 'pi-like' })
    for (const columns of [80, 40]) {
      const label = `紧凑密度 ${columns} 列`
      const compact = await mountDensity('acme/compact', columns, `card-density-${columns}`)
      const plain = await mountDensity('acme/plain', columns, `card-density-plain-${columns}`)
      try {
        await settled(() => compact.h.screen().includes('[上下文]') && compact.h.screen().includes('[acme]')
          && plain.h.screen().includes('[上下文]'))
        const compactRow = compact.h.lines().findIndex(line => line.includes('[上下文]'))
        const plainRow = compact.h.lines().findIndex(line => line.includes('[acme]'))
        check(`${label}：紧凑密度的卡片没有卡面底色与内边距（标签贴左缘）`,
          compactRow >= 0 && compact.h.bgAt(0, compactRow) === 'default'
            && compact.h.lines()[compactRow]!.indexOf('[上下文]') === 0
            && !compact.h.lines()[compactRow]!.includes('│'),
          JSON.stringify({ row: compact.h.lines()[compactRow], bg: compactRow >= 0 ? compact.h.bgAt(0, compactRow) : 'none' }))
        check(`${label}：同一屏的普通卡片保留 pi-like 卡面`,
          plainRow >= 0 && compact.h.bgAt(1, plainRow) !== 'default',
          JSON.stringify({ row: compact.h.lines()[plainRow], bg: plainRow >= 0 ? compact.h.bgAt(1, plainRow) : 'none' }))
        // 同一份内容不声明密度时：首个区块多出方案呼吸行 + 卡面上下各一行内边距。
        const plainLabelRow = plain.h.lines().findIndex(line => line.includes('[上下文]'))
        check(`${label}：紧凑密度少掉方案呼吸行与上下内边距（标签行固定上移两行）`,
          plainLabelRow - compactRow === 2 && plain.h.bgAt(0, plainLabelRow) !== 'default',
          JSON.stringify({ plainLabelRow, compactRow }))
        check(`${label}：折叠时正文仍收在卡内`, !compact.h.screen().includes('COMPACT-BODY-MARKER'))
        compact.h.input.write('\x0f')
        const bodyRow = await settled(() => compact.h.screen().includes('COMPACT-BODY-MARKER'))
          ? compact.h.lines().findIndex(line => line.includes('COMPACT-BODY-MARKER'))
          : -1
        check(`${label}：Ctrl+O 仍能展开这张卡的正文`, bodyRow >= 0)
        check(`${label}：展开出来的正文也没有卡面底色`,
          bodyRow >= 0 && compact.h.bgAt(0, bodyRow) === 'default' && compact.h.bgAt(columns - 1, bodyRow) === 'default',
          JSON.stringify({ bg: bodyRow >= 0 ? compact.h.bgAt(0, bodyRow) : 'none' }))
        check(`${label}：相邻普通卡片的正文仍在自己的卡面里`,
          compact.h.screen().includes('NEIGHBOUR-BODY-MARKER'))
        check(`${label}：密度不影响行数与模型输入`,
          compact.channel.rows.filter(row => row.kind === 'card').length === 2)
      } finally {
        await compact.h.close()
        compact.channel.releaseContributions()
        await plain.h.close()
        plain.channel.releaseContributions()
      }
    }
  } finally {
    applyCardStyles(previous)
  }
}

// 折叠预览与历史恢复：窗口折叠只丢掉完整展示，留下的有界预览仍由同一个卡面壳
// 画出，所以紧凑密度必须跟着行一起留下——否则深滚动记录里的卡片会闪回整个卡面，
// loadOlder 恢复后又整体缩高。这里先把行折起来再挂载 Chat（滚动窗口里已经折叠的
// 历史），用真实 foldRows / 折叠期间的快照 / loadOlder；同一份内容不声明密度时
// 作为对照（方案呼吸行 + 卡面上下内边距）。深/浅主题 × 40/80 列。
{
  const { applyCardStyles, getCardStyleConfig } = await import('../../src/cardStyles.js')
  const previous = getCardStyleConfig()
  const faceColor = (theme: 'dark' | 'light') => `rgb:${theme === 'dark' ? 0x3a3055 : 0xe6e4ee}`
  const cardEvent = (type: string, title: string, body: string, seq: number): AgentEvent => ({
    type: 'card.upsert', record: cardRecord({ type, id: 'fold-1', title, body }), seq, time: seq,
  })
  /** 折叠（真实 foldRows）→ 折叠期间的新快照 → 挂载 Chat 观察折叠帧。 */
  const openFolded = async (type: string, sessionId: string, theme: 'dark' | 'light', columns: number) => {
    const snapshots: AgentEvent[] = [cardEvent(type, '2条 · 导入2', 'COMPACT-BODY-MARKER', 70)]
    const session = fakeSession(sessionId, {
      transcript: { record: () => snapshots, hasOlder: () => false, older: () => [] },
    })
    const channel = open(session, { history: snapshots })
    await settled(() => cardRows(channel).length === 1)
    const folded = foldRows(channel.rows as ChatRow[], 0, undefined, candidate => anchoredRow(candidate))
    // 折叠刚丢掉完整展示时的行状态（releaseCardSnapshot 的契约）。
    const afterFold = { folded, view: cardRows(channel)[0]?.card?.view, density: cardRows(channel)[0]?.card?.density }
    const update = cardEvent(type, '3条 · 导入3', 'FOLDED-UPDATE-BODY', 80)
    snapshots.push(update)
    session.emit([update])
    await settled(() => cardRows(channel)[0]?.card?.latestSeq === 80)
    const h = await mountChat(
      <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
        fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
      columns,
      false,
      theme,
    )
    await settled(() => h.screen().includes('导入3'))
    return { h, channel, session, row: cardRows(channel)[0]!, folded, afterFold }
  }
  try {
    applyCardStyles({ preset: 'pi-like' })
    for (const theme of ['dark', 'light'] as const) {
      for (const columns of [40, 80]) {
        const label = `折叠恢复 ${theme} ${columns} 列`
        const compact = await openFolded('acme/compact', `card-fold-density-${theme}-${columns}`, theme, columns)
        const plain = await openFolded('acme/plain', `card-fold-density-plain-${theme}-${columns}`, theme, columns)
        const { h, channel, session, row } = compact
        const previewRowOf = (view: { lines: () => string[] }) => view.lines().findIndex(line => line.includes('导入3'))
        const headerRowOf = (view: { lines: () => string[] }) => view.lines().findIndex(line => line.includes('[上下文]'))
        try {
          const previewRow = previewRowOf(h)
          check(`${label}：窗口折叠丢掉完整展示但保留密度`,
            compact.afterFold.folded === 1 && compact.afterFold.view === undefined
              && compact.afterFold.density === 'compact',
            JSON.stringify(compact.afterFold))
          check(`${label}：折叠期间到达的快照也把密度留在行上`,
            row.folded === true && row.card?.view === undefined
              && row.card?.density === 'compact' && row.card?.latestSeq === 80,
            JSON.stringify({ folded: compact.folded, card: row.card }))
          check(`${label}：折叠预览仍按密度画（无底色、无内边距、不闪回整个卡面）`,
            previewRow >= 0 && h.bgAt(0, previewRow) === 'default' && h.bgAt(columns - 1, previewRow) === 'default'
              && h.bgAt(0, previewRow + 1) === 'default'
              && h.lines()[previewRow]!.indexOf('3条') === 0
              && !/[│┃║┌┍┎┏╭╮┐┑┒┓└┕┖┗╰╯┘┙┚┛─━]/u.test(h.lines()[previewRow]!),
            JSON.stringify({ previewRow, card: row.card, bg: previewRow >= 0 ? h.bgAt(columns - 1, previewRow) : 'none', line: h.lines()[previewRow] }))
          // 同一份内容不声明密度时：折叠预览多出方案呼吸行 + 卡面上下一行内边距，
          // 所以它的内容行恰好比紧凑预览低两行。
          check(`${label}：折叠预览少掉方案呼吸行与上下内边距（内容行固定上移两行）`,
            previewRow > 0 && previewRowOf(plain.h) - previewRow === 2
              && plain.h.bgAt(0, previewRowOf(plain.h)) === faceColor(theme),
            JSON.stringify({ compact: previewRow, plain: previewRowOf(plain.h), plainBg: plain.h.bgAt(0, previewRowOf(plain.h)) }))
          const restored = channel.loadOlder()
          const plainRestored = plain.channel.loadOlder()
          check(`${label}：loadOlder 恢复完整展示时把密度一起带回来`,
            restored === 1 && plainRestored === 1 && row.folded !== true
              && row.card?.view?.density === 'compact' && row.card?.latestSeq === 80,
            JSON.stringify({ restored, plainRestored, density: row.card?.density, viewDensity: row.card?.view?.density }))
          const restoredRow = await settled(() => headerRowOf(h) >= 0)
            ? headerRowOf(h)
            : -1
          const plainRestoredRow = await settled(() => headerRowOf(plain.h) >= 0)
            ? headerRowOf(plain.h)
            : -1
          check(`${label}：恢复后仍是同一个紧凑卡面（无底色、无内边距、比普通卡面少两行）`,
            restoredRow >= 0 && h.bgAt(0, restoredRow) === 'default' && h.lines()[restoredRow]!.indexOf('[上下文]') === 0
              && plainRestoredRow - restoredRow === 2 && plain.h.bgAt(0, plainRestoredRow) === faceColor(theme),
            JSON.stringify({ restoredRow, plainRestoredRow, bg: restoredRow >= 0 ? h.bgAt(0, restoredRow) : 'none', line: h.lines()[restoredRow] }))
          check(`${label}：折叠/恢复不动行身份与提交锚点`,
            row.id === compact.row.id && row.seq === compact.row.seq && row.time === compact.row.time
              && session.submits.length === 0)
        } finally {
          await h.close()
          channel.releaseContributions()
          await plain.h.close()
          plain.channel.releaseContributions()
        }
      }
    }
  } finally {
    applyCardStyles(previous)
  }
}

// 原始 HTML 包装的卡片正文不能整段消失（真实 Chat 观察）；助手行的默认 Markdown
// 行为不变。记录里的 wrapper 与行内 XML 都作为字面文本绘出，从不执行。
{
  const history: AgentEvent[] = [
    { type: 'card.upsert', record: cardRecord({ type: 'acme/html', id: 'html-1', title: 'HTML 卡' }), seq: 60, time: 60 },
    {
      type: 'assistant.message',
      seq: 61,
      anchor: '61',
      turn: 1,
      step: 1,
      attemptId: 'a-html',
      time: 61,
      blocks: [{ type: 'text', text: '<system-reminder>\nASSISTANT_HTML_END\n</system-reminder>' }],
      canonical: true,
    },
  ]
  for (const columns of [100, 40]) {
    const label = `HTML 卡 ${columns} 列`
    const channel = open(fakeSession(`card-html-${columns}`), { history })
    const h = await mountChat(
      <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
        fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
      columns,
      false,
    )
    try {
      check(`${label}：默认折叠不显示正文`,
        await settled(() => h.screen().includes('[acme/html]') && h.screen().includes('HTML 卡'))
          && !h.screen().includes('CARD_HTML_END'))
      h.input.write('\x0f')
      check(`${label}：展开后 HTML wrapper 里的正文完整可见（不整段消失）`,
        await settled(() => h.screen().includes('CARD_HTML_END'))
          && h.screen().includes('<system-reminder>')
          && h.screen().includes('INLINE_XML_END'),
        h.screen().split('\n').filter(line => /HTML|system-reminder|INLINE/.test(line)).join(' | '))
      check(`${label}：行内 XML 作为字面文本保留（不会丢掉中间内容）`,
        h.screen().includes('before <context-notes>') && h.screen().includes('INLINE_XML_END')
          && h.screen().includes('context-notes> after'),
        h.screen().split('\n').filter(line => line.includes('context-notes') || line.includes('INLINE_XML')).join(' | '))
      check(`${label}：助手行的默认 Markdown 仍隐藏 HTML 包装（行为未变）`,
        !h.screen().includes('ASSISTANT_HTML_END'))
      check(`${label}：HTML 正文行不越界`,
        h.lines().every(line => displayWidth(line) <= columns))
    } finally {
      await h.close()
      channel.releaseContributions()
    }
  }
}

// 点击与消息选择 Enter：既有的逐行展开手势，不是新按键。
{
  const channel = open(fakeSession('card-chat-click'), { history: translationOf(seq1) })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    100,
    true,
  )
  try {
    await settled(() => h.screen().includes('[acme]'))
    const lines = h.lines()
    const cardRow = lines.findIndex(line => line.includes('[acme]'))
    check('交互：折叠时能找到卡片行', cardRow >= 0)
    if (cardRow >= 0) {
      const col = lines[cardRow]!.indexOf('[acme]') + 2
      h.input.write(`\x1b[<0;${col};${cardRow + 1}M`)
      h.input.write(`\x1b[<0;${col};${cardRow + 1}m`)
      check('交互：点击卡片行逐行展开正文', await settled(() => h.screen().includes('TAIL-OF-CARD-BODY')))
    }
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

{
  const channel = open(fakeSession('card-chat-selection'), { history: translationOf(seq1) })
  const controller: { current: unknown } = { current: null }
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={controller as never} />,
    100,
    false,
  )
  try {
    check('交互：卡片行默认折叠', await settled(() => h.screen().includes('[acme]')) && !h.screen().includes('TAIL-OF-CARD-BODY'))
    h.input.write('\x1b[1;2A')
    await settle(() => h.screen().includes('esc 返回输入') || controller.current !== null)
    await settle(() => h.screen().includes('esc 返回输入'))
    h.input.write('\r')
    check('交互：消息选择里 Enter 展开卡片正文', await settled(() => h.screen().includes('TAIL-OF-CARD-BODY')),
      h.screen().split('\n').filter(line => line.includes('TAIL')).join(' | '))
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

{
  const { setLang } = await import('../../src/i18n.js')
  const channel = open(fakeSession('skill-language'), { history: [skillLoad(31)] })
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    100,
    false,
  )
  try {
    check('语言：共享技能卡初始显示中文', await settled(() => h.screen().includes('[技能] alpha')))
    setLang('en')
    h.input.write('\x1b[1;2A')
    check('语言：切换后选中同一技能行，标签与状态不会保留旧语言',
      await settled(() => h.screen().includes('[skill] alpha') && h.screen().includes('instructions loaded')),
      h.lines().filter(line => /alpha|loaded|技能/.test(line)).join(' | '))
  } finally {
    await h.close()
    channel.releaseContributions()
    setLang('zh')
  }
}

{
  const { applyCardStyles } = await import('../../src/cardStyles.js')
  for (const preset of ['legacy', 'pi-like'] as const) {
    applyCardStyles({ preset })
    const body = '**SAVED_SKILL_BOLD**\n\n<system-reminder>SKILL_XML_VISIBLE</system-reminder>'
    const channel = open(fakeSession(`skill-markdown-${preset}`), { history: [skillLoad(31, 'visual-skill', body)] })
    const h = await mountChat(
      <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
        fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
      100, false,
    )
    try {
      h.input.write('\x1b[1;2A')
      await settle(() => h.screen().includes('esc 返回输入'))
      h.input.write('\r')
      const visible = await settled(() => h.screen().includes('SKILL_XML_VISIBLE'))
      check(`技能呈现：${preset} ${preset === 'pi-like' ? '读取已存 Markdown' : '保留原文标记'}`,
        visible && h.screen().includes('SAVED_SKILL_BOLD')
          && h.screen().includes('**SAVED_SKILL_BOLD**') === (preset === 'legacy')
          && channel.rows.find(row => row.kind === 'skill')?.text === body)
    } finally {
      await h.close()
      channel.releaseContributions()
      applyCardStyles(undefined)
    }
  }
}

{
  const session = fakeSession('card-preview-detail')
  const channel = open(session)
  session.emit([{ type: 'card.upsert', seq: 1, time: 1, record: { version: 1, type: 'acme/reading', id: 'reading', data: {} } }])
  const h = await mountChat(
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={false} trajectorySeen onExit={() => undefined} promptControllerRef={{ current: null }} />,
    100, false,
  )
  try {
    check('阅读：折叠卡片显示概要而不是隐藏全部正文',
      await settled(() => h.screen().includes('OVERVIEW_VISIBLE')) && !h.screen().includes('DETAIL_ONLY_VISIBLE'))
    const presented = readingPresentations
    h.input.write('\x1b[1;2A')
    await settle(() => h.screen().includes('esc 返回输入'))
    h.input.write('\r')
    check('阅读：展开用完整内容替换预览，不重复预览',
      await settled(() => h.screen().includes('DETAIL_ONLY_VISIBLE')) && !h.screen().includes('OVERVIEW_VISIBLE'))
    check('阅读：展开不重跑展示适配或请求模型', session.submits.length === 0 && readingPresentations === presented)
  } finally {
    await h.close()
    channel.releaseContributions()
  }
}

await admitted.fiber.dispose()
await root.fiber.dispose()

console.log(failed === 0 ? 'verify-custom-card-flow OK' : `verify-custom-card-flow: ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)

/** 显示宽度：不依赖渲染器的最小实现（CJK/emoji 宽 2），ANSI 已由屏幕文本去掉。 */
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
