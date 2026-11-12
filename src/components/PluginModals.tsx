import React from 'react'
import * as ui from '../ui.js'
import { t } from '../i18n.js'
import type { ChannelUi } from '../adapter/ports/channel-ui.js'
import type { TuiModalHost, TuiModalInstance } from '../dsh-adapter/modal-stack.js'
import type { TuiModalOptions } from '../modal-options.js'
import StdinContext from '../ink/components/StdinContext.js'
import CursorDeclarationContext, { type CursorDeclarationSetter } from '../ink/components/CursorDeclarationContext.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'
import { EventEmitter } from '../ink/events/emitter.js'
import type { InputEvent, Key } from '../ink/events/input-event.js'
import type { KeyboardEvent } from '../ink/events/keyboard-event.js'
import type { DOMElement } from '../ink/dom.js'
import measureElement from '../ink/measure-element.js'
import { getRootNode, type FocusManager } from '../ink/focus.js'
import { PluginSceneBoundary } from './PluginSceneBoundary.js'
import { resolveModalLayout, type ModalLayout } from './modalLayout.js'

interface WindowInput {
  key: number
  emitter: EventEmitter
  node: DOMElement | null
}
interface ModalFrame {
  instance: TuiModalInstance
  input: WindowInput
  options: TuiModalOptions
  layout: ModalLayout
  visible: boolean
  focused: boolean
  failure?: { error: unknown }
}
const EMPTY_STACK: readonly TuiModalInstance[] = Object.freeze([])
const emptyStack = () => EMPTY_STACK
const noSubscription = () => () => {}
const ModalFocusContext = React.createContext(false)

/** Native Tab/autoFocus must obey the same window boundary as useInput.
 * Scope the injected kit, not the renderer or the module's original Box. */
function ModalBox(props: React.ComponentProps<typeof ui.Box>): React.ReactNode {
  const focused = React.useContext(ModalFocusContext)
  return <ui.Box {...props} autoFocus={focused && props.autoFocus}
    tabIndex={focused || props.tabIndex === undefined ? props.tabIndex : -1} />
}
const MODAL_UI: typeof ui = { ...ui, Box: ModalBox }

function contains(parent: DOMElement, target: DOMElement | null): boolean {
  for (let node = target; node; node = node.parentNode ?? null) if (node === parent) return true
  return false
}
function isVisible(options: TuiModalOptions, viewport: { columns: number; rows: number }): boolean {
  if (!options.visible) return true
  const result = options.visible(viewport.columns, viewport.rows)
  if (typeof result !== 'boolean') throw new TypeError('modal visible() must return a boolean')
  return result
}

/** A single owner routes keys, independent of paint order and passive windows.
 * Each instance has its own stdin context; hidden/lower hooks never get keys. */
