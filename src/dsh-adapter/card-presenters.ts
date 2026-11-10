/** Custom Card presenter registry (downstream custom-cards feature): the
 *  implementation behind `tuiRenderers.registerCard` and the renderer host's
 *  `hasCard`/`presentCard`, owned by the renderer service in `renderers.ts`. */

import type { Context } from '@deepseek-ai/cordis'
import { asTuiCardView, fallbackCardView, isTuiCardType } from '../agent/cards.js'
import type { TuiCardPresenter, TuiCardRecord, TuiCardView } from '../agent/cards.js'
import { bindCallerEffect, requirePluginCaller } from './host-access.js'

export class TuiCardPresenters {
  private readonly cards = new Map<string, TuiCardPresenter>()
  private readonly failedTypes = new Set<string>()
  private readonly logger: Context['logger']

  constructor(logger: Context['logger']) {
    this.logger = logger
  }

  has(type: string): boolean {
    try {
      return this.cards.has(String(type ?? '').trim().toLowerCase())
    } catch {
      return false
    }
  }

  /** The registered presentation of `record`, or its readable fallback when no
   *  presenter is mounted, the presenter throws, or its view is malformed. */
  present(record: TuiCardRecord): TuiCardView {
    const presenter = this.cards.get(record.type)
    if (presenter === undefined) return fallbackCardView(record)
    try {
      return asTuiCardView(presenter(record.data)) ?? fallbackCardView(record)
    } catch (error) {
      if (!this.failedTypes.has(record.type)) {
        this.failedTypes.add(record.type)
        this.logger.warn(`dsh-tui: card presenter for "${record.type}" threw; fallback is used: %o`, error)
      }
      return fallbackCardView(record)
    }
  }

  /** `registerCard` for the renderer service `service` whose own context is
   *  `ctx`. The contribution shares renderer admission, ownership, and effect
   *  cleanup. */
  register(ctx: Context, service: object, type: string, presenter: TuiCardPresenter, identity?: Context): () => void {
    let caller: Context
    try {
      caller = requirePluginCaller(ctx, 'tuiRenderers.registerCard', service)
    } catch {
      ctx.logger.warn('dsh-tui: tuiRenderers.registerCard requires a live non-root plugin activation')
      return () => {}
    }
    let normalized: string
    try {
      normalized = String(type ?? '').trim().toLowerCase()
    } catch {
      ctx.logger.warn('dsh-tui: tuiRenderers.registerCard rejected an uncoercible business type')
      return () => {}
    }
    if (!isTuiCardType(normalized)) {
      ctx.logger.warn('dsh-tui: tuiRenderers.registerCard rejected an invalid business type')
      return () => {}
    }
    if (this.cards.has(normalized)) {
      ctx.logger.warn(`dsh-tui: tuiRenderers.registerCard rejected "${normalized}" — already registered`)
      ctx.get('tuiEffectLedger')?.record(
        {
          operation: 'create',
          resource: { kind: 'renderer', id: `card:${normalized}` },
          result: 'failed',
          errorCode: 'DUPLICATE_CONTRIBUTION_ID',
        },
        identity,
      )
      return () => {}
    }
    if (typeof presenter !== 'function') {
      ctx.logger.warn(`dsh-tui: tuiRenderers.registerCard rejected "${normalized}" — presenter must be a function`)
      return () => {}
    }
    this.cards.set(normalized, presenter)
    ctx.get('tuiEffectLedger')?.record(
      { operation: 'create', resource: { kind: 'renderer', id: `card:${normalized}` }, result: 'applied' },
      identity,
    )
    const dispose = () => {
      if (this.cards.get(normalized) !== presenter) return
      this.cards.delete(normalized)
      ctx.get('tuiEffectLedger')?.record(
        { operation: 'release', resource: { kind: 'renderer', id: `card:${normalized}` }, result: 'applied' },
        identity,
      )
    }
    bindCallerEffect(caller, dispose)
    return dispose
  }
}

/** Tool view presenters plus the host's current Custom Card presenter, when
 *  one is mounted (folded-row restore in `channel/local-actions.ts`). */
export function withCardPresenter<T extends object>(
  presenters: T,
  card: ((record: TuiCardRecord) => TuiCardView) | undefined,
): T & { card?(record: TuiCardRecord): TuiCardView } {
  return { ...presenters, ...(card === undefined ? {} : { card }) }
}
