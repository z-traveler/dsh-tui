/**
 * Option surface of a plugin modal window: the type default a descriptor
 * declares, the per-open override `openModal` takes, and the patch an instance
 * handle applies at runtime.
 *
 * This module only validates, merges and freezes those values. Two things stay
 * host-owned on purpose:
 *
 * - Geometry. Percentages are relative to the host viewport, and `row`/`col`
 *   percentages travel the *remaining* range (0% = top/left edge, 100% =
 *   bottom/right), so only the host that measures the conversation can turn
 *   them into a rect.
 * - Visibility. `visible(columns, rows)` is a predicate the host evaluates
 *   when it knows the current frame; a new window that fails it is refused by
 *   the host admission gate instead of opening as a hidden placeholder.
 *
 * Colors reuse the theme boundary: a theme token is normalized to its
 * canonical key, any other value must be a concrete color the renderer
 * accepts. Alpha is rejected outright — a modal card is opaque, and this
 * option surface never pretends to offer transparency.
 */

import { isValidThemeColor } from './customTheme.js'
import type { BorderStyle } from './ink/render-border.js'
import type { Color } from './ink/styles.js'
import { normalizeThemeKey, type Theme } from './theme.js'

/** A theme token (normalized to its canonical key) or a concrete color. */
export type TuiModalColor = keyof Theme | Color

/** A cell count, or a percentage of the host viewport (`'60%'`, `'33.3%'`). */
export type TuiModalLength = number | `${number}%`

/** Where the window sits on the host rect: nine positions, named the way Pi
 *  names them (`left-center`/`right-center` are the middle row's sides). */
export const MODAL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

export type TuiModalAnchor = (typeof MODAL_ANCHORS)[number]

/** Per-edge cell margins; an omitted edge is 0. */
export interface TuiModalEdges {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

// `satisfies` keeps this list honest: every name but 'none' must stay a border
// style the renderer can draw. 'none' is this surface's own "no frame" marker
// (ink spells that as an absent `borderStyle`).
const MODAL_BORDER_STYLES = [
  'single',
  'double',
  'round',
  'bold',
  'singleDouble',
  'doubleSingle',
  'classic',
  'arrow',
  'dashed',
] as const satisfies readonly BorderStyle[]

export type TuiModalBorderStyle = (typeof MODAL_BORDER_STYLES)[number] | 'none'

export interface TuiModalStyle {
  /** Card fill. `null` = the terminal's own background, still painted opaque
   *  so the text underneath never shows through. */
  backgroundColor?: TuiModalColor | null
  /** Frame glyphs; `'none'` removes the frame entirely. */
  borderStyle?: TuiModalBorderStyle
  borderColor?: TuiModalColor | null
  titleColor?: TuiModalColor | null
  paddingX?: number
  paddingY?: number
  /** `false` removes the host title/footer; the plugin owns all content rows. */
  chrome?: boolean
  /** `'dim'` washes the background behind the window, `false` leaves it
   *  untouched. This is a real dim attribute, not an alpha channel. */
  backdrop?: 'dim' | false
}

export interface TuiModalOptions {
  /** Card width. Default: the host's round-1 content-driven width. */
  width?: TuiModalLength
  /** Smallest width in cells, applied after the percentage resolution. */
  minWidth?: number
  height?: TuiModalLength
  maxHeight?: TuiModalLength
  anchor?: TuiModalAnchor
  /** Cell offset applied after anchoring; negative moves up/left. */
  offsetX?: number
  offsetY?: number
  /** Vertical travel: a cell row, or a percentage of the remaining range. */
  row?: TuiModalLength
  /** Horizontal travel: a cell column, or a percentage of the remaining range. */
  col?: TuiModalLength
  /** Keep-out distance from the host rect edges; a number applies to all four. */
  margin?: number | TuiModalEdges
  /** Whether this window fits the current host frame. The host evaluates it
   *  before opening (refusing a window that cannot be shown) and after every
   *  resize (keeping the instance, but taking its input and bounds away). */
  visible?: (columns: number, rows: number) => boolean
  /** Show without taking the keyboard: the chat keeps its input until the
   *  user focuses or clicks this window. A non-capturing window is painted
   *  below the capturing one, so it can never hide the active input owner. */
  nonCapturing?: boolean
  style?: TuiModalStyle
}

/**
 * The card rect the host reports for one visible instance.
 *
 * The rect is measured inside the host's currently visible chat frame:
 * in fullscreen that frame is the terminal, in inline mode the terminal also
 * keeps scrollback above it, so the row is *not* promised to be an absolute
 * terminal row. This runtime stores and reports the host's numbers verbatim
 * and never derives a coordinate system of its own.
 */
export interface TuiModalBounds {
  left: number
  top: number
  columns: number
  rows: number
}

/** `rgba()`/`hsla()`, 4- or 8-digit hex and `transparent` all carry alpha. */
const ALPHA_COLOR = /^(?:rgba|hsla)\(|^#[0-9a-f]{4}$|^#[0-9a-f]{8}$|^transparent$/iu
/** `'50%'` and `'33.3%'`; digits only, one decimal point, no sign or space. */
const PERCENT = /^(\d+(?:\.\d+)?)%$/u

function optionError(label: string, detail: string): TypeError {
  return new TypeError(`dsh-tui: invalid TUI modal options for ${label}: ${detail}`)
}

/** An option document is plain data: an object literal, or a record with a
 *  `null` prototype (a map built key by key). Anything else — a Date, a Map, a
 *  class instance — would validate as an empty document and silently fall back
 *  to the defaults, so it is refused instead. */
function plainRecord(input: unknown, label: string, what: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw optionError(label, `${what} must be a plain object`)
  }
  const prototype: unknown = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    throw optionError(label, `${what} must be a plain object`)
  }
  return input as Record<string, unknown>
}

