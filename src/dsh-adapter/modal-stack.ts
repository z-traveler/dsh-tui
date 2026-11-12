/**
 * Provider-neutral modal window stack — the cordis-free half of
 * `tuiScenes.registerModal` / `openModal`.
 *
 * A full-screen scene REPLACES the conversation; a modal stacks ON it, so its
 * lifetime cannot be a single `current` slot. This module owns what the plugin
 * and the host can observe: one instance per open (same descriptor may be open
 * several times), the bottom→top stack the host paints, the host's admission
 * gate and mount acknowledgement, and the per-instance AbortSignal.
 *
 * It also owns the two projections the host paints from and the plugin reads:
 * the effective options of each instance (see `../modal-options.ts` for the
 * validation and merge rules) and the input owner. Which window owns input is
 * derived here, never in the UI: focus needs the host's per-frame visibility
 * report and the plugin's explicit focus gesture together, and only this
 * module sees both. The host paints `stack()` in order, targets keys at
 * `focused()`, and reports visibility/bounds back as they change.
 *
 * Cordis activation, owner checks and effect-ledger records stay in
 * `modal-registry.ts`; the host-only facade that `getHostSceneRuntime` exposes is a
 * thin projection of {@link TuiModalStack} methods.
 */

import type React from 'react'
import {
  mergeModalOptions,
  normalizeModalOptions,
  patchModalOptions,
  type TuiModalBounds,
  type TuiModalOptions,
} from '../modal-options.js'
import type { TuiSceneProps } from './scenes.js'

/** Cells a modal's content may paint in — the host frame's inner area after
 *  the border and padding are subtracted. Same shape and units as
 *  `ui.useTerminalSize()`, so a modal can also feed it to descendants. */
export interface TuiModalContentSize {
  columns: number
  rows: number
}

/**
 * Props every plugin modal receives. The host-React contract of
 * {@link TuiSceneProps} applies unchanged (hooks and elements must come from
 * the injected `React`); the modal extensions are host-owned view state.
 */
export interface TuiModalProps extends TuiSceneProps {
  /** True for the instance that owns input; every other instance is a plain
   *  painted window (or passive, see `TuiModalOptions.nonCapturing`). */
  focused: boolean
  /** The content box the host gives this instance. */
  contentSize: TuiModalContentSize
  /** Aborted when this instance stops being displayable (closed by plugin or
   *  host, owner unload, render failure, session switch, scope teardown).
   *  For an instance that already opened, this abort is the only report: its
   *  settled `openModal` result is never rewritten. */
  signal: AbortSignal
}

export interface TuiModalDescriptor {
  /** Unique modal id (kebab-case); the plugin's own commands open it by id. */
  id: string
  /** Optional human label; the host renders it in the frame header. */
  title?: string
  component: React.ComponentType<TuiModalProps>
  /** Type default for this registration; every open inherits it and may
   *  override it per instance. Omitted = the round-1 window (opaque, centred,
   *  framed, capturing input). */
  options?: TuiModalOptions
}

/** One opened window. Both the plugin (from its `openModal` result) and the
 *  host (from the stack) hold this same handle. */
