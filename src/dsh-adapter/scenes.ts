/** Provider-neutral full-screen scene registry for terminal front doors. */

import type React from 'react'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ChannelUi as Channel } from '../adapter/channel/ui-policy.js'
import { activationFiber, bindCallerEffect, compositionRoot, concreteService, requirePluginCaller } from './host-access.js'
import { componentIdentityOf } from './component-identity.js'
import type { TuiModalDescriptor, TuiModalHost, TuiModalOpenResult } from './modal-stack.js'
import type { TuiModalOptions } from '../modal-options.js'
import { TuiModalRegistry } from './modal-registry.js'
import {
  assertCapabilityShadowPolicy,
  type AdapterRuntimeOptions,
} from '../adapter/kernel/runtime.js'
import { adapterRuntimeFor } from '../adapter/kernel/runtime-context.js'

/**
 * Props every plugin scene receives. Both element creation and hooks must go
 * through the HOST's React, never the plugin's own copy:
 *
 * - Hooks: a component rendered by this TUI's reconciler but calling hooks
 *   imported from a second React copy (the plugin's own node_modules) dies
 *   with an invalid-hook-call on first render. Use the injected `React`.
 * - Elements: this app's reconciler (React 19) accepts only
 *   `Symbol.for('react.transitional.element')` elements. JSX compiled
 *   against a plugin-bundled older React emits `Symbol.for('react.element')`
 *   and throws on first render. Create elements with the injected `React`
 *   (`React.createElement`/`React.Fragment`), or compile JSX against the
 *   host runtime via tsconfig
 *   `"jsxImportSource": "@deepseek-harness-tui/dsh-tui"` (its `./jsx-runtime`
 *   subpath re-exports this app's own react/jsx-runtime). A plugin-owned
 *   React copy works ONLY if it is the same React 19 line — and its hooks
 *   remain off-limits regardless.
 */
export interface TuiSceneProps {
  /** The TUI's React instance — use THIS for every hook and element. */
  React: typeof React
  /** The TUI's ui kit (Box/Text/useInput/useTerminalSize/…). */
  ui: typeof import('../ui.js')
  /** Live session channel: rows, status, trace events, notifications. */
  channel: Channel
  /** Leave the scene and return to whatever screen was up before. */
  close(): void
}

export interface TuiSceneDescriptor {
  /** Unique scene id (kebab-case); the plugin's own commands open it by id. */
  id: string
  /** Optional human label for logs/debugging; the scene renders its own header. */
  title?: string
  component: React.ComponentType<TuiSceneProps>
}

/** Host-only scene controls used by the channel; omitted from the plugin export. */
export interface TuiSceneHost {
  readonly active: TuiSceneDescriptor | undefined
  /** Modal window stack on top of the conversation (host-only). */
  readonly modal: TuiModalHost
  register(descriptor: TuiSceneDescriptor): () => void
  list(): readonly TuiSceneDescriptor[]
  open(id: string): boolean
  close(): void
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiScenes: TuiSceneRuntime
  }
}

export const name = 'dsh-tui-scenes'

/**
 * Small host-only registry; command execution remains owned by dsh-commands.
 *
 * A plugin registers a scene once (`ctx.tuiScenes.register(...)`, keep the
 * dispose) and opens it from anywhere host-side — typically its own
 * dsh-commands handler: `ctx.tuiScenes.open('my-scene')` plus a silent
 * `success` result, so the conversation stays untouched while the scene
 * takes the whole terminal the way the trajectory scene does.
 *
 * `registerModal`/`openModal` stack windows on top of the conversation
 * instead (see `./modal-registry.ts`).
 */
