/** Offline acceptance fixture: real Chat/Channel, no provider or credentials.
 * node --import tsx/esm scripts/downstream/hud-demo.tsx [--inline] */
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
const [React, ui, { Chat }, { createChannel }, { QuestionStore }, { ApprovalStore }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/channel.js'), import('../../src/dsh-adapter/questions.js'),
  import('../../src/dsh-adapter/approvals.js'),
])
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this demo in a terminal')
const fixture: readonly AgentEvent[] = [
  { type: 'session.ready', sessionId: 'hud-demo', cwd: home, model: 'HUD-DEMO', provider: 'fixture', effort: 'high', contextWindow: 100_000 },
  { type: 'turn.end', turn: 0, reason: { kind: 'completed' }, time: 0, cost: { amount: 0.125, currency: 'USD', source: 'estimate' } },
  { type: 'context.usage', used: 25_000, max: 100_000 },
]
const session: AgentSession = {
  ref: { backendId: 'fixture', sessionId: 'hud-demo' }, cwd: home, status: 'idle', capabilities: { native: {} },
  history: async () => fixture, subscribe: () => () => undefined,
  submit: async () => ({ accepted: false, reason: '离线外观演示不发送消息；请使用 Alt+1/2/3/4。' }),
  cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
}
const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }
const order = 'model,thinking,contextUsage,cost,cwd,gitBranch'
const channel = createChannel(host as never, session, {
  model: 'HUD-DEMO', provider: 'fixture', cwd: home, activity: false, whale: false,
  statusBar: { placement: 'above', separator: 'powerline-thin', order, contextBar: false, cache: false, gitBranch: true },
})
const fullscreen = !process.argv.includes('--inline')
let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })
function Demo() {
  ui.useInput((input, key, event) => {
    if (key.ctrl && input === 'c') { event.stopImmediatePropagation(); finish(); return }
    if (!key.meta || !['1', '2', '3', '4'].includes(input)) return
    event.stopImmediatePropagation()
    if (input === '1') channel.setStatusBar({ placement: channel.statusBar.placement === 'above' ? 'below' : 'above' })
    if (input === '2') channel.setStatusBar({ separator: channel.statusBar.separator === 'powerline-thin' ? 'dot' : 'powerline-thin' })
    if (input === '3') channel.setStatusBar({ order: channel.statusBar.order === order ? 'cwd,cost,contextUsage,thinking,model,gitBranch' : order })
    if (input === '4') channel.setStatusBar({ placement: 'below', separator: 'dot', order: '' })
  }, { prepend: true })
  return <ui.Box flexDirection="column" height={fullscreen ? '100%' : undefined}>
    <ui.Text>离线 HUD 演示：Alt+1 位置 / Alt+2 分隔符 / Alt+3 顺序 / Alt+4 原生 / Ctrl+C 退出</ui.Text>
    <Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
      fullscreen={fullscreen} trajectorySeen onExit={finish} />
  </ui.Box>
}
const content = <ui.ThemeProvider theme="dark"><Demo /></ui.ThemeProvider>
const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content, { exitOnCtrlC: false, patchConsole: false })
try { await done } finally { await instance.unmount(); channel.releaseContributions() }
