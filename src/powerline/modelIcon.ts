import type { PowerlineOptions } from './config.js'

const GENERIC_MODEL_ICON = '\uec19'
const ASCII_MODEL_ICON = 'model'

/**
 * The icon the model field shows: the shared glyph mode wins over the rule map,
 * otherwise the first rule matching the raw model id, else the generic glyph.
 * The result carries no trailing space; callers own field spacing.
 */
export function selectModelIcon(model: string, options: PowerlineOptions): string {
  if (options.icons === 'none') return ''
  if (options.icons === 'ascii') return ASCII_MODEL_ICON
  return options.modelIcons.find(rule => new RegExp(rule.pattern, 'i').test(model))?.icon ?? GENERIC_MODEL_ICON
}
