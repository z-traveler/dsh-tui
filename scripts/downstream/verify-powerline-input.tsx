/** Public settings + actual Chat presentation. No provider calls or real user data.
 * node --import tsx/esm scripts/downstream/verify-powerline-input.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { activateModernEmojiWidths } from '../lib/modern-widths.mjs'
import { PassThrough, Writable } from 'node:stream'
import type { AgentSession } from '../../src/agent/session.js'
import type { PromptController } from '../../src/components/PromptInput.js'
process.env.FORCE_COLOR = '3'
process.env.TERM = 'xterm-256color'
process.env.COLORTERM = 'truecolor'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
delete process.env.TMUX
const [React, { Terminal }, ui, { Chat }, { createChannel }, { QuestionStore }, { ApprovalStore }, { settled, viewportLines }, { Config }, { configValues }, { createTuiSettingsService }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/channel.js'), import('../../src/dsh-adapter/questions.js'), import('../../src/dsh-adapter/approvals.js'),
  import('../lib/term-test.mjs'), import('../../src/dsh-adapter/index.js'), import('../../src/dsh-adapter/compat/settings.js'), import('../../src/dsh-adapter/tui-settings.js'),
])
let checks = 0
function check(label: string, run: () => void) { run(); console.log(`PASS ${++checks}: ${label}`) }
const file = `${process.env.HOME}/powerline.json`
const settings = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'fixture', keys: ['statusBar'] })
const scope = settings.register('dsh-tui', Config)
const defaults = configValues(scope.get()).statusBar!
check('native is the production default; Powerline has no forced below placement', () => {
  assert.equal(defaults.style, 'native')
  assert.equal(defaults.placement, undefined)
})
await settings.mutate('dsh-tui', [{ op: 'set', path: ['statusBar', 'style'], value: 'powerline' },
  { op: 'set', path: ['statusBar', 'powerline'], value: { icons: 'ascii', padding: 0, right: ['cwd'] } }])
check('production settings retain the style and option object', () => {
  const value = configValues(scope.get()).statusBar!
  assert.equal(value.style, 'powerline')
  assert.deepEqual(value.powerline, { icons: 'ascii', padding: 0, right: ['cwd'] })
})
const { TuiStatusStore } = await import('../../src/dsh-adapter/status.js')
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const fullscreen of [false, true]) for (const columns of [60, 180]) {
  let receive: Parameters<AgentSession['subscribe']>[0] | undefined
  const session: AgentSession = {
    ref: { backendId: 'fixture', sessionId: 'powerline-fixture' }, cwd: '/fixture/project', status: 'idle', capabilities: { native: {} },
    history: async () => [
      { type: 'session.ready', sessionId: 'powerline-fixture', cwd: '/fixture/project', model: 'deepseek-flash', effort: 'high', contextWindow: 100_000 },
      { type: 'context.usage', used: 25_000, max: 100_000 },
      { type: 'turn.end', turn: 0, reason: { kind: 'completed' }, time: 0, cost: { amount: 0.125, currency: 'USD', source: 'estimate' } },
    ],
    subscribe: listener => { receive = listener; return () => { receive = undefined } }, submit: async () => ({ accepted: false }),
    cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
  }
  const host = { on: () => () => undefined, get: () => undefined, logger: { warn() {}, info() {}, debug() {} } }
  const channel = createChannel(host as never, session, {
    model: 'deepseek-flash', provider: '', effort: 'high', cwd: session.cwd, activity: false, whale: false,
    statusBar: { ...configValues(scope.get()).statusBar, contextBar: false, cache: false, powerline: { icons: 'none' } },
  })
  const terminal = new Terminal({ cols: columns, rows: 40, scrollback: 200, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  class Output extends Writable { columns = columns; rows = 40; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input()
  const controller: { current: PromptController | null } = { current: null }
  const store = new TuiStatusStore()
  const chat = <Chat extensionStatus={store} channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
    fullscreen={fullscreen} trajectorySeen promptControllerRef={controller} onExit={() => undefined} />
  const node = <ui.ThemeProvider theme="dark">{chat}</ui.ThemeProvider>
  const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{node}</ui.AlternateScreen> : node,
    { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => viewportLines(terminal, 40)
  try {
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.append('输入ABC')
    assert.ok(await settled(() => lines().some(line => line.includes('输入ABC'))))
    const draftRow = () => lines().findIndex(line => line.includes('输入AB'))
    check(`fused single-line frame (${fullscreen},${columns})`, () => {
      const at = draftRow(), frame = lines()
      assert.ok(frame[at]!.trimStart().startsWith('╰─'), frame.join('\n'))
      assert.ok(frame[at]!.trimEnd().endsWith('─╯'), frame.join('\n'))
      assert.ok(frame[at - 1]!.includes('╭─'), frame.join('\n'))
      assert.ok(frame[at - 1]!.includes('deepseek-flash:high'), frame.join('\n'))
      assert.ok(frame[at - 1]!.includes('🐋'), frame.join('\n'))
      assert.ok(!frame[at]!.includes('⌸') && !frame[at]!.includes('⛶'))
    })
    check(`no progress gauge or permanent idle hint (${fullscreen},${columns})`, () => {
      const at = draftRow()
      assert.ok(!lines().slice(at - 2, at + 3).join('\n').includes('▕'))
      if (columns === 180) {
        const header = lines()[at - 1]!
        assert.ok(header.includes('25.0%/100k'), lines().join('\n'))
        assert.ok(header.includes('$0.1250'), lines().join('\n'))
      }
    })
    if (columns === 60) check(`whole fields overflow beneath the editor (${fullscreen})`, () => {
      assert.ok(!lines()[draftRow() - 1]!.includes('project'))
      assert.ok(lines()[draftRow() - 1]!.includes('$0.1250'))
      assert.ok(lines()[draftRow() + 1]!.includes('project'))
    })
    receive!([{ type: 'session.title', title: '验收会话', source: 'user' }], { replay: false })
    channel.setPromptSessionLabel(true)
    assert.ok(await settled(() => lines()[draftRow() - 1]?.includes('验收会话') === true))
    check(`session chip shares the top edge without an extra row (${fullscreen},${columns})`, () => {
      const header = lines()[draftRow() - 1]!
      assert.ok(header.includes('╭─') && header.includes('deepseek-flash:high') && header.includes('验收会话'))
      assert.ok(lines().slice(draftRow() - 1, draftRow() + 2).join('\n').includes('25.0%/100k'))
    })
    channel.setStatusBar({ placement: 'below' })
    assert.ok(await settled(() => lines()[draftRow() + 1]?.includes('deepseek-flash:high') === true))
    check(`explicit below placement has one frame and a plain HUD (${fullscreen},${columns})`, () => {
      assert.ok(lines()[draftRow() - 1]!.includes('验收会话'))
      assert.ok(!lines()[draftRow() + 1]!.includes('╭') && !lines()[draftRow() + 1]!.includes('╮'))
      assert.ok(lines()[draftRow() + 1]!.includes('$0.1250'))
    })
    channel.setPromptSessionLabel(false)
    channel.setStatusBar({ placement: 'above' })
    const custom = { left: ['model'], icons: 'none', padding: 0 }
    channel.setStatusBar({ powerline: custom })
    assert.ok(await settled(() => lines()[draftRow() - 1]?.startsWith('╭─deepseek-flash:high') === true))
    check(`unchanged options are a no-op (${fullscreen},${columns})`, () => {
      const version = channel.version
      channel.setStatusBar({ powerline: custom })
      assert.equal(channel.version, version)
    })
    channel.setStatusBar({ powerline: undefined })
    assert.ok(await settled(() => lines()[draftRow() - 1]?.includes('🐋') === true))
    check(`clearing options restores the preset (${fullscreen},${columns})`, () => assert.equal(channel.statusBar.powerline, undefined))
    channel.setStatusBar({ powerline: { left: ['cwd', 'model'], right: ['context'], padding: 2, icons: 'ascii', separator: '|' } })
    assert.ok(await settled(() => lines()[draftRow() - 1]?.includes('dir project') === true))
    check(`configured groups reserve the right context first (${fullscreen},${columns})`, () => {
      const header = lines()[draftRow() - 1]!
      assert.ok(header.startsWith('╭─  dir project'))
      assert.ok(header.lastIndexOf('ctx 25.0%/100k') > header.indexOf('dir project'))
      if (columns === 60) assert.ok(lines()[draftRow() + 1]!.includes('model deepseek-flash:high'))
    })
    channel.setStatusBar({ powerline: { icons: 'none' } })
    assert.ok(await settled(() => lines()[draftRow() - 1]?.includes('🐋') === true))
    input.write('\u001b[D')
    input.write('X')
    assert.ok(await settled(() => controller.current!.text() === '输入ABXC'))
    channel.setStatusBar({ style: 'native' })
    assert.ok(await settled(() => draftRow() >= 0 && lines()[draftRow()]?.trimStart().startsWith('╰─') === false))
    input.write('Y')
    assert.ok(await settled(() => controller.current!.text() === '输入ABXYC'))
    channel.setStatusBar({ style: 'powerline' })
    assert.ok(await settled(() => lines()[draftRow()]?.trimStart().startsWith('╰─') === true))
    input.write('Z')
    assert.ok(await settled(() => controller.current!.text() === '输入ABXYZC'))
    check(`style switching preserves the draft, middle cursor and input ownership (${fullscreen},${columns})`, () => {
      assert.equal(controller.current!.text(), '输入ABXYZC')
    })
    controller.current!.append('\n第二行')
    assert.ok(await settled(() => lines().some(line => line.includes('第二行'))))
    check(`multiline frame keeps the last input in its bottom rail (${fullscreen},${columns})`, () => {
      assert.ok(lines().find(line => line.includes('第二行'))!.trimStart().startsWith('╰─'))
      assert.ok(lines().find(line => line.includes('输入ABXYZ'))!.trimStart().startsWith('│'))
    })
    let clicks = 0
    const owner = {}
    store.setField({ key: 'fixture:metric', text: 'PLUGIN 7%', slot: 'left-tail', tone: 'warning', maxCells: 16, minColumns: 0,
      detail: 'plugin details stay opaque', onClick: () => { clicks++ } }, 1, owner)
    store.setField({ key: 'fixture:ready', text: 'READY', slot: 'right-head', tone: 'success', maxCells: 16, minColumns: 100 }, 2, owner)
    store.set('fixture:status', 'StatusX', 3, owner)
    store.addView({ key: 'fixture:view', maxRows: 1, registrationId: 1, component: () => <ui.Text>RICH_VIEW</ui.Text> }, 4, owner)
    assert.ok(await settled(() => lines().some(line => line.includes('PLUGIN 7%')) && lines().some(line => line.includes('RICH_VIEW'))))
    check(`plugin values, slot visibility and separate rich view survive (${fullscreen},${columns})`, () => {
      const frame = lines()
      assert.ok(frame.some(line => line.includes('StatusX')))
      assert.equal(frame.some(line => line.includes('READY')), columns >= 100)
      assert.ok(!frame.find(line => line.includes('RICH_VIEW'))!.includes('deepseek-flash'))
    })
    if (fullscreen) {
      const row = lines().findIndex(line => line.includes('PLUGIN 7%'))
      const col = lines()[row]!.indexOf('PLUGIN 7%')
      const before = draftRow()
      input.write(`\u001b[<35;${col + 1};${row + 1}M`)
      assert.ok(await settled(() => lines().some(line => line.includes('plugin details stay opaque'))))
      check(`plugin details float without moving the editor (${columns})`, () => assert.equal(draftRow(), before))
      input.write(`\u001b[<0;${col + 1};${row + 1}M`)
      input.write(`\u001b[<0;${col + 1};${row + 1}m`)
      assert.ok(await settled(() => clicks === 1))
      input.write('\u001b[<35;1;1M')
      assert.ok(await settled(() => !lines().some(line => line.includes('plugin details stay opaque'))))
    }
    store.clearFieldIf('fixture:metric', 1, owner)
    store.clearFieldIf('fixture:ready', 2, owner)
    store.clearIf('fixture:status', 3, owner)
    store.clearViewIf('fixture:view', 4, owner)
    assert.ok(await settled(() => !lines().some(line => /PLUGIN 7%|READY|StatusX|RICH_VIEW/.test(line))))
    check(`disposing plugin contributions removes them (${fullscreen},${columns})`, () => assert.equal(store.getFieldSnapshot().length, 0))
    const beforeNotice = draftRow()
    const dismissNotice = channel.notify('NOTICE stays visible', { color: 'warning', timeoutMs: 10_000 })
    assert.ok(await settled(() => lines().some(line => line.includes('NOTICE stays visible'))))
    check(`notifications remain visible without moving the editor (${fullscreen},${columns})`, () => assert.equal(draftRow(), beforeNotice))
    dismissNotice()
    assert.ok(await settled(() => !lines().some(line => line.includes('NOTICE stays visible'))))
    receive!([{ type: 'turn.start', turn: 1, origin: 'user', time: Date.now() }], { replay: false })
    assert.ok(await settled(() => {
      const frame = lines(), at = frame.findIndex(line => /[0-9]s.*interrupt/i.test(line))
      return at > 0 && frame[at - 1]!.trim() === '' && frame[at + 1]!.includes('╭─')
    }), lines().join('\n'))
    check(`working row is compact, separated above HUD, with no default counters (${fullscreen},${columns})`, () => {
      const frame = lines(), workAt = frame.findIndex(line => /[0-9]s.*interrupt/i.test(line))
      assert.equal(frame[workAt - 1]!.trim(), '')
      assert.ok(frame[workAt + 1]!.includes('╭─'), frame.join('\n'))
      assert.ok(!frame[workAt]!.includes('↑') && !frame[workAt]!.includes('↓'))
    })
    channel.setStatusBar({ workingCounters: true })
    assert.ok(await settled(() => lines().some(line => /[0-9]s.*↑.*↓.*interrupt/i.test(line))))
    receive!([{ type: 'turn.end', turn: 1, reason: { kind: 'completed' }, time: Date.now() }], { replay: false })
    assert.ok(await settled(() => !lines().some(line => /[0-9]s.*interrupt/i.test(line))))
    check(`working row disappears when idle (${fullscreen},${columns})`, () => assert.ok(!channel.working))
  } finally { await instance.unmount(); channel.releaseContributions(); terminal.dispose(); input.destroy() }
}
console.log(`Powerline input: ${checks} checks passed`)
