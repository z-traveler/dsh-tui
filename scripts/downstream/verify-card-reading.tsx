/** Generic preview/detail, distribution and compact literal tables through real TUI.
 * Run: node --import tsx/esm scripts/downstream/verify-card-reading.tsx */
import '../lib/fake-home.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_TMUX_TRUECOLOR = '1'
process.env.DSH_TUI_LANG = 'en'
import assert from 'node:assert/strict'
import { Writable, PassThrough } from 'node:stream'
import type { TuiCardView } from '../../src/agent/cards.js'
const [React, { Terminal }, { render, Box, Text, ThemeProvider, AlternateScreen }, { CustomCardRow }, { applyCardStyles }, { settled }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'), import('../../src/components/messages/CustomCardRow.js'), import('../../src/cardStyles.js'), import('../lib/term-test.mjs'),
])
const view: TuiCardView = {
  title: 'Capacity', label: 'overview',
  preview: [
    { kind: 'distribution', total: 100, segments: [{ kind: 'filled', value: 25 }, { kind: 'empty', value: 75 }] },
    { kind: 'table', layout: 'compact', columns: ['Category', 'Count'], rows: [['Used', '25 / 100']] },
    { kind: 'text', text: 'PREVIEW_END' },
  ],
  blocks: [
    { kind: 'table', layout: 'compact', columns: ['Source', 'Tokens'], rows: [['  path|line\n下一行', '≈ 12'], ['  a-very-long-source-label-that-must-remain-readable', '≈ 3']] },
    { kind: 'text', text: 'DETAIL_END' },
  ],
}
for (const preset of ['legacy', 'pi-like'] as const) for (const columns of [40, 100]) for (const fullscreen of [false, true]) {
  const term = new Terminal({ cols: columns, rows: 40, allowProposedApi: true })
  class Output extends Writable {
    columns = columns
    rows = 40
    isTTY = true
    _write(chunk: unknown, _enc: BufferEncoding, done: () => void) { term.write(String(chunk), done) }
  }
  class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
  let expand = (_value: boolean) => {}
  let allReading = false
  function Scene() {
    const [expanded, setExpanded] = React.useState(false)
    expand = setExpanded
    return <ThemeProvider theme="dark"><Box flexDirection="column">
      <CustomCardRow view={allReading ? { ...view, summary: 'ALL_VISIBLE', preview: view.blocks } : view} type="acme/capacity" expanded={expanded} background={undefined} marginTopOnTurn={false} toolBackground="none" />
      <Text>AFTER_READING</Text>
    </Box></ThemeProvider>
  }
  applyCardStyles({ preset })
  const input = new Input()
  const output = new Output()
  const instance = await render(fullscreen ? <AlternateScreen><Scene /></AlternateScreen> : <Scene />, { stdin: input as never, stdout: output as never, stderr: output as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => Array.from({ length: 40 }, (_, y) => term.buffer.active.getLine(y)!.translateToString(true))
  try {
    assert.ok(await settled(() => lines().join('\n').includes('PREVIEW_END')))
    const collapsed = lines()
    assert.equal(collapsed.filter(line => /[⛁⛶]/u.test(line)).length, 8, 'grid shrinks columns, not rows')
    assert.ok(collapsed.some(line => line.includes('Used') && line.includes('25 / 100')))
    assert.ok(!collapsed.join('\n').includes('DETAIL_END'))
    assert.match(collapsed.join('\n'), /ctrl\+o/iu, 'a partial reading offers expansion')
    assert.ok(!collapsed.join('\n').includes('┌'), 'compact metrics have no table frame')
    expand(true)
    assert.ok(await settled(() => lines().join('\n').includes('DETAIL_END')))
    const expanded = lines().join('\n')
    assert.ok(!expanded.includes('PREVIEW_END'))
    assert.ok(!/[⛁⛶]/u.test(expanded))
    assert.ok(expanded.includes('path|line') && expanded.includes('下一行') && expanded.includes('≈ 12'))
    assert.ok(expanded.replace(/≈\s*\d+/gu, '').replace(/\s/gu, '').includes('a-very-long-source-label-that-must-remain-readable'))
    assert.ok(expanded.includes('AFTER_READING'), 'card leaves following rows visible')
    allReading = true
    expand(false)
    assert.ok(await settled(() => lines().join('\n').includes('ALL_VISIBLE')))
    assert.doesNotMatch(lines().join('\n'), /ctrl\+o/iu, 'a full reading does not offer a no-op expansion')
    console.log(`PASS reading ${preset} ${columns} ${fullscreen ? 'fullscreen' : 'inline'}`)
  } finally { await instance.unmount(); input.destroy(); term.dispose() }
}
applyCardStyles(undefined)
console.log('card reading layout passed (8 real terminal scenes)')
