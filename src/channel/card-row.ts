/**
 * Shared Custom Card row mechanics: how one presented snapshot lands on a
 * transcript row, how the window fold releases it, and the identity that makes
 * an update replace a card in place. The projector (live/replay), the DSH log
 * restore and the backend-neutral transcript restore all go through here, so a
 * card row means the same thing on every path.
 *
 * A card row keeps its business `(type, id)` identity plus the committed `seq` of
 * the applied snapshot, a readable `text` form of the current view
 * (`cardPlainText`) for search and for the folded preview, and the presentation
 * density (see `cardRowDensity`). The full presentation itself is disposable: the
 * durable log holds the snapshots, and `loadOlder` re-presents the latest one
 * with the host's current presenters.
 */
import type { CardRow, ChatRow } from '../adapter/ports/channel-view.js'
import type { AgentEvent, AgentEventOf } from '../agent/events.js'
import { cardPlainText, fallbackCardView, type TuiCardDensity, type TuiCardRecord, type TuiCardView } from '../agent/cards.js'
import { preview } from './transcript.js'

/** Card preview budget while the window folded the row (terminal cells). */
const CARD_FOLD_PREVIEW_CELLS = 200

/** The business identity a snapshot belongs to; the null byte cannot appear in
 *  either half (both come from the record's own validation), so distinct pairs
 *  never collide. */
export function cardRowKey(type: string, id: string): string {
  return `${type}\u0000${id}`
}

/**
 * The snapshot a settled command offers the `command/<name>` card seam: the
 * command's own facts plus its complete result text as the body. The identity
 * is the command's pairing id, and `data` follows the presenter contract
 * (`name`/`args?`/`outcome`/`text`), never a bare result string.
 */
export function commandCardRecord(command: {
  readonly commandId: string
  readonly name: string
  readonly args?: string | undefined
  readonly outcome: 'success' | 'error'
  readonly text: string
}): TuiCardRecord {
  return {
    version: 1,
    type: `command/${command.name}`,
    id: command.commandId,
    data: {
      commandId: command.commandId,
      name: command.name,
      ...(command.args === undefined || command.args === '' ? {} : { args: command.args }),
      outcome: command.outcome,
      text: command.text,
    },
    fallback: { title: `/${command.name}`, body: command.text },
  }
}

/** Present one snapshot through the host registry, degrading to the record's
 *  own safe text when no presenter answers. */
export function presentCardView(
  record: TuiCardRecord,
  present: ((record: TuiCardRecord) => TuiCardView | undefined) | undefined,
): TuiCardView {
  return present?.(record) ?? fallbackCardView(record)
}

/** Write one presented snapshot onto its row: the row now shows this view in
 *  full (an expansion reads the whole body). */
export function writeCardSnapshot(row: ChatRow, view: TuiCardView, identity: { type: string; id: string; latestSeq: number }): void {
  row.card = { type: identity.type, id: identity.id, latestSeq: identity.latestSeq, view }
  row.text = cardPlainText(view)
}

/**
 * The density a card row currently draws with: the full view's own field, or the
 * one kept on the row while the window folded the view away. Presentation only —
 * the row's business identity is `(type, id)` and its ordering fence `latestSeq`.
 */
export function cardRowDensity(card: CardRow | undefined): TuiCardDensity | undefined {
  if (card === undefined) return undefined
  return card.view === undefined ? card.density : card.view.density
}

/** Apply a snapshot to a row the window already folded: identity and a bounded
 *  preview advance, the full view is NOT kept (it comes back from the log). The
 *  density is kept so the folded preview draws in the snapshot's own face. */
export function foldCardSnapshot(row: ChatRow, view: TuiCardView, identity: { type: string; id: string; latestSeq: number }): void {
  row.card = {
    type: identity.type,
    id: identity.id,
    latestSeq: identity.latestSeq,
    ...(view.density === undefined ? {} : { density: view.density }),
  }
  row.text = preview(cardPlainText(view), CARD_FOLD_PREVIEW_CELLS)
}

/** Release a row's full presentation when the window folds it: identity, the
 *  presentation density and a bounded preview stay, so the same row is restored
 *  from the log later without changing face while it waits. */
export function releaseCardSnapshot(row: ChatRow): void {
  const card = row.card
  if (card === undefined) return
  const density = cardRowDensity(card)
  row.card = {
    type: card.type,
    id: card.id,
    latestSeq: card.latestSeq,
    ...(density === undefined ? {} : { density }),
  }
}

/** The latest snapshot of every card identity in a durable record (content
 *  updates replace) — the neutral transcript restore's card index. */
export function latestCardUpserts(record: readonly AgentEvent[]): Map<string, AgentEventOf<'card.upsert'>> {
  const cards = new Map<string, AgentEventOf<'card.upsert'>>()
  for (const event of record) {
    if (event.type !== 'card.upsert') continue
    const key = cardRowKey(event.record.type, event.record.id)
    const known = cards.get(key)
    if (known === undefined || event.seq > known.seq) cards.set(key, event)
  }
  return cards
}

/** Restore one folded card row from the record's latest snapshot of its
 *  identity (`restoreFoldedRows`); returns whether the row was restored. */
export function restoreCardRow(
  row: ChatRow,
  cards: ReadonlyMap<string, AgentEventOf<'card.upsert'>>,
  present: ((record: TuiCardRecord) => TuiCardView | undefined) | undefined,
): boolean {
  if (row.card === undefined) return false
  const snapshot = cards.get(cardRowKey(row.card.type, row.card.id))
  if (snapshot === undefined) return false
  // A record read can be older than a snapshot this row already accepted
  // (a lagging durable read, an in-flight one). Restoring it would show
  // old content as if it were the complete current card, so the row keeps
  // its folded preview and latest-seq fence until a record that knows the
  // newer snapshot arrives.
  if (snapshot.seq < row.card.latestSeq) return false
  writeCardSnapshot(row, presentCardView(snapshot.record, present), {
    type: row.card.type,
    id: row.card.id,
    latestSeq: snapshot.seq,
  })
  return true
}

/** The older history rows to prepend (`prependHistoryRows`): a card identity
 *  already on screen owns the LATEST snapshot, so an older page re-offering the
 *  same card (its earlier content) must not add a second one. */
export function withoutShownCards(rows: readonly ChatRow[], older: readonly ChatRow[]): readonly ChatRow[] {
  const shown = new Set<string>()
  for (const row of rows) if (row.card !== undefined) shown.add(cardRowKey(row.card.type, row.card.id))
  return older.filter(row => row.card === undefined || !shown.has(cardRowKey(row.card.type, row.card.id)))
}
