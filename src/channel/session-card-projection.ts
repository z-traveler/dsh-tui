/**
 * Session fact cards (downstream): projects generic context notices into
 * transcript card rows. Called from the shared projector (`projection.ts`),
 * which hands every fact-card event it delegates to `apply`.
 */
import type { ChatRow } from '../adapter/ports/channel-view.js'
import type { AgentEventOf } from '../agent/events.js'
import type { ChannelProjectionDeps } from './projection.js'

/** The neutral events that become fact-card rows here. */
export type SessionCardEvent = AgentEventOf<'context.notice'>

/**
 * The fact-card half of one projector. `deps` is the projector's own deps
 * object (read on every event); `appendRow` is the projector's row append.
 */
export function createSessionCardProjection(
  deps: Pick<ChannelProjectionDeps, 'rowIds' | 'sessionCards'>,
  appendRow: (row: ChatRow) => void,
) {
  const apply = (event: SessionCardEvent): void => {
    // A generic context notice (any producer's `form: 'notice'`). One row
    // per durable message, default-folded: summary while folded, the
    // complete saved body when expanded. It is transcript material only,
    // so it adds no toast and never joins the human/user bubble path; the
    // switch keeps the upstream model-only injection when off.
    if (deps.sessionCards !== true) return
    appendRow({
      id: deps.rowIds.value,
      kind: 'context-notice',
      text: event.body,
      seq: event.seq,
      time: event.time,
      contextNotice: { messageId: event.id, source: event.source, summary: event.summary },
    })
    deps.rowIds.value += 1
  }

  return { apply }
}
