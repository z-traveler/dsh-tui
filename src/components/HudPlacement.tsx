import React, { Children, type ReactNode } from 'react'
import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import type { InputBorderLabel } from './EffortInputBorder.js'
import type { StatusLinePresentation } from './StatusLinePresentation.js'
import { PowerlineStatus } from '../powerline/Status.js'
import type { StatusBarConfig } from '../adapter/ports/channel-display.js'
import { useTerminalSize } from '../ui.js'
import { PromptChrome } from './PromptChrome.js'
import { PowerlineSurface } from '../powerline/surface.js'
import { PowerlineInputBorder } from '../powerline/InputBorder.js'
import { normalizePowerlineOptions } from '../powerline/config.js'

/** Downstream composition root: native editor and metric producers do not
 * own the concrete input-frame adapter. Keep provider/editor identity stable. */
export function HudPlacement({ placement, style, powerline, suspended = false, statusText = '', children }: {
  placement: StatusBarConfig['placement']
  style?: StatusBarConfig['style']
  powerline?: unknown
  suspended?: boolean
  statusText?: string
} & { children: ReactNode }): ReactNode {
  const { columns } = useTerminalSize()
  const elements = Children.toArray(children)
  const [prompt, status] = elements
  let content: ReactNode[] = placement === 'above' ? [...elements].reverse() : elements
  let surface: React.ContextType<typeof PowerlineSurface> = null
  if (style === 'powerline' && columns >= 10 && React.isValidElement<{ channel: ChannelUi; render?: (view: StatusLinePresentation) => ReactNode }>(status)) {
    const fused = placement !== 'below' && !suspended
    const header = (label?: InputBorderLabel) => React.cloneElement(status, { key: 'hud-header',
      render: view => <PowerlineStatus {...view} channel={status.props.channel} surface={fused ? 'header' : 'row'} gapBefore={!fused && !suspended} label={label} statusText={statusText} /> })
    const overflow = React.cloneElement(status, { key: 'hud-overflow',
      render: view => <PowerlineStatus {...view} channel={status.props.channel} surface="overflow" gapBefore={fused} reserveLabel={fused} statusText={statusText} /> })
    if (!suspended) surface = { header: fused ? header : null, options: normalizePowerlineOptions(powerline) }
    content = [prompt, fused ? null : header(), overflow]
  }
  const chrome = surface === null ? null : { Frame: PowerlineInputBorder, padding: 3, inlineControls: false, marginTop: 0 }
  return <PromptChrome.Provider value={chrome}><PowerlineSurface.Provider value={surface}>
    {content}
  </PowerlineSurface.Provider></PromptChrome.Provider>
}
