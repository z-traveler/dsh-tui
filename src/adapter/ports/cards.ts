export type TuiCardBlock =
  | { readonly kind: 'text'; readonly text: string; readonly label?: string; readonly truncate?: 'end' }
  | { readonly kind: 'markdown'; readonly text: string }
  /** Rows have exactly one string cell per column; cells are literal text. */
  | { readonly kind: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly layout?: 'compact' }
  /** A width-aware capacity grid. Values remain producer-owned; painting clamps at total. */
  | { readonly kind: 'distribution'; readonly total: number; readonly segments: readonly { readonly value: number; readonly kind: 'filled' | 'reserved' | 'empty' }[] }

/** Per-card density. `compact` is the lowest reading face: the card keeps its
 * theme label/text roles, folding and reading, and drops only the configured
 * card face (background, border, padding and gap) for THIS card. Absent means
 * the shared face of its kind, unchanged. */
export type TuiCardDensity = 'compact'

/** Borrowed readonly presentation. The host sanitizes terminal output without
 * permanently clipping body content; it must not mutate the presenter's view. */
export interface TuiCardView {
  readonly title: string
  readonly label?: string
  readonly summary?: string
  readonly blocks: readonly TuiCardBlock[]
  /** Optional reading shown while collapsed; expansion replaces it with blocks. */
  readonly preview?: readonly TuiCardBlock[]
  /** Optional per-card density; omitted keeps the configured card face. */
  readonly density?: TuiCardDensity
}
