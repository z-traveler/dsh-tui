import { isValidThemeColor } from '../customTheme.js'
import { stringWidth } from '../ink/stringWidth.js'
import { isThemeColorKey } from '../theme.js'

/** Glyph set for HUD field labels; `none` keeps the labels text-only. */
export type PowerlineIcons = 'nerd' | 'ascii' | 'none'
/** How much of the working directory a path field shows. */
export type PowerlinePathMode = 'basename' | 'abbreviated' | 'full'
/** How much of the context window usage a context field shows. */
export type PowerlineContextMode = 'full' | 'percent'
/** What happens to a field that does not fit the overflow row being filled. */
export type PowerlineSecondaryOverflow = 'drop' | 'wrap'

export interface PowerlineColors {
  marker: string
  model: string
  path: string
  gitClean: string
  gitDirty: string
  context: string
  warning: string
  error: string
  separator: string
  border: string
  cost: string
  thinking: string
  plugin: string
  agent: string
  quota: string
}

/** A model family color rule; the first matching pattern wins. */
export interface PowerlineModelColor {
  pattern: string
  color: string
}

/** A model icon rule; the first matching pattern wins. */
export interface PowerlineModelIcon {
  pattern: string
  icon: string
}

/** Fully resolved HUD options: every field has a value the renderer can use. */
export interface PowerlineOptions {
  left: string[]
  right: string[]
  separator: string
  icons: PowerlineIcons
  padding: number
  secondaryOverflow: PowerlineSecondaryOverflow
  path: PowerlinePathMode
  context: PowerlineContextMode
  warnPercent: number
  errorPercent: number
  /** Upper bound for overflow rows; keeps a bad config from producing rows forever. */
  maxRows: number
  marker: string
  colors: PowerlineColors
  modelColors: PowerlineModelColor[]
  modelIcons: PowerlineModelIcon[]
}

const ICONS = ['nerd', 'ascii', 'none'] as const
const PATH_MODES = ['basename', 'abbreviated', 'full'] as const
const CONTEXT_MODES = ['full', 'percent'] as const
const OVERFLOWS = ['drop', 'wrap'] as const
const COLOR_KEYS = [
  'marker', 'model', 'path', 'gitClean', 'gitDirty', 'context', 'warning',
  'error', 'separator', 'border', 'cost', 'thinking', 'plugin', 'agent', 'quota',
] as const satisfies readonly (keyof PowerlineColors)[]

const MAX_PADDING = 8
const MAX_ROWS = 32
const MAX_SEPARATOR_WIDTH = 8
const MAX_MARKER_WIDTH = 8
const MAX_MODEL_ICON_WIDTH = 8

const DEFAULT_LEFT = ['marker', 'model', 'context', 'cost', 'shell', 'cwd', 'git', 'plugins'] as const
const DEFAULT_RIGHT = ['agent'] as const
const DEFAULT_SEPARATOR = '\ue0b1'
const DEFAULT_MARKER = '🐋'
const DEFAULT_WARN_PERCENT = 70
const DEFAULT_ERROR_PERCENT = 90

// Hex values keep the model and path colors stable across themes; theme keys
// let the remaining fields follow the active palette.
const DEFAULT_COLORS: PowerlineColors = {
  marker: 'accent',
  model: '#d787af',
  path: '#00afaf',
  gitClean: 'success',
  gitDirty: 'warning',
  context: 'subtle',
  warning: 'warning',
  error: 'error',
  separator: 'subtle',
  border: 'promptBorder',
  cost: 'text',
  thinking: 'subtle',
  plugin: 'text',
  agent: 'text',
  quota: 'success',
}