/** Write one validated value, or drop the key so the fallback applies again. */
function assignOption<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) Reflect.deleteProperty(target, key)
  else target[key] = value
}

function readCells(value: unknown, name: string, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw optionError(label, `${name} must be an integer >= ${min}`)
  }
  return value
}

function readOffset(value: unknown, name: string, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw optionError(label, `${name} must be an integer cell offset`)
  }
  return value
}

/** Cell counts and percentages share one field; `minPercent`/`minCells` keep
 *  a size from resolving to nothing (a travel position may be 0). Cells are
 *  always whole terminal cells; a percentage may carry decimals. */
function readLength(value: unknown, name: string, label: string, minCells: number, minPercent: number): TuiModalLength {
  if (typeof value === 'number') return readCells(value, name, label, minCells)
  if (typeof value === 'string') {
    const match = PERCENT.exec(value)
    const percent = match === null ? Number.NaN : Number(match[1])
    if (percent >= minPercent && percent <= 100) return value as `${number}%`
  }
  throw optionError(
    label,
    `${name} must be an integer cell count >= ${minCells} or a percentage in ${minPercent}%..100%`,
  )
}

function readAnchor(value: unknown, label: string): TuiModalAnchor {
  if (typeof value === 'string' && (MODAL_ANCHORS as readonly string[]).includes(value)) {
    return value as TuiModalAnchor
  }
  throw optionError(label, `anchor must be one of ${MODAL_ANCHORS.join(', ')}`)
}

function readMargin(value: unknown, label: string): number | TuiModalEdges {
  if (typeof value === 'number') return readCells(value, 'margin', label, 0)
  const source = plainRecord(value, label, 'margin')
  const edges: TuiModalEdges = {}
  for (const key of Object.keys(source)) {
    const edge = source[key]
    switch (key) {
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
        if (edge !== undefined) edges[key] = readCells(edge, `margin.${key}`, label, 0)
        break
      default:
        throw optionError(label, `unknown margin edge "${key}"`)
    }
  }
  return Object.freeze(edges)
}

function readVisible(value: unknown, label: string): (columns: number, rows: number) => boolean {
  if (typeof value !== 'function') throw optionError(label, 'visible must be a function of (columns, rows)')
  return value as (columns: number, rows: number) => boolean
}

function readBoolean(value: unknown, name: string, label: string): boolean {
  if (typeof value !== 'boolean') throw optionError(label, `${name} must be a boolean`)
  return value
}

function readColor(value: unknown, name: string, label: string): TuiModalColor | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw optionError(label, `${name} must be a theme token, a concrete color, or null`)
  }
  if (ALPHA_COLOR.test(value)) {
    throw optionError(label, `${name} must not carry alpha (${value}); a modal surface is always opaque`)
  }
  const themeKey = normalizeThemeKey(value)
  if (themeKey !== undefined) return themeKey
  if (isValidThemeColor(value)) return value as Color
  throw optionError(label, `${name} is neither a theme token nor a concrete color (${value})`)
}

function readBorderStyle(value: unknown, label: string): TuiModalBorderStyle {
  if (value === 'none' || (typeof value === 'string' && (MODAL_BORDER_STYLES as readonly string[]).includes(value))) {
    return value as TuiModalBorderStyle
  }
  throw optionError(label, `borderStyle must be 'none' or one of ${MODAL_BORDER_STYLES.join(', ')}`)
}

function readBackdrop(value: unknown, label: string): 'dim' | false {
  if (value === 'dim' || value === false) return value
  throw optionError(label, 'backdrop must be "dim" or false')
}

/** Validate one style object; a `undefined` field means "no opinion". */
function normalizeModalStyle(input: unknown, label: string): TuiModalStyle {
  return patchModalStyle(undefined, input, label)
}

/** Validate one option entry; unknown keys are refused instead of ignored. The
 *  key stays a plain string here so each `case` narrows to the option it names
 *  and `assignOption` keeps the value typed from the interface. */
