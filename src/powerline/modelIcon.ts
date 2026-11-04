import type { PowerlineOptions } from './config.js'

const GENERIC_MODEL_ICON = '\uec19'
const ASCII_MODEL_ICON = 'model'

const VS16 = '\ufe0f'
/** Keycap bases stay ASCII: a digit plus VS16 without U+20E3 is one cell. */
const KEYCAP_BASE = /^[0-9#*]$/
const EMOJI_CAPABLE = /\p{Emoji}/u
const DEFAULT_EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u

/**
 * The icon the model field shows: the shared glyph mode wins over the rule map,
 * otherwise the first rule matching the raw model id, else the generic glyph.
 * The result carries no trailing space and no width normalization; callers own
 * field spacing and should prefer {@link formatModelIconPrefix}.
 */
export function selectModelIcon(model: string, options: PowerlineOptions): string {
  if (options.icons === 'none') return ''
  if (options.icons === 'ascii') return ASCII_MODEL_ICON
  return options.modelIcons.find(rule => new RegExp(rule.pattern, 'i').test(model))?.icon ?? GENERIC_MODEL_ICON
}

/**
 * A bare text-default emoji symbol (`✳` U+2733, `⚠` U+26A0) is drawn one or two
 * cells wide depending on the terminal font and its emoji presentation setting,
 * so the same config renders at a different width per host. An explicit VS16
 * pins it to emoji presentation, which modern terminals draw two cells wide and
 * `stringWidth` also measures as two. Multi-codepoint icons already carry their
 * own selector, default-emoji glyphs (`🐋`) need no marker, and keycap bases
 * must not become emoji sequences.
 */
function normalizeModelIcon(icon: string): string {
  const codepoints = [...icon]
  if (codepoints.length !== 1 || KEYCAP_BASE.test(icon)) return icon
  if (!EMOJI_CAPABLE.test(icon) || DEFAULT_EMOJI_PRESENTATION.test(icon)) return icon
  return `${icon}${VS16}`
}

/**
 * Keep each icon's natural width and exactly one separating space. A wider
 * icon in another rule must not add padding to this model's prefix.
 */
export function formatModelIconPrefix(model: string, options: PowerlineOptions): string {
  const icon = selectModelIcon(model, options)
  if (icon === '') return ''
  if (options.icons === 'ascii') return `${ASCII_MODEL_ICON} `

  return `${normalizeModelIcon(icon)} `
}