export interface TuiModalInstance {
  id: string
  title?: string
  component: React.ComponentType<TuiModalProps>
  signal: AbortSignal
  /** Close only this instance, wherever it sits in the stack; idempotent and
   *  never cascades to its neighbours. */
  close(): void
  /** Effective options right now: descriptor default, then the open override,
   *  then every `updateOptions` patch. Read-only and replaced, never mutated. */
  options(): TuiModalOptions
  /** Merge one option patch into this instance only. An option set to
   *  `undefined` drops its override so the descriptor default applies again;
   *  `style` merges field by field. The instance, its signal and everything
   *  its component holds are untouched — the change is a repaint, not a
   *  remount. Invalid or unknown values are a TypeError and change nothing. */
  updateOptions(patch: TuiModalOptions): void
  /** Hide or show without closing: state, options and stack slot survive. A
   *  hidden window owns no input and reports no bounds. */
  setHidden(hidden: boolean): void
  isHidden(): boolean
  /** True for the instance that currently owns input (at most one is). */
  isFocused(): boolean
  /** Take input: raises this window above every other one. Works for a
   *  non-capturing window too — that is how a passive card becomes active. */
  focus(): void
  /** Give input back: the next capturing window below takes it, or the chat
   *  when none is left. The window itself stays open and painted. */
  unfocus(): void
  /** The card rect the host last reported, or `undefined` while the window is
   *  plugin-hidden, host-invisible or closed (see {@link TuiModalBounds} for
   *  the coordinate space). The value is a frozen copy: a consumer cannot
   *  rewrite the host's projection through it. */
  getBounds(): Readonly<TuiModalBounds> | undefined
}

/** Why an open request produced no window. */
export type TuiModalRejectionCode =
  /** No registration with that id in the caller's composition. */
  | 'not-registered'
  /** The registration belongs to another activation. */
  | 'foreign-owner'
  /** No host is consuming modal windows (no admission gate installed), so the
   *  window could never be painted and acknowledged. */
  | 'host-unavailable'
  /** The host's gate refused this request (non-chat page, key interaction
   *  active, stack hidden); `message` is the host's reason. */
  | 'admission-denied'

/** Why an admitted window never became displayable. */
export type TuiModalFailureCode =
  /** Closed, unloaded or torn down before the host confirmed the mount. */
  | 'closed-before-ack'
  /** The host reported that rendering this instance failed. */
  | 'render-failed'

/**
 * The host's verdict on a new window, asked synchronously before any instance
 * exists, with the effective options this open would use (descriptor default
 * already merged with the per-open override). Returning a reason refuses the
 * open; `undefined` admits it. This is where the host evaluates `visible`
 * against the current frame and refuses a window it could not paint.
 */
export type TuiModalAdmission = (descriptor: TuiModalDescriptor, options: TuiModalOptions) => string | undefined

/**
 * Result of `openModal`. `opened` means the host acknowledged the instance as
 * mounted — not that the terminal has finished physically painting it, and
 * never that a registry slot was merely taken.
 */
export type TuiModalOpenResult =
  | { status: 'opened'; instance: TuiModalInstance }
  | { status: 'rejected'; code: TuiModalRejectionCode; message: string }
  | { status: 'failed'; code: TuiModalFailureCode; message: string; cause?: unknown }

/**
 * Host-only modal controls. The chat screen paints {@link stack}, answers
 * admission, acknowledges mounts and drives session/hidden-stack teardown;
 * plugins only ever see their own {@link TuiModalInstance}.
 */
export interface TuiModalHost {
  /** Bottom → top paint order. The runtime keeps the window that owns input
   *  last, so neither a non-capturing window nor one the plugin just released
   *  can cover the window that actually receives keys. */
  stack(): readonly TuiModalInstance[]
  subscribe(listener: () => void): () => void
  /** Install (or clear, with `undefined`) the admission gate. Without a gate
   *  every open is refused as `host-unavailable`. The returned disposer clears
   *  the gate only while it is still the installed one. */
  setAdmission(gate: TuiModalAdmission | undefined): () => void
  /** The instance that owns input right now; `undefined` means the chat does.
   *  This — not the top of the stack — is the target for keys and Esc. */
  focused(): TuiModalInstance | undefined
  /** Report whether this instance is painted on the current frame (the host's
   *  own whole-stack visibility and the per-window `visible` predicate).
   *  Idempotent: a repeated value never notifies, and a change notifies only
   *  when the input owner moved, so a per-frame call cannot start an emit
   *  loop. An invisible instance keeps its state and placement. */
  setVisibility(instance: TuiModalInstance, visible: boolean): void
  /** Report the card rect measured this frame; `undefined` clears it. Never
   *  notifies — bounds are read while painting, so a bounds-only update must
   *  not force another render. */
  setBounds(instance: TuiModalInstance, bounds: TuiModalBounds | undefined): void
  /** Confirm the instance mounted: resolves its pending `openModal` as
   *  `opened`. Stale acknowledgements (after close/fail) are ignored. */
  acknowledge(instance: TuiModalInstance): void
  /** Report that this instance cannot be shown: it leaves the stack, its
   *  signal aborts and its pending open settles as `render-failed`. After the
   *  host acknowledged the mount there is no pending open left, so the abort
   *  is all this failure produces. */
  fail(instance: TuiModalInstance, error: unknown): void
  /** Close every instance — session switch, or leaving the chat surface. */
  closeAll(): void
}

