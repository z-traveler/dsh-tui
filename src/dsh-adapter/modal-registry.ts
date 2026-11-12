/**
 * Plugin modal registrations (downstream plugin-modals feature): the Cordis
 * half of `tuiScenes.registerModal` / `openModal` — activation ownership,
 * effect-ledger records and the host-only `TuiSceneHost.modal` facade — owned
 * by `TuiSceneRuntime` in `scenes.ts`. The window stack itself lives in
 * `modal-stack.ts`.
 *
 * `registerModal`/`openModal` are the stacked counterpart of full-screen
 * scenes: the conversation stays mounted underneath, every open is an
 * independent instance, and the result only reports `opened` once the host
 * acknowledged that the window is mounted. Their presence — not a config flag
 * — is what a plugin detects: an older host has no `registerModal`, so
 * nothing can silently degrade into a full-screen scene.
 *
 * Custom geometry and appearance are a second, later capability. A plugin that
 * passes options must check `tuiScenes.modalOptionsVersion` first: a host
 * without it ignores the second `openModal` argument, so the check is the
 * difference between a window that looks as declared and one that silently
 * falls back to the round-1 default.
 */

import type { Context } from '@deepseek-ai/cordis'
import { normalizeModalOptions, type TuiModalBounds, type TuiModalOptions } from '../modal-options.js'
import { activationFiber, bindCallerEffect, requirePluginCaller } from './host-access.js'
import { componentIdentityOf } from './component-identity.js'
import {
  modalRejected,
  TuiModalStack,
  type TuiModalAdmission,
  type TuiModalDescriptor,
  type TuiModalHost,
  type TuiModalInstance,
  type TuiModalOpenResult,
} from './modal-stack.js'

export class TuiModalRegistry {
  private readonly modals = new Map<string, TuiModalDescriptor>()
  private readonly owners = new Map<string, object>()
  private readonly modalStack = new TuiModalStack()
  /** Host-only controls exposed as `TuiSceneHost.modal`. */
  readonly host: TuiModalHost

  constructor() {
    const modalStack = this.modalStack
    this.host = Object.freeze({
      stack: () => modalStack.stack(),
      subscribe: (listener: () => void) => modalStack.subscribe(listener),
      setAdmission: (gate: TuiModalAdmission | undefined) => modalStack.setAdmission(gate),
      focused: () => modalStack.focused(),
      setVisibility: (instance: TuiModalInstance, visible: boolean) => { modalStack.setVisibility(instance, visible) },
      setBounds: (instance: TuiModalInstance, bounds: TuiModalBounds | undefined) => { modalStack.setBounds(instance, bounds) },
      acknowledge: (instance: TuiModalInstance) => { modalStack.acknowledge(instance) },
      fail: (instance: TuiModalInstance, error: unknown) => { modalStack.fail(instance, error) },
      closeAll: () => { modalStack.closeAll() },
    })
  }

  /** Close every open window (the scenes row's own disposal). */
  closeAll(): void {
    this.modalStack.closeAll()
  }

  /**
   * `tuiScenes.registerModal` for the scenes service `service` whose own
   * context is `context`. Registration owns no window: each open creates its
   * own instance, so the same type may be open several times. Disposing the
   * registration closes the windows still open from it, and never touches
   * another registration's windows.
   */
  register(context: Context, service: object, descriptor: TuiModalDescriptor, identity?: Context): () => void {
    const caller = requirePluginCaller(context, 'tuiScenes.registerModal', service)
    const activationOwner = activationFiber(caller)
    if (activationOwner === undefined) throw new Error('dsh-tui: tuiScenes.registerModal requires a live activation')
    // An explicit `identity` (the plugin's own ctx) is admitted only when it
    // names the calling activation, so a caller cannot file a modal under
    // another plugin.
    const callerIdentity = componentIdentityOf(caller)
    const suppliedIdentity = identity === undefined ? callerIdentity : componentIdentityOf(identity)
    if (identity !== undefined && callerIdentity !== undefined && suppliedIdentity !== callerIdentity) {
      throw new Error('dsh-tui: tuiScenes.registerModal identity belongs to another activation')
    }
    const id = descriptor.id.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]*$/u.test(id)) throw new TypeError(`invalid TUI modal id: ${descriptor.id}`)
    if (this.modals.has(id)) {
      caller.get('tuiEffectLedger')?.record(
        {
          operation: 'create',
          resource: { kind: 'modal', id },
          result: 'failed',
          errorCode: 'DUPLICATE_CONTRIBUTION_ID',
        },
        identity,
      )
      throw new Error(`TUI modal "${id}" is already registered`)
    }
    const normalized: TuiModalDescriptor = Object.freeze({
      ...descriptor,
      id,
      // Type defaults are validated once, at registration: a malformed option
      // must fail where it was declared, not on the first open.
      ...(descriptor.options === undefined
        ? {}
        : { options: normalizeModalOptions(descriptor.options, `modal "${id}"`) }),
    })
    this.modals.set(id, normalized)
    this.owners.set(id, activationOwner)
    caller.get('tuiEffectLedger')?.record(
      { operation: 'create', resource: { kind: 'modal', id }, result: 'applied' },
      identity,
    )
    const dispose = () => {
      if (this.modals.get(id) !== normalized) return
      this.modals.delete(id)
      this.owners.delete(id)
      this.modalStack.closeRegistration(normalized)
      caller.get('tuiEffectLedger')?.record(
        { operation: 'release', resource: { kind: 'modal', id }, result: 'applied' },
        identity,
      )
    }
    bindCallerEffect(caller, dispose)
    return dispose
  }

  /**
   * `tuiScenes.openModal`: open one window instance of the named registration.
   * The returned promise distinguishes what actually happened: `opened` only
   * after the host acknowledged the mount, `rejected` when the request can
   * never be shown (unknown id, another activation's modal, no host consumer,
   * host gate refusal), `failed` when an admitted window was closed or crashed
   * before that acknowledgement. Once `opened` settles the result is final: a
   * later close or crash only aborts the instance signal. A dead activation
   * throws synchronously here instead of receiving a result, like every other
   * plugin-owned effect.
   *
   * `options` overrides the descriptor's own options for this instance only;
   * a malformed option object is a TypeError. The host gate sees the merged
   * result and is the one place that can refuse a window its current frame
   * cannot show.
   */
  open(context: Context, service: object, id: string, options?: TuiModalOptions): Promise<TuiModalOpenResult> {
    const caller = requirePluginCaller(context, 'tuiScenes.openModal', service)
    const owner = activationFiber(caller)
    const normalized = id.trim().toLowerCase()
    const descriptor = this.modals.get(normalized)
    if (descriptor === undefined) {
      caller.logger.warn(`dsh-tui: no TUI modal registered as "${id}"`)
      return Promise.resolve(modalRejected('not-registered', `no TUI modal registered as "${id}"`))
    }
    if (owner !== undefined && this.owners.get(normalized) !== owner) {
      caller.logger.warn(`dsh-tui: modal "${normalized}" belongs to another activation`)
      return Promise.resolve(modalRejected('foreign-owner', `modal "${normalized}" belongs to another activation`))
    }
    return this.modalStack.open(descriptor, options)
  }
}
