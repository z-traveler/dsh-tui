import type { ChannelUi } from './adapter/channel/ui-policy.js'

/** Text presentation, not an emoji or server-confirmed acceleration indicator. */
export const FAST_MODE_MARK = ' ⚡︎'

/** Route equality only: eligibility belongs to the backend projection. */
export function showFastMode(channel: Pick<ChannelUi, 'provider' | 'model' | 'fastMode'>): boolean {
  const mode = channel.fastMode
  return mode?.enabled === true && mode.applicable === true
    && mode.provider === channel.provider && mode.model === channel.model
}