type ModalSettler = (result: TuiModalOpenResult) => void

interface ModalEntry {
  /** The frozen registration this instance was opened from — identity, not id,
   *  so a re-registered id never inherits old instances. */
  readonly descriptor: TuiModalDescriptor
  readonly instance: TuiModalInstance
  readonly controller: AbortController
  /** Validated descriptor default; the fallback a cleared override restores. */
  readonly defaults: TuiModalOptions
  /** Validated per-instance overrides (open options ← later patches). */
  overrides: TuiModalOptions
  /** Effective options: `defaults` with `overrides` applied. */
  options: TuiModalOptions
  /** Pending `openModal` settlement; undefined once resolved or failed. */
  settle: ModalSettler | undefined
  /** Plugin-owned hide; the instance keeps its stack slot and its state. */
  hidden: boolean
  /** Host projection: painted on the frame the host last reported. */
  hostVisible: boolean
  /** Explicitly focused: captures input even when `nonCapturing` says not to. */
  pinned: boolean
  /** Explicitly unfocused: skips it as an input candidate until it is focused
   *  again (or reopened). */
  released: boolean
  /** Last host-reported rect; stored verbatim, see {@link TuiModalBounds}. */
  bounds: TuiModalBounds | undefined
}

/** A window captures input unless its options opt out, and an explicit focus
 *  overrides the opt-out. Paint order follows the same split. */
function captures(entry: ModalEntry): boolean {
  return entry.pinned || entry.options.nonCapturing !== true
}

/** Whether the host can show this window right now (and so whether it may own
 *  input or report bounds). */
function available(entry: ModalEntry): boolean {
  return !entry.hidden && entry.hostVisible
}

