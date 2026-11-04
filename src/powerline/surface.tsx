import React from 'react'
import type { InputBorderLabel } from '../components/EffortInputBorder.js'
import type { PowerlineOptions } from './config.js'

/** The existing status renderer is mounted at the input edge and beneath the
 * editor for overflow. No second metric store or plugin registry is created. */
export const PowerlineSurface = React.createContext<{
  header: ((label?: InputBorderLabel) => React.ReactNode) | null
  options: PowerlineOptions
} | null>(null)