function assignRawOption(target: TuiModalOptions, key: string, value: unknown, label: string): void {
  switch (key) {
    case 'width':
    case 'height':
    case 'maxHeight':
      assignOption(target, key, value === undefined ? undefined : readLength(value, key, label, 1, 1))
      return
    case 'minWidth':
      assignOption(target, key, value === undefined ? undefined : readCells(value, key, label, 1))
      return
    case 'row':
    case 'col':
      assignOption(target, key, value === undefined ? undefined : readLength(value, key, label, 0, 0))
      return
    case 'offsetX':
    case 'offsetY':
      assignOption(target, key, value === undefined ? undefined : readOffset(value, key, label))
      return
    case 'anchor':
      assignOption(target, key, value === undefined ? undefined : readAnchor(value, label))
      return
    case 'margin':
      assignOption(target, key, value === undefined ? undefined : readMargin(value, label))
      return
    case 'visible':
      assignOption(target, key, value === undefined ? undefined : readVisible(value, label))
      return
    case 'nonCapturing':
      assignOption(target, key, value === undefined ? undefined : readBoolean(value, key, label))
      return
    case 'style':
      assignOption(target, key, value === undefined ? undefined : normalizeModalStyle(value, label))
      return
    default:
      throw optionError(label, `unknown option "${key}"`)
  }
}

function readOptionBag(input: unknown, label: string): TuiModalOptions {
  const options: TuiModalOptions = {}
  if (input === undefined) return options
  const source = plainRecord(input, label, 'options')
  // `assignRawOption` decides both questions at once: a known key set to
  // `undefined` means "no opinion", an unknown key is refused whatever it
  // holds — so a typo never hides behind an `undefined` value.
  for (const key of Object.keys(source)) assignRawOption(options, key, source[key], label)
  return options
}

/**
 * Validate and freeze a whole option object (a descriptor default or one
 * `openModal` override). `undefined` values are "no opinion" and stay absent;
 * anything unknown or malformed is a TypeError, never a silent fallback.
 */
export function normalizeModalOptions(input: unknown, label: string): TuiModalOptions {
  return Object.freeze(readOptionBag(input, label))
}

/**
 * Apply `overlay` on top of `base`: geometry fields replace, `style` merges
 * field by field so an override can repaint one aspect of the card.
 */
export function mergeModalOptions(base: TuiModalOptions, overlay: TuiModalOptions): TuiModalOptions {
  const style = overlay.style === undefined
    ? base.style
    : Object.freeze({ ...base.style, ...overlay.style })
  return Object.freeze(style === undefined ? { ...base, ...overlay } : { ...base, ...overlay, style })
}

/** Validate one style object field by field on top of `current`. A field the
 *  caller sets to `undefined` is dropped: read as a whole object it means "no
 *  opinion", applied as a patch it falls back to the value underneath. */
function patchModalStyle(current: TuiModalStyle | undefined, input: unknown, label: string): TuiModalStyle {
  const source = plainRecord(input, label, 'style')
  const style: TuiModalStyle = { ...current }
  for (const key of Object.keys(source)) {
    const value = source[key]
    switch (key) {
      case 'backgroundColor':
      case 'borderColor':
      case 'titleColor':
        assignOption(style, key, value === undefined ? undefined : readColor(value, key, label))
        break
      case 'borderStyle':
        assignOption(style, key, value === undefined ? undefined : readBorderStyle(value, label))
        break
      case 'paddingX':
      case 'paddingY':
        assignOption(style, key, value === undefined ? undefined : readCells(value, key, label, 0))
        break
      case 'chrome':
        assignOption(style, key, value === undefined ? undefined : readBoolean(value, key, label))
        break
      case 'backdrop':
        assignOption(style, key, value === undefined ? undefined : readBackdrop(value, label))
        break
      default:
        throw optionError(label, `unknown style option "${key}"`)
    }
  }
  return Object.freeze(style)
}

/**
 * Apply one `updateOptions` patch to an instance's own overrides.
 *
 * A key set to `undefined` *drops* that override, so the field falls back to
 * the descriptor default (and a `style` set to `undefined` drops the whole
 * style override). Anything else is validated and replaces the field;
 * `style: { … }` merges field by field with the same `undefined` rule. This
 * mutates nothing: the returned object is the new frozen override layer.
 */
export function patchModalOptions(current: TuiModalOptions, patch: unknown, label: string): TuiModalOptions {
  const source = plainRecord(patch, label, 'options')
  const next: TuiModalOptions = { ...current }
  for (const key of Object.keys(source)) {
    const value = source[key]
    if (key === 'style' && value !== undefined) {
      assignOption(next, 'style', patchModalStyle(next.style, value, label))
      continue
    }
    // Known key + `undefined` drops the override; an unknown key stays a
    // TypeError instead of being cast into the option table.
    assignRawOption(next, key, value, label)
  }
  return Object.freeze(next)
}
