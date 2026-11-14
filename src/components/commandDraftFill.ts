/**
 * The composer's intent for one settled command line.
 *
 * A local command normally settles as "consume the line or keep it". A
 * command with a registered command-draft mapper (`ctx.tuiInput`) settles
 * with a draft instead: the composer consumes the line it submitted and
 * fills the mapped text in the same atomic step — an editable draft, never a
 * submit, a queue or a model request.
 *
 * This translation stays outside both `Chat` and `PromptInput`: Chat passes
 * the settled outcome through, the prompt owns the write.
 */
import type { ExternalCommandOutcome } from '../dsh-adapter/channel.js'

/** Replace the command line just consumed with `draftText`. */
export interface CommandDraftFill {
  readonly consumeDraft: true
  readonly draftText: string
}

/** What one dispatch answers: sync `true`/`false` keep their meaning. */
export type CommandRunResult = boolean | CommandDraftFill

/** The fill intent only when the settled outcome carries a draft. */
export function commandDraftFillOf(outcome: ExternalCommandOutcome): CommandRunResult {
  if (outcome.kind === 'success' && outcome.draftText !== undefined) {
    return { consumeDraft: true, draftText: outcome.draftText }
  }
  return outcome.consumeDraft
}
