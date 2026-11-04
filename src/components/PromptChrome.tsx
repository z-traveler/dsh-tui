import React from 'react'
import type { EffortInputBorder } from './EffortInputBorder.js'

export type PromptFrameProps = React.ComponentProps<typeof EffortInputBorder> & { rows: number }

/** Optional presentation adapter; editor state, key handling and cursor
 * ownership stay in PromptInput. Null keeps native chrome unchanged. */
export const PromptChrome = React.createContext<{
  Frame: React.ComponentType<PromptFrameProps>
  padding: number
  inlineControls: boolean
  marginTop: number
} | null>(null)
