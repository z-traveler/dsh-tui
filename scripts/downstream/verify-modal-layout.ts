/** Modal layout contract: terminal cells, Pi-style anchors/percentages, bounded chrome.
 * node --import tsx/esm scripts/downstream/verify-modal-layout.ts */
import assert from 'node:assert/strict'
import { resolveModalLayout } from '../../src/components/modalLayout.js'

const viewport = { columns: 100, rows: 30 }
const original = resolveModalLayout(viewport)
assert.deepEqual({ width: original.columns, height: original.rows, row: original.top, col: original.left, content: original.contentSize },
  { width: 96, height: 26, row: 2, col: 2, content: { columns: 92, rows: 22 } })
const corner = resolveModalLayout(viewport, { width: '60%', height: 12, anchor: 'bottom-right', margin: { right: 3, bottom: 2 }, style: { paddingX: 2, paddingY: 1 } })
assert.deepEqual({ width: corner.columns, height: corner.rows, row: corner.top, col: corner.left, content: corner.contentSize },
  { width: 60, height: 12, row: 16, col: 37, content: { columns: 54, rows: 6 } })
const percentage = resolveModalLayout(viewport, { width: 20, height: 10, row: '25%', col: '50%' })
assert.equal(percentage.top, 5)
assert.equal(percentage.left, 40)
const anchors = {
  'top-left': [0, 0], 'top-center': [0, 40], 'top-right': [0, 80],
  'left-center': [10, 0], center: [10, 40], 'right-center': [10, 80],
  'bottom-left': [20, 0], 'bottom-center': [20, 40], 'bottom-right': [20, 80],
} as const
for (const [anchor, [row, col]] of Object.entries(anchors)) {
  const layout = resolveModalLayout(viewport, { width: 20, height: 10, anchor: anchor as keyof typeof anchors })
  assert.equal(layout.top, row, anchor); assert.equal(layout.left, col, anchor)
}
const clamped = resolveModalLayout(viewport, { width: 200, height: 99, offsetX: -999, offsetY: 999, margin: 2 })
assert.equal(clamped.columns, 96); assert.equal(clamped.rows, 26)
assert.equal(clamped.left, 2); assert.equal(clamped.top, 2)
assert.equal(resolveModalLayout(viewport, { width: 10, minWidth: 30 }).columns, 30)
assert.equal(resolveModalLayout(viewport, { maxHeight: '40%' }).rows, 12)
const borderless = resolveModalLayout(viewport, { width: 20, height: 3, style: { borderStyle: 'none', paddingX: 0 } })
assert.equal(borderless.compact, false)
assert.deepEqual(borderless.contentSize, { columns: 20, rows: 1 })
const padded = resolveModalLayout(viewport, { width: 20, height: 10, style: { paddingX: 999, paddingY: 999 } })
assert.ok(padded.contentSize.columns >= 1 && padded.contentSize.rows >= 1)
assert.ok(padded.paddingX * 2 + padded.contentSize.columns + 2 <= padded.columns)
assert.ok(padded.paddingY * 2 + padded.contentSize.rows + 4 <= padded.rows)
for (const area of [{ columns: 8, rows: 4 }, { columns: 1, rows: 1 }]) {
  const tiny = resolveModalLayout(area, { width: '100%', height: '100%', margin: 100 })
  assert.ok(tiny.compact)
  assert.ok(tiny.columns <= area.columns && tiny.rows <= area.rows)
  assert.ok(tiny.left >= 0 && tiny.top >= 0 && tiny.left + tiny.columns <= area.columns && tiny.top + tiny.rows <= area.rows)
}
console.log('PASS modal geometry: default parity, all nine anchors, percentages, offsets, bounds, padding, compact mode')
