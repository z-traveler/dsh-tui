/** Offline real-Chat scenes, no provider requests or credentials.
 * node --import tsx/esm scripts/downstream/hud-demo.tsx [--inline]
 * Alt+0 backend scene, 1 placement, 2 icon mode, 3 order, 4 style,
 * 5 working, 6 overflow, 7 plugin, 8 context, 9 subscription snapshot.
 * No guessed brand-icon overrides. Ctrl+C exits. */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { AgentEvent } from '../../src/agent/events.js'
import type { AgentSession } from '../../src/agent/session.js'
import type { StatusBarConfig } from '../../src/adapter/ports/channel-display.js'
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
function subscriptionSnapshot(backendId: string, index: number): AgentEvent {
  const now = Date.now(), day = 86_400_000
  return { type: 'rate-limit', info: { windows: [
    { name: 'five_hour', utilization: [.2, .76, .91][index]!, resetsAt: now + (index === 2 ? -60_000 : index === 1 ? 20 * 60_000 : 2 * 3_600_000) },
    { name: 'seven_day', utilization: (backendId === 'codex' ? [.2, .76, .91] : [.76, .91, .91])[index]!, resetsAt: now + (index === 2 ? -60_000 : index === 1 ? day : 6 * day) },
  ] } }
}
const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }
const scenes = [
  { backendId: 'fixture', model: 'deepseek-flash' },
  { backendId: 'codex', model: 'gpt-5' },
  { backendId: 'claude', model: 'claude-sonnet-4-5' },
].map(({ backendId, model }) => {
  let receive: Parameters<AgentSession['subscribe']>[0] | undefined
  const sessionId = `hud-demo-${backendId}`
  const session: AgentSession = {
    ref: { backendId, sessionId }, cwd: home, status: 'idle', capabilities: { native: {} },
    history: async () => [
      { type: 'session.ready', sessionId, cwd: home, model, effort: 'high', contextWindow: 100_000 },
      { type: 'turn.end', turn: 0, reason: { kind: 'completed' }, time: 0, cost: { amount: .125, currency: 'USD', source: 'estimate' } },
      { type: 'context.usage', used: 25_000, max: 100_000 },
    ],
    subscribe: listener => { receive = listener; return () => { receive = undefined } },
    submit: async () => ({ accepted: false, reason: '离线演示不发送消息；Alt+0…9 切换场景，Ctrl+C 退出。' }),
    cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
  }
  const channel = createChannel(host as never, session, {
    model, provider: 'fixture', effort: 'high', cwd: home, activity: false, whale: false,
    statusBar: { style: 'powerline', contextBar: false, cache: false, gitBranch: true },
  })
  return { backendId, channel, quotaIndex: 0, turn: 0,
    emit: (events: readonly AgentEvent[]) => receive?.(events, { replay: false }) }
})
function setStatusBar(value: Partial<StatusBarConfig>) { for (const scene of scenes) scene.channel.setStatusBar(value) }
const store = new TuiStatusStore(), owner = {}
const questions = new QuestionStore(), approvals = new ApprovalStore()
const fullscreen = !process.argv.includes('--inline')
let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })
let reordered = false, plugin = false, contextIndex = 0
function Demo() {
  const [sceneIndex, setSceneIndex] = React.useState(0)
  const scene = scenes[sceneIndex]!, channel = scene.channel
  React.useEffect(() => {
    if (scene.backendId !== 'fixture') scene.emit([subscriptionSnapshot(scene.backendId, scene.quotaIndex)])
  }, [scene])
  ui.useInput((input, key, event) => {
    if (key.ctrl && input === 'c') { event.stopImmediatePropagation(); finish(); return }
    if (!key.meta || !'0123456789'.includes(input) || input.length !== 1) return
    event.stopImmediatePropagation()
    const options = normalizePowerlineOptions(channel.statusBar.powerline)
    if (input === '0') setSceneIndex(index => (index + 1) % scenes.length)
    if (input === '1') setStatusBar({ placement: channel.statusBar.placement === 'below' ? 'above' : 'below' })
    if (input === '2') setStatusBar({ powerline: { ...options, icons: options.icons === 'nerd' ? 'ascii' : 'nerd' } })
    if (input === '3') {
      reordered = !reordered
      setStatusBar({ powerline: { ...options, left: reordered ? ['cwd', 'model', 'context', 'cost', 'git', 'plugins'] : normalizePowerlineOptions(undefined).left } })
    }
    if (input === '4') setStatusBar({ style: channel.statusBar.style === 'powerline' ? 'native' : 'powerline' })
    if (input === '5') scene.emit([channel.working
      ? { type: 'turn.end', turn: scene.turn, reason: { kind: 'completed' }, time: Date.now() }
      : { type: 'turn.start', turn: ++scene.turn, origin: 'user', time: Date.now() }])
    if (input === '6') setStatusBar({ powerline: { ...options, secondaryOverflow: options.secondaryOverflow === 'wrap' ? 'drop' : 'wrap' } })
    if (input === '7') {
      plugin = !plugin
      if (plugin) store.setField({ key: 'fixture:build', text: '构建 42%', slot: 'left-tail', tone: 'warning', maxCells: 16,
        minColumns: 0, detail: '离线插件字段：保留原值、语义色、单行预算和生命周期。' }, 1, owner)
      else store.clearFieldIf('fixture:build', 1, owner)
    }
    if (input === '8') {
      contextIndex = (contextIndex + 1) % 3
      scene.emit([{ type: 'context.usage', used: [25_000, 75_000, 95_000][contextIndex]!, max: 100_000 }])
    }
    if (input === '9') {
      if (scene.backendId === 'fixture') channel.notify('DeepSeek 场景不显示订阅窗口；Alt+0 切换到 Codex/Claude。', { timeoutMs: 3000 })
      else {
        scene.quotaIndex = (scene.quotaIndex + 1) % 3
        scene.emit([subscriptionSnapshot(scene.backendId, scene.quotaIndex)])
        channel.notify('已刷新离线订阅样例（未联网）。', { timeoutMs: 2000 })
      }
    }
  }, { prepend: true })
  return <Chat channel={channel as never} questionStore={questions} approvalStore={approvals} extensionStatus={store}
    fullscreen={fullscreen} trajectorySeen onExit={finish} />
}
const content = <ui.ThemeProvider theme="dark"><Demo /></ui.ThemeProvider>
const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content, { exitOnCtrlC: false, patchConsole: false })
try { await done } finally { await instance.unmount(); for (const scene of scenes) scene.channel.releaseContributions() }
