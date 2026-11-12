/**
 * 对话卡片样式（下游）下子代理卡片的宽度预算与紧凑表头；由 `SubagentMessage`
 * 调用。
 */
import type { CardSurface } from '../cardSurface.js'

/** Card's own left indent (on top of the configured horizontal padding). */
export const CARD_INDENT = 2

export interface SubagentCardBudget {
  /** Columns the card's own indent takes from the waterfall row budget. */
  readonly indent: number
  /** One-line header that truncates instead of wrapping its metadata. */
  readonly compact: boolean
  readonly headerWrap: 'truncate' | undefined
  readonly showStatus: boolean
  readonly showModel: boolean
  readonly showCounts: boolean
}

export function subagentCardBudget(
  card: Pick<CardSurface, 'narrowed' | 'preset'>,
  columns: number,
  dock: { readonly grouped: boolean; readonly docked: boolean },
): SubagentCardBudget {
  // `card.columns` is already net of the border and configured padding; the
  // +2 indent eats into it too, so a card whose content is indented must
  // subtract it or the constant-height rows ask the renderer for two columns
  // it doesn't have (its truncate then silently drops the tail). Legacy (no
  // border, no padding, no indent beyond its own) keeps its old budget
  // byte-for-byte; pi-like cards keep their own 2-column indent inside the
  // (padding-less) content box, so their budget is the net one.
  const indented = dock.grouped || card.narrowed || card.preset === 'pi-like'
  // Card chrome reduces the header budget; keep the task title instead of
  // letting every metadata column wrap vertically. pi-like keeps the compact
  // header even without padding (its preset is what the layout belongs to);
  // legacy without chrome keeps its original tree/budget. `narrowed` stays the
  // size contract — the preset flag is not a substitute for it.
  const compact = dock.docked || card.preset === 'pi-like' || card.narrowed
  return {
    indent: indented ? CARD_INDENT : 0,
    compact,
    headerWrap: compact ? 'truncate' : undefined,
    showStatus: !compact || columns >= 60,
    showModel: !compact || columns >= 90,
    showCounts: !compact || columns >= 110,
  }
}
