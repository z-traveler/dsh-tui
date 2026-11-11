import { Context, Service } from '@deepseek-ai/cordis'
import { activationFiber, bindCallerEffect, compositionRoot, concreteService, requirePluginCaller } from './host-access.js'
import type { ChannelState } from './channel/types.js'
import { onChannelOwnerDispose } from './channel/owner.js'

/** The session currently bound to the TUI, or undefined while none is ready. */
export interface TuiSessionSnapshot {
  readonly sessionId: string
  readonly backend?: string
}

/** An online session derivation; historical origins are not inferred. */
export interface TuiSessionDerived {
  readonly kind: 'fork' | 'rewind'
  readonly sourceSessionId: string
  readonly sessionId: string
}

type Listener<T> = (value: T) => void
interface SessionsState {
  snapshot: TuiSessionSnapshot | undefined
  owner?: object
  readonly listeners: Set<Listener<TuiSessionSnapshot | undefined>>
  readonly derived: Set<Listener<TuiSessionDerived>>
}
const roots = new WeakMap<object, SessionsState>()
const runtimes = new WeakMap<TuiSessionsRuntime, SessionsState>()
function stateFor(ctx: Context): SessionsState {
  const root = compositionRoot(ctx)
  let state = roots.get(root)
  if (state === undefined) {
    state = { snapshot: undefined, listeners: new Set(), derived: new Set() }
    roots.set(root, state)
  }
  return state
}
function runtimeState(runtime: TuiSessionsRuntime): SessionsState {
  const state = runtimes.get(concreteService(runtime))
  if (state === undefined) throw new Error('tuiSessions host state is unavailable')
  return state
}

/** Host-only: attach the real channel, including a late-settling startup. */
export function attachTuiSessionsChannel(ctx: Context, channel: Pick<ChannelState, 'ready' | 'sessionRef' | 'subscribe'>): () => void {
  const state = stateFor(ctx)
  const owner = {}
  state.owner = owner
  const update = (): void => {
    if (state.owner !== owner) return
    const ref = channel.sessionRef
    const next = channel.ready ? Object.freeze({ sessionId: ref.sessionId, backend: ref.backendId }) : undefined
    if (state.snapshot?.sessionId === next?.sessionId && state.snapshot?.backend === next?.backend) return
    state.snapshot = next
    for (const listener of [...state.listeners]) listener(next)
  }
  const off = channel.subscribe(update)
  update()
  return onChannelOwnerDispose(channel, () => {
    off()
    if (state.owner !== owner) return
    state.owner = undefined
    if (state.snapshot === undefined) return
    state.snapshot = undefined
    for (const listener of [...state.listeners]) listener(undefined)
  })
}

/** Host-only: publish an operation that actually produced a session. */
export function publishTuiSessionDerived(ctx: Context, event: TuiSessionDerived): void {
  const state = stateFor(ctx)
  const value = Object.freeze({ ...event })
  for (const listener of [...state.derived]) listener(value)
}

/** Host-only channel callback (`onSessionDerived`): publish each derivation;
 *  a failing listener is logged, never thrown into the fork/rewind action. */
export function tuiSessionDerivedNotifier(ctx: Context): (event: TuiSessionDerived) => void {
  return event => {
    try { publishTuiSessionDerived(ctx, event) } catch (error) {
      ctx.logger.warn('dsh-tui: session derivation notification failed: %o', error)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiSessions: TuiSessionsRuntime }
}

/** Read-only session binding and online derivation notifications. */
export class TuiSessionsRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tuiSessions')
    const state = stateFor(ctx)
    runtimes.set(this, state)
    const owned = new Set<() => void>()
    runtimeCleanups.set(this, owned)
    ctx.effect(() => () => { for (const dispose of [...owned]) dispose() })
  }

  current(): TuiSessionSnapshot | undefined {
    requirePluginCaller(this.ctx, 'tuiSessions.current', this)
    return runtimeState(this).snapshot
  }

  subscribe(listener: Listener<TuiSessionSnapshot | undefined>): () => void {
    const state = runtimeState(this)
    return this.listen(state.listeners, listener, true)
  }

  onDerived(listener: Listener<TuiSessionDerived>): () => void {
    return this.listen(runtimeState(this).derived, listener, false)
  }

  private listen<T>(listeners: Set<Listener<T>>, listener: Listener<T>, replay: boolean): () => void {
    const caller = requirePluginCaller(this.ctx, 'tuiSessions.subscribe', this)
    if (activationFiber(caller) === undefined || typeof listener !== 'function') return () => {}
    const owned = runtimeCleanups.get(concreteService(this))!
    const logger = caller.logger
    const warn = (error: unknown): void => { logger.warn('dsh-tui: tuiSessions listener failed: %o', error) }
    const wrapped: Listener<T> = value => {
      try { void Promise.resolve(listener(value)).catch(warn) } catch (error) { warn(error) }
    }
    listeners.add(wrapped)
    let cleanup: (() => unknown) | undefined
    let disposed = false
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      listeners.delete(wrapped)
      owned.delete(dispose)
      const release = cleanup
      cleanup = undefined
      release?.()
    }
    owned.add(dispose)
    if (!bindCallerEffect(caller, dispose, value => { cleanup = value })) return () => {}
    if (replay) wrapped(runtimeState(this).snapshot as T)
    return dispose
  }
}
const runtimeCleanups = new WeakMap<TuiSessionsRuntime, Set<() => void>>()
