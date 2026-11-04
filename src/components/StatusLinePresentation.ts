import type React from 'react'
import type { TuiStatusFieldEntry } from '../dsh-adapter/status.js'

/** Already projected/formatted host fields. A presentation adapter must not
 * infer accounting or plugin semantics from their text. */
export interface StatusLinePresentation {
  fields: readonly {
    key: string
    node: React.ReactNode
    id?: string
    onClick?: () => void
    tooltip?: string
  }[]
  pluginFields: readonly TuiStatusFieldEntry[]
  used: number | undefined
  capacity: number | undefined
  detail: (id: string) => React.ReactNode
  supplemental: React.ReactNode
}
