/** Follow an optional `subscriptionQuota` service for the foreground route.
 *  The provider owns credentials and cache freshness. Keep the last successful
 *  reading between queries; cache expiry is not a change in observed allowance. */
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelState } from './types.js'
import type { ChannelOwner } from './owner.js'

interface QuotaRoute { readonly provider: string; readonly model: string }
interface QuotaSnapshot {
  readonly windows: readonly { readonly name: string; readonly utilization: number; readonly resetsAt?: number }[]
  readonly fetchedAt: number
  readonly expiresAt: number
}
interface QuotaService { query(route: QuotaRoute): Promise<QuotaSnapshot | undefined> }
/** Local view only: the provider owns the global Context augmentation. */
interface QuotaContext extends Context { readonly subscriptionQuota?: QuotaService }

const keyOf = (route: QuotaRoute): string => `${route.provider}\n${route.model}`

export function createSubscriptionQuota(ctx: Context, state: Pick<ChannelState, 'rateLimit' | 'emit'>, owner: ChannelOwner, route: () => QuotaRoute) {
  let token = 0
  let serial = 0
  let live = false
  let service: QuotaService | undefined
  let pendingKey: string | undefined
  const hide = (): void => {
    if (state.rateLimit === undefined) return
    state.rateLimit = undefined
    state.emit()
  }
  const invalidate = (): void => { token += 1; pendingKey = undefined; hide() }
  const query = (target: QuotaRoute, reset: boolean): void => {
    if (!owner.current() || !live) return
    const key = keyOf(target)
    // One route change may be observed twice (durable event and the legacy switch tail).
    if (reset && pendingKey === key) return
    if (reset) hide()
    const mine = ++token
    if (service === undefined) { pendingKey = undefined; return }
    const active = service
    pendingKey = key
    void Promise.resolve().then(() => active.query({ provider: target.provider, model: target.model })).then(
      snapshot => {
        if (mine !== token || !owner.current() || keyOf(route()) !== key) return
        pendingKey = undefined
        if (snapshot === undefined || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= Date.now()) { hide(); return }
        state.rateLimit = { windows: snapshot.windows.map(window => ({ name: window.name, utilization: window.utilization, ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }) })) }
        state.emit()
      },
      () => { if (mine === token && owner.current()) { pendingKey = undefined; hide() } },
    )
  }
  // The provider is optional: follow its activation and withdrawal through the
  // injected service, as the Fast projection does.
  // Minimal embedded contexts have no injection; they simply have no provider.
  const fiber = typeof ctx.inject !== 'function' ? undefined : ctx.inject(['subscriptionQuota'], (child: Context) => {
    service = (child as QuotaContext).subscriptionQuota
    child.effect(() => () => {
      service = undefined
      if (owner.current()) invalidate()
    })
    if (live && owner.current()) query(route(), true)
  })
  owner.own(() => { void fiber?.dispose() })
  owner.own(invalidate)
  return {
    /** A freshly bound session: forget the previous answer and ask again. Returns the binding's disposer. */
    bind(): () => void {
      const mine = ++serial
      live = true
      invalidate()
      query(route(), true)
      return () => {
        // A later binding has already taken over.
        if (mine !== serial) return
        live = false
        invalidate()
      }
    },
    /** The foreground route changed. */
    change(target: QuotaRoute): void { query(target, true) },
    /** A turn finished: keep the last reading while querying; an unavailable answer hides it. */
    refresh(target: QuotaRoute): void { query(target, false) },
  }
}

export type SubscriptionQuota = ReturnType<typeof createSubscriptionQuota>
