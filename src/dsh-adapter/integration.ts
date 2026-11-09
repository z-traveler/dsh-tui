/** Downstream host bridge for foreground followers and one Ctrl+G provider.
 * Session data and editor-specific behavior belong to the consuming plugin.
 * The TUI retains editor choice, terminal handoff, draft read-back and adoption.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { assertCapabilityShadowPolicy, type AdapterRuntimeOptions } from '../adapter/kernel/runtime.js'
import { adapterRuntimeFor } from '../adapter/kernel/runtime-context.js'
import { bindCallerEffect, compositionRoot, concreteService, requirePluginCaller } from './host-access.js'
import type { PromptEditorLaunch, PromptEditorPrepare, PromptEditorPrepareContext } from '../utils/promptEditorLaunch.js'

export type { PromptEditorLaunch, PromptEditorPrepare, PromptEditorPrepareContext } from '../utils/promptEditorLaunch.js'

export interface TuiForegroundBinding {
  readonly sessionId: string
  /** Live working directory, not the project's original directory. */
  readonly cwd: string
}

/** Host-only controls, deliberately absent from the plugin-facing exports. */
export interface TuiIntegrationHost {
  publishForeground(binding: TuiForegroundBinding | undefined): void
  prepareEditor(context: PromptEditorPrepareContext): Promise<PromptEditorLaunch | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiIntegration: TuiIntegrationRuntime
  }
}

interface IntegrationState {
  readonly runtime: AdapterRuntimeOptions
  readonly listeners: Map<object, () => void>
  readonly host: TuiIntegrationHost
  foreground: TuiForegroundBinding | undefined
  editor?: { readonly prepare: PromptEditorPrepare }
}

const hostIntegrations = new WeakMap<TuiIntegrationRuntime, IntegrationState>()
const NOOP = (): void => {}

function integrationStateFor(runtime: TuiIntegrationRuntime): IntegrationState {
  const state = hostIntegrations.get(concreteService(runtime))
  if (state === undefined) throw new Error('tuiIntegration host state is unavailable')
  return state
}

function warn(ctx: Context, message: string, detail?: unknown): void {
  try {
    if (detail === undefined) ctx.logger.warn(`dsh-tui: ${message}`)
    else ctx.logger.warn(`dsh-tui: ${message}: %o`, detail)
  } catch {
    // Logging must not break the editor or a foreground switch.
  }
}

function publishForeground(ctx: Context, state: IntegrationState, next: TuiForegroundBinding | undefined): void {
  const previous = state.foreground
  if (previous === next || (previous !== undefined && next !== undefined
    && previous.sessionId === next.sessionId && previous.cwd === next.cwd)) return
  state.foreground = next
  for (const listener of [...state.listeners.values()]) {
    try { listener() } catch (error) { warn(ctx, 'tuiIntegration.onChange listener failed', error) }
  }
}

async function prepareEditor(ctx: Context, state: IntegrationState, context: PromptEditorPrepareContext): Promise<PromptEditorLaunch | undefined> {
  try {
    return await state.editor?.prepare(context)
  } catch (error) {
    warn(ctx, 'tuiIntegration editor provider failed; launching the editor unchanged', error)
    return undefined
  }
}

export class TuiIntegrationRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tuiIntegration')
    compositionRoot(ctx)
    const state: IntegrationState = {
      runtime: adapterRuntimeFor(ctx),
      listeners: new Map(),
      foreground: undefined,
      host: Object.freeze({
        publishForeground: (binding: TuiForegroundBinding | undefined) => publishForeground(this.ctx, state, binding),
        prepareEditor: (context: PromptEditorPrepareContext) => prepareEditor(this.ctx, state, context),
      }),
    }
    hostIntegrations.set(this, state)
  }

  /** Current binding, including for a plugin attaching after the initial bind. */
  getForeground(): TuiForegroundBinding | undefined {
    return integrationStateFor(this).foreground
  }

  /** Notify once if already bound, then on changes and release. Read the
   * current value through getForeground(); no previous-state contract.
   * Registration belongs to the calling plugin activation.
   */
  onChange(listener: () => void): () => void {
    const state = integrationStateFor(this)
    assertCapabilityShadowPolicy('host.integration.subscribe', state.runtime.mode, state.runtime.slices)
    if (typeof listener !== 'function') return NOOP
    let caller: Context
    try { caller = requirePluginCaller(this.ctx, 'tuiIntegration.onChange', this) } catch {
      warn(this.ctx, 'tuiIntegration.onChange requires a live non-root plugin activation')
      return NOOP
    }
    const token = {}
    state.listeners.set(token, listener)
    const dispose = (): void => { state.listeners.delete(token) }
    bindCallerEffect(caller, dispose)
    if (state.foreground !== undefined) {
      try { listener() } catch (error) { warn(this.ctx, 'tuiIntegration.onChange listener failed', error) }
    }
    return dispose
  }

  /** One editor provider per composition. A second registration is refused
   * rather than creating an ordered provider chain. Decline or failure uses
   * the ordinary editor launch; unloading the owner releases its slot.
   */
  registerEditor(prepare: PromptEditorPrepare): () => void {
    const state = integrationStateFor(this)
    assertCapabilityShadowPolicy('host.integration.register-editor', state.runtime.mode, state.runtime.slices)
    if (typeof prepare !== 'function') return NOOP
    let caller: Context
    try { caller = requirePluginCaller(this.ctx, 'tuiIntegration.registerEditor', this) } catch {
      warn(this.ctx, 'tuiIntegration.registerEditor requires a live non-root plugin activation')
      return NOOP
    }
    if (state.editor !== undefined) {
      warn(this.ctx, 'tuiIntegration already has an editor provider')
      return NOOP
    }
    const registration = { prepare }
    state.editor = registration
    const dispose = (): void => { if (state.editor === registration) state.editor = undefined }
    bindCallerEffect(caller, dispose)
    return dispose
  }
}

export function getHostIntegration(runtime: TuiIntegrationRuntime | undefined): TuiIntegrationHost | undefined {
  if (runtime === undefined) return undefined
  try { return hostIntegrations.get(concreteService(runtime))?.host } catch { return undefined }
}

export default TuiIntegrationRuntime
