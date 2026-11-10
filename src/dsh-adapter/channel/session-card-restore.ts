/**
 * Session fact cards and Custom Cards (downstream): restores folded command,
 * skill, context notice and Custom Card rows from the DSH session log. Called
 * from `foldBack` in `transcript.ts`; the window fold itself (`foldRows`)
 * folds these kinds with the text rows and releases a card row's presentation
 * (`releaseCardSnapshot`), which `views.card` re-derives here.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { markChannelReadDirty } from '../../adapter/channel/read-view.js'
import { asTuiCardRecord, TUI_CARD_RECORD_TYPE, type TuiCardRecord } from '../../agent/cards.js'
import { cardRowKey, commandCardRecord, presentCardView, writeCardSnapshot } from '../../channel/card-row.js'
import { skillInvocationName } from '../compat/messages.js'
import { pluginRecordOf } from '../compat/pluginRecords.js'
import type { ChatRow, ToolViewPresenter } from './types.js'

/**
 * The fact-card restore for one `foldBack` pass. The returned function answers
 * undefined for a row that is not a fact card (the upstream paths handle it),
 * false for a fact card the log cannot restore yet and true once the row is
 * restored and unfolded.
 */
export function sessionCardRestore(
  restoreEvents: readonly SessionEvent[],
  events: readonly SessionEvent[],
  views: ToolViewPresenter | undefined,
): (row: ChatRow) => boolean | undefined {
  /** Read once, on the first folded card row of this pass. */
  let cards: Map<string, { record: TuiCardRecord; seq: number }> | undefined
  return row => {
    const rowSeq = row.seq
    if (row.kind === 'command' && row.command !== undefined) {
      // The settled record owns the body: it is found by the same `commandId`
      // the card was built from (the run record only names it, so the folded
      // row keeps that metadata and drops just the text). Like a tool result,
      // it is matched by its pairing id, not by the row's seq.
      const done = restoreEvents.find(event => event.type === 'command/done' && event.data.commandId === row.command?.commandId)
      if (done === undefined || done.type !== 'command/done') return false
      row.text = done.data.text ?? ''
      if (row.card !== undefined) {
        // The shared host presented this command: re-derive that view with the
        // CURRENT presenter, or fall back to the command's own card.
        const record = commandCardRecord({
          commandId: row.command.commandId,
          name: row.command.name,
          args: row.command.args,
          outcome: row.command.status,
          text: row.text,
        })
        const view = views?.card?.(record)
        row.card = view === undefined ? undefined : { type: record.type, id: record.id, latestSeq: done.seq, view }
      }
      return unfold(row)
    }
    if (row.kind === 'skill') {
      // The injected user/message at the row's own seq carries the saved body.
      const load = restoreEvents.find(event => event.seq === rowSeq && event.type === 'user/message' && skillInvocationName(event.data.source) !== undefined)
      if (load === undefined || load.type !== 'user/message') return false
      const body = messageBody(load)
      if (body.trim()) row.text = body.trim()
      return unfold(row)
    }
    if (row.kind === 'context-notice') {
      // The durable notice message at the row's own seq owns the full body;
      // its message id and summary stay on the row (the log only restores the
      // text the folded window dropped).
      const notice = restoreEvents.find(event => event.seq === rowSeq && event.type === 'user/message')
      if (notice === undefined || notice.type !== 'user/message') return false
      row.text = messageBody(notice)
      return unfold(row)
    }
    if (row.kind === 'card' && row.card !== undefined) {
      // A folded Custom Card row comes back from the latest valid snapshot of
      // its identity, read from the whole durable log (any earlier snapshot on
      // screen was the same card, not a separate fact).
      cards ??= latestCardSnapshots(events)
      const snapshot = cards.get(cardRowKey(row.card.type, row.card.id))
      if (snapshot === undefined) return false
      // The same fence as the neutral restore: a caller can pass a log prefix
      // older than a snapshot this row already accepted; restoring it would
      // present stale content as complete. The row keeps its preview until a
      // snapshot that knows the newer seq is available.
      if (snapshot.seq < row.card.latestSeq) return false
      writeCardSnapshot(row, presentCardView(snapshot.record, views?.card), {
        type: row.card.type,
        id: row.card.id,
        latestSeq: snapshot.seq,
      })
      // The neutral restore's rule, for the card kind alone: a card restored
      // by hand is not re-folded by the next window pass (the full view stays
      // readable until the user leaves it behind).
      row.restored = true
      return unfold(row)
    }
    return undefined
  }
}

/**
 * The latest valid Custom Card snapshot of every business identity in the
 * durable log. A card's content is its newest snapshot (the log keeps every
 * submission as history, not as separate cards), so a folded row restores the
 * state it last showed even when the update arrived while it was folded.
 */
function latestCardSnapshots(events: readonly SessionEvent[]): Map<string, { record: TuiCardRecord; seq: number }> {
  const snapshots = new Map<string, { record: TuiCardRecord; seq: number }>()
  for (const event of events) {
    const pluginRecord = pluginRecordOf(event)
    if (pluginRecord === undefined || pluginRecord.type !== TUI_CARD_RECORD_TYPE) continue
    const record = asTuiCardRecord(pluginRecord.data)
    if (record === undefined) continue
    const key = cardRowKey(record.type, record.id)
    const known = snapshots.get(key)
    if (known === undefined || pluginRecord.seq > known.seq) snapshots.set(key, { record, seq: pluginRecord.seq })
  }
  return snapshots
}

/** A fact card's saved body: the user/message text at the row's own seq. */
function messageBody(event: SessionEvent<'user/message'>): string {
  return event.data.content.map(block => block.type === 'text' ? block.text : '').join('')
}

function unfold(row: ChatRow): true {
  row.folded = false
  markChannelReadDirty(row)
  return true
}
