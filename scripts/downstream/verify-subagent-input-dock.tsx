/** Real Chat + channel, isolated fake backend. No credentials or model calls.
 * Run: node --import tsx/esm scripts/downstream/verify-subagent-input-dock.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { activateModernEmojiWidths } from '../lib/modern-widths.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_TMUX_TRUECOLOR = '1'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_HOME = `${process.env.HOME}/.dsh`
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, { Terminal }, ui, { Chat }, { QuestionStore }, { ApprovalStore }, { settled, viewportLines }, { Config }, { subagentDockFixture }, { createTuiSettingsService }, { configValues }, prefs, { registerBuiltinPanels }, { applyCardStyles }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/questions.js'), import('../../src/dsh-adapter/approvals.js'), import('../lib/term-test.mjs'),
  import('../../src/dsh-adapter/index.js'), import('./subagent-dock-fixture.js'), import('../../src/dsh-adapter/tui-settings.js'),
  import('../../src/dsh-adapter/compat/settings.js'), import('../../src/tuiDisplayPrefs.js'), import('../../src/components/sidePanel/builtinPanels.js'), import('../../src/cardStyles.js'),
])
let checks = 0
function check(label: string, run: () => void) { run(); console.log(`PASS ${++checks}: ${label}`) }
check('configuration defaults off and permits opt-in', () => {
  assert.equal(configValues(Config({})).subagentInputDock, false)
  assert.equal(configValues(Config({ subagentInputDock: true })).subagentInputDock, true)
})
const file = `${process.env.HOME}/dock-settings.json`
const settings = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'fixture', keys: ['subagentInputDock'] })
settings.register('dsh-tui', Config)
await settings.mutate('dsh-tui', [{ op: 'set', path: ['subagentInputDock'], value: true }])
check('user settings survive reload', () => {
  const reloaded = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'fixture', keys: ['subagentInputDock'] }).register('dsh-tui', Config)
  assert.equal(configValues(reloaded.get()).subagentInputDock, true)
})
registerBuiltinPanels()
prefs.applySidePanelPanels('agents')
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const preset of ['legacy', 'pi-like'] as const) for (const fullscreen of [false, true]) for (const rows of [18, 40]) {
  applyCardStyles({ preset })
  const theme = preset === 'pi-like' && rows === 40 ? 'light' : 'dark'
  const columns = rows === 18 ? 60 : 120
  prefs.applySidePanelOpen(false)
  const h = subagentDockFixture(false)
  const channel = h.channel
  const terminal = new Terminal({ cols: columns, rows, scrollback: 300, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  class Output extends Writable { columns = columns; rows = rows; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input()
  const controller: { current: import('../../src/components/PromptInput.js').PromptController | null } = { current: null }
  const content = <ui.ThemeProvider theme={theme}><Chat channel={channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()}
    fullscreen={fullscreen} trajectorySeen promptControllerRef={controller} onExit={() => undefined} /></ui.ThemeProvider>
  const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content,
    { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => viewportLines(terminal, output.rows)
  const frame = () => lines().join('\n')
  const where = (text: string) => lines().findIndex(line => line.includes(text))
  const tag = `${preset} ${theme} ${fullscreen ? 'fullscreen' : 'inline'} ${columns}x${rows}`
  const cell = (row: number, column: number) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.getCell(column)
  const background = (row: number, column = columns - 1) => cell(row, column)?.getBgColor()
  try {
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.append('DRAFT_KEEP')
    h.beginTurn()
    h.start('A')
    h.progress('A', 'LIVE_ACTIVITY_A')
    for (let i = 0; i < 45; i++) h.reply(`MAIN_REPLY_${i}`)
    assert.ok(await settled(() => frame().includes('MAIN_REPLY_44') && frame().includes('DRAFT_KEEP')), frame())
    check(`disabled view leaves only historical card (${tag})`, () => {
      assert.ok(!frame().includes('DOCK_TASK_A'), frame())
      assert.equal(channel.rows.filter(row => row.kind === 'subagent').length, 1)
    })
    await channel.settingsHost()!.write('dsh-tui', [{ op: 'set', path: ['subagentInputDock'], value: true }])
    assert.ok(await settled(() => frame().includes('DOCK_TASK_A')), frame())
    check(`live card stays above the editable draft (${tag})`, () => {
      assert.ok(where('DOCK_TASK_A') < where('DRAFT_KEEP'), frame())
      assert.ok(where('DOCK_TASK_A') > where('MAIN_REPLY_44'), frame())
      assert.ok(frame().includes('LIVE_ACTIVITY_A'), frame())
      const version = channel.version
      channel.setSubagentInputDock(true)
      assert.equal(channel.version, version)
    })
    check(`preset paints header, activity and full right edge (${tag})`, () => {
      const at = where('DOCK_TASK_A')
      for (const row of [at, at + 2]) assert.equal(cell(row, columns - 1)?.isBgDefault(), preset === 'legacy', frame())
      if (preset === 'pi-like') {
        assert.equal(background(at), background(at + 2))
        assert.equal(cell(at - 1, columns - 1)?.isBgDefault(), true, 'breathing gap stays unpainted')
      }
    })
    const draftRow = where('DRAFT_KEEP')
    h.progress('A', 'A long activity with 中英混排 and emoji 👋\n'.repeat(20))
    assert.ok(await settled(() => frame().includes('A long activity')), frame())
    check(`activity text does not move the composer (${tag})`, () => assert.equal(where('DRAFT_KEEP'), draftRow, frame()))
    if (rows === 40) {
      // Live edits use the same store as production settings, not a test-only surface.
      applyCardStyles({ preset, common: { border: 'round', borderColor: '#abcdef', paddingX: 1, paddingY: 1, gap: 0 },
        kinds: { subagent: { paddingX: 2, background: '#654321', states: { running: '#123456' } } } })
      assert.ok(await settled(() => lines()[where('DOCK_TASK_A') - 2]?.includes('╭') === true), frame())
      check(`configured border, padding and running face fit the budget (${tag})`, () => {
        const at = where('DOCK_TASK_A')
        assert.ok(lines()[at - 2]?.includes('╮'), frame())
        assert.ok(lines()[at + 4]?.includes('╰'), frame())
        assert.ok(lines()[at + 4]?.includes('╯'), frame())
        assert.equal(cell(at - 2, 0)?.getFgColor(), 0xabcdef)
        assert.equal(background(at, columns - 2), 0x123456)
        assert.equal(background(at + 2, columns - 2), 0x123456)
        assert.ok(lines()[at - 1]?.trim().startsWith('│'), frame())
        assert.ok(frame().includes('A long activity') && frame().includes('DRAFT_KEEP'), frame())
      })
      applyCardStyles({ preset: 'pi-like', common: { border: 'round', paddingX: 1, paddingY: 1, gap: 0 },
        kinds: { subagent: { background: '#654321', states: { running: 'none' } } } })
      assert.ok(await settled(() => background(where('DOCK_TASK_A'), columns - 2) === 0x654321), frame())
      check(`state override can fall back to the configured ordinary face (${tag})`, () => assert.equal(background(where('DOCK_TASK_A'), columns - 2), 0x654321))
      applyCardStyles({ preset: 'pi-like', kinds: { subagent: { border: 'round', paddingY: 4, gap: 4 } } })
      assert.ok(await settled(() => frame().includes('Subagents · 1 running')), frame())
      check(`oversized chrome degrades to a painted summary, never a clipped card (${tag})`, () => {
        assert.ok(!frame().includes('DOCK_TASK_A') && frame().includes('DRAFT_KEEP'), frame())
        assert.equal(cell(where('Subagents · 1 running'), columns - 1)?.isBgDefault(), false)
      })
      applyCardStyles({ preset })
      assert.ok(await settled(() => frame().includes('A long activity') && !lines()[where('DOCK_TASK_A') - 2]?.includes('╭')), frame())
    }
    for (let i = 0; i < 15; i++) h.reply(`MORE_REPLY_${i}`)
    assert.ok(await settled(() => frame().includes('MORE_REPLY_14') && frame().includes('DOCK_TASK_A')), frame())
    if (fullscreen) {
      input.write('\x1b[5~')
      assert.ok(await settled(() => !frame().includes('MORE_REPLY_14') && frame().includes('DOCK_TASK_A')), frame())
      check(`scrolling transcript keeps dock visible (${tag})`, () => assert.ok(frame().includes('DRAFT_KEEP')))
      input.write('\x1b[F')
      assert.ok(await settled(() => frame().includes('MORE_REPLY_14')))
      // Existing mouse route, not a direct component callback.
      const y = where('DOCK_TASK_A') + 1
      input.write(`\x1b[<0;8;${y}M\x1b[<0;8;${y}m`)
      assert.ok(await settled(() => frame().includes('DOCK_TASK_A') && !frame().includes('DRAFT_KEEP')), frame())
      input.write('\x1b')
      // Detail returns to the existing dashboard; Escape again returns to Chat.
      assert.ok(await settled(() => frame().includes('DOCK_TASK_A')))
      input.write('\x1b')
      assert.ok(await settled(() => frame().includes('DRAFT_KEEP')), frame())
      check(`click opens existing detail and preserves draft on return (${tag})`, () => assert.ok(frame().includes('DOCK_TASK_A')))
    }
    if (fullscreen && columns === 120) {
      prefs.applySidePanelOpen(true)
      assert.ok(await settled(() => frame().split('DOCK_TASK_A').length >= 3), frame())
      check('agents side panel and fixed view coexist', () => assert.ok(frame().includes('DRAFT_KEEP')))
      prefs.applySidePanelOpen(false)
      assert.ok(await settled(() => frame().split('DOCK_TASK_A').length < 3))
    }
    for (let i = 0; i < 11; i++) h.start(String(i))
    for (let i = 0; i < 20; i++) h.reply(`PARALLEL_REPLY_${i}`)
    assert.ok(await settled(() => frame().includes(' folded') && frame().includes('PARALLEL_REPLY_19')), frame())
    check(`parallel agents have a bounded compact view (${tag})`, () => {
      const occupiedRows = where(' folded') - lines().findIndex(line => line.includes('DOCK_TASK_')) + 1 + (preset === 'pi-like' ? 1 : 0)
      assert.ok(occupiedRows <= Math.min(8, Math.floor(rows / 4)), frame())
      assert.ok(frame().includes('DRAFT_KEEP'), frame())
      assert.ok(!frame().includes('A long activity'), frame())
    })
    output.rows = 13
    terminal.resize(columns, 13)
    output.emit('resize')
    assert.ok(await settled(() => frame().includes('Subagents · 12 running')), frame())
    check(`short terminal falls back to a styled single summary (${tag})`, () => {
      assert.ok(frame().includes('DRAFT_KEEP'), frame())
      assert.equal(cell(where('Subagents · 12 running'), columns - 1)?.isBgDefault(), preset === 'legacy', frame())
    })
    controller.current!.append('\nline 2\nline 3\nline 4\nLAST_DRAFT_ROW')
    assert.ok(await settled(() => frame().includes('LAST_DRAFT_ROW') && frame().includes('Subagents · 12 running')), frame())
    check(`short terminal keeps a five-line composer usable (${tag})`, () => assert.ok(frame().includes('LAST_DRAFT_ROW')))
    controller.current!.clear()
    controller.current!.append('DRAFT_KEEP')
    output.rows = rows
    terminal.resize(columns, rows)
    output.emit('resize')
    assert.ok(await settled(() => frame().includes(' folded')), frame())
    for (let i = 0; i < 11; i++) h.end(String(i), (['completed', 'failed', 'cancelled', 'unknown'] as const)[i % 4])
    h.end('A')
    for (let i = 0; i < 20; i++) h.reply(`AFTER_END_${i}`)
    assert.ok(await settled(() => frame().includes('AFTER_END_19') && !frame().includes('DOCK_TASK_') && !frame().includes(' folded')), frame())
    check(`all terminal outcomes leave dock but keep history (${tag})`, () => {
      assert.equal(channel.rows.filter(row => row.kind === 'subagent').length, 12)
      assert.ok(frame().includes('DRAFT_KEEP'))
    })
    h.start('NEW')
    assert.ok(await settled(() => frame().includes('DOCK_TASK_NEW')))
    h.endTurn()
    assert.equal(await channel.newSession(), true)
    assert.ok(await settled(() => !frame().includes('DOCK_TASK_NEW')), frame())
    check(`new session cannot retain previous live cards (${tag})`, () => assert.equal(channel.subagents.length, 0))
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.clear()
    controller.current!.append('/settings')
    input.write('\r')
    assert.ok(await settled(() => frame().includes('Pin running subagents above input')), frame())
    input.write('\r')
    assert.ok(await settled(() => channel.subagentInputDock === false), frame())
    check(`settings screen exposes and applies the live switch (${tag})`, () => assert.equal(channel.subagentInputDock, false))
    input.write('\x1b')
    assert.ok(await settled(() => controller.current !== null))
  } finally { await instance.unmount(); h.cleanup(); terminal.dispose(); input.destroy() }
}
console.log(`verify-subagent-input-dock: ${checks} checks passed`)
