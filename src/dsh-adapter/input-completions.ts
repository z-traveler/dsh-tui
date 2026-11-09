/**
 * Generic plugin input completions: an installable Cordis plugin registers a
 * source (trigger + async candidates), and the TUI owns the draft token, the
 * menu, selection and replacement. Skills discovery, ranking and
 * `#skill:name` insertion stay in the plugin that registers a source; this
 * module only provides the host seam.
 *
 * Lifecycle and ownership:
 *
 * - `ctx.tuiInputCompletions.register(provider)` is bound to the calling
 *   Cordis activation (the same owner/effect rule as `tuiCommandTrees`): the
 *   source disappears when that activation unloads, its menu closes and its
 *   query is aborted by the prompt.
 * - The public service exposes registration only. The UI gets a host-only
 *   facade (`getHostInputCompletions`) with `resolve`/`subscribe`; a provider
 *   never receives a draft writer, a submit function or another source's
 *   surface.
 * - A query gets the query fragment and a frozen read-only
 *   `{ backendId, sessionId, cwd }` context plus an `AbortSignal`. It never
 *   sees the full draft: the host supplies only the whitespace-delimited token
 *   around the caret, with a token-local cursor.
 *
 * Resolution contract:
 *
 * - Every matching source contributes. Sources are ordered by priority
 *   descending (default 0), ties by registration order; each source keeps its
 *   returned candidate order.
 * - All matching sources settle before one menu is produced, so a late
 *   high-priority result cannot silently replace the item the user selected.
 * - A source that throws (trigger or query) contributes nothing; the other
 *   sources still answer.
 * - `menu.start`/`menu.end` are the only replacement bounds. The host never
 *   includes the surrounding draft, so text before/after the token (including
 *   `@path#L12` and an atomic `[Image #N]` span) survives acceptance.
 * - A menu is produced only while the source-generation captured at the start
 *   still matches and the caller's signal is live.
 *
 * Presentation: the menu is shown after the built-in `/` command and `@` file
 * menus, and only when neither of those owns the token. When more than one
 * source contributes candidates, every row carries its source label.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { activationFiber, bindCallerEffect, compositionRoot, concreteService, requirePluginCaller } from './host-access.js'
import { cleanScalarText } from './sanitize.js'
import { imageTokenSpans } from '../components/composerImageTokens.js'
import {
  assertCapabilityShadowPolicy,
  type AdapterRuntimeOptions,
} from '../adapter/kernel/runtime.js'
import { adapterRuntimeFor } from '../adapter/kernel/runtime-context.js'

export const name = 'dsh-tui-input-completions'

/** The whitespace-delimited token around the caret, with a token-local cursor. */
export interface TuiInputCompletionToken {
  readonly text: string
  /** Caret offset inside `text`, 0..text.length. */
  readonly cursor: number
}

/** Read-only session identity available to a query. */
export interface TuiInputCompletionContext {
  readonly backendId: string
  readonly sessionId: string
  readonly cwd: string
}

/** A source's answer for one token: the fragment between its trigger and the caret. */
export interface TuiInputCompletionTrigger {
  readonly query: string
}

/** What a source query receives (plus the abort signal as the second argument). */
export interface TuiInputCompletionQuery {
  readonly query: string
  readonly context: TuiInputCompletionContext
}

/** One candidate; the host never rewrites `replacement`. */
export interface TuiInputCompletionCandidate {
  /** Stable identity within this source. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Optional second line / muted description. */
  readonly description?: string
  /** Exact text that replaces the token; surrounding draft text is preserved. */
  readonly replacement: string
}

