/**
 * Session fact cards (downstream): pairs the DSH command lifecycle records
 * behind command cards into neutral events. Called from the DSH translator
 * (`translate.ts`), whose `command/run` / `command/done` cases go through
 * `createCommandResults`.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { NO_EVENTS, type AgentEvent } from '../../agent/events.js'

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