export function usePluginModals(host: TuiModalHost | undefined, channel: ChannelUi, refusal: () => string | undefined) {
  const terminal = ui.useTerminalSize()
  const [measured, setMeasured] = React.useState({ columns: terminal.columns, rows: terminal.rows, defaultRows: terminal.rows })
  const viewport = { columns: Math.max(1, Math.min(measured.columns, terminal.columns)), rows: Math.max(1, Math.min(measured.rows, terminal.rows)) }
  // Keep the original short-frame budget while excluding scrollback/cursor
  // reserve from the positioning viewport. Neither budget may grow the chat.
  const defaults = { columns: viewport.columns, rows: Math.min(measured.defaultRows, terminal.rows) }
  const viewportRef = React.useRef(viewport)
  viewportRef.current = viewport
  const currentRefusal = React.useRef(refusal)
  currentRefusal.current = refusal
  const windows = React.useRef(new Map<TuiModalInstance, WindowInput>())
  const nextKey = React.useRef(0)
  const draining = React.useRef(false)
  const binding = `${channel.sessionId}:${channel.agentBindingGeneration ?? ''}`
  const previousBinding = React.useRef(binding)
  const currentBinding = React.useRef(binding)
  currentBinding.current = binding
  const stack = React.useSyncExternalStore(host?.subscribe ?? noSubscription, host?.stack ?? emptyStack)
  React.useLayoutEffect(() => {
    if (!host) return
    const off = host.setAdmission((_descriptor, options) => {
      if (previousBinding.current !== currentBinding.current) return 'session-changing'
      const blocked = currentRefusal.current()
      if (blocked !== undefined) return blocked
      try { return isVisible(options, viewportRef.current) ? undefined : 'responsive-hidden' }
      catch (error) { return `visibility failed: ${error instanceof Error ? error.message : String(error)}` }
    })
    return () => { off(); host.closeAll() }
  }, [host])
  React.useLayoutEffect(() => {
    if (binding !== previousBinding.current) host?.closeAll()
    previousBinding.current = binding
  }, [binding, host])
  for (const instance of stack) {
    if (!windows.current.has(instance)) windows.current.set(instance, { key: ++nextKey.current, emitter: new EventEmitter(), node: null })
  }
  for (const instance of windows.current.keys()) if (!stack.includes(instance)) windows.current.delete(instance)
  const allowed = refusal() === undefined && binding === previousBinding.current
  const frames: ModalFrame[] = stack.map(instance => {
    const options = instance.options()
    let visible = false
    let failure: ModalFrame['failure']
    try { visible = allowed && !instance.signal.aborted && !instance.isHidden() && isVisible(options, viewport) }
    catch (error) { failure = { error } }
    return { instance, input: windows.current.get(instance)!, options, layout: resolveModalLayout(viewport, options, defaults), visible,
      focused: visible && host?.focused() === instance, failure }
  })
  const inputOwner = (): TuiModalInstance | undefined => {
    if (currentRefusal.current() !== undefined || previousBinding.current !== currentBinding.current) return undefined
    const instance = host?.focused()
    if (!instance || instance.signal.aborted || instance.isHidden()) return undefined
    try { return isVisible(instance.options(), viewportRef.current) ? instance : undefined }
    catch { return undefined }
  }
  const layer = host ? <PluginModalLayer host={host} channel={channel} frames={frames} viewport={viewport}
    onMeasure={next => {
      viewportRef.current = next
      setMeasured(old => old.columns === next.columns && old.rows === next.rows && old.defaultRows === next.defaultRows ? old : next)
    }} isDraining={() => draining.current} /> : null
  return {
    active: frames.some(frame => frame.focused),
    /** Chat root `onKeyDownCapture`: background focusables never see a key a window owns. */
    captureBackgroundKeys(event: KeyboardEvent): void {
      if (draining.current || inputOwner() !== undefined) { event.preventDefault(); event.stopImmediatePropagation() }
    },
    handleInput(input: string, key: Key, event: InputEvent): boolean {
      if (draining.current) { event.stopImmediatePropagation(); return true }
      const owner = inputOwner()
      if (!owner) return false
      if (!key.isPasted && (key.escape || (key.ctrl && input === 'c'))) owner.close()
      else if (!resolveModalLayout(viewportRef.current, owner.options(), defaults).compact) windows.current.get(owner)?.emitter.emit('input', event)
      if (host?.focused() !== owner) {
        draining.current = true
        queueMicrotask(() => { draining.current = false })
      }
      event.stopImmediatePropagation()
      return true
    },
    /** Mount the window layer over the chat screen; without a host the screen is returned as is. */
    frame(content: React.ReactNode): React.ReactNode {
      return host ? <ui.Box flexDirection="column" flexGrow={1} width="100%">
        {content}
        {layer}
      </ui.Box> : content
    },
  }
}