export class TuiSceneRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tuiScenes')
    compositionRoot(ctx)
    const runtime = this
    const state: SceneState = {
      scenes: new Map(),
      owners: new Map(),
      modals: new TuiModalRegistry(),
      listeners: new Set(),
      current: undefined,
      host: undefined,
      logger: ctx.logger,
      runtime: adapterRuntimeFor(ctx),
    }
    // Disposing this row takes every open window with it: no instance may
    // outlive the scope that created it.
    ctx.effect(() => () => { state.modals.closeAll() })
    state.host = Object.freeze({
      get active() {
        return sceneStateFor(runtime).current
      },
      modal: state.modals.host,
      register(descriptor: TuiSceneDescriptor) {
        const state = sceneStateFor(runtime)
        const id = descriptor.id.trim().toLowerCase()
        if (!/^[a-z][a-z0-9_-]*$/u.test(id)) throw new TypeError(`invalid TUI scene id: ${descriptor.id}`)
        if (state.scenes.has(id)) throw new Error(`TUI scene "${id}" is already registered`)
        const normalized = Object.freeze({ ...descriptor, id })
        state.scenes.set(id, normalized)
        return () => {
          if (state.scenes.get(id) !== normalized) return
          state.scenes.delete(id)
          state.owners.delete(id)
          if (state.current === normalized) {
            state.current = undefined
            notifyScenes(state)
          }
        }
      },
      list() {
        return [...sceneStateFor(runtime).scenes.values()]
      },
      open(id: string) {
        return openScene(runtime, id)
      },
      close() {
        closeScene(runtime)
      },
      subscribe(listener: () => void) {
        return subscribeScenes(runtime, listener)
      },
    })
    sceneStates.set(this, state)
  }

  /**
   * Register a full-screen scene; returns the dispose function (caller
   * scopes it with `ctx.effect`). The optional trailing `identity` (the
   * plugin's own ctx) only feeds the effect ledger's pluginId — omitting it
   * records `undeclared` (C-060).
   */
  register(descriptor: TuiSceneDescriptor, identity?: Context): () => void {
    assertCapabilityShadowPolicy('host.scenes.register', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    const state = sceneStateFor(this)
    const caller = requirePluginCaller(this.ctx, 'tuiScenes.register', this)
    const activationOwner = activationFiber(caller)
    if (activationOwner === undefined) throw new Error('dsh-tui: tuiScenes.register requires a live activation')
    const callerIdentity = componentIdentityOf(caller)
    const suppliedIdentity = identity === undefined ? callerIdentity : componentIdentityOf(identity)
    if (identity !== undefined && callerIdentity !== undefined && suppliedIdentity !== callerIdentity) {
      throw new Error('dsh-tui: tuiScenes.register identity belongs to another activation')
    }
    const id = descriptor.id.trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]*$/u.test(id)) throw new TypeError(`invalid TUI scene id: ${descriptor.id}`)
    if (state.scenes.has(id)) {
      caller.get('tuiEffectLedger')?.record(
        {
          operation: 'create',
          resource: { kind: 'scene', id },
          result: 'failed',
          errorCode: 'DUPLICATE_CONTRIBUTION_ID',
        },
        identity,
      )
      throw new Error(`TUI scene "${id}" is already registered`)
    }
    const normalized = Object.freeze({ ...descriptor, id })
    state.scenes.set(id, normalized)
    state.owners.set(id, activationOwner)
    caller.get('tuiEffectLedger')?.record(
      { operation: 'create', resource: { kind: 'scene', id }, result: 'applied' },
      identity,
    )
    const dispose = () => {
      if (state.scenes.get(id) !== normalized) return
      state.scenes.delete(id)
      state.owners.delete(id)
      caller.get('tuiEffectLedger')?.record(
        { operation: 'release', resource: { kind: 'scene', id }, result: 'applied' },
        identity,
      )
      // Disposing the open scene must not strand the user on a dead screen.
      if (state.current === normalized) {
        state.current = undefined
        notifyScenes(state, activationOwner)
      }
    }
    bindCallerEffect(caller, dispose)
    return dispose
  }

  /**
   * Swap the conversation for the named scene. Returns false (and warns)
   * when no plugin registered that id — a mistyped id must fail visibly in
   * the log, not silently do nothing in the UI.
   */
  open(id: string): boolean {
    assertCapabilityShadowPolicy('host.scenes.open', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiScenes.open', this)
    const owner = activationFiber(caller)
    return owner === undefined ? false : openScene(this, id, caller, owner)
  }

  close(): void {
    assertCapabilityShadowPolicy('host.scenes.close', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiScenes.close', this)
    const owner = activationFiber(caller)
    if (owner !== undefined) closeScene(this, caller, owner)
  }

  /** The scene currently replacing the conversation, if any. */
  get active(): TuiSceneDescriptor | undefined {
    assertCapabilityShadowPolicy('host.scenes.active', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiScenes.active', this)
    const owner = activationFiber(caller)
    const state = sceneStateFor(this)
    return owner !== undefined && state.current !== undefined && state.owners.get(state.current.id) === owner
      ? state.current
      : undefined
  }

  /** Register a modal window type; returns the dispose function (caller
   *  scopes it with `ctx.effect`). See `./modal-registry.ts`. */
  registerModal(descriptor: TuiModalDescriptor, identity?: Context): () => void {
    assertCapabilityShadowPolicy('host.scenes.register', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    return sceneStateFor(this).modals.register(this.ctx, this, descriptor, identity)
  }

  /** Open one modal window instance of the named registration; `options`
   *  override the descriptor's own for this instance only. */
  openModal(id: string, options?: TuiModalOptions): Promise<TuiModalOpenResult> {
    assertCapabilityShadowPolicy('host.scenes.open', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    return sceneStateFor(this).modals.open(this.ctx, this, id, options)
  }

  /**
   * Capability marker for the modal options surface: `1` means descriptor
   * options, per-open overrides, `updateOptions`/`setHidden`/`focus`/`getBounds`
   * on the handle, and the host's visibility/bounds/focus projection are all
   * present. An older host has no such member (and drops the second
   * `openModal` argument on the floor), so a plugin that wants custom geometry
   * must check this before opening.
   */
  get modalOptionsVersion(): 1 {
    assertCapabilityShadowPolicy('host.scenes.active', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    return 1
  }

  /** UI-side change feed: fired after every open/close/dispose transition. */
  subscribe(listener: () => void): () => void {
    assertCapabilityShadowPolicy('host.scenes.subscribe', sceneStateFor(this).runtime.mode, sceneStateFor(this).runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiScenes.subscribe', this)
    const owner = activationFiber(caller)
    if (owner === undefined) return () => {}
    const dispose = subscribeScenes(this, listener, owner)
    bindCallerEffect(caller, dispose)
    return dispose
  }

}

interface SceneState {
  readonly runtime: AdapterRuntimeOptions
  readonly scenes: Map<string, TuiSceneDescriptor>
  readonly owners: Map<string, object>
  readonly modals: TuiModalRegistry
  readonly listeners: Set<{ owner: object | undefined; listener: () => void }>
  current: TuiSceneDescriptor | undefined
  host: TuiSceneHost | undefined
  readonly logger: Context['logger']
}

const sceneStates = new WeakMap<TuiSceneRuntime, SceneState>()

function sceneStateFor(runtime: TuiSceneRuntime): SceneState {
  const state = sceneStates.get(concreteService(runtime))
  if (state === undefined) throw new Error('tuiScenes host state is unavailable')
  return state
}

function openScene(runtime: TuiSceneRuntime, id: string, caller?: Context, owner?: object): boolean {
  const state = sceneStateFor(runtime)
  const scene = state.scenes.get(id.trim().toLowerCase())
  if (scene === undefined) {
    ;(caller?.logger ?? state.logger).warn(`dsh-tui: no TUI scene registered as "${id}"`)
    return false
  }
  if (owner !== undefined && state.owners.get(scene.id) !== owner) {
    caller?.logger.warn(`dsh-tui: scene "${scene.id}" belongs to another activation`)
    return false
  }
  if (scene === state.current) return true
  const previousOwner = state.current === undefined ? undefined : state.owners.get(state.current.id)
  state.current = scene
  notifyScenes(state, previousOwner)
  return true
}

function closeScene(runtime: TuiSceneRuntime, caller?: Context, owner?: object): void {
  const state = sceneStateFor(runtime)
  if (state.current === undefined) return
  if (owner !== undefined && state.owners.get(state.current.id) !== owner) {
    caller?.logger.warn(`dsh-tui: scene "${state.current.id}" belongs to another activation`)
    return
  }
  const previousOwner = state.owners.get(state.current.id)
  state.current = undefined
  notifyScenes(state, previousOwner)
}

function subscribeScenes(runtime: TuiSceneRuntime, listener: () => void, owner?: object): () => void {
  const state = sceneStateFor(runtime)
  const entry = { owner, listener }
  state.listeners.add(entry)
  return () => {
    state.listeners.delete(entry)
  }
}

function notifyScenes(state: SceneState, previousOwner?: object): void {
  const currentOwner = state.current === undefined ? undefined : state.owners.get(state.current.id)
  for (const entry of state.listeners) {
    if (entry.owner !== undefined && entry.owner !== currentOwner && entry.owner !== previousOwner) continue
    entry.listener()
  }
}

export function getHostSceneRuntime(runtime: TuiSceneRuntime | undefined): TuiSceneHost | undefined {
  if (runtime === undefined) return undefined
  try {
    return sceneStateFor(runtime).host ?? undefined
  } catch {
    return undefined
  }
}

export default TuiSceneRuntime
