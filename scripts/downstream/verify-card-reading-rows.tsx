/** Quick check: node --import tsx/esm scripts/downstream/verify-card-reading-rows.tsx */
import '../lib/fake-home.mjs'
process.env.DSH_TUI_LANG = 'en'
process.env.FORCE_COLOR = '3'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { settled } from '../lib/term-test.mjs'
const [React, { Terminal }, { render, Box, Text, ThemeProvider }, { CustomCardRow }, { asTuiCardView }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/components/messages/CustomCardRow.js'), import('../../src/cards.js'),
])
const full = '/work/shared/very-long-reference-file-for-reading.md'
const view = asTuiCardView({ title: '', label: '', density: 'compact',
  preview: [{ kind: 'text', label: 'context', text: 'pkg/AGENTS.md', truncate: 'end' },
    { kind: 'text', label: 'import', text: full, truncate: 'end' }],
  blocks: [{ kind: 'text', label: 'context', text: `pkg/AGENTS.md\nscope  pkg/**\nimport ${full}` }],
})
assert.ok(view)
for (const expanded of [false, true]) {
  const terminal = new Terminal({ cols: 40, rows: 24, allowProposedApi: true })
  class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
  class Output extends Writable { isTTY = true; columns = 40; rows = 24; _write(chunk: unknown, _: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) } }
  const input = new Input(), output = new Output()
  const app = await render(<ThemeProvider theme="dark"><Box flexDirection="column"><CustomCardRow view={view} type="demo/rows" expanded={expanded} background={undefined} marginTopOnTurn={false} toolBackground="none" /><Text>AFTER_ROWS</Text></Box></ThemeProvider>, {
    stdout: output as never, stdin: input as never, stderr: output as never, patchConsole: false, exitOnCtrlC: false,
  })
  const lines = () => Array.from({ length: 24 }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true) ?? '')
  try {
    await settled(() => lines().some(line => line.includes('AFTER_ROWS')))
    const screen = lines(), after = screen.findIndex(line => line.includes('AFTER_ROWS'))
    if (!expanded) {
      assert.equal(after, 2, 'one row per item, no empty heading or hint')
      assert.match(screen[0]!, /\[context\].*pkg\/AGENTS.md/u)
      assert.match(screen[1]!, /\[import\].*\.\.\.$/u)
      const row = terminal.buffer.active.getLine(0)!
      assert.notEqual(row.getCell(2)?.getFgColor(), row.getCell(12)?.getFgColor())
    } else {
      assert.ok(screen.slice(0, after).join('').replace(/\s+/gu, '').includes(full))
      assert.ok(screen.some(line => line.includes('scope')))
    }
  } finally { await app.unmount(); terminal.dispose(); input.destroy() }
}
console.log('card reading rows: short preview, full grouped details passed')
