import { stringWidth } from '../ink/stringWidth.js'
import type { PowerlineOptions } from './config.js'

export interface PowerlineFieldLayout<T extends { key: string; width: number }> {
  readonly left: readonly T[]
  readonly right: readonly T[]
  readonly secondary: readonly (readonly T[])[]
}

/** A configured id also selects fields keyed `<id>:<suffix>`, in field order. */
function matchingFields<T extends { key: string }>(
  id: string,
  fields: readonly T[],
  byKey: ReadonlyMap<string, T>,
): readonly T[] {
  const exact = byKey.get(id)
  if (exact) return [exact]
  const prefix = `${id}:`
  return fields.filter(field => field.key.startsWith(prefix))
}

function visibleFieldWidth(field: { width: number }): number {
  return Number.isFinite(field.width) ? Math.max(0, Math.floor(field.width)) : 0
}

/**
 * Fit HUD fields into the top row and the overflow rows below it.
 *
 * Group order decides who renders and where: `left` then `secondary` flow along
 * the primary row, `right` reserves its prefix from the right edge first. A
 * configured id also selects fields keyed `<id>:<suffix>`, so a plugin group can
 * add fields without listing every suffix. `width` is the row budget in terminal
 * cells; every field is charged its own width plus `2 * padding`, and the
 * separator is charged between adjacent fields of the same row. Nothing is
 * scaled: a field that does not fit moves to a later row or is dropped.
 */
export function layoutPowerlineFields<T extends { key: string; width: number }>(
  fields: readonly T[],
  options: PowerlineOptions,
  width: number,
): PowerlineFieldLayout<T> {
  const empty: PowerlineFieldLayout<T> = { left: [], right: [], secondary: [] }
  const available = Math.floor(width)
  if (!Number.isFinite(available) || available <= 0) return empty

  const byKey = new Map<string, T>()
  for (const field of fields) {
    if (!byKey.has(field.key)) byKey.set(field.key, field)
  }

  // Groups claim fields in config order (left, right, secondary), so a field
  // listed twice renders once, at its first placement.
  const claimed = new Set<string>()
  const group = (ids: readonly string[]): T[] => {
    const selected: T[] = []
    for (const id of ids) {
      for (const field of matchingFields(id, fields, byKey)) {
        if (claimed.has(field.key)) continue
        claimed.add(field.key)
        selected.push(field)
      }
    }
    return selected
  }

  const leftFields = group(options.left)
  const rightFields = group(options.right)
  const secondaryFields = group(options.secondary)

  const separatorWidth = stringWidth(options.separator)
  const padding = options.padding * 2
  const cost = (count: number, field: T): number =>
    visibleFieldWidth(field) + padding + (count > 0 ? separatorWidth : 0)

  const right: T[] = []
  let rightWidth = 0
  let rightFull = false
  const rightOverflow: T[] = []
  for (const field of rightFields) {
    const needed = cost(right.length, field)
    if (!rightFull && rightWidth + needed <= available) {
      right.push(field)
      rightWidth += needed
    } else {
      rightFull = true
      rightOverflow.push(field)
    }
  }

  const leftAvailable = available - rightWidth
  const left: T[] = []
  let leftWidth = 0
  let leftFull = false
  const primaryOverflow: T[] = []
  for (const field of [...leftFields, ...secondaryFields]) {
    const needed = cost(left.length, field)
    if (!leftFull && leftWidth + needed <= leftAvailable) {
      left.push(field)
      leftWidth += needed
    } else {
      // The first nonfit stops the row; every later primary field overflows too.
      leftFull = true
      primaryOverflow.push(field)
    }
  }

  const queue = [...primaryOverflow, ...rightOverflow]
  const secondary: T[][] = []
  let index = 0
  let stopped = false
  while (index < queue.length && secondary.length < options.maxRows && !stopped) {
    const row: T[] = []
    let rowWidth = 0
    while (index < queue.length) {
      const field = queue[index]!
      const needed = cost(row.length, field)
      if (rowWidth + needed > available) break
      row.push(field)
      rowWidth += needed
      index += 1
    }
    if (row.length > 0) secondary.push(row)
    if (index >= queue.length) break
    if (options.secondaryOverflow === 'drop') stopped = true
    // wrap: a field wider than a whole row can never fit, so skip it.
    else if (row.length === 0) index += 1
  }

  return { left, right, secondary }
}
