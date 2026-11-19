import { stringWidth } from '../ink/stringWidth.js'
import { getGraphemeSegmenter } from '../utils/intl.js'
import { cleanStatusFieldText } from './sanitize.js'
import type { TuiStatusFieldNormalizedSegment, TuiStatusFieldTone } from './status.js'

const MAX_FIELD_SEGMENTS = 8
const NO_CELL_LIMIT = Number.MAX_SAFE_INTEGER

/** Segment styling must not change grapheme boundaries or the layout width. */
function hasSafeSegmentBoundaries(parts: readonly TuiStatusFieldNormalizedSegment[], text: string): boolean {
  const graphemes = getGraphemeSegmenter().segment(text)
  let offset = 0
  let width = 0
  for (const part of parts) {
    if (offset !== 0 && graphemes.containing(offset)?.index !== offset) return false
    offset += part.text.length
    width += stringWidth(part.text)
  }
  return width === stringWidth(text)
}

/** Normalize untrusted segments, or return null when the field must be refused. */
export function normalizeStatusFieldSegments(
  value: unknown,
  rawText: string | number | boolean,
  text: string,
  maxCells: number,
  tone: TuiStatusFieldTone,
  tones: ReadonlySet<TuiStatusFieldTone>,
): readonly TuiStatusFieldNormalizedSegment[] | undefined | null {
  if (value === undefined) return undefined
  try {
    if (!Array.isArray(value)) return null
    const length: unknown = value.length
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 1 || length > MAX_FIELD_SEGMENTS) return null
    const parts: TuiStatusFieldNormalizedSegment[] = []
    for (let i = 0; i < length; i += 1) {
      const segment: unknown = value[i]
      if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) return null
      const { text: rawSegment, tone: rawTone } = segment as { text?: unknown; tone?: unknown }
      if (typeof rawSegment !== 'string') return null
      if (rawTone !== undefined && (typeof rawTone !== 'string' || !tones.has(rawTone as TuiStatusFieldTone))) return null
      // Non-whitespace sentinels let the shared cleaner preserve edge spaces.
      // U+FFFF cannot finish an incomplete ANSI/OSC sequence in plugin text.
      let cleaned = cleanStatusFieldText(`\uFFFF${rawSegment}\uFFFF`, NO_CELL_LIMIT).slice(1, -1)
      if (cleaned === '') return null
      if (parts.at(-1)?.text.endsWith(' ') && cleaned.startsWith(' ')) cleaned = cleaned.slice(1)
      if (cleaned !== '') parts.push({ text: cleaned, tone: (rawTone as TuiStatusFieldTone | undefined) ?? tone })
    }
    while (parts.length > 0) {
      const first = parts[0]!
      const trimmed = first.text.trimStart()
      if (trimmed !== '') { parts[0] = { ...first, text: trimmed }; break }
      parts.shift()
    }
    while (parts.length > 0) {
      const last = parts[parts.length - 1]!
      const trimmed = last.text.trimEnd()
      if (trimmed !== '') { parts[parts.length - 1] = { ...last, text: trimmed }; break }
      parts.pop()
    }
    const flat = parts.map(part => part.text).join('')
    if (flat !== cleanStatusFieldText(rawText, NO_CELL_LIMIT) || !hasSafeSegmentBoundaries(parts, flat)) return null

    // The existing field cleaner determines the exact prefix (including its
    // code-point and ellipsis rules); only its colours are projected back onto
    // the segments, so segment boundaries cannot change the displayed text.
    const truncated = stringWidth(flat) > maxCells
    let remaining = truncated ? text.length - 1 : text.length
    const result: TuiStatusFieldNormalizedSegment[] = []
    for (const part of parts) {
      const visible = part.text.slice(0, remaining)
      remaining -= visible.length
      if (truncated && visible.length < part.text.length) {
        result.push(Object.freeze({ text: `${visible}…`, tone: part.tone }))
        break
      }
      if (visible !== '') result.push(Object.freeze({ text: visible, tone: part.tone }))
    }
    if (result.map(part => part.text).join('') !== text || !hasSafeSegmentBoundaries(result, text)) return null
    return Object.freeze(result)
  } catch {
    // A segment, array, or proxy can throw while its properties are read.
    return null
  }
}
