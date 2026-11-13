/** Read backend-owned Fast intent; never infer eligibility from model names. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ChannelState } from './types.js'
import type { ChannelOwner } from './owner.js'
import { t } from '../../i18n.js'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'model/selection': ModelSelection
  }
}

const KEY = 'piAiFast'
type Mode = NonNullable<ChannelState['fastMode']>
interface Fallback { id: string; seq: number; provider: string; model: string }
interface View extends Mode { lastFallback: Fallback | null }
interface Registry {
  snapshot(session: Session, keys: readonly string[]): { asOfSeq: number; values: Record<string, unknown> }
  onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void): () => void
}
function registryOf(ctx: Context): Registry | undefined {
  // `get` probes the optional service; reading the property on an activation
  // that did not inject it throws once the service is registered.
  const value: unknown = ctx.get('sessionProjections')
  return value !== null && typeof value === 'object' && 'snapshot' in value && typeof value.snapshot === 'function'
    && 'onChanged' in value && typeof value.onChanged === 'function' ? value as Registry : undefined
}
const warned = new WeakSet<Session>()
function snapshotOf(ctx: Context, registry: Registry | undefined, session: Session) {
  try { return registry?.snapshot(session, [KEY]) }
  catch {
    if (!warned.has(session)) {
      warned.add(session)
      ctx.logger.warn('dsh-tui: optional Fast projection read failed; hiding its marker')
    }
    return undefined
  }
}
function viewOf(value: unknown): View | undefined {
  if (value === null || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean'
    || !('applicable' in value) || typeof value.applicable !== 'boolean') return undefined
  const last = 'lastFallback' in value ? value.lastFallback : null
  const lastFallback = last !== null && typeof last === 'object' && 'id' in last && typeof last.id === 'string'
    && 'seq' in last && typeof last.seq === 'number' && Number.isSafeInteger(last.seq) && last.seq >= 0
    && 'provider' in last && typeof last.provider === 'string' && 'model' in last && typeof last.model === 'string'
    ? { id: last.id, seq: last.seq, provider: last.provider, model: last.model } : null
  return {
    enabled: value.enabled, applicable: value.applicable, lastFallback,
    ...'provider' in value && typeof value.provider === 'string' ? { provider: value.provider } : {},
    ...'model' in value && typeof value.model === 'string' ? { model: value.model } : {},
  }
}

export function createFastModeStatus(ctx: Context, state: Pick<ChannelState, 'fastModeSnapshot' | 'emit' | 'notify'>, owner: ChannelOwner) {
  let current: Session | undefined
  let registry: Registry | undefined
  let watermark = -1
  let noticeId: string | undefined
  const seed = (session: Session): void => {
    current = session
    const snapshot = snapshotOf(ctx, registry, session)
    const view = viewOf(snapshot?.values[KEY])
    watermark = snapshot?.asOfSeq ?? -1
    noticeId = view?.lastFallback?.id
    state.emit()
  }
  state.fastModeSnapshot = () => current === undefined || registry === undefined ? undefined : viewOf(snapshotOf(ctx, registry, current)?.values[KEY])
  owner.own(() => { current = undefined; state.fastModeSnapshot = undefined })
  // A modern DSH loop supplies the registry before publishing its Agent.
  // Older or embedded compositions without it have no Fast capability.
  if (registryOf(ctx) === undefined) return { seed }
  const fiber = ctx.inject(['sessionProjections'], child => {
    const source = registryOf(child)
    if (source === undefined) return
    registry = source
    child.effect(() => source.onChanged((session, key, value, seq) => {
      if (!owner.current() || session !== current || key !== KEY) return
      const view = viewOf(value)
      const notice = view?.lastFallback
      if (notice !== null && notice !== undefined && notice.id !== noticeId && notice.seq > watermark) {
        state.notify(t('fast-mode-fallback', { model: notice.model }), { color: 'warning' })
      }
      noticeId = notice?.id
      watermark = seq
      state.emit()
    }))
    child.effect(() => () => { registry = undefined; if (owner.current()) state.emit() })
    if (current !== undefined) seed(current)
  })
  owner.own(() => { void fiber.dispose() })
  return { seed }
}

/** Publish the route the TUI already owns, only when the backend offers this capability. */
export function publishFastModelSelection(ctx: Context, session: Session, selection: ModelSelection): void {
  const registry = registryOf(ctx)
  if (snapshotOf(ctx, registry, session)?.values[KEY] === undefined) return
  session.append('model/selection', selection)
}

/** The legacy (seam-less) route write records no selection event; a changed
 *  route still needs one for Fast intent (called from `model-selection.ts`). */
export function publishFastRouteChange(
  ctx: Context,
  session: Session,
  previous: { readonly provider?: string; readonly model?: string },
  next: ModelSelection | undefined,
): void {
  if (next !== undefined && (next.provider !== previous.provider || next.model !== previous.model)) {
    publishFastModelSelection(ctx, session, next)
  }
}
