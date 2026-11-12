/** Stable original-card rows and a single shared dock surface.
 * node --import tsx/esm scripts/downstream/verify-subagent-dock-stability.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_TMUX_TRUECOLOR = '1'
process.env.DSH_TUI_LANG = 'en'
const [React, ui, { Terminal }, { settled, viewportLines }, { applyCardStyles }, { SubagentInputDock }, { SubagentMessage }, { subagentDockFixture }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('@xterm/headless'), import('../lib/term-test.mjs'), import('../../src/cardStyles.js'),
  import('../../src/components/SubagentInputDock.js'), import('../../src/components/Chat/SubagentMessage.js'), import('./subagent-dock-fixture.js'),
])
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const mode of ['history', 'dock', 'group'] as const) {
  applyCardStyles({ preset: 'pi-like', ...(mode === 'group' ? { common: { border: 'round' as const, paddingY: 0, gap: 0 } } : {}) })
  const h = subagentDockFixture()
  h.beginTurn(); h.start('STABLE')
  if (mode === 'group') h.start('SECOND')
  const terminal = new Terminal({ cols: 100, rows: 40, allowProposedApi: true })
  class Output extends Writable { columns = 100; rows = 40; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const input = new Input(), output = new Output()
  let refresh = () => {}
  let toolPresent = false
  function Scene() {
    const [, set] = React.useState(0)
    refresh = () => set(n => n + 1)
    const row = h.channel.rows.find(row => row.subagent?.agentId === 'STABLE')!.subagent!
    return <ui.ThemeProvider theme="dark"><ui.Box flexDirection="column">
      {mode === 'history' ? <SubagentMessage subagent={row} marginTopOnTurn={false} isExpanded /> :
        <SubagentInputDock subagents={h.channel.subagents.map(agent => toolPresent ? { ...agent, toolCalls: [{ id: 'read', name: 'Read', status: 'running' as const, startedAt: 1, argsPreview: 'fixture.ts' }] } : agent)} onOpen={() => {}} onOpenView={() => {}} onOpenDashboard={() => {}} />}
      <ui.Text>INPUT_ANCHOR</ui.Text>
    </ui.Box></ui.ThemeProvider>
  }
  const app = await ui.render(<Scene />, { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => viewportLines(terminal, 40)
  const frame = () => lines().join('\n')
  try {
    let anchor: number | undefined
    const failures: string[] = []
    for (let tick = 0; tick < 8; tick++) {
      for (let i = 0; i < 3; i++) h.progress('STABLE', `FRAME_${tick}_LINE_${i} ${'x'.repeat((tick + i) % 3 * 20)}${tick % 2 ? '\ncontinued' : ''}`)
      refresh()
      assert.ok(await settled(() => frame().includes(`FRAME_${tick}_LINE_2`)), frame())
      const at = lines().findIndex(line => line.includes('Subagent: DOCK_TASK_STABLE'))
      const actual = lines().findIndex(line => line.includes(`FRAME_${tick}_LINE_2`)) - at
      console.log(`${mode} tick ${tick}: latest output offset ${actual}`)
      if (mode !== 'group') {
        for (let i = 0; i < 3; i++) if (!lines()[at + 1 + i]?.includes(`FRAME_${tick}_LINE_${i}`)) failures.push(`${mode} tick ${tick}: reply ${i} moved away from offset ${i + 1}`)
      }
      const inputRow = lines().findIndex(line => line.includes('INPUT_ANCHOR'))
      anchor ??= inputRow
      assert.equal(inputRow, anchor, `${mode}: content updates must not move input`)
    }
    assert.deepEqual(failures, [], `${mode}: stable reply slots without a leading blank\n${frame()}`)
    if (mode === 'dock') {
      toolPresent = true
      refresh()
      assert.ok(await settled(() => frame().includes('Read (fixture.ts)')), frame())
      const at = lines().findIndex(line => line.includes('Subagent: DOCK_TASK_STABLE'))
      assert.ok(lines()[at + 1]?.includes('Read (fixture.ts)'), frame())
      for (let i = 0; i < 3; i++) assert.ok(lines()[at + 2 + i]?.includes(`FRAME_7_LINE_${i}`), frame())
      assert.equal(lines().findIndex(line => line.includes('INPUT_ANCHOR')), anchor, 'a real tool slot must not push input')
      toolPresent = false
      refresh()
      assert.ok(await settled(() => !frame().includes('Read (fixture.ts)')), frame())
      assert.ok(lines()[at + 1]?.includes('FRAME_7_LINE_0'), frame())
      assert.equal(lines().findIndex(line => line.includes('INPUT_ANCHOR')), anchor)
    }
    if (mode === 'group') {
      assert.equal(lines().filter(line => line.includes('╭')).length, 1, `one outer border, not one border per agent\n${frame()}`)
      assert.equal(lines().filter(line => line.includes('╰')).length, 1, frame())
      const a = lines().findIndex(line => line.includes('Subagent: DOCK_TASK_STABLE'))
      const b = lines().findIndex(line => line.includes('Subagent: DOCK_TASK_SECOND'))
      const bg = (y: number) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.getCell(98)
      for (let y = a; y <= b; y++) {
        assert.equal(bg(y)?.isBgDefault(), false, `shared face must fill every row between agents: ${y}\n${frame()}`)
        assert.equal(bg(y)?.getBgColor(), bg(a)?.getBgColor(), frame())
      }
    }
    console.log(`PASS ${mode}: fixed reply slots, tight title and unified surface`)
  } finally { await app.unmount(); h.cleanup(); terminal.dispose(); input.destroy() }
}
