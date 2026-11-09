/**
 * Composer-side lifecycle for plugin input completions.
 *
 * The host (`TuiInputCompletionHost`) owns token bounds, matching, ordering
 * and replacement. This hook only runs one resolve per (draft, caret, session,
 * source-generation) tuple and keeps the displayed menu honest:
 *
 * - Every change to text, caret, session/binding, or the registered sources
 *   aborts the in-flight query and starts a new one; a late answer from the
 *   old request cannot replace the new menu.
 * - Selection survives a re-resolution by the candidate's stable source-qualified
 *   key, so a late high-priority source cannot silently turn Enter into a
 *   different candidate.
 * - Esc dismisses the current token until the draft changes again; accepting a
 *   candidate dismisses the replacement token for the same edit so the same
 *   `#skill:name` does not immediately reopen its own menu.
 *
 * The hook never writes the draft: `accept` hands the replaced draft to the
 * caller's own composer edit path.
 */
import React from 'react'
import type {
  TuiInputCompletionContext,
  TuiInputCompletionHost,
  TuiInputCompletionItem,
  TuiInputCompletionMenu,
} from '../dsh-adapter/input-completions.js'
import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import { resolveBindingGeneration } from './promptDraftCache.js'

/** The session facts a composer passes to its sources, plus its binding generation. */
export type InputCompletionSession = TuiInputCompletionContext & { readonly bindingGeneration: number }

export const NO_INPUT_COMPLETION_SESSION: InputCompletionSession = { backendId: '', sessionId: '', cwd: '', bindingGeneration: 0 }

/** The foreground session of `channel`, as PromptInput and Launchpad present it. */
export function inputCompletionSession(channel: ChannelUi): InputCompletionSession {
  return {
    backendId: (channel.backendCapabilities as ChannelUi['backendCapabilities'] | undefined)?.backendId ?? '',
    sessionId: String(channel.sessionId ?? channel.agentId),
    cwd: channel.cwd,
    bindingGeneration: resolveBindingGeneration(channel),
  }
}

export interface UseInputCompletionsOptions {
  readonly host: TuiInputCompletionHost | undefined
  /** False while a built-in menu/help/selection/expanded editor owns input. */
  readonly enabled: boolean
  readonly text: string
  readonly cursor: number
  readonly backendId: string
  readonly sessionId: string
  readonly cwd: string
  /** Session/binding generation (`resolveBindingGeneration(channel)`). */
  readonly bindingGeneration: number
  /** Composer edit sequence; caret-only moves do not change it. */
  readonly revision: number
}

export interface InputCompletions {
  readonly menu: TuiInputCompletionMenu | undefined
  /** True while the menu is visible (not dismissed and not pre-empted). */
  readonly open: boolean
  readonly selected: number
  /** Move selection with wrap-around (arrow keys/wheel). */
  move(step: 1 | -1): void
  /** Esc: hide this token's menu until the next draft edit. */
  dismiss(): void
  /** Stable identity of the selected row, for a caller applying the edit. */
  selectedItem(): TuiInputCompletionItem | undefined
  /**
   * Accept `item`: replace ONLY the host-owned token (`menu.start/end`) through
   * `edit`, which applies the draft as one composer edit and returns the
   * post-edit revision; the replacement token then stays dismissed until the
   * next edit. Skipped when `current` no longer matches the draft and caret
   * this menu was resolved for. False only when there is no item.
   */
  accept(
    item: TuiInputCompletionItem | undefined,
    current: { readonly text: string; readonly cursor: number },
    edit: (text: string, cursor: number) => number,
  ): boolean
}

interface MenuEntry {
  readonly key: string
  readonly menu: TuiInputCompletionMenu
}

export function useInputCompletions(options: UseInputCompletionsOptions): InputCompletions {
  const {
    host,
    enabled,
    text,
    cursor,
    backendId,
    sessionId,
    cwd,
    bindingGeneration,
    revision,
  } = options
  const [sourceVersion, setSourceVersion] = React.useState(0)
  const [entry, setEntry] = React.useState<MenuEntry | undefined>(undefined)
  const [selected, setSelected] = React.useState(0)
  const [, refresh] = React.useState(0)
  const dismissed = React.useRef<{ revision: number; start: number } | null>(null)
  const entryRef = React.useRef(entry)
  entryRef.current = entry
  const selectedRef = React.useRef(selected)
  selectedRef.current = selected

  React.useEffect(() => {
    if (host === undefined) return
    return host.subscribe(() => setSourceVersion(version => version + 1))
  }, [host])

  const requestKey = JSON.stringify([
    text,
    cursor,
    backendId,
    sessionId,
    cwd,
    bindingGeneration,
    sourceVersion,
    revision,
  ])
  const live = host === undefined || entry === undefined || entry.key !== requestKey
    ? undefined
    : entry.menu
  const dismissedHere = live !== undefined
    && dismissed.current !== null
    && dismissed.current.revision === revision
    && dismissed.current.start === live.start
  const shouldQuery = host !== undefined && enabled && !dismissedHere
  const context = { backendId, sessionId, cwd }
  const selectedIndex = live === undefined || live.items.length === 0
    ? 0
    : Math.min(Math.max(selected, 0), live.items.length - 1)

  React.useEffect(() => {
    if (host === undefined || !shouldQuery) return
    const controller = new AbortController()
    let active = true
    const previousKey = entryRef.current?.menu.items[selectedRef.current]?.key
    void host.resolve({ text, cursor, context, signal: controller.signal })
      .then((menu) => {
        if (!active || controller.signal.aborted) return
        if (menu === undefined) {
          setEntry(undefined)
          setSelected(0)
          return
        }
        setEntry({ key: requestKey, menu })
        const kept = previousKey === undefined
          ? -1
          : menu.items.findIndex(item => item.key === previousKey)
        setSelected(kept >= 0 ? kept : 0)
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return
        setEntry(undefined)
        setSelected(0)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [host, requestKey, shouldQuery])

  return {
    menu: live,
    open: live !== undefined && enabled && !dismissedHere,
    selected: selectedIndex,
    move: (step) => {
      if (live === undefined || live.items.length === 0) return
      const max = live.items.length - 1
      setSelected(current => {
        const base = Math.min(Math.max(current, 0), max)
        if (step > 0) return base >= max ? 0 : base + 1
        return base <= 0 ? max : base - 1
      })
    },
    dismiss: () => {
      if (live === undefined) return
      dismissed.current = { revision, start: live.start }
      refresh(tick => tick + 1)
    },
    selectedItem: () => live?.items[selectedIndex],
    accept: (item, current, edit) => {
      if (item === undefined) return false
      if (live === undefined || current.text !== text || current.cursor !== cursor) return true
      const nextRevision = edit(text.slice(0, live.start) + item.replacement + text.slice(live.end), live.start + item.replacement.length)
      dismissed.current = { revision: nextRevision, start: live.start }
      refresh(tick => tick + 1)
      return true
    },
  }
}
