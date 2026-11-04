/** Focused downstream HUD regression. No provider calls or real user state.
 * node --import tsx/esm scripts/downstream/verify-hud.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { AgentSession } from '../../src/agent/session.js'
import type { PromptController } from '../../src/components/PromptInput.js'
process.env.FORCE_COLOR = '3'
process.env.TERM = 'xterm-256color'
process.env.COLORTERM = 'truecolor'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
delete process.env.TMUX
const [React, { Terminal }, ui, { Chat }, { StatusLine }, { createChannel }, { QuestionStore }, { ApprovalStore }, { settled, viewportLines }, prefs, { Config }, { configValues }, { createTuiSettingsService }, { EDITABLE_CONFIG_KEYS }, { parseStatusBarOrder }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/screens/Chat.js'), import('../../src/screens/StatusLine.js'),
  import('../../src/dsh-adapter/channel.js'), import('../../src/dsh-adapter/questions.js'),
  import('../../src/dsh-adapter/approvals.js'), import('../lib/term-test.mjs'),
  import('../../src/tuiDisplayPrefs.js'), import('../../src/dsh-adapter/index.js'),
  import('../../src/dsh-adapter/compat/settings.js'), import('../../src/dsh-adapter/tui-settings.js'),
  import('../../src/settings/definitions.js'), import('../../src/hudLayout.js'),
])
let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }
const layout = { placement: 'above', separator: 'powerline-thin', order: 'model,thinking,contextUsage,cost,cwd,gitBranch' } as const
check('explicit preferences normalize without changing native defaults', () => {
  assert.deepEqual(prefs.normalizeStatusBar(undefined), prefs.DEFAULT_STATUS_BAR)
  assert.deepEqual(prefs.normalizeStatusBar({ ...layout, order: ' model, thinking, contextUsage, cost, cwd, gitBranch ' }), { ...prefs.DEFAULT_STATUS_BAR, ...layout })
  for (const order of ['model,unknown', 'model,model', 'model,', '__proto__', 'constructor']) {
    assert.equal(parseStatusBarOrder(order), undefined)
    assert.deepEqual(prefs.normalizeStatusBar({ placement: 'side', separator: '\x1b[31m', order }), prefs.DEFAULT_STATUS_BAR)
  }
  assert.deepEqual(parseStatusBarOrder(''), [])
})
const file = join(process.env.HOME!, 'hud-settings.json')
const service = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'hud-test', keys: EDITABLE_CONFIG_KEYS })
const scope = service.register('dsh-tui', Config)
await service.mutate('dsh-tui', Object.entries(layout).map(([key, value]) => ({ op: 'set' as const, path: ['statusBar', key], value })))
const reloaded = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'hud-test', keys: EDITABLE_CONFIG_KEYS }).register('dsh-tui', Config)
check('settings round-trip through production schema and a new service', () => {
  for (const [key, value] of Object.entries(layout)) {
    assert.equal((configValues(scope.get()).statusBar as Record<string, unknown>)[key], value)
    assert.equal((configValues(reloaded.get()).statusBar as Record<string, unknown>)[key], value)
  }
})
class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}
async function mount(node: React.ReactNode, columns = 180, fullscreen = false) {
  const rows = 32
  const terminal = new Terminal({ cols: columns, rows, scrollback: 200, allowProposedApi: true })
  class Output extends Writable {
    columns = columns
    rows = rows
    isTTY = true
    _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
  }
  const stdout = new Output(), input = new Input()
  const content = <ui.ThemeProvider theme="dark">{node}</ui.ThemeProvider>
  const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content, {
    stdout: stdout as never, stdin: input as never, stderr: stdout as never, exitOnCtrlC: false, patchConsole: false,
  })
  return {
    input, lines: () => viewportLines(terminal, rows),
    async close() { await instance.unmount(); terminal.dispose(); input.destroy() },
  }
}
const base = {
  agentId: 'abc12345', model: 'HUD-MODEL', reasoningEffort: 'max',
  cwd: '/fixture/项目', displayCwd: '/fixture/项目', gitBranch: 'feature/hud',
  contextWindow: 100_000, lastUsage: { input: 24_000, output: 500, cacheRead: 1_000, cacheWrite: 0 },
  tokens: { input: 2000, output: 500 }, costReport: { amount: 0.125, currency: 'USD', source: 'estimate' },
  mode: { id: 'default', plan: false }, modeIndex: 0, working: false,
  contextBarEnabled: true, activityFrames: [], sessionTitle: 'HUD-TITLE', tps: 37, tpsSamples: [],
}
const statusBar = { ...prefs.DEFAULT_STATUS_BAR, ...layout, contextBar: false, cache: false, gitBranch: true }
async function status(overrides: Record<string, unknown> = {}, columns = 180, extras: Record<string, unknown> = {}) {
  const h = await mount(<StatusLine channel={{ ...base, statusBar, ...overrides } as never} {...extras} />, columns)
  try {
    assert.ok(await settled(() => h.lines().some(line => line.trim() !== '')))
    return h.lines().filter(line => line.trim() !== '')
  } finally { await h.close() }
}
function inOrder(text: string, values: string[]) {
  let previous = -1
  for (const value of values) {
    const index = text.indexOf(value)
    assert.ok(index > previous, `missing/out of order ${value}: ${text}`)
    assert.equal(text.indexOf(value, index + value.length), -1)
    previous = index
  }
}
const custom = await status()
check('custom row uses existing metrics, configured order and Powerline separators', () => {
  assert.equal(custom.length, 1)
  inOrder(custom[0]!, ['HUD-MODEL', 'max', 'ctx 25%', '$0.1250', '项目', 'feature/hud'])
  assert.equal(custom[0]!.split('\ue0b1').length - 1, 5)
})
const native = await status({ statusBar: { ...prefs.DEFAULT_STATUS_BAR, contextBar: false, cache: false, gitBranch: true } })
const explicitNative = await status({ statusBar: { ...statusBar, placement: 'below', separator: 'dot', order: '' } })
check('default and explicitly restored native layout match', () => assert.deepEqual(explicitNative, native))
const all = await status({
  statusBar: { ...statusBar, tokens: true, cache: true, tps: true, mode: true, sessionTitle: true, sessionId: true,
    order: 'sessionId,sessionTitle,goal,mode,tps,cache,tokens,gitBranch,cwd,cost,contextUsage,thinking,model' },
  modeIndex: 1, mode: { id: 'plan', plan: true },
  goal: { id: 'g', revision: 1, objective: 'goal', phase: 'active', roundsStarted: 2, maxGoalRounds: 5 },
}, 300)
check('all public order keys map to the native fields', () => inOrder(all[0]!, ['#abc12345', 'HUD-TITLE', '2/5', 'plan mode', '37 t/s', 'cache 4.0%', '2k→500', 'feature/hud', '项目', '$0.1250', 'ctx 25%', 'max', 'HUD-MODEL']))
const appended = await status({ statusBar: { ...statusBar, order: 'cwd', model: false } }, 180, {
  backendMode: { id: 'bypassPermissions', name: 'UNSAFE-MODE', onOpen() {} },
  pluginFields: [{ key: 'test', text: 'PLUGIN-FIELD', slot: 'right-tail', tone: 'dim', maxCells: 20, minColumns: 0 }],
})
check('omitted fields survive; order never enables hidden fields', () => {
  assert.ok(!appended.join().includes('HUD-MODEL'))
  inOrder(appended[0]!, ['项目', 'max', 'UNSAFE-MODE'])
  assert.ok(appended[0]!.includes('PLUGIN-FIELD'))
})
const minimal = await status({ minimalUi: true })
const minimalNative = await status({ minimalUi: true, statusBar: prefs.DEFAULT_STATUS_BAR })
check('minimal UI ignores layout preferences', () => assert.deepEqual(minimal, minimalNative))
for (const columns of [40, 60, 84]) {
  const narrow = await status({}, columns)
  check(`single field row at ${columns} columns`, () => { assert.equal(narrow.length, 1); assert.ok(narrow[0]!.includes('HUD-MODEL')) })
}
for (const fullscreen of [false, true]) for (const columns of [60, 120]) {
  const session: AgentSession = {
    ref: { backendId: 'fixture', sessionId: 'hud-session' }, cwd: '/fixture/project', status: 'idle', capabilities: { native: {} },
    history: async () => [], subscribe: () => () => undefined, submit: async () => ({ accepted: true }),
    cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
  }
  const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }
  const channel = createChannel(host as never, session, { model: 'HUD-MODEL', provider: '', cwd: session.cwd, activity: false, whale: false,
    statusBar: { contextBar: false, contextUsage: false, cwd: false, cache: false } })
  const controller: { current: PromptController | null } = { current: null }
  const h = await mount(<Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
    fullscreen={fullscreen} trajectorySeen onExit={() => undefined} promptControllerRef={controller} />, columns, fullscreen)
  const placed = (above: boolean) => {
    const lines = h.lines(), prompt = lines.findIndex(line => line.includes('HUD-DRAFT'))
    const candidates = lines.map((text, index) => ({ text, index })).filter(row => row.text.includes('HUD-MODEL') && Math.abs(row.index - prompt) <= 4)
    return prompt >= 0 && candidates.length === 1 && (above ? candidates[0]!.index < prompt : candidates[0]!.index > prompt)
  }
  try {
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.append('HUD-DRAFT')
    assert.ok(await settled(() => placed(false)), h.lines().join('\n'))
    channel.setStatusBar({ placement: 'above' })
    assert.ok(await settled(() => placed(true)), h.lines().join('\n'))
    h.input.write('X')
    assert.ok(await settled(() => controller.current!.text() === 'HUD-DRAFTX'))
    channel.setStatusBar({ placement: 'below' })
    assert.ok(await settled(() => placed(false)), h.lines().join('\n'))
    assert.equal(controller.current!.text(), 'HUD-DRAFTX')
    check(`Chat moves HUD without losing draft/focus (${fullscreen ? 'fullscreen' : 'inline'}, ${columns})`, () => {})
  } finally { await h.close(); channel.releaseContributions() }
}
console.log(`HUD: ${checks} checks passed`)
