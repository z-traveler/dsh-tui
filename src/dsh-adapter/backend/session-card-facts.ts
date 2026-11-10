/**
 * Session fact cards and Custom Cards (downstream): decodes the DSH records
 * behind command, skill, context notice and Custom Card rows into neutral
 * events. Called from the DSH translator (`translate.ts`): every event asks
 * `customCardEvents` first, user messages ask `skillInvocationEvents` and
 * `contextNoticeEvents`, the command lifecycle goes through
 * `createCommandResults`.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { NO_EVENTS, type AgentEvent, type AgentEventOf } from '../../agent/events.js'
import { asTuiCardRecord, TUI_CARD_RECORD_TYPE } from '../../agent/cards.js'
import { skillInvocationName } from '../compat/messages.js'
import { pluginRecordOf } from '../compat/pluginRecords.js'

/**
 * A Custom Card snapshot: ONLY the dedicated carrier is decoded, so no other
 * plugin record silently becomes a card. An invalid snapshot is skipped (the
 * rest of the log is unaffected); every other plugin record still takes the
 * translator's generic renderer seam. Undefined: not a card record.
 */
export function customCardEvents(event: SessionEvent): readonly AgentEvent[] | undefined {
  const pluginRecord = pluginRecordOf(event)
  if (pluginRecord === undefined || pluginRecord.type !== TUI_CARD_RECORD_TYPE) return undefined
  const record = asTuiCardRecord(pluginRecord.data)
  return record === undefined
    ? NO_EVENTS
    : [{ type: 'card.upsert', record, seq: pluginRecord.seq, time: pluginRecord.time }]
}

/**
 * A user-explicit skill load: core records ONE durable source kind for both
 * gestures (`/name` and `#skill:name` are the same claim), and the message
 * body is the canonical rendered content the model received. The card shows
 * that saved text, so nothing here re-reads the skill file or re-scans the
 * user's line — and the generic injected message is replaced, never added.
 * Only an APPENDED injection is transcript material: a replacement copy
 * (`surfaceOp` replace) is model-only, and a pre-V4 record without the
 * marker is the legacy append. Undefined: not a skill load card.
 */
export function skillInvocationEvents(
  event: SessionEvent<'user/message'>,
  data: SessionEvent<'user/message'>['data'],
  textOf: (content: readonly ContentBlock[] | undefined) => string,
): readonly AgentEvent[] | undefined {
  const skillName = skillInvocationName(data.source)
  if (skillName === undefined) return undefined
  const surfaceOp = event.surfaceOp
  if (surfaceOp !== undefined && surfaceOp !== 'append') return undefined
  return [{ type: 'skill.invocation', seq: event.seq, time: event.time, name: skillName, body: textOf(data.content) }]
}

/**
 * The summary of a generic context notice — a producer-declared
 * `source.form: 'notice'` with a usable one-line account. The producer kind,
 * `name` and plugin-private `message` are deliberately not inspected: any
 * producer's notice gets the same transcript contract, while a malformed
 * notice (no summary) keeps the opaque injected fallback. Only the form and
 * summary decide, exactly as the shared vocabulary documents.
 */
const contextNoticeSummary = (source: unknown): string | undefined => {
  if (source === null || typeof source !== 'object') return undefined
  const { form, summary } = source as { form?: unknown; summary?: unknown }
  return form === 'notice' && typeof summary === 'string' && summary.trim() !== '' ? summary : undefined
}

/**
 * A generic context notice: the producer declared ONE of the shared context
 * forms (`notice`) plus its summary, so the card needs no plugin name and no
 * `name`/`message` extension. The neutral event keeps the durable message
 * identity, summary and complete body; only an appended (or legacy unmarked)
 * record is transcript material. A replacement copy is model-only, like every
 * other replaced surface node: it stays the opaque injected message built from
 * `base`. Undefined: not a context notice.
 */
export function contextNoticeEvents(
  event: SessionEvent<'user/message'>,
  data: SessionEvent<'user/message'>['data'],
  base: Omit<AgentEventOf<'user.message'>, 'type' | 'source' | 'text'>,
): readonly AgentEvent[] | undefined {
  const noticeSummary = contextNoticeSummary(data.source)
  if (noticeSummary === undefined) return undefined
  const surfaceOp = event.surfaceOp
  if (surfaceOp === undefined || surfaceOp === 'append') {
    return [{
      type: 'context.notice',
      id: data.id,
      seq: event.seq,
      time: event.time,
      source: data.source.kind,
      summary: noticeSummary,
      body: data.content.map(block => block.type === 'text' ? block.text : '').join(''),
    }]
  }
  return [{ type: 'user.message', ...base, source: 'injected', text: '' }]
}

/**
 * One durable command result: core pairs `command/run` with `command/done` by
 * `commandId`, and the done record carries the outcome while the run record
 * carries the name and input. Only the settled record is projected, so the
 * pairing lives here (the translator is the DSH-shaped seam) instead of
 * leaving a half-known card in the shared vocabulary.
 */
type OpenCommand = { readonly name: string; readonly args?: string }

/**
 * The command lifecycle pairing. The lifecycle is log-only; the public event
 * types are kept here so upstream payload changes fail compilation instead of
 * silently dropping a card. Only a paired, settled record has a name and
 * result to show.
 */
export function createCommandResults() {
  /**
   * Open command invocations by `commandId` until their `command/done` settles
   * them (a crash between the two leaves one small entry until the session
   * resets).
   */
  const openCommands = new Map<string, OpenCommand>()
  return {
    run(event: SessionEvent<'command/run'>): readonly AgentEvent[] {
      const data = event.data
      openCommands.set(data.commandId, { name: data.name, ...(data.args === undefined ? {} : { args: data.args }) })
      return NO_EVENTS
    },
    done(event: SessionEvent<'command/done'>): readonly AgentEvent[] {
      const data = event.data
      const run = openCommands.get(data.commandId)
      openCommands.delete(data.commandId)
      if (run === undefined) return NO_EVENTS
      return [{
        type: 'command.result',
        commandId: data.commandId,
        name: run.name,
        ...(run.args === undefined ? {} : { args: run.args }),
        outcome: data.kind,
        text: data.text ?? '',
        ...(data.sourceEventSeq === undefined ? {} : { coveredBySeq: data.sourceEventSeq }),
        seq: event.seq,
        time: event.time,
      }]
    },
    clear(): void {
      openCommands.clear()
    },
  }
}
