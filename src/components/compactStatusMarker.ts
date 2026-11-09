import type { SubagentStatus } from '../adapter/ports/channel-view.js'
import type { TeamMemberStatus } from './teamRoster.js'

export interface CompactStatusMarker {
  readonly glyph: string
  readonly color?: 'success' | 'error' | 'warning' | 'subtle' | 'accent'
}

/** Single-cell subagent/team chrome for pi-like; never changes the reported state. */
export function compactStatusMarker(status: SubagentStatus | TeamMemberStatus, minimalUi = false): CompactStatusMarker {
  let marker: CompactStatusMarker
  switch (status) {
    case 'completed': marker = { glyph: '✓', color: 'success' }; break
    case 'failed': marker = { glyph: '×', color: 'error' }; break
    case 'running':
    case 'starting': marker = { glyph: '·', color: 'warning' }; break
    case 'idle': marker = { glyph: '○', color: 'accent' }; break
    case 'active': marker = { glyph: '◇', color: 'accent' }; break
    default: marker = { glyph: '·', color: 'subtle' }
  }
  return minimalUi ? { glyph: marker.glyph } : marker
}
