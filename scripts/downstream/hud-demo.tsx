/** Offline acceptance fixture: actual Chat/Channel, no provider or credentials.
 * node --import tsx/esm scripts/downstream/hud-demo.tsx [--inline]
 * Demo-only Alt+1 placement, 2 icons, 3 groups, 4 style, 5 working,
 * 6 overflow, 7 plugin field, 8 context, 9 subscription snapshot, 0 model.
 * All quota/reset data are fixtures. Ctrl+C exits. */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { AgentEvent } from '../../src/agent/events.js'
import type { AgentSession } from '../../src/agent/session.js'
const home = fileURLToPath(new URL('../../.local/hud-demo/home/', import.meta.url))
mkdirSync(home, { recursive: true, mode: 0o700 })
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
process.env.DSH_TUI_LANG = 'zh'
const [React, ui, { Chat }, { createChannel }, { QuestionStore }, { ApprovalStore }, { TuiStatusStore }, { normalizePowerlineOptions }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/channel.js'), import('../../src/dsh-adapter/questions.js'),
  import('../../src/dsh-adapter/approvals.js'), import('../../src/dsh-adapter/status.js'), import('../../src/powerline/config.js'),
])
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this demo in a terminal')
function subscriptionSnapshot(index: number): AgentEvent {
  const now = Date.now()
  return { type: 'rate-limit', info: { windows: [
    { name: 'five_hour', utilization: [.25, .8, .9][index]!, resetsAt: now + (index === 2 ? -60_000 : 2 * 60 * 60 * 1000) },
    { name: 'seven_day', utilization: [.4, .65, .85][index]!, resetsAt: now + 72 * 60 * 60 * 1000 },
  ] } }
}
const fixture: readonly AgentEvent[] = [
  { type: 'session.ready', sessionId: 'hud-demo', cwd: home, model: 'deepseek-flash', provider: 'fixture', effort: 'high', contextWindow: 100_000 },
  { type: 'turn.end', turn: 0, reason: { kind: 'completed' }, time: 0, cost: { amount: 0.125, currency: 'USD', source: 'estimate' } },
  { type: 'context.usage', used: 25_000, max: 100_000 },
]
let receive: Parameters<AgentSession['subscribe']>[0] | undefined
const session: AgentSession = {
  ref: { backendId: 'fixture', sessionId: 'hud-demo' }, cwd: home, status: 'idle', capabilities: { native: {} },
  history: async () => fixture, subscribe: listener => { receive = listener; return () => { receive = undefined } },
  submit: async () => ({ accepted: false, reason: '离线外观演示不发送消息；Alt+0…9 切换外观，Ctrl+C 退出。' }),
  cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
}
const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }
const channel = createChannel(host as never, session, {
  model: 'deepseek-flash', provider: 'fixture', effort: 'high', cwd: home, activity: false, whale: false,
  statusBar: { style: 'powerline', contextBar: false, cache: false, gitBranch: true,
    powerline: { modelIcons: [{ pattern: '^deepseek', icon: '◆' }, { pattern: '^gpt', icon: '◉' }, { pattern: '^claude', icon: '✳' }] } },
})
const store = new TuiStatusStore(), owner = {}
const questions = new QuestionStore(), approvals = new ApprovalStore()
const fullscreen = !process.argv.includes('--inline')
let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })
let reordered = false, plugin = false, contextIndex = 0, turn = 0, quotaIndex = 0, modelIndex = 0
function Demo() {
  React.useEffect(() => { receive?.([subscriptionSnapshot(0)], { replay: false }) }, [])
  ui.useInput((input, key, event) => {
    if (key.ctrl && input === 'c') { event.stopImmediatePropagation(); finish(); return }
    if (!key.meta || !'0123456789'.includes(input) || input.length !== 1) return
    event.stopImmediatePropagation()
    const options = normalizePowerlineOptions(channel.statusBar.powerline)
    if (input === '1') channel.setStatusBar({ placement: channel.statusBar.placement === 'below' ? 'above' : 'below' })
    if (input === '2') channel.setStatusBar({ powerline: { ...options, icons: options.icons === 'nerd' ? 'ascii' : 'nerd' } })
    if (input === '3') {
      reordered = !reordered
      channel.setStatusBar({ powerline: reordered ? { ...options, left: ['cwd', 'model', 'context', 'cost', 'quota', 'git', 'plugins'] } : { ...options, left: normalizePowerlineOptions(undefined).left } })
    }
    if (input === '4') channel.setStatusBar({ style: channel.statusBar.style === 'powerline' ? 'native' : 'powerline' })
    if (input === '5') receive?.([channel.working
      ? { type: 'turn.end', turn, reason: { kind: 'completed' }, time: Date.now() }
      : { type: 'turn.start', turn: ++turn, origin: 'user', time: Date.now() }], { replay: false })
    if (input === '6') channel.setStatusBar({ powerline: { ...options, secondaryOverflow: options.secondaryOverflow === 'wrap' ? 'drop' : 'wrap' } })
    if (input === '7') {
      plugin = !plugin
      if (plugin) store.setField({ key: 'fixture:build', text: '构建 42%', slot: 'left-tail', tone: 'warning', maxCells: 16,
        minColumns: 0, detail: '离线插件字段：保留原值、语义色、单行预算和生命周期。' }, 1, owner)
      else store.clearFieldIf('fixture:build', 1, owner)
    }
    if (input === '8') {
      contextIndex = (contextIndex + 1) % 3
      receive?.([{ type: 'context.usage', used: [25_000, 75_000, 95_000][contextIndex]!, max: 100_000 }], { replay: false })
    }
    if (input === '9') {
      quotaIndex = (quotaIndex + 1) % 3
      receive?.([subscriptionSnapshot(quotaIndex)], { replay: false })
      channel.notify('已刷新离线订阅样例（未联网）；悬停额度查看完整重置时间。', { timeoutMs: 3000 })
    }
    if (input === '0') {
      modelIndex = (modelIndex + 1) % 3
      receive?.([{ type: 'model.changed', model: ['deepseek-flash', 'gpt-5', 'claude-sonnet-4-5'][modelIndex]!, source: 'user' }], { replay: false })
    }
  }, { prepend: true })
  return <Chat channel={channel as never} questionStore={questions} approvalStore={approvals} extensionStatus={store}
    fullscreen={fullscreen} trajectorySeen onExit={finish} />
}
const content = <ui.ThemeProvider theme="dark"><Demo /></ui.ThemeProvider>
const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content, { exitOnCtrlC: false, patchConsole: false })
try { await done } finally { await instance.unmount(); channel.releaseContributions() }