/** A plugin-owned completion source. */
export interface TuiInputCompletionProvider {
  /** Stable source id (`^[a-z][a-z0-9_-]*$`). */
  readonly id: string
  /** Visible source label, used on every row when several sources contribute. */
  readonly label: string
  /** Higher wins; ties keep registration order. Defaults to 0. */
  readonly priority?: number
  /**
   * Match the current token. Receives only the token and its local caret, so
   * the provider cannot inspect or rewrite the rest of the draft.
   */
  trigger(token: TuiInputCompletionToken): TuiInputCompletionTrigger | undefined
  /** Ordered candidates for one matched token. */
  query(
    query: TuiInputCompletionQuery,
    signal: AbortSignal,
  ): readonly TuiInputCompletionCandidate[] | Promise<readonly TuiInputCompletionCandidate[]>
}

/** One merged menu row. */
export interface TuiInputCompletionItem {
  /** Stable identity across re-renders/re-resolutions (`source id + candidate id`). */
  readonly key: string
  readonly sourceId: string
  readonly sourceLabel: string
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly replacement: string
}

/** The host-owned menu for the token currently under the caret. */
export interface TuiInputCompletionMenu {
  /** First character of the replaceable token. */
  readonly start: number
  /** The caret: text after it is never part of a completion replacement. */
  readonly end: number
  readonly items: readonly TuiInputCompletionItem[]
  /** True when more than one source contributed at least one candidate. */
  readonly multiSource: boolean
}

export interface TuiInputCompletionResolveRequest {
  readonly text: string
  readonly cursor: number
  readonly context: TuiInputCompletionContext
  readonly signal: AbortSignal
}

/** Host-only view of the completion service. No write/submit surface. */
export interface TuiInputCompletionHost {
  resolve(request: TuiInputCompletionResolveRequest): Promise<TuiInputCompletionMenu | undefined>
  /** Fires when a source registers or unloads; the prompt re-resolves. */
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiInputCompletions: TuiInputCompletionRuntime
  }
}

const SOURCE_ID = /^[a-z][a-z0-9_-]*$/u
const LABEL_CELLS = 40
const NAME_CELLS = 120
const DESCRIPTION_CELLS = 200

interface RegisteredSource {
  readonly provider: TuiInputCompletionProvider
  readonly id: string
  readonly label: string
  readonly priority: number
  readonly order: number
}

interface InputCompletionState {
  readonly runtime: AdapterRuntimeOptions
  readonly providers: Map<string, RegisteredSource>
  readonly listeners: Set<() => void>
  readonly pending: Set<AbortController>
  host: TuiInputCompletionHost | undefined
  order: number
  generation: number
}

const inputCompletionStates = new WeakMap<TuiInputCompletionRuntime, InputCompletionState>()

/**
 * `ctx.tuiInputCompletions` — the plugin-facing completion registry. The
 * first-party `dsh-tui-extensions` row mounts it; a profile without that row
 * simply has no plugin completion menu.
 */
export class TuiInputCompletionRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tuiInputCompletions')
    compositionRoot(ctx)
    const runtime = this
    const state: InputCompletionState = {
      runtime: adapterRuntimeFor(ctx),
      providers: new Map(),
      listeners: new Set(),
      pending: new Set(),
      host: undefined,
      order: 0,
      generation: 0,
    }
    state.host = Object.freeze({
      resolve: (request: TuiInputCompletionResolveRequest) => resolveInputCompletions(runtime, request),
      subscribe: (listener: () => void) => subscribeInputCompletions(state, listener),
    })
    inputCompletionStates.set(this, state)
    ctx.effect(() => () => {
      state.generation += 1
      state.providers.clear()
      for (const controller of [...state.pending]) controller.abort()
      for (const listener of [...state.listeners]) {
        try {
          listener()
        } catch {
          // A host listener cannot break service teardown.
        }
      }
      state.listeners.clear()
    })
  }

  /**
   * Register one source for the lifetime of the calling activation. The
   * returned disposer is also bound to that activation, so an explicit
   * `ctx.effect(() => ctx.tuiInputCompletions.register(...))` and a bare
   * `register()` both unload with the plugin.
   */
  register(provider: TuiInputCompletionProvider): () => void {
    const state = inputCompletionStateFor(this)
    assertCapabilityShadowPolicy('host.input-completions.register', state.runtime.mode, state.runtime.slices)
    const caller = requirePluginCaller(this.ctx, 'tuiInputCompletions.register', this)
    if (activationFiber(caller) === undefined) {
      throw new Error('dsh-tui: tuiInputCompletions.register requires a live activation')
    }
    const normalized = normalizeProvider(provider)
    if (state.providers.has(normalized.id)) {
      throw new Error(`TUI input-completion source "${normalized.id}" is already registered`)
    }
    const entry: RegisteredSource = { ...normalized, order: state.order++ }
    state.providers.set(entry.id, entry)
    state.generation += 1
    notify(state)
    const dispose = (): void => {
      if (state.providers.get(entry.id) !== entry) return
      state.providers.delete(entry.id)
      state.generation += 1
      notify(state)
    }
    bindCallerEffect(caller, dispose)
    return dispose
  }
}

