import { Children, type ReactNode } from 'react'
import type { StatusBarConfig } from '../adapter/ports/channel-display.js'

/** Reorder the same prompt/HUD elements without adding a layout box or
 * remounting the editor. Children are declared in native prompt-then-HUD order. */
export function HudPlacement({ placement, children }: { placement: StatusBarConfig['placement']; children: ReactNode }): ReactNode {
  const elements = Children.toArray(children)
  return placement === 'above' ? elements.reverse() : elements
}
