/** Pinned history references must retain their one-row virtual extent.
 * node --import tsx/esm scripts/downstream/verify-subagent-reference-height.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
import type { ListGeometryNote } from '../../src/ink/geometry-trace.js'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_GEOMETRY_TRACE = `${process.env.HOME}/reference-geometry.jsonl`
const [React, ui, xterm, { settled, viewportLines }, { Chat }, { QuestionStore }, { ApprovalStore }, { subagentDockFixture }, { applyCardStyles }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('@xterm/headless'), import('../lib/term-test.mjs'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/questions.js'), import('../../src/dsh-adapter/approvals.js'), import('./subagent-dock-fixture.js'), import('../../src/cardStyles.js'),
])
applyCardStyles({ preset: 'pi-like' })
const h = subagentDockFixture()
const terminal = new xterm.Terminal({ cols: 60, rows: 18, scrollback: 400, allowProposedApi: true })
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
class Output extends Writable { columns = 60; rows = 18; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
const input = new Input(), output = new Output()
const node = <ui.ThemeProvider theme="dark"><Chat channel={h.channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()} fullscreen={false} trajectorySeen onExit={() => {}} /></ui.ThemeProvider>
const app = await ui.render(node, { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
const lines = () => viewportLines(terminal, 18)
const frame = () => lines().join('\n')
const notes = () => {
  try { return readFileSync(process.env.DSH_TUI_GEOMETRY_TRACE!, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { list: ListGeometryNote | null }) } catch { return [] }
}
try {
  h.beginTurn(); h.start('CACHE'); h.progress('CACHE', 'CACHE_OLD')
  assert.ok(await settled(() => frame().includes('Subagent reference:') && frame().includes('CACHE_OLD')), frame())
  for (let i = 0; i < 45; i++) h.reply(`CACHE_MAIN_${i}`)
  assert.ok(await settled(() => frame().includes('CACHE_MAIN_44')), frame())
  const before = notes().findLast(note => note.list)?.list
  assert.ok(before)
  assert.ok(!frame().includes('Subagent reference:'), 'the measured reference must be offscreen')
  const inputRow = lines().findIndex(line => line.includes('⌸ ❯'))
  assert.ok(inputRow >= 0)
  const mark = notes().length
  h.progress('CACHE', 'CACHE_NEW\n'.repeat(20))
  assert.ok(await settled(() => frame().includes('CACHE_NEW')), frame())
  const after = notes().slice(mark).flatMap(note => note.list ? [note.list] : [])
  assert.ok(after.length > 0)
  console.log(JSON.stringify({ before, after }))
  assert.ok(after.every(list => list.total === before.total), 'unchanged static reference must not alter estimated transcript height')
  assert.equal(lines().findIndex(line => line.includes('⌸ ❯')), inputRow, 'activity-only changes must not move the input')
  console.log('PASS pinned reference: activity-only changes retain virtual height and input position')
} finally { await app.unmount(); h.cleanup(); terminal.dispose(); input.destroy() }
