import type { StatusBarConfig } from './adapter/ports/channel-display.js'

type HudLayout = Pick<StatusBarConfig, 'placement' | 'separator' | 'order' | 'style' | 'powerline' | 'workingCounters'>

// Public setting names map to existing view keys; metrics and visibility stay
// with StatusLine. Unlisted fields are retained (including safety notices).
const FIELD_KEYS: Readonly<Record<string, string>> = {
  model: 'model', thinking: 'effort', contextUsage: 'context', cost: 'cost',
  cwd: 'cwd', gitBranch: 'git', tokens: 'tokens', cache: 'cache', tps: 'tps',
  mode: 'mode', goal: 'goal', sessionTitle: 'title', sessionId: 'sessionId',
}

export function parseStatusBarOrder(value: string): string[] | undefined {
  if (value.trim() === '') return []
  const keys = value.split(',').map(key => key.trim())
  if (keys.some(key => !Object.hasOwn(FIELD_KEYS, key)) || new Set(keys).size !== keys.length) return undefined
  return keys
}

/** Only explicit, valid choices extend the upstream preference object. */
export function normalizeHudLayout(input: Record<string, unknown>): HudLayout {
  const result: HudLayout = {}
  if (input.style === 'native' || input.style === 'powerline') result.style = input.style
  if (Object.hasOwn(input, 'powerline')) result.powerline = input.powerline
  if (typeof input.workingCounters === 'boolean') result.workingCounters = input.workingCounters
  if (input.placement === 'above' || input.placement === 'below') result.placement = input.placement
  if (input.separator === 'dot' || input.separator === 'powerline-thin') result.separator = input.separator
  if (typeof input.order === 'string') {
    const keys = parseStatusBarOrder(input.order)
    if (keys !== undefined) result.order = keys.join(',')
  }
  return result
}

export function orderHudFields<T extends { key: string }>(fields: readonly T[], order: string | undefined): readonly T[] | undefined {
  const keys = order === undefined ? undefined : parseStatusBarOrder(order)
  if (!keys?.length) return undefined
  const selected = keys.map(key => FIELD_KEYS[key])
  return [
    ...selected.flatMap(key => fields.filter(field => field.key === key)),
    ...fields.filter(field => !selected.includes(field.key)),
  ]
}

export function hudSeparator(separator: HudLayout['separator']): string {
  return separator === 'powerline-thin' ? ' \ue0b1 ' : ' · '
}
