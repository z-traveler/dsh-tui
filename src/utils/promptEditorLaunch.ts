/**
 * Prompt-editor launch hook (downstream Omni integration seam), consulted by
 * `editInExternalEditor` in `externalEditor.ts`.
 *
 * An optional preparation hook may extend a single launch (extra argv for a
 * reusable editor runtime, child-only environment) and own a cleanup for it.
 * The hook never replaces the resolution, the temp file, the terminal handoff
 * or the read-back, and an absent hook leaves the launch exactly as it was.
 */

import { logForDebugging } from './debug.js'

/** The session the draft belongs to, its file, and the resolved editor argv.
 * No cwd: the provider reads any needed session facts from their owner.
 */
export interface PromptEditorPrepareContext {
  readonly sessionId: string
  readonly file: string
  readonly argv: readonly string[]
}

/**
 * A hook's extension of ONE launch. `argv` is the command line to spawn
 * instead of the resolved one (usually a copy with loader arguments added);
 * `env` is merged over the inherited environment for this child only, so
 * `$EDITOR` and `process.env` stay untouched for the rest of the process;
 * `dispose` runs once, after the child exited or the launch failed and before
 * the terminal is restored; it may be async and is always awaited.
 */
export interface PromptEditorLaunch {
  readonly argv: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  dispose?(): void | Promise<void>
}

/**
 * Host hook for one launch (see `dsh-adapter/integration.ts`). `undefined`
 * means no opinion and the plain launch runs; a throw or a rejection is
 * contained the same way, so a broken hook can never cost the user the editor.
 */
export type PromptEditorPrepare = (
  context: PromptEditorPrepareContext,
) => PromptEditorLaunch | undefined | Promise<PromptEditorLaunch | undefined>

/** Session facts plus the optional hook a host mount passes to
 *  `editInExternalEditor`. */
export interface PromptEditorLaunchOptions {
  readonly sessionId: string
  readonly prepare?: PromptEditorPrepare
}

/** One launch as it will be spawned: the hook's argv/env (or the plain ones)
 *  and the hook's cleanup. */
export interface PreparedPromptEditorLaunch {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>> | undefined
  /** Release the hook's cleanup exactly once: right after the child exits, or
   *  in the caller's finally when the launch never got that far — in both
   *  cases before the terminal restore, so a hook that owns a temp file or a
   *  lock for the child can let go of it first. Never rejects. */
  release(): Promise<void>
}

/**
 * Run the host's preparation hook for one launch of `argv` (the resolved
 * editor command with the draft `file` as its last element). The hook runs
 * before the handover: it may need to prepare state the child reads on start
 * (a history cache, a loader file), and doing that while the screen still
 * renders asks nothing of the terminal.
 */
export async function preparePromptEditorLaunch(
  options: PromptEditorLaunchOptions | undefined,
  file: string,
  argv: readonly string[],
): Promise<PreparedPromptEditorLaunch> {
  const prepared = await prepareLaunch(options?.prepare, {
    sessionId: options?.sessionId ?? '',
    file,
    argv,
  })
  let releaseLaunch = prepared?.dispose
  return {
    argv: prepared?.argv ?? argv,
    env: prepared?.env,
    async release(): Promise<void> {
      const dispose = releaseLaunch
      releaseLaunch = undefined
      if (dispose === undefined) return
      try {
        await dispose()
      } catch {
        // A stuck cleanup is invisible; a rejection on top of a valid outcome
        // is strictly worse.
      }
    },
  }
}

/** Run the host's preparation hook; every failure is contained as "no
 *  opinion" so the plain launch still happens. */
async function prepareLaunch(
  prepare: PromptEditorPrepare | undefined,
  context: PromptEditorPrepareContext,
): Promise<PromptEditorLaunch | undefined> {
  if (prepare === undefined) return undefined
  try {
    return (await prepare(context)) ?? undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`editor launch hook failed (${message}); launching the editor unchanged`)
    return undefined
  }
}
