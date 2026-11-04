import React from 'react'
import { Text } from '../ui.js'
import { normalizeThemeKey } from '../theme.js'
import { isValidThemeColor } from '../customTheme.js'
import type { Color } from '../ink/styles.js'

/** User color settings cross the typed renderer boundary only after the
 * host's theme/color validators accept them. */
export function PowerlineText({ color, ...props }: Omit<React.ComponentProps<typeof Text>, 'color'> & { color?: string }): React.ReactNode {
  const accepted = color === undefined ? undefined : normalizeThemeKey(color) ?? (isValidThemeColor(color) ? color as Color : 'text')
  return <Text {...props} color={accepted} />
}
