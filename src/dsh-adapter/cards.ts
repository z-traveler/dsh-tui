import * as sessionApi from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { TUI_CARD_RECORD_TYPE, asTuiCardRecord } from '../agent/cards.js'
import type { TuiCardRecord } from '../agent/cards.js'

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:dsh-tui/card': TuiCardRecord
  }
}

interface CardRecordWriter {
  appendPluginRecord(session: Session, type: typeof TUI_CARD_RECORD_TYPE, data: TuiCardRecord): ReturnType<Session['append']>
}
function hasCardRecordWriter(value: unknown): value is CardRecordWriter {
  return value !== null && typeof value === 'object'
    && 'appendPluginRecord' in value && typeof value.appendPluginRecord === 'function'
}

/** Append one validated, complete Custom Card snapshot to a Session.
 *
 * Downstream-only exception: upstream explicitly prohibits callers outside its
 * experimental packages. This intentional unsupported coupling is not official
 * third-party support, and future Session format migration is best-effort, not
 * a guarantee of lossless Custom Card retention.
 */
export function appendTuiCard(session: Session, record: TuiCardRecord) {
  const validated = asTuiCardRecord(record)
  if (validated === undefined) throw new TypeError('invalid Custom Card record')
  if (!hasCardRecordWriter(sessionApi)) throw new Error('Custom Cards require a DSH host with plugin-record support')
  return sessionApi.appendPluginRecord(session, TUI_CARD_RECORD_TYPE, validated)
}