function inputCompletionStateFor(runtime: TuiInputCompletionRuntime): InputCompletionState {
  const state = inputCompletionStates.get(concreteService(runtime))
  if (state === undefined) throw new Error('tuiInputCompletions host state is unavailable')
  return state
}

function normalizeProvider(provider: TuiInputCompletionProvider): Omit<RegisteredSource, 'order'> {
  if (typeof provider !== 'object' || provider === null) {
    throw new TypeError('TUI input-completion provider must be an object')
  }
  const id = typeof provider.id === 'string' ? provider.id.trim().toLowerCase() : ''
  if (!SOURCE_ID.test(id)) throw new TypeError(`invalid TUI input-completion source id: ${provider.id}`)
  const label = cleanScalarText(provider.label, LABEL_CELLS)
  if (label === '') throw new TypeError(`TUI input-completion source "${id}" needs a label`)
  const priority = provider.priority ?? 0
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    throw new TypeError(`TUI input-completion source "${id}" needs a finite priority`)
  }
  if (typeof provider.trigger !== 'function') {
    throw new TypeError(`TUI input-completion source "${id}" needs trigger()`)
  }
  if (typeof provider.query !== 'function') {
    throw new TypeError(`TUI input-completion source "${id}" needs query()`)
  }
  return { provider, id, label, priority }
}

function subscribeInputCompletions(state: InputCompletionState, listener: () => void): () => void {
  if (typeof listener !== 'function') return () => {}
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}

function notify(state: InputCompletionState): void {
  for (const controller of [...state.pending]) controller.abort()
  for (const listener of [...state.listeners]) {
    try {
      listener()
    } catch {
      // A host listener cannot break registration for everyone else.
    }
  }
}

function orderedSources(state: InputCompletionState): readonly RegisteredSource[] {
  return [...state.providers.values()].sort((left, right) =>
    right.priority - left.priority || left.order - right.order)
}

const isWhitespace = (char: string | undefined): boolean => char === undefined || /\s/u.test(char)

/** The replaceable whitespace token under the caret, unless it intersects an image token. */
function tokenAtCaret(text: string, cursor: number): { start: number; end: number; text: string; cursor: number } | undefined {
  let start = cursor
  while (start > 0 && !isWhitespace(text[start - 1])) start -= 1
  let end = cursor
  while (end < text.length && !isWhitespace(text[end])) end += 1
  if (start === end) return undefined
  // An image placeholder is opaque to plugin completions even though it
  // contains a whitespace-delimited `#…` part: a caret inside one must never
  // offer a token replacement that would cut the placeholder.
  if (imageTokenSpans(text).some(span => span.start < end && span.end > start)) return undefined
  return { start, end, text: text.slice(start, end), cursor: cursor - start }
}