function PluginModalLayer({ host, channel, frames, viewport, onMeasure, isDraining }: {
  host: TuiModalHost
  channel: ChannelUi
  frames: readonly ModalFrame[]
  viewport: { columns: number; rows: number }
  onMeasure(size: { columns: number; rows: number; defaultRows: number }): void
  isDraining(): boolean
}) {
  const terminal = ui.useTerminalSize()
  const catcher = React.useRef<DOMElement | null>(null)
  const lastBackgroundFocus = React.useRef<DOMElement | null>(null)
  const focus = React.useRef<{ manager: FocusManager; root: DOMElement; previous: DOMElement | null; window: DOMElement } | null>(null)
  const insideWindow = (target: DOMElement | null) => (focus.current !== null && contains(focus.current.window, target))
    || frames.some(frame => frame.input.node && contains(frame.input.node, target))
  // Capture the prior owner before a newly mounted child runs autoFocus.
  const prior = catcher.current && getRootNode(catcher.current).focusManager?.activeElement
  if (prior && !insideWindow(prior)) lastBackgroundFocus.current = prior
  React.useLayoutEffect(() => {
    for (const frame of frames) {
      if (frame.failure) {
        host.fail(frame.instance, frame.failure.error)
        channel.notify(t('plugin-modal-crashed', { id: frame.instance.id, err: frame.failure.error instanceof Error ? frame.failure.error.message : String(frame.failure.error) }), { color: 'error' })
      } else {
        host.setVisibility(frame.instance, frame.visible)
        const { left, top, columns, rows } = frame.layout
        host.setBounds(frame.instance, frame.visible ? { left, top, columns, rows } : undefined)
      }
    }
    if (!catcher.current) return
    const root = getRootNode(catcher.current)
    const manager = root.focusManager!
    const wasWindow = insideWindow(manager.activeElement)
    if (manager.activeElement && !wasWindow) lastBackgroundFocus.current = manager.activeElement
    const owner = frames.find(frame => frame.visible && frame.instance === host.focused())
    const node = owner?.input.node
    if (node) {
      focus.current ??= { manager, root, previous: lastBackgroundFocus.current, window: node }
      focus.current.window = node
      if (!contains(node, manager.activeElement)) manager.focus(node)
    } else {
      const previous = focus.current?.previous ?? lastBackgroundFocus.current
      if (wasWindow || !manager.activeElement) {
        if (previous && contains(root, previous)) manager.focus(previous)
        else manager.blur()
      }
      focus.current = null
    }
  })
  React.useLayoutEffect(() => {
    const parent = catcher.current?.parentNode
    if (!parent) return
    const size = measureElement(parent)
    if (size.width <= 0 || size.height <= 0) return
    // Inline frames can extend into scrollback. Use the parent's visible
    // tail and the renderer's cursor-restore row, as image previews do.
    let bottom = size.height
    let rootHeight = size.height
    for (let ancestor: DOMElement | undefined = parent; ancestor; ancestor = ancestor.parentNode) {
      bottom += ancestor.yogaNode?.getComputedTop() ?? 0
      rootHeight = ancestor.yogaNode?.getComputedHeight() ?? rootHeight
    }
    const screenRows = terminal.screenRows ?? terminal.rows
    const viewportTop = rootHeight > screenRows ? rootHeight - screenRows + 1 : 0
    const rows = Math.max(1, Math.min(size.height, bottom - viewportTop, terminal.rows))
    onMeasure({ columns: Math.max(1, Math.min(size.width, terminal.columns)), rows, defaultRows: Math.min(size.height, terminal.rows) })
  })
  const owner = frames.find(frame => frame.focused)
  const swallow = React.useCallback((event: { stopImmediatePropagation(): void }) => event.stopImmediatePropagation(), [])
  return <>
    <ui.Box ref={catcher} display={owner ? 'flex' : 'none'} position="absolute" bottom={0} left={0}
      width="100%" height={viewport.rows} backdrop={owner?.options.style?.backdrop === false ? undefined : 'dim'}
      onClick={swallow} onWheel={swallow} onDragStart={swallow} onDragMove={swallow} onDragEnd={swallow} />
    {frames.map(frame => <ModalWindow key={frame.input.key} host={host} channel={channel} frame={frame} isDraining={isDraining} />)}
  </>
}