const DEFAULT_MODEL_COLORS: readonly PowerlineModelColor[] = [
  { pattern: 'deepseek', color: '#6e9bc5' },
  { pattern: 'gpt', color: '#f5f5f5' },
  { pattern: 'claude', color: '#fac03d' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

// Control characters would corrupt the row: newlines break it, ESC injects
// terminal sequences, and C1 controls render as invisible width.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value)
}

/**
 * A blank, over-wide or control-bearing glyph falls back instead of letting one
 * configured value consume the row budget or rewrite the line (newlines, ESC).
 */
function normalizeGlyph(value: unknown, fallback: string, maxWidth: number): string {
  return isGlyph(value, maxWidth) ? value : fallback
}

function isGlyph(value: unknown, maxWidth: number): value is string {
  if (typeof value !== 'string' || value.trim() === '' || hasControlChars(value)) return false
  const width = stringWidth(value)
  return width > 0 && width <= maxWidth
}

/** A color is a Theme key or one of the forms the renderer already accepts. */
function isPowerlineColor(value: unknown): value is string {
  if (typeof value !== 'string' || hasControlChars(value)) return false
  const color = value.trim()
  return color !== '' && (isThemeColorKey(color) || isValidThemeColor(color))
}

/** An explicit empty group stays empty; only a missing group gets the default. */
function normalizeFieldIds(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function normalizeColors(value: unknown): PowerlineColors {
  const raw = isRecord(value) ? value : {}
  const colors = { ...DEFAULT_COLORS }
  for (const key of COLOR_KEYS) {
    const color = raw[key]
    // An invalid color falls back to the field's default instead of reaching
    // the renderer, where an unknown value would silently paint nothing.
    if (isPowerlineColor(color)) colors[key] = color.trim()
  }
  return colors
}

/** A malformed pattern is skipped rather than discarding the whole rule list. */
function isPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

function normalizeModelColors(value: unknown): PowerlineModelColor[] {
  if (!Array.isArray(value)) return DEFAULT_MODEL_COLORS.map(entry => ({ ...entry }))
  const rules: PowerlineModelColor[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const pattern = typeof entry.pattern === 'string' ? entry.pattern.trim() : ''
    const color = typeof entry.color === 'string' ? entry.color : ''
    if (pattern === '' || !isPattern(pattern) || !isPowerlineColor(color)) continue
    rules.push({ pattern, color: color.trim() })
  }
  return rules
}

function normalizeModelIcons(value: unknown): PowerlineModelIcon[] {
  if (!Array.isArray(value)) return []
  const rules: PowerlineModelIcon[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const pattern = typeof entry.pattern === 'string' ? entry.pattern.trim() : ''
    if (pattern === '' || !isPattern(pattern) || !isGlyph(entry.icon, MAX_MODEL_ICON_WIDTH)) continue
    rules.push({ pattern, icon: entry.icon })
  }
  return rules
}

/**
 * Resolve untrusted config into usable options. Every missing, mistyped or
 * out-of-range value falls back to its default, so rendering never depends on
 * the on-disk config being well formed.
 */
export function normalizePowerlineOptions(value: unknown): PowerlineOptions {
  const raw = isRecord(value) ? value : {}
  const warnPercent = clampInteger(raw.warnPercent, 0, 100, DEFAULT_WARN_PERCENT)
  const errorPercent = clampInteger(raw.errorPercent, 0, 100, DEFAULT_ERROR_PERCENT)
  const thresholdsInverted = warnPercent >= errorPercent
  return {
    left: normalizeFieldIds(raw.left, DEFAULT_LEFT),
    right: normalizeFieldIds(raw.right, DEFAULT_RIGHT),
    separator: normalizeGlyph(raw.separator, DEFAULT_SEPARATOR, MAX_SEPARATOR_WIDTH),
    icons: isOneOf(raw.icons, ICONS) ? raw.icons : 'nerd',
    padding: clampInteger(raw.padding, 0, MAX_PADDING, 1),
    secondaryOverflow: isOneOf(raw.secondaryOverflow, OVERFLOWS) ? raw.secondaryOverflow : 'drop',
    path: isOneOf(raw.path, PATH_MODES) ? raw.path : 'basename',
    context: isOneOf(raw.context, CONTEXT_MODES) ? raw.context : 'full',
    warnPercent: thresholdsInverted ? DEFAULT_WARN_PERCENT : warnPercent,
    errorPercent: thresholdsInverted ? DEFAULT_ERROR_PERCENT : errorPercent,
    maxRows: clampInteger(raw.maxRows, 1, MAX_ROWS, MAX_ROWS),
    marker: normalizeGlyph(raw.marker, DEFAULT_MARKER, MAX_MARKER_WIDTH),
    colors: normalizeColors(raw.colors),
    modelColors: normalizeModelColors(raw.modelColors),
    modelIcons: normalizeModelIcons(raw.modelIcons),
  }
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function isColorsInput(value: unknown): boolean {
  if (!isRecord(value)) return false
  return COLOR_KEYS.every(key => value[key] === undefined || isPowerlineColor(value[key]))
}

function isModelColorsInput(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => isRecord(entry)
    && typeof entry.pattern === 'string'
    && isPowerlineColor(entry.color))
}

function isModelIconsInput(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => isRecord(entry)
    && typeof entry.pattern === 'string'
    && isGlyph(entry.icon, MAX_MODEL_ICON_WIDTH))
}

/**
 * `/settings` edits a partial object, so an invalid style value is rejected
 * instead of silently defaulting: a typo should fail the save rather than look
 * accepted. Value ranges stay normalized, malformed model patterns are skipped
 * (they are a search filter, not a style), and unknown layout ids are accepted
 * because plugin field ids are not known in advance.
 */
function hasValidTypes(raw: Record<string, unknown>): boolean {
  return (raw.left === undefined || isStringArray(raw.left))
    && (raw.right === undefined || isStringArray(raw.right))
    && (raw.separator === undefined || isGlyph(raw.separator, MAX_SEPARATOR_WIDTH))
    && (raw.icons === undefined || isOneOf(raw.icons, ICONS))
    && (raw.padding === undefined || isFiniteNumber(raw.padding))
    && (raw.secondaryOverflow === undefined || isOneOf(raw.secondaryOverflow, OVERFLOWS))
    && (raw.path === undefined || isOneOf(raw.path, PATH_MODES))
    && (raw.context === undefined || isOneOf(raw.context, CONTEXT_MODES))
    && (raw.warnPercent === undefined || isFiniteNumber(raw.warnPercent))
    && (raw.errorPercent === undefined || isFiniteNumber(raw.errorPercent))
    && (raw.maxRows === undefined || isFiniteNumber(raw.maxRows))
    && (raw.marker === undefined || isGlyph(raw.marker, MAX_MARKER_WIDTH))
    && (raw.colors === undefined || isColorsInput(raw.colors))
    && (raw.modelColors === undefined || isModelColorsInput(raw.modelColors))
    && (raw.modelIcons === undefined || isModelIconsInput(raw.modelIcons))
}

/**
 * Parse the JSON text stored by `/settings`. Malformed JSON and wrong types
 * reject the text; a valid partial object resolves to complete options.
 */
export function parsePowerlineOptions(text: string): PowerlineOptions | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value) || !hasValidTypes(value)) return undefined
  return normalizePowerlineOptions(value)
}
