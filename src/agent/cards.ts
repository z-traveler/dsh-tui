/** Vendor-neutral Custom Card data and pure Card Presentation contracts. */

import type { TuiCardBlock, TuiCardDensity, TuiCardView } from '../adapter/ports/cards.js'
export type { TuiCardBlock, TuiCardDensity, TuiCardView } from '../adapter/ports/cards.js'

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const TUI_CARD_RECORD_TYPE = 'plugin:dsh-tui/card' as const

export interface TuiCardFallback {
  readonly title: string
  readonly body: string
  readonly summary?: string
}

/** A complete snapshot. The owning session's committed sequence orders updates
 * with the same business type and stable id. */
export interface TuiCardRecord {
  readonly version: 1
  readonly type: string
  readonly id: string
  readonly data: JsonValue
  readonly fallback?: TuiCardFallback
}

/** Synchronous pure conversion; no UI or host capabilities. Never mutate the
 * input or change returned blocks later: views represent one committed snapshot. */
export type TuiCardPresenter = (data: TuiCardRecord['data']) => TuiCardView | undefined

const TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/u

export function isTuiCardType(value: unknown): value is string {
  return typeof value === 'string' && TYPE_PATTERN.test(value)
}

function isJsonValue(value: unknown, seen: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value) || !isJsonValue(value[index], seen)) return false
      }
      return true
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    if (Object.getOwnPropertySymbols(value).length > 0) return false
    return Object.values(value).every(entry => isJsonValue(entry, seen))
  } catch {
    return false
  } finally {
    seen.delete(value)
  }
}

export function asTuiCardRecord(value: unknown): TuiCardRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !isTuiCardType(record.type) || typeof record.id !== 'string' || record.id.length === 0) return undefined
  if (!isJsonValue(record.data, new Set())) return undefined
  if (record.fallback !== undefined) {
    if (typeof record.fallback !== 'object' || record.fallback === null) return undefined
    const fallback = record.fallback as Record<string, unknown>
    if (typeof fallback.title !== 'string' || typeof fallback.body !== 'string') return undefined
    if (fallback.summary !== undefined && typeof fallback.summary !== 'string') return undefined
  }
  return value as TuiCardRecord
}

export function asTuiCardView(value: unknown): TuiCardView | undefined {
  if (typeof value !== 'object' || value === null || !isJsonValue(value, new Set())) return undefined
  const view = value as Record<string, unknown>
  if (typeof view.title !== 'string' || !Array.isArray(view.blocks)) return undefined
  if (view.label !== undefined && typeof view.label !== 'string') return undefined
  if (view.summary !== undefined && typeof view.summary !== 'string') return undefined
  const density = view.density
  if (density !== undefined && density !== 'compact') return undefined
  const blocks = asCardBlocks(view.blocks)
  const preview = view.preview === undefined ? undefined : asCardBlocks(view.preview)
  if (blocks === undefined || (view.preview !== undefined && preview === undefined)) return undefined
  return {
    title: view.title,
    ...(view.label === undefined ? {} : { label: view.label }),
    ...(view.summary === undefined ? {} : { summary: view.summary }),
    ...(density === undefined ? {} : { density }),
    ...(preview === undefined ? {} : { preview }),
    blocks,
  }
}

function asCardBlocks(value: unknown): TuiCardBlock[] | undefined {
  if (!Array.isArray(value)) return undefined
  const blocks: TuiCardBlock[] = []
  for (const block of value as unknown[]) {
    if (typeof block !== 'object' || block === null) return undefined
    const candidate = block as Record<string, unknown>
    if (candidate.kind === 'text' || candidate.kind === 'markdown') {
      if (typeof candidate.text !== 'string') return undefined
      if (candidate.kind === 'text') {
        if (candidate.label !== undefined && typeof candidate.label !== 'string') return undefined
        if (candidate.truncate !== undefined && candidate.truncate !== 'end') return undefined
        blocks.push({ kind: 'text', text: candidate.text,
          ...(candidate.label === undefined ? {} : { label: candidate.label }),
          ...(candidate.truncate === undefined ? {} : { truncate: candidate.truncate }),
        })
      } else blocks.push({ kind: 'markdown', text: candidate.text })
      continue
    }
    if (candidate.kind === 'distribution') {
      if (typeof candidate.total !== 'number' || !Number.isFinite(candidate.total) || candidate.total <= 0 || !Array.isArray(candidate.segments)) return undefined
      const segments: Extract<TuiCardBlock, { kind: 'distribution' }>['segments'][number][] = []
      for (const segment of candidate.segments as unknown[]) {
        if (typeof segment !== 'object' || segment === null) return undefined
        const item = segment as Record<string, unknown>
        if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0
          || (item.kind !== 'filled' && item.kind !== 'reserved' && item.kind !== 'empty')) return undefined
        segments.push({ value: item.value, kind: item.kind })
      }
      blocks.push({ kind: 'distribution', total: candidate.total, segments })
      continue
    }
    if (candidate.kind !== 'table' || !Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)) return undefined
    if (candidate.layout !== undefined && candidate.layout !== 'compact') return undefined
    if (!candidate.columns.every((column: unknown): column is string => typeof column === 'string')) return undefined
    const columns = candidate.columns.slice()
    const rows: string[][] = []
    for (const row of candidate.rows as unknown[]) {
      if (!Array.isArray(row) || row.length !== columns.length
        || !row.every((cell: unknown): cell is string => typeof cell === 'string')) return undefined
      rows.push(row.slice())
    }
    blocks.push({ kind: 'table', columns, rows, ...(candidate.layout === undefined ? {} : { layout: candidate.layout }) })
  }
  return blocks
}

/** Readable host-independent text; Markdown remains readable source text. */
export function cardPlainText(view: TuiCardView): string {
  const lines = [view.title, view.summary ?? '']
  for (const block of view.blocks) {
    if (block.kind === 'table') {
      lines.push(block.columns.join(' | '))
      for (const row of block.rows) lines.push(row.join(' | '))
    } else if (block.kind === 'distribution') {
      lines.push(block.segments.map(segment => `${{ filled: '⛁', reserved: '⛝', empty: '⛶' }[segment.kind]} ${segment.value}`).join(' · ') + ` / ${block.total}`)
    } else {
      lines.push(block.kind === 'text' && block.label !== undefined ? `[${block.label}] ${block.text}` : block.text)
    }
  }
  return lines.filter(line => line.length > 0).join('\n')
}

export function fallbackCardView(record: TuiCardRecord): TuiCardView {
  return {
    title: record.fallback?.title ?? record.type,
    ...(record.fallback?.summary === undefined ? {} : { summary: record.fallback.summary }),
    blocks: [{
      kind: 'text',
      text: record.fallback?.body ?? JSON.stringify(record.data, null, 2),
    }],
  }
}