function ModalWindow({ host, channel, frame, isDraining }: {
  host: TuiModalHost
  channel: ChannelUi
  frame: ModalFrame
  isDraining(): boolean
}) {
  const { instance, input: windowInput, visible, focused, layout, options } = frame
  const style = options.style ?? {}
  const stdin = ui.useStdin()
  const screen = ui.useTerminalSize()
  const acceptsCursor = focused && !layout.compact
  const declareCursor = React.useContext(CursorDeclarationContext)
  const cursorNode = React.useRef<DOMElement | null>(null)
  const scopedCursor = React.useCallback<CursorDeclarationSetter>((declaration, clearIfNode) => {
    if (declaration) {
      if (!acceptsCursor) return
      cursorNode.current = declaration.node
      declareCursor(declaration)
    } else if (clearIfNode) declareCursor(null, clearIfNode)
  }, [declareCursor, acceptsCursor])
  React.useLayoutEffect(() => {
    if (!acceptsCursor && cursorNode.current) declareCursor(null, cursorNode.current)
  }, [declareCursor, acceptsCursor])
  const context = React.useMemo(() => ({ ...stdin, internal_eventEmitter: windowInput.emitter }), [stdin, windowInput])
  const swallow = (event: { stopImmediatePropagation(): void }) => event.stopImmediatePropagation()
  return <ui.Box ref={node => { windowInput.node = node }} tabIndex={-1}
    onKeyDownCapture={event => {
      if (!focused || isDraining() || event.key === 'escape' || (event.ctrl && event.key === 'c')) {
        event.preventDefault(); event.stopImmediatePropagation(); return
      }
      if (event.key === 'tab') {
        event.preventDefault()
        const node = windowInput.node
        const manager = node && getRootNode(node).focusManager
        if (node && manager) {
          if (event.shift) manager.focusPrevious(node)
          else manager.focusNext(node)
        }
      }
    }}
    display={visible ? 'flex' : 'none'} position="absolute" left={layout.left} bottom={layout.bottom} width={layout.columns} height={layout.rows}
    flexDirection="column" flexShrink={0} overflow="hidden" backgroundColor={style.backgroundColor === null ? undefined : style.backgroundColor ?? 'toolCardBackground'} opaque
    borderStyle={layout.compact || style.borderStyle === 'none' ? undefined : style.borderStyle ?? 'round'}
    borderColor={style.borderColor === null ? undefined : style.borderColor ?? (focused ? 'accent' : 'inactive')}
    onClick={event => { event.stopImmediatePropagation(); instance.focus() }} onWheel={swallow}
    onDragStart={swallow} onDragMove={swallow} onDragEnd={swallow}>
    {layout.compact && <ui.Box flexDirection="column" flexShrink={0}>
      <ui.Text wrap="truncate">{focused ? t('plugin-modal-close-compact') : t('plugin-modal-passive')}</ui.Text>
      {layout.rows > 1 && <ui.Text wrap="truncate">{t('plugin-modal-space')}</ui.Text>}
    </ui.Box>}
    <ui.Box display={layout.compact ? 'none' : 'flex'} flexDirection="column">
      {style.chrome !== false && <ui.Text bold color={style.titleColor === null ? undefined : style.titleColor ?? 'accent'} wrap="truncate">{instance.title ?? instance.id}</ui.Text>}
      <ui.Box flexDirection="column" height={layout.contentSize.rows + layout.paddingY * 2} flexShrink={0}
        paddingX={layout.paddingX} paddingY={layout.paddingY} overflow="hidden">
        <TerminalSizeContext.Provider value={{ ...layout.contentSize, screenRows: screen.screenRows ?? screen.rows }}>
          <StdinContext.Provider value={context}>
            <CursorDeclarationContext.Provider value={scopedCursor}>
              <ModalFocusContext.Provider value={focused}>
                <PluginSceneBoundary id={instance.id} onError={(id, error) => {
                  host.fail(instance, error)
                  channel.notify(t('plugin-modal-crashed', { id, err: error.message }), { color: 'error' })
                }}>
                  <React.Suspense fallback={<ui.Text dimColor>{t('plugin-modal-loading')}</ui.Text>}>
                    <ModalContent host={host} instance={instance} visible={visible}>
                      {React.createElement(instance.component, { React, ui: MODAL_UI, channel, close: instance.close, focused, contentSize: layout.contentSize, signal: instance.signal })}
                    </ModalContent>
                  </React.Suspense>
                </PluginSceneBoundary>
              </ModalFocusContext.Provider>
            </CursorDeclarationContext.Provider>
          </StdinContext.Provider>
        </TerminalSizeContext.Provider>
      </ui.Box>
      {style.chrome !== false && <ui.Text dimColor wrap="truncate">{focused ? t('plugin-modal-close') : t('plugin-modal-passive')}</ui.Text>}
    </ui.Box>
  </ui.Box>
}

/** A suspended child must not acknowledge an open from its loading frame. */
function ModalContent({ host, instance, visible, children }: React.PropsWithChildren<{
  host: TuiModalHost
  instance: TuiModalInstance
  visible: boolean
}>) {
  React.useEffect(() => { if (visible) host.acknowledge(instance) }, [host, instance, visible])
  return children
}