async function resolveInputCompletions(
  runtime: TuiInputCompletionRuntime,
  request: TuiInputCompletionResolveRequest,
): Promise<TuiInputCompletionMenu | undefined> {
  const state = inputCompletionStateFor(runtime)
  const generation = state.generation
  if (typeof request.text !== 'string'
    || !Number.isInteger(request.cursor)
    || request.cursor < 0
    || request.cursor > request.text.length
    || request.signal.aborted) return undefined
  const token = tokenAtCaret(request.text, request.cursor)
  if (token === undefined) return undefined

  const context: TuiInputCompletionContext = Object.freeze({
    backendId: typeof request.context?.backendId === 'string' ? request.context.backendId : '',
    sessionId: typeof request.context?.sessionId === 'string' ? request.context.sessionId : '',
    cwd: typeof request.context?.cwd === 'string' ? request.context.cwd : '',
  })

  const matched: Array<{ source: RegisteredSource; query: string }> = []
  for (const source of orderedSources(state)) {
    try {
      const trigger: TuiInputCompletionTrigger | undefined | null =
        source.provider.trigger({ text: token.text, cursor: token.cursor })
      if (trigger === undefined || trigger === null || typeof trigger.query !== 'string') continue
      matched.push({ source, query: trigger.query })
    } catch {
      // A malformed trigger contributes nothing; other sources still answer.
      continue
    }
  }
  if (matched.length === 0) return undefined

  if (request.signal.aborted || generation !== state.generation) return undefined
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  state.pending.add(controller)
  let release: (() => void) | undefined
  const cancelled = new Promise<undefined>(resolve => {
    release = () => resolve(undefined)
    controller.signal.addEventListener('abort', release, { once: true })
  })
  try {
    const results = await Promise.race([
      Promise.all(matched.map(async ({ source, query }) => {
        try {
          const candidates = await source.provider.query(Object.freeze({ query, context }), controller.signal)
          return normalizeCandidates(source, candidates)
        } catch {
          // One source's failure never removes the other sources' answers.
          return []
        }
      })),
      cancelled,
    ])
    if (results === undefined || controller.signal.aborted || generation !== state.generation) return undefined

    const items: TuiInputCompletionItem[] = []
    let contributing = 0
    for (const candidates of results) {
      if (candidates.length > 0) contributing += 1
      items.push(...candidates)
    }
    if (items.length === 0) return undefined
    return Object.freeze({
      start: token.start,
      end: request.cursor,
      items: Object.freeze(items),
      multiSource: contributing > 1,
    })
  } finally {
    request.signal.removeEventListener('abort', abort)
    if (release !== undefined) controller.signal.removeEventListener('abort', release)
    state.pending.delete(controller)
  }
}

function normalizeCandidates(source: RegisteredSource, value: unknown): readonly TuiInputCompletionItem[] {
  if (!Array.isArray(value)) return []
  const items: TuiInputCompletionItem[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const candidate = raw as Partial<TuiInputCompletionCandidate>
    const id = typeof candidate.id === 'string' ? candidate.id : ''
    if (id === '' || seen.has(id)) continue
    const name = cleanScalarText(candidate.name, NAME_CELLS)
    if (name === '') continue
    const replacement = typeof candidate.replacement === 'string' ? candidate.replacement : ''
    if (replacement === '') continue
    const description = candidate.description === undefined
      ? undefined
      : cleanScalarText(candidate.description, DESCRIPTION_CELLS) || undefined
    seen.add(id)
    const key = JSON.stringify([source.id, id])
    items.push(description === undefined
      ? { key, sourceId: source.id, sourceLabel: source.label, id, name, replacement }
      : { key, sourceId: source.id, sourceLabel: source.label, id, name, description, replacement })
  }
  return items
}

/** Host-only facade; absent when the extension row is not mounted. */
export function getHostInputCompletions(runtime: TuiInputCompletionRuntime | undefined): TuiInputCompletionHost | undefined {
  if (runtime === undefined) return undefined
  try {
    return inputCompletionStateFor(runtime).host
  } catch {
    return undefined
  }
}

export default TuiInputCompletionRuntime