/** Build a refusal result for callers that reject before the stack sees them. */
export function modalRejected(code: TuiModalRejectionCode, message: string): TuiModalOpenResult {
  return { status: 'rejected', code, message }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Instance and stack state for one composition. Registration stays in the
 * service; this class is created, driven and torn down by it.
 */
export class TuiModalStack {
  private readonly listeners = new Set<() => void>()
  private readonly entries: ModalEntry[] = []
  private readonly byInstance = new Map<TuiModalInstance, ModalEntry>()
  private admission: TuiModalAdmission | undefined
  /** The entry that owns input; recomputed on every transition. */
  private focusedEntry: ModalEntry | undefined
  /** Rebuilt on every transition so `stack()` has a stable identity between
   *  changes — the host renders it through a subscription. */
  private snapshot: readonly TuiModalInstance[] = Object.freeze([])

  /**
   * Admit and create one independent instance of `descriptor`, with `requested`
   * (if any) overriding the descriptor's own options for this instance only.
   * A malformed option object throws a TypeError before anything exists; a
   * refusal settles at once; an admitted request stays pending until the host
   * acknowledges or fails the instance.
   */
  open(descriptor: TuiModalDescriptor, requested?: TuiModalOptions): Promise<TuiModalOpenResult> {
    const label = `modal "${descriptor.id}"`
    const defaults = normalizeModalOptions(descriptor.options, label)
    const overrides = normalizeModalOptions(requested, `${label}.openModal`)
    const options = mergeModalOptions(defaults, overrides)
    const admission = this.admission
    if (admission === undefined) {
      return Promise.resolve(modalRejected(
        'host-unavailable',
        `no TUI host is accepting modal windows; "${descriptor.id}" was not shown`,
      ))
    }
    const refusal = admission(descriptor, options)
    if (refusal !== undefined) return Promise.resolve(modalRejected('admission-denied', refusal))
    const controller = new AbortController()
    const instance: TuiModalInstance = Object.freeze({
      id: descriptor.id,
      ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
      component: descriptor.component,
      signal: controller.signal,
      close: () => { this.closeInstance(instance) },
      options: () => entry.options,
      updateOptions: (patch: TuiModalOptions) => { this.updateOptions(entry, patch) },
      setHidden: (hidden: boolean) => { this.setHidden(entry, hidden) },
      isHidden: () => entry.hidden,
      isFocused: () => this.focusedEntry === entry,
      focus: () => { this.focusInstance(entry) },
      unfocus: () => { this.releaseInstance(entry) },
      getBounds: () => (this.isOpen(entry) && available(entry) ? entry.bounds : undefined),
    })
    const entry: ModalEntry = {
      descriptor,
      instance,
      controller,
      defaults,
      overrides,
      options,
      settle: undefined,
      hidden: false,
      hostVisible: true,
      pinned: false,
      released: false,
      bounds: undefined,
    }
    this.entries.push(entry)
    this.byInstance.set(instance, entry)
    // The executor runs synchronously, so `settle` is armed before anyone can
    // observe the new stack entry.
    const result = new Promise<TuiModalOpenResult>(resolve => { entry.settle = resolve })
    this.emit()
    return result
  }

  /** Drop every instance created from this registration (owner unload). */
  closeRegistration(descriptor: TuiModalDescriptor): void {
    for (const entry of [...this.entries]) {
      if (entry.descriptor === descriptor) this.closeInstance(entry.instance)
    }
  }

  closeAll(): void {
    for (const entry of [...this.entries]) this.closeInstance(entry.instance)
  }

  stack(): readonly TuiModalInstance[] {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setAdmission(gate: TuiModalAdmission | undefined): () => void {
    this.admission = gate
    return () => {
      if (this.admission === gate) this.admission = undefined
    }
  }

  focused(): TuiModalInstance | undefined {
    return this.focusedEntry?.instance
  }

  setVisibility(instance: TuiModalInstance, visible: boolean): void {
    const entry = this.byInstance.get(instance)
    // A repeat of the current value is the common case — the host reports the
    // frame it just measured on every render — so it must cost nothing.
    if (entry === undefined || entry.hostVisible === visible) return
    entry.hostVisible = visible
    // Visibility is an input of the paint order, never a reorder of its own:
    // it repaints only when it takes input away from a window or gives it
    // back, and that is also the only way it moves the paint order.
    if (this.refresh()) this.publish()
  }

  setBounds(instance: TuiModalInstance, bounds: TuiModalBounds | undefined): void {
    const entry = this.byInstance.get(instance)
    if (entry === undefined) return
    // Copied and frozen: the host keeps measuring into its own object, and the
    // consumer of `getBounds()` must not be able to rewrite this projection.
    entry.bounds = bounds === undefined ? undefined : Object.freeze({ ...bounds })
  }

  acknowledge(instance: TuiModalInstance): void {
    const entry = this.byInstance.get(instance)
    // A late or duplicate acknowledgement never re-creates or re-resolves an
    // instance the host already closed.
    if (entry === undefined || entry.settle === undefined) return
    const settle = entry.settle
    entry.settle = undefined
    settle({ status: 'opened', instance })
  }

  fail(instance: TuiModalInstance, error: unknown): void {
    const entry = this.byInstance.get(instance)
    if (entry === undefined) return
    const settle = this.detach(entry)
    settle?.({
      status: 'failed',
      code: 'render-failed',
      message: `modal "${instance.id}" failed to render: ${messageOf(error)}`,
      cause: error,
    })
  }

  /** A plugin may keep its handle after `close()`; that handle still points at
   *  the old entry, so every late mutation checks the entry is the live one
   *  before touching the stack, the options or the input owner. */
  private isOpen(entry: ModalEntry): boolean {
    return this.byInstance.get(entry.instance) === entry
  }

  private focusInstance(entry: ModalEntry): void {
    // Without this, `moveToTop` finds no index and pushes the closed entry
    // back onto the stack — a window whose signal is already aborted.
    if (!this.isOpen(entry)) return
    if (this.focusedEntry === entry && this.entries.at(-1) === entry) return
    entry.pinned = true
    entry.released = false
    this.moveToTop(entry)
    this.emit()
  }

  private releaseInstance(entry: ModalEntry): void {
    if (!this.isOpen(entry) || entry.released) return
    entry.released = true
    this.emit()
  }

  private setHidden(entry: ModalEntry, hidden: boolean): void {
    if (!this.isOpen(entry) || entry.hidden === hidden) return
    entry.hidden = hidden
    // The host must paint or clear this window: a real repaint either way.
    this.emit()
  }

  private updateOptions(entry: ModalEntry, patch: TuiModalOptions): void {
    // Nothing outlives the close: no validation, no stored patch, no repaint.
    if (!this.isOpen(entry)) return
    // Validated before it is stored: a bad patch leaves the instance as it was.
    entry.overrides = patchModalOptions(entry.overrides, patch, `modal "${entry.descriptor.id}".updateOptions`)
    entry.options = mergeModalOptions(entry.defaults, entry.overrides)
    this.emit()
  }

  private moveToTop(entry: ModalEntry): void {
    const index = this.entries.indexOf(entry)
    if (index !== -1) this.entries.splice(index, 1)
    this.entries.push(entry)
  }

  private closeInstance(instance: TuiModalInstance): void {
    const entry = this.byInstance.get(instance)
    if (entry === undefined) return
    const settle = this.detach(entry)
    settle?.({
      status: 'failed',
      code: 'closed-before-ack',
      message: `modal "${instance.id}" closed before the host confirmed it mounted`,
    })
  }

  /** Remove one entry and abort its signal; returns the still-pending settler. */
  private detach(entry: ModalEntry): ModalSettler | undefined {
    const index = this.entries.indexOf(entry)
    if (index === -1) return undefined
    this.entries.splice(index, 1)
    this.byInstance.delete(entry.instance)
    entry.controller.abort()
    const settle = entry.settle
    entry.settle = undefined
    this.emit()
    return settle
  }

  /** Recompute the input owner: the last capturing window in stacking order
   *  that the host can show and the plugin did not release. Returns whether
   *  the owner changed. The stacking order itself is untouched — it is what
   *  this scan reads, so reordering it here would feed back into the choice. */
  private refresh(): boolean {
    const previous = this.focusedEntry
    let focused: ModalEntry | undefined
    for (const entry of this.entries) {
      if (!captures(entry) || !available(entry) || entry.released) continue
      focused = entry
    }
    this.focusedEntry = focused
    return previous !== focused
  }

  /** Rebuild the paint order the host renders: passive windows below capturing
   *  ones, and the input owner last. A released window is still capturing, so
   *  without moving the owner to the end the window the user just unfocused
   *  would keep painting above the window that now receives keys. */
  private publish(): void {
    const passive: ModalEntry[] = []
    const capturing: ModalEntry[] = []
    for (const entry of this.entries) (captures(entry) ? capturing : passive).push(entry)
    const focused = this.focusedEntry
    const order = focused === undefined
      ? [...passive, ...capturing]
      : [...passive, ...capturing.filter(entry => entry !== focused), focused]
    this.snapshot = Object.freeze(order.map(entry => entry.instance))
    for (const listener of this.listeners) listener()
  }

  private emit(): void {
    this.refresh()
    this.publish()
  }
}
