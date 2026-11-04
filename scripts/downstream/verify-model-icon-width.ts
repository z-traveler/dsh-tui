/** Bounded terminal-emulation check for the model icon prefix cell width.
 * The app lays the powerline row out with src/ink/stringWidth; xterm-headless
 * only agrees when the emulated Unicode provider widens VS16 pairs. These
 * checks assert the prefix paints the cells its own measure claims, and that
 * every model name starts at the same column. No provider calls or user state.
 * node --import tsx/esm scripts/downstream/verify-model-icon-width.ts */
import assert from 'node:assert/strict'
import { activateModernEmojiWidths } from '../lib/modern-widths.mjs'
import { writeParsed } from '../lib/term-test.mjs'
import { normalizePowerlineOptions } from '../../src/powerline/config.js'
import { formatModelIconPrefix } from '../../src/powerline/modelIcon.js'
import { stringWidth } from '../../src/ink/stringWidth.js'

const { Terminal } = await import('@xterm/headless')

let checks = 0
const check = async (label: string, run: () => Promise<void>) => { await run(); console.log(`PASS ${++checks}: ${label}`) }

const options = (overrides: Parameters<typeof normalizePowerlineOptions>[0]) => normalizePowerlineOptions(overrides)

/** Cells the emulated terminal paints for `text`, read from a marker cell. */
async function paintedWidth(text: string): Promise<number> {
  const terminal = new Terminal({ cols: 60, rows: 2, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  await writeParsed(terminal, `${text}|`)
  const line = terminal.buffer.active.getLine(0)
  const marker = Array.from({ length: terminal.cols }, (_, x) => line?.getCell(x)?.getChars() ?? '').indexOf('|')
  terminal.dispose()
  assert.notEqual(marker, -1, `the marker cell was painted for ${JSON.stringify(text)}`)
  return marker
}

await check('a VS16 pair occupies two cells, like the app measures it', async () => {
  assert.equal(await paintedWidth('✳\ufe0f'), 2)
  assert.equal(stringWidth('✳\ufe0f'), 2)
})

await check('a bare text-default symbol and an incomplete keycap stay one cell', async () => {
  assert.equal(await paintedWidth('✳'), 1)
  assert.equal(await paintedWidth('1\ufe0f'), 1)
})

await check('default-emoji and CJK glyphs keep their measured width', async () => {
  assert.equal(await paintedWidth('🐋'), 2)
  assert.equal(await paintedWidth('界'), 2)
})

await check('every model name starts at the column the prefix measure claims', async () => {
  const shared = options({
    modelIcons: [
      { pattern: 'claude', icon: '✳' },
      { pattern: 'gpt', icon: 'G' },
      { pattern: 'deepseek', icon: '界' },
    ],
  })
  const columns = new Set<number>()
  for (const model of ['claude-sonnet-4-5', 'gpt-5', 'deepseek-chat', 'llama-4']) {
    const prefix = formatModelIconPrefix(model, shared)
    const column = await paintedWidth(prefix)
    assert.equal(column, stringWidth(prefix), `the painted prefix width of ${model}`)
    columns.add(column)
  }
  assert.deepEqual([...columns], [3])
})

console.log(`${checks} checks passed`)
