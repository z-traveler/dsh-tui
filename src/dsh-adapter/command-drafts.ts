/**
 * Generic command-draft seam: a plugin maps one settled LOCAL command result
 * to a replacement draft in the composer.
 *
 * Lifecycle and ownership:
 *
 * - `ctx.tuiInput.registerCommandDraft(name, mapper)` is bound to the calling
 *   Cordis activation (the same owner/effect rule as `tuiInputCompletions`):
 *   unloading the plugin drops its mapper, so a command that settles later can
 *   no longer fill anything.
 * - The public service exposes registration only. The live local invocation
 *   gets a host-only resolver (`resolveCommandDraft`); a mapper never receives
 *   a composer handle, a submit function or another command's surface.
 *
 * Contract:
 *
 * - The mapper is a synchronous pure function of the settled packet
 *   `{ name, args, outcome, text }` of the command dispatched in THIS process:
 *   `args` is the raw text after the command name exactly as typed (` copy`
 *   for `/demo copy`), `text` is the settled result text. It returns the draft
 *   text to place in the composer, or `undefined` to leave the draft alone.
 * - It runs only in the live local command completion
 *   (`createExternalCommandInvoker.invoke`) — never from a durable command
 *   card, a replayed transcript, a restored session or another client.
 * - Only a success outcome can carry the draft. A throwing mapper contributes
 *   nothing and never changes the command's own result.
 * - The host owns the write: the composer still decides whether the draft may
 *   be replaced (session lease, edit sequence, text and image checks) and
 *   never submits, queues or sends a model request on the mapper's behalf.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { activationFiber, bindCallerEffect, compositionRoot, concreteService, requirePluginCaller } from './host-access.js'
import { assertCapabilityShadowPolicy, type AdapterRuntimeOptions } from '../adapter/kernel/runtime.js'
import { adapterRuntimeFor } from '../adapter/kernel/runtime-context.js'

export const name = 'dsh-tui-command-drafts'

/** What one settled local command hands to a registered mapper. */
export interface TuiCommandDraftPacket {
  /** Command name as dispatched (`prompt copy` → `prompt`). */
  readonly name: string
  /** Raw argument text after the name, exactly as typed; absent when empty. */
  readonly args?: string
  /** Settled result kind of the local command. */
  readonly outcome: 'success' | 'error'
  /** Settled result text as the command returned it. */
  readonly text: string
}

/** Draft text to place in the composer, or `undefined` to leave it alone. */
export type TuiCommandDraftMapper = (packet: TuiCommandDraftPacket) => string | undefined

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiInput: TuiInputRuntime
  }
}

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

interface TuiInputState {
  readonly runtime: AdapterRuntimeOptions
  readonly mappers: Map<string, TuiCommandDraftMapper>
}

const tuiInputStates = new WeakMap<TuiInputRuntime, TuiInputState>()

/**
 * `ctx.tuiInput` — the plugin-facing command-draft registry. The first-party
 * `dsh-tui-extensions` row mounts it; a profile without that row has no
 * mapper, so every command keeps its plain settle-and-consume behavior.
 */
export class TuiInputRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tuiInput')
    compositionRoot(ctx)
    const state: TuiInputState = {
      runtime: adapterRuntimeFor(ctx),
      mappers: new Map(),
    }
    tuiInputStates.set(this, state)
    ctx.effect(() => () => { state.mappers.clear() })
  }

  /**
   * Register the mapper for one command name for the lifetime of the calling
   * activation. The returned disposer is also bound to that activation, so an
   * explicit `ctx.effect(() => ctx.tuiInput.registerCommandDraft(...))` and a
   * bare `registerCommandDraft()` both unload with the plugin.
   */
  registerCommandDraft(name: string, mapper: TuiCommandDraftMapper): () => void {
    const state = stateFor(this)
    assertCapabilityShadowPolicy('host.tui-input.register-command-draft', state.runtime.mode, state.runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiInput.registerCommandDraft', this)
    if (activationFiber(caller) === undefined) {
      throw new Error('dsh-tui: tuiInput.registerCommandDraft requires a live activation')
    }
    const command = typeof name === 'string' ? name.trim() : ''
    if (!COMMAND_NAME.test(command)) {
      throw new TypeError(`invalid command-draft command name: ${String(name)}`)
    }
    if (typeof mapper !== 'function') {
      throw new TypeError(`command-draft mapper for "/${command}" must be a function`)
    }
    if (state.mappers.has(command)) {
      throw new Error(`TUI command-draft mapper for "/${command}" is already registered`)
    }
    state.mappers.set(command, mapper)
    const dispose = (): void => {
      if (state.mappers.get(command) === mapper) state.mappers.delete(command)
    }
    bindCallerEffect(caller, dispose)
    return dispose
  }
}

function stateFor(runtime: TuiInputRuntime): TuiInputState {
  const state = tuiInputStates.get(concreteService(runtime))
  if (state === undefined) throw new Error('tuiInput host state is unavailable')
  return state
}

/**
 * The draft one settled local command maps to, for the live invocation only.
 * `undefined` means "no draft": no mounted service, no mapper for that name, or
 * a mapper that threw or declined — every case leaves the command's own
 * outcome untouched.
 */
export function resolveCommandDraft(
  runtime: TuiInputRuntime | undefined,
  packet: TuiCommandDraftPacket,
): string | undefined {
  if (runtime === undefined) return undefined
  let state: TuiInputState
  try {
    state = stateFor(runtime)
  } catch {
    return undefined
  }
  const mapper = state.mappers.get(packet.name)
  if (mapper === undefined) return undefined
  try {
    const draft = mapper(packet)
    return typeof draft === 'string' && draft !== '' ? draft : undefined
  } catch {
    // A mapper cannot break the command that produced its packet.
    return undefined
  }
}

export default TuiInputRuntime
