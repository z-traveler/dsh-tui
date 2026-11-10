/**
 * Session fact cards and Custom Cards (downstream): projects settled command
 * results, explicit skill loads, generic context notices and Custom Card
 * snapshots into transcript card rows. Called from the shared projector
 * (`projection.ts`), which hands every card event to `apply`, re-indexes the
 * card ledger before a replay and clears it on reset.
 */
import type { ChatRow } from '../adapter/ports/channel-view.js'
import type { AgentEventOf } from '../agent/events.js'
import type { TuiCardRecord, TuiCardView } from '../agent/cards.js'
import { cardRowKey, commandCardRecord, foldCardSnapshot, presentCardView, writeCardSnapshot } from './card-row.js'
import type { ChannelProjectionDeps, ProjectionState } from './projection.js'

/** The neutral events that become fact-card rows. */
export type SessionCardEvent = AgentEventOf<'command.result' | 'skill.invocation' | 'context.notice' | 'card.upsert'>

/**
 * The card half of one projector. `state` and `deps` are the projector's own
 * objects (read on every event); `appendRow`/`touchRow` are its row append and
 * in-place change marks.
 */
export function createSessionCardProjection(
  state: Pick<ProjectionState, 'rows'>,
  deps: Pick<ChannelProjectionDeps, 'rowIds' | 'sessionCards' | 'renderer'>,
  appendRow: (row: ChatRow) => void,
  touchRow: (row: ChatRow) => void,
) {
  /**
   * Custom Card rows by their business `(type, id)` identity: a committed
   * snapshot with a known identity updates that row in place instead of adding
   * another card. Replay re-indexes the painted rows so a replayed history
   * reuses them; `reset` drops the ledger with the rows.
   */
  const cardRows = new Map<string, ChatRow>()

  /**
   * The card row that already owns an identity. A row this projector did not
   * paint — one prepended from an older history page — is adopted on first use:
   * scanning the rows only on a ledger miss keeps the per-event cost off the
   * streaming path while a live update still lands in the SAME row.
   */
  const cardRowOf = (key: string): ChatRow | undefined => {
    const known = cardRows.get(key)
    if (known !== undefined) return known
    for (const row of state.rows) {
      if (row.kind !== 'card' || row.card === undefined) continue
      if (cardRowKey(row.card.type, row.card.id) !== key) continue
      cardRows.set(key, row)
      return row
    }
    return undefined
  }

  /**
   * One committed Custom Card snapshot. Same `(type, id)` = same card: the row
   * keeps its id, position, first seq/time and only takes the newer content.
   * A snapshot at or below the applied seq is a duplicate delivery (reconnect,
   * replay over painted rows) and changes nothing.
   */
  const applyCardUpsert = (event: AgentEventOf<'card.upsert'>): void => {
    const record: TuiCardRecord = event.record
    const key = cardRowKey(record.type, record.id)
    const existing = cardRowOf(key)
    if (existing?.card !== undefined) {
      if (event.seq <= existing.card.latestSeq) return
      const identity = { type: record.type, id: record.id, latestSeq: event.seq }
      const view = presentCardView(record, deps.renderer?.presentCard)
      // A folded row stays folded: only its identity and preview advance.
      if (existing.folded === true) foldCardSnapshot(existing, view, identity)
      else writeCardSnapshot(existing, view, identity)
      touchRow(existing)
      return
    }
    const row: ChatRow = { id: deps.rowIds.value, kind: 'card', text: '', seq: event.seq, time: event.time }
    writeCardSnapshot(row, presentCardView(record, deps.renderer?.presentCard), {
      type: record.type,
      id: record.id,
      latestSeq: event.seq,
    })
    appendRow(row)
    cardRows.set(key, row)
    deps.rowIds.value += 1
  }

  /**
   * The Custom Card snapshot a settled command would present through the host:
   * a registered `command/<name>` presenter takes the card over, an
   * unregistered command keeps its own generic card. The identity is the
   * command's pairing id, so a settled command never adds two cards.
   */
  const commandCardView = (event: AgentEventOf<'command.result'>): { record: TuiCardRecord; view: TuiCardView } | undefined => {
    const present = deps.renderer?.presentCard
    if (present === undefined || deps.renderer?.hasCard?.(`command/${event.name}`) !== true) return undefined
    const record = commandCardRecord(event)
    return { record, view: present(record) }
  }

  const apply = (event: SessionCardEvent): void => {
    // The `sessionCards` deployment switch: off keeps the upstream transcript
    // shape (local command reports, model-only skill and notice injections,
    // no Custom Card rows).
    if (deps.sessionCards !== true) return
    switch (event.type) {
      case 'command.result': {
        // A settled command (core's command/run + command/done, paired by the
        // backend): one card, unless there is nothing to present. A success
        // with no text has no outcome to show, and `coveredBySeq` names an
        // earlier record that already owns this outcome's presentation
        // (a compaction checkpoint) — a card there would be its duplicate.
        if (event.text === '' || event.coveredBySeq !== undefined) return
        const shared = commandCardView(event)
        appendRow({
          id: deps.rowIds.value,
          kind: 'command',
          text: event.text,
          seq: event.seq,
          time: event.time,
          command: {
            commandId: event.commandId,
            name: event.name,
            ...(event.args === undefined || event.args === '' ? {} : { args: event.args }),
            status: event.outcome,
          },
          // A registered `command/<name>` presenter owns the look; the row keeps
          // its command facts either way, so the generic card is the fallback.
          ...(shared === undefined
            ? {}
            : { card: { type: shared.record.type, id: shared.record.id, latestSeq: event.seq, view: shared.view } }),
        })
        deps.rowIds.value += 1
        return
      }
      case 'skill.invocation':
        // A user-explicit skill load. The card shows the canonical body core
        // injected, verbatim; the switch keeps the upstream hidden injection.
        appendRow({
          id: deps.rowIds.value,
          kind: 'skill',
          text: event.body,
          seq: event.seq,
          time: event.time,
          skill: { name: event.name },
        })
        deps.rowIds.value += 1
        return
      case 'context.notice':
        // A generic context notice (any producer's `form: 'notice'`). One row
        // per durable message, default-folded: summary while folded, the
        // complete saved body when expanded. It is transcript material only,
        // so it adds no toast and never joins the human/user bubble path; the
        // switch keeps the upstream model-only injection when off.
        appendRow({
          id: deps.rowIds.value,
          kind: 'context-notice',
          text: event.body,
          seq: event.seq,
          time: event.time,
          contextNotice: { messageId: event.id, source: event.source, summary: event.summary },
        })
        deps.rowIds.value += 1
        return
      case 'card.upsert':
        applyCardUpsert(event)
        return
    }
  }

  return {
    apply,
    /** Before a replay: Custom Cards match by business identity, so a
     *  replayed snapshot at or below the applied seq is the same content, not
     *  a second card. */
    reindex(): void {
      cardRows.clear()
      for (const row of state.rows) if (row.kind === 'card' && row.card !== undefined) cardRows.set(cardRowKey(row.card.type, row.card.id), row)
    },
    clear(): void {
      cardRows.clear()
    },
  }
}
