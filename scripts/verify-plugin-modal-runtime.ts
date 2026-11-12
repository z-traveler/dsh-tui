/**
 * Plugin modal runtime (ticket 01): `tuiScenes.registerModal` / `openModal`
 * driven through REAL cordis activations, plus the host-only modal facade.
 *
 * Covered caller-recognizable behavior:
 *
 *   A. detectability: the registration API exists on the service, so a plugin
 *      can refuse to run on a host that would only offer full-screen scenes;
 *   B. refusals create nothing: unknown id (`not-registered`), another
 *      activation's registration (`foreign-owner`), no host consumer
 *      (`host-unavailable`), host admission gate (`admission-denied`);
 *   C. `opened` is reported only after the host acknowledges the mount, and
 *      every open is an independent instance of the same registered type;
 *   D. closing the BOTTOM instance keeps the top one, aborts only its own
 *      signal, and a late acknowledgement cannot resurrect it;
 *   E. closing before the ack settles the open as `closed-before-ack`; a host
 *      render failure settles it as `render-failed` and drops only that
 *      instance;
 *   F. owner isolation: a second activation cannot open the first one's modal,
 *      unloading one plugin closes only its windows, and a torn-down
 *      activation cannot reach `openModal` at all (synchronous throw instead of
 *      a `rejected` result);
 *   G. session switch (`closeAll`) and scope teardown clear the stack;
 *   H. the old full-screen scene API keeps its behavior, and the two id
 *      namespaces stay separate;
 *   I. modal contributions land in the effect ledger (needs no UI);
 *   J. the options capability is detectable (`modalOptionsVersion`) so a
 *      plugin never passes options to a host that would silently ignore them;
 *   K. descriptor `options` are the type default, `openModal(id, options)`
 *      overrides them for that instance only, and a descriptor without
 *      options keeps the round-1 window;
 *   L. invalid/unknown options and fake transparency are TypeErrors;
 *   M. `updateOptions` merges geometry and style per field, `undefined`
 *      restores the descriptor default, and nothing is rebuilt;
 *   N. `setHidden`/`isHidden` keeps the instance and its state and moves the
 *      input owner to the next available window;
 *   O. the host visibility/bounds projection: bounds-only updates never
 *      notify, a repeated visibility value never notifies (no per-frame
 *      loop), hidden windows report no bounds and release input;
 *   P. `nonCapturing` opens without taking input, paints below the active
 *      capturing window, and can be focused/unfocused explicitly — and the
 *      window that owns input is always the last one painted, so a released
 *      window never covers the live input owner;
 *   Q. the admission gate receives the effective options and can refuse an
 *      open whose `visible` predicate fails at the current viewport;
 *   R. only a plain (or null-prototype) object is an option document, and an
 *      unknown key is a TypeError even when its value is `undefined`, on the
 *      open path and the update patch alike;
 *   S. percentages take decimals in 0..100 (cells stay integers) and the nine
 *      anchors use Pi's `left-center`/`right-center` middle-row names;
 *   T. a handle whose instance was closed is inert: `focus` cannot resurrect
 *      an aborted window, `updateOptions`/`setHidden`/`unfocus` change and
 *      notify nothing, and `getBounds` keeps returning no rect.
 *
 * HOME/USERPROFILE are isolated before any src import; no model credentials,
 * no TTY and no React render are involved (the UI half is ticket 02).
 *
 * Run: node --import tsx/esm scripts/verify-plugin-modal-runtime.ts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-plugin-modal-home-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome

const { Context } = await import('@deepseek-ai/cordis')
const { TuiSceneRuntime, getHostSceneRuntime } = await import('../src/dsh-adapter/scenes.js')
const { TuiEffectLedgerRuntime } = await import('../src/dsh-adapter/effect-ledger.js')
import type {
  TuiModalBounds,
  TuiModalDescriptor,
  TuiModalInstance,
  TuiModalOpenResult,
  TuiModalOptions,
  TuiModalStyle,
  TuiSceneDescriptor,
} from '../src/scenes.js'

let failed = 0
const describe = (result: TuiModalOpenResult): string => JSON.stringify(result, (key, value) =>
  key === 'instance' && value !== null && typeof value === 'object' ? (value as TuiModalInstance).id : value)
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

const component = (): null => null
const modalDescriptor = (id: string): TuiModalDescriptor => ({ id, title: `title:${id}`, component })
const sceneDescriptor = (id: string): TuiSceneDescriptor => ({ id, component: () => null })

// ── root composition: scenes row + the effect ledger it records into ──────
const ledgerFile = join(fakeHome, 'effect-ledger.jsonl')
const root = new Context()
new TuiEffectLedgerRuntime(root, { file: ledgerFile })
await root.plugin(TuiSceneRuntime)
const host = getHostSceneRuntime(root.get('tuiScenes'))
if (host === undefined) throw new Error('modal battery: host scene facade unavailable')
const modal = host.modal

/** Mount one real plugin activation on this composition. */
async function activate(
  name: string,
  setup: (ctx: InstanceType<typeof Context>) => void,
): Promise<{ ctx: InstanceType<typeof Context>; dispose: () => Promise<unknown> }> {
  let activated: InstanceType<typeof Context> | undefined
  const fiber = root.inject(['tuiScenes'], (ctx: InstanceType<typeof Context>) => {
    activated = ctx
    setup(ctx)
  }) as unknown as { dispose(): Promise<unknown> }
  await fiber
  if (activated === undefined) throw new Error(`modal battery: ${name} did not activate`)
  return { ctx: activated, dispose: () => fiber.dispose() }
}

// ── A. detection + registration surface ──────────────────────────────────
const alpha = await activate('alpha', (ctx) => {
  ctx.tuiScenes.registerModal(modalDescriptor('panel'))
})
check('registerModal/openModal are detectable on the scenes service',
  typeof alpha.ctx.tuiScenes.registerModal === 'function' && typeof alpha.ctx.tuiScenes.openModal === 'function')
let duplicateIdThrew = false
try {
  alpha.ctx.tuiScenes.registerModal(modalDescriptor('panel'))
} catch {
  duplicateIdThrew = true
}
check('a duplicate modal id is rejected like a duplicate scene id', duplicateIdThrew)
let invalidIdThrew = false
try {
  alpha.ctx.tuiScenes.registerModal(modalDescriptor('Panel Window'))
} catch (error) {
  invalidIdThrew = error instanceof TypeError
}
check('an invalid modal id is a TypeError', invalidIdThrew)

// ── B. refusals never create an instance ─────────────────────────────────
const unknown = await alpha.ctx.tuiScenes.openModal('absent')
check('an unknown id is refused as not-registered',
  unknown.status === 'rejected' && unknown.code === 'not-registered', describe(unknown))

const noHost = await alpha.ctx.tuiScenes.openModal('panel')
check('without a host admission gate the open is refused as host-unavailable',
  noHost.status === 'rejected' && noHost.code === 'host-unavailable', describe(noHost))
check('refusals leave the stack empty', modal.stack().length === 0)

const refusingGate = modal.setAdmission(() => 'this page is not a chat')
const denied = await alpha.ctx.tuiScenes.openModal('panel')
check('the host gate can refuse an open and its reason reaches the plugin',
  denied.status === 'rejected' && denied.code === 'admission-denied' && denied.message === 'this page is not a chat',
  describe(denied))
check('a denied open creates no instance', modal.stack().length === 0)

const clearRefusing = modal.setAdmission(() => 'a key interaction is active')
refusingGate()
const stillDenied = await alpha.ctx.tuiScenes.openModal('panel')
check('a stale gate disposer does not clear the installed gate',
  stillDenied.status === 'rejected' && stillDenied.code === 'admission-denied' && stillDenied.message === 'a key interaction is active',
  describe(stillDenied))
clearRefusing()
const clearedGate = await alpha.ctx.tuiScenes.openModal('panel')
check('clearing the installed gate returns to host-unavailable',
  clearedGate.status === 'rejected' && clearedGate.code === 'host-unavailable', describe(clearedGate))

modal.setAdmission(() => undefined)

// ── C. one independent instance per open; opened only after the ack ──────
const firstOpen = alpha.ctx.tuiScenes.openModal('panel')
const secondOpen = alpha.ctx.tuiScenes.openModal('panel')
let settledEarly: TuiModalOpenResult | undefined
void firstOpen.then((result) => { settledEarly = result })
check('every open appends its own instance to the stack', modal.stack().length === 2, `stack=${modal.stack().length}`)
const [bottom, top] = modal.stack()
check('instances of the same type are distinct handles',
  bottom !== top && bottom.id === 'panel' && top.id === 'panel')
check('the instances carry the registered title and a live signal',
  bottom.title === 'title:panel' && !bottom.signal.aborted)
let notified = 0
const unsubscribe = modal.subscribe(() => { notified += 1 })
const stackBeforeAck = modal.stack()
check('the stack snapshot is stable between transitions', stackBeforeAck === modal.stack())
await Promise.resolve()
check('openModal stays pending until the host acknowledges', settledEarly === undefined)
modal.acknowledge(bottom)
modal.acknowledge(top)
const openedFirst = await firstOpen
const openedSecond = await secondOpen
check('an acknowledged open reports opened',
  openedFirst.status === 'opened' && openedFirst.instance === bottom
  && openedSecond.status === 'opened' && openedSecond.instance === top,
  `${describe(openedFirst)} / ${describe(openedSecond)}`)

// ── D. closing the bottom instance keeps the top one ────────────────────
bottom.close()
check('closing the bottom instance leaves the top instance mounted',
  modal.stack().length === 1 && modal.stack()[0] === top, `stack=${modal.stack().length}`)
check('only the closed instance signal aborts', bottom.signal.aborted && !top.signal.aborted)
modal.acknowledge(bottom)
check('a late acknowledgement never resurrects a closed instance',
  modal.stack().length === 1 && modal.stack()[0] === top)

// ── E. close before ack, and host-reported render failure ───────────────
const thirdOpen = alpha.ctx.tuiScenes.openModal('panel')
const thirdInstance = modal.stack()[modal.stack().length - 1]
thirdInstance.close()
const closedThird = await thirdOpen
check('closing before the ack fails the open as closed-before-ack',
  closedThird.status === 'failed' && closedThird.code === 'closed-before-ack', describe(closedThird))
check('the failed open leaves the already mounted instance alone',
  modal.stack().length === 1 && modal.stack()[0] === top)

const fourthOpen = alpha.ctx.tuiScenes.openModal('panel')
const fourthInstance = modal.stack()[modal.stack().length - 1]
modal.fail(fourthInstance, new Error('render boom'))
const failedFourth = await fourthOpen
check('a host render failure rejects the open as render-failed',
  failedFourth.status === 'failed' && failedFourth.code === 'render-failed'
  && failedFourth.message.includes('render boom'), describe(failedFourth))
check('the failed instance is gone and its signal aborted',
  modal.stack().length === 1 && fourthInstance.signal.aborted)
modal.fail(top, new Error('crash after mount'))
check('failing an acknowledged instance drops just that instance', modal.stack().length === 0)
check('the host change feed reported the stack transitions', notified > 0, `notified=${notified}`)
check('a transition replaces the stack snapshot', modal.stack() !== stackBeforeAck)
unsubscribe()

// ── F. owner isolation across activations ───────────────────────────────
let betaCtx: InstanceType<typeof Context> | undefined
const beta = await activate('beta', (ctx) => {
  betaCtx = ctx
  ctx.tuiScenes.registerModal(modalDescriptor('other'))
})
if (betaCtx === undefined) throw new Error('modal battery: beta context missing')
const foreign = await betaCtx.tuiScenes.openModal('panel')
check('another activation cannot open a foreign modal',
  foreign.status === 'rejected' && foreign.code === 'foreign-owner', describe(foreign))
const foreignReverse = await alpha.ctx.tuiScenes.openModal('other')
check('the first activation cannot open the second one\'s modal',
  foreignReverse.status === 'rejected' && foreignReverse.code === 'foreign-owner', describe(foreignReverse))

const alphaOpen = alpha.ctx.tuiScenes.openModal('panel')
modal.acknowledge(modal.stack()[modal.stack().length - 1])
const betaOpen = betaCtx.tuiScenes.openModal('other')
modal.acknowledge(modal.stack()[modal.stack().length - 1])
check('windows of two owners stack together',
  (await alphaOpen).status === 'opened' && (await betaOpen).status === 'opened' && modal.stack().length === 2)
const alphaPending = alpha.ctx.tuiScenes.openModal('panel')
await alpha.dispose()
const alphaPendingResult = await alphaPending
check('unloading a plugin fails its own pending open',
  alphaPendingResult.status === 'failed' && alphaPendingResult.code === 'closed-before-ack',
  describe(alphaPendingResult))
check('unloading a plugin closes only its windows',
  modal.stack().length === 1 && modal.stack()[0].id === 'other', `stack=${modal.stack().map(i => i.id).join(',')}`)
const afterUnload = await betaCtx.tuiScenes.openModal('panel')
check('the unloaded registration stops being openable',
  afterUnload.status === 'rejected' && afterUnload.code === 'not-registered', describe(afterUnload))

// `openModal` only compares owners when it could resolve the caller's
// activation (`owner !== undefined`), so a dead caller must never get that far.
// The disposed caller retains a service handle whose registration is already
// gone: a lookup-first implementation would answer `not-registered` instead of
// throwing, which is what pins the ordering here. The message is the live
// activation refusal that `requirePluginCaller` raises for a disposed fiber.
const gamma = await activate('gamma', (ctx) => {
  ctx.tuiScenes.registerModal(modalDescriptor('stale'))
})
const retainedScenes = gamma.ctx.tuiScenes
await gamma.dispose()
let staleOpen: Promise<TuiModalOpenResult> | undefined
let staleOpenError: unknown
try {
  staleOpen = retainedScenes.openModal('stale')
} catch (error) {
  staleOpenError = error
}
if (staleOpen !== undefined) {
  await staleOpen.catch((error: unknown) => { staleOpenError = error })
}
check('a dead activation cannot openModal; the refusal is a synchronous throw',
  staleOpen === undefined && staleOpenError instanceof Error
  && /^dsh-tui: tuiScenes\.openModal requires a live /.test(staleOpenError.message),
  staleOpenError instanceof Error ? staleOpenError.message : String(staleOpen))

// ── G. session switch clears the stack ──────────────────────────────────
const beforeSwitch = modal.stack()[0]
modal.closeAll()
check('closeAll (session switch) clears the stack and aborts the instances',
  modal.stack().length === 0 && beforeSwitch.signal.aborted)

// ── H. the old full-screen scene API keeps its behavior ─────────────────
betaCtx.tuiScenes.register(sceneDescriptor('old-scene'))
let sceneNotified = 0
const offScene = betaCtx.tuiScenes.subscribe(() => { sceneNotified += 1 })
check('a full-screen scene still opens over the conversation', betaCtx.tuiScenes.open('old-scene') === true)
check('the scene becomes the host active scene and notifies',
  host.active?.id === 'old-scene' && sceneNotified === 1, `notified=${sceneNotified}`)
check('a full-screen scene never enters the modal stack', modal.stack().length === 0)
betaCtx.tuiScenes.close()
check('closing the scene returns to the conversation', host.active === undefined)
offScene()
check('the two id namespaces stay separate',
  betaCtx.tuiScenes.open('other') === false && (await betaCtx.tuiScenes.openModal('old-scene')).code === 'not-registered')

// ── I. scoped teardown and the effect ledger ────────────────────────────
const scope = new Context()
const scopeFiber = scope.plugin(TuiSceneRuntime)
await scopeFiber
const scopeHost = getHostSceneRuntime(scope.get('tuiScenes'))
if (scopeHost === undefined) throw new Error('modal battery: scoped host facade unavailable')
scopeHost.modal.setAdmission(() => undefined)
let scopeCtx: InstanceType<typeof Context> | undefined
await scope.inject(['tuiScenes'], (ctx: InstanceType<typeof Context>) => {
  scopeCtx = ctx
  ctx.tuiScenes.registerModal(modalDescriptor('panel'))
})
if (scopeCtx === undefined) throw new Error('modal battery: scoped activation missing')
const scopedOpen = scopeCtx.tuiScenes.openModal('panel')
const scopedInstance = scopeHost.modal.stack()[0]
scopeHost.modal.acknowledge(scopedInstance)
check('a window opens inside a disposable scope', (await scopedOpen).status === 'opened')
const scopedPending = scopeCtx.tuiScenes.openModal('panel')
await scopeFiber.dispose()
check('disposing the scope closes every window',
  scopeHost.modal.stack().length === 0 && scopedInstance.signal.aborted)
check('disposing the scope fails a pending open',
  (await scopedPending).code === 'closed-before-ack')

const ledgerText = readFileSync(ledgerFile, 'utf8')
check('modal contributions land in the effect ledger',
  ledgerText.includes('"kind":"modal"') && ledgerText.includes('"operation":"create"')
  && ledgerText.includes('"operation":"release"'))

// ── shared helpers for the options battery ──────────────────────────────
/** The instance one open added, wherever the stack inserted it. */
function openedInstance(before: readonly TuiModalInstance[]): TuiModalInstance {
  const added = modal.stack().filter(instance => !before.includes(instance))
  if (added.length !== 1) throw new Error(`modal battery: expected one new instance, saw ${added.length}`)
  return added[0]!
}

const closeAndAck = async (ctx: InstanceType<typeof Context>, id: string, options?: TuiModalOptions): Promise<TuiModalInstance> => {
  const before = modal.stack()
  const open = ctx.tuiScenes.openModal(id, options)
  const instance = openedInstance(before)
  modal.acknowledge(instance)
  if ((await open).status !== 'opened') throw new Error(`modal battery: ${id} did not open`)
  return instance
}

// ── J. the options capability is detectable ─────────────────────────────
const styledDescriptor: TuiModalDescriptor = {
  id: 'styled',
  title: 'styled',
  component,
  options: {
    width: '50%',
    col: '25%',
    style: { paddingX: 2, backgroundColor: 'toolCardBackground' },
    visible: (columns, rows) => columns > 40 && rows > 20,
  },
}
const plainDescriptor: TuiModalDescriptor = { id: 'plain', component }
const passiveDescriptor: TuiModalDescriptor = { id: 'passive', component, options: { nonCapturing: true } }
const delta = await activate('delta', (ctx) => {
  ctx.tuiScenes.registerModal(styledDescriptor)
  ctx.tuiScenes.registerModal(plainDescriptor)
  ctx.tuiScenes.registerModal(passiveDescriptor)
})
check('an options-aware host is detectable as modalOptionsVersion === 1',
  delta.ctx.tuiScenes.modalOptionsVersion === 1, String(delta.ctx.tuiScenes.modalOptionsVersion))

// ── K. descriptor defaults, per-open overrides, round-1 default ─────────
modal.closeAll()
const styled = await closeAndAck(delta.ctx, 'styled')
check('an open without options inherits the descriptor defaults',
  styled.options().width === '50%' && styled.options().col === '25%'
  && styled.options().style?.paddingX === 2 && styled.options().style?.backgroundColor === 'toolCardBackground')
check('the descriptor\'s visible() predicate is part of the effective options',
  typeof styled.options().visible === 'function' && styled.options().visible(80, 30) === true
  && styled.options().visible(80, 20) === false)
const overridden = await closeAndAck(delta.ctx, 'styled', { width: 30, style: { borderColor: 'accent' } })
check('openModal options override the descriptor for that instance only',
  overridden.options().width === 30 && overridden.options().col === '25%'
  && overridden.options().style?.paddingX === 2 && overridden.options().style?.borderColor === 'accent')
check('a per-open override never rewrites the descriptor default',
  styled.options().width === '50%' && styled.options().style?.borderColor === undefined)
const plain = await closeAndAck(delta.ctx, 'plain')
check('a descriptor without options is the unchanged round-1 window',
  Object.keys(plain.options()).length === 0)
check('an unknown option key on a descriptor is a TypeError', (() => {
  try {
    delta.ctx.tuiScenes.registerModal({ id: 'bad-descriptor', component, options: { opactity: 0.5 } as TuiModalOptions })
    return false
  } catch (error) {
    return error instanceof TypeError
  }
})())

// ── L. invalid options never degrade silently ───────────────────────────
const invalidOptions: Array<[string, TuiModalOptions]> = [
  ['unknown option key', { opactity: 0.5 } as TuiModalOptions],
  ['negative width', { width: -1 }],
  ['percentage above 100%', { width: '140%' }],
  ['fractional cell width', { width: 12.5 }],
  ['unknown anchor', { anchor: 'middle' } as TuiModalOptions],
  ['negative margin edge', { margin: { top: -2 } }],
  ['unknown margin edge', { margin: { centre: 2 } } as TuiModalOptions],
  ['non-boolean nonCapturing', { nonCapturing: 'yes' } as TuiModalOptions],
  ['unknown style key', { style: { opacity: 0.5 } } as TuiModalOptions],
  ['rgba fake transparency', { style: { backgroundColor: 'rgba(0,0,0,0.5)' } } as TuiModalOptions],
  ['8-digit hex alpha', { style: { backgroundColor: '#11223344' } } as TuiModalOptions],
  ['unknown backdrop mode', { style: { backdrop: 'solid' } } as TuiModalOptions],
  ['unknown border style', { style: { borderStyle: 'wiggly' } } as TuiModalOptions],
]
const stackBeforeInvalid = modal.stack().length
for (const [name, options] of invalidOptions) {
  let threw: unknown
  try {
    delta.ctx.tuiScenes.openModal('plain', options)
  } catch (error) {
    threw = error
  }
  check(`an invalid option is a TypeError (${name})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}
check('a refused invalid open creates no instance', modal.stack().length === stackBeforeInvalid)
let updateThrew: unknown
try {
  plain.updateOptions({ height: 'lots' } as TuiModalOptions)
} catch (error) {
  updateThrew = error
}
check('an invalid updateOptions patch is a TypeError and changes nothing',
  updateThrew instanceof TypeError && Object.keys(plain.options()).length === 0)

// ── M. runtime option updates keep the instance alive ───────────────────
const stackSizeBeforeUpdate = modal.stack().length
const signalBeforeUpdate = styled.signal
let optionNotified = 0
const offOptions = modal.subscribe(() => { optionNotified += 1 })
styled.updateOptions({ width: '80%', style: { paddingY: 1 } })
check('updateOptions merges geometry per field',
  styled.options().width === '80%' && styled.options().col === '25%')
check('updateOptions merges style per field',
  styled.options().style?.paddingX === 2 && styled.options().style?.paddingY === 1)
check('updating options rebuilds neither the instance nor its signal',
  modal.stack().length === stackSizeBeforeUpdate && styled.signal === signalBeforeUpdate
  && !styled.signal.aborted && modal.stack().includes(styled))
check('an options update repaints through the change feed', optionNotified > 0, `notified=${optionNotified}`)
styled.updateOptions({ width: undefined })
check('an undefined geometry in the patch restores the descriptor default', styled.options().width === '50%')
styled.updateOptions({ style: { paddingY: undefined } })
check('an undefined style field restores the descriptor value',
  styled.options().style?.paddingY === undefined && styled.options().style?.paddingX === 2)
offOptions()

// ── N. plugin-owned hiding keeps the instance and moves input ───────────
modal.closeAll()
const lower = await closeAndAck(delta.ctx, 'plain')
const upper = await closeAndAck(delta.ctx, 'plain')
check('the newest capturing window owns input',
  modal.focused() === upper && upper.isFocused() && !lower.isFocused())
upper.setHidden(true)
check('a hidden instance reports isHidden and keeps its stack slot',
  upper.isHidden() && modal.stack().includes(upper) && modal.stack().length === 2)
check('hiding the input owner hands input to the next capturing window',
  modal.focused() === lower && lower.isFocused() && !upper.isFocused())
check('a hidden instance exposes no bounds', upper.getBounds() === undefined)
upper.setHidden(false)
check('unhiding restores the same instance as input owner',
  modal.focused() === upper && upper.isFocused() && !upper.isHidden())
upper.setHidden(true)
lower.setHidden(true)
check('with every window hidden the chat keeps input', modal.focused() === undefined)
lower.setHidden(false)
upper.setHidden(false)
check('restoring both windows restores the top one as input owner', modal.focused() === upper)

// ── O. host visibility/bounds projection ────────────────────────────────
modal.closeAll()
const probe = await closeAndAck(delta.ctx, 'plain')
const firstRect = { left: 4, top: 6, columns: 30, rows: 10 }
let boundsNotified = 0
const offBounds = modal.subscribe(() => { boundsNotified += 1 })
modal.setBounds(probe, firstRect)
check('the host can report bounds and the instance reads them back',
  JSON.stringify(probe.getBounds()) === JSON.stringify(firstRect), JSON.stringify(probe.getBounds()))
check('a bounds-only update never notifies (no forced repaint)', boundsNotified === 0, `notified=${boundsNotified}`)
modal.setVisibility(probe, false)
check('a host-invisible window releases input and hides its bounds',
  modal.focused() === undefined && !probe.isFocused() && probe.getBounds() === undefined)
check('a visibility change that moves input notifies once', boundsNotified === 1, `notified=${boundsNotified}`)
modal.setVisibility(probe, false)
check('repeating the same visibility every frame notifies nothing (no emit loop)', boundsNotified === 1)
const secondRect = { left: 8, top: 2, columns: 40, rows: 12 }
modal.setBounds(probe, secondRect)
check('bounds pushed while invisible stay unreadable', probe.getBounds() === undefined)
modal.setVisibility(probe, true)
check('restoring visibility returns input to the still-open window',
  modal.focused() === probe && probe.isFocused()
  && JSON.stringify(probe.getBounds()) === JSON.stringify(secondRect))
offBounds()
// The rect is the host's projection: neither the host's own object afterwards
// nor a consumer writing to the returned value may change what is reported.
const mutableRect = { left: 1, top: 1, columns: 20, rows: 5 }
modal.setBounds(probe, mutableRect)
mutableRect.left = 42
check('bounds are stored as a frozen copy of the host report',
  probe.getBounds()?.left === 1, JSON.stringify(probe.getBounds()))
const reportedRect = probe.getBounds() as TuiModalBounds
let rectWriteThrew = false
try {
  reportedRect.left = 7
} catch {
  rectWriteThrew = true
}
check('a consumer cannot rewrite the host projection through getBounds()',
  reportedRect.left === 1 && Object.isFrozen(reportedRect) && rectWriteThrew,
  `left=${reportedRect.left} frozen=${Object.isFrozen(reportedRect)} threw=${rectWriteThrew}`)

// ── P. non-capturing (passive) windows ──────────────────────────────────
modal.closeAll()
const owner = await closeAndAck(delta.ctx, 'plain')
const passive = await closeAndAck(delta.ctx, 'passive')
check('a non-capturing window opens without taking input',
  modal.focused() === owner && !passive.isFocused())
check('a non-capturing window paints below the active capturing window',
  modal.stack()[0] === passive && modal.stack().at(-1) === owner,
  modal.stack().map(instance => instance.id).join(','))
passive.focus()
check('an explicit focus raises a passive window to the top and gives it input',
  modal.focused() === passive && passive.isFocused()
  && modal.stack().at(-1) === passive && !owner.isFocused())
passive.unfocus()
check('unfocus returns input to the capturing window underneath',
  modal.focused() === owner && owner.isFocused() && !passive.isFocused())
check('the window that now owns input is the last one painted',
  modal.stack().at(-1) === owner && modal.stack().includes(passive),
  modal.stack().map(instance => instance.id).join(','))
owner.unfocus()
check('unfocusing the last capturing window hands input back to the chat',
  modal.focused() === undefined && modal.stack().length === 2)
owner.focus()
check('focus reclaims input for a released capturing window', modal.focused() === owner)
owner.close()
check('a stack of passive windows alone owns no input',
  modal.focused() === undefined && modal.stack().length === 1 && modal.stack()[0] === passive)
passive.close()

// A released *capturing* window is still capturing, so the paint order must
// follow the input owner rather than the open order. The UI paints `stack()`
// as it is; it never re-sorts the runtime's own projection.
modal.closeAll()
const openedA = await closeAndAck(delta.ctx, 'plain')
const openedB = await closeAndAck(delta.ctx, 'plain')
check('the newest capturing window owns input and paints last',
  modal.focused() === openedB && modal.stack().at(-1) === openedB)
openedB.unfocus()
check('unfocusing the top capturing window hands input to the one below',
  modal.focused() === openedA && openedA.isFocused() && !openedB.isFocused())
check('the new input owner moves to the end of the paint order',
  modal.stack().at(-1) === openedA && modal.stack()[0] === openedB,
  modal.stack().map(instance => instance.id).join(','))
check('the unfocused window stays open, painted and un-aborted',
  modal.stack().length === 2 && modal.stack().includes(openedB) && !openedB.signal.aborted)
openedA.unfocus()
check('with no input owner the paint order keeps every window',
  modal.focused() === undefined && modal.stack().length === 2
  && modal.stack().includes(openedA) && modal.stack().includes(openedB),
  modal.stack().map(instance => instance.id).join(','))
openedB.focus()
check('refocusing a released window makes it the input owner and the last painted',
  modal.focused() === openedB && modal.stack().at(-1) === openedB)
openedA.close()
openedB.close()

// ── Q. the admission gate sees the effective options ────────────────────
modal.closeAll()
const viewport = { columns: 80, rows: 20 }
let gateSawWidth: TuiModalOptions['width']
const offViewportGate = modal.setAdmission((descriptor, options) => {
  gateSawWidth = options.width
  const visible = options.visible
  if (visible !== undefined && !visible(viewport.columns, viewport.rows)) {
    return `modal "${descriptor.id}" does not fit this viewport`
  }
  return undefined
})
const refusedOpen = await delta.ctx.tuiScenes.openModal('styled')
check('the admission gate receives the effective options and can refuse the open',
  refusedOpen.status === 'rejected' && refusedOpen.code === 'admission-denied'
  && refusedOpen.message.includes('does not fit'), describe(refusedOpen))
check('the gate saw the descriptor default merged into the effective options',
  gateSawWidth === '50%', String(gateSawWidth))
const refusedOverride = await delta.ctx.tuiScenes.openModal('styled', { width: 24 })
check('the gate sees the per-open override, not just the descriptor default',
  gateSawWidth === 24 && refusedOverride.status === 'rejected', String(gateSawWidth))
check('a refused open created no instance', modal.stack().length === 0)
viewport.rows = 30
const admitted = await closeAndAck(delta.ctx, 'styled')
check('the same window opens once the viewport satisfies its visible() predicate', admitted.isFocused())
offViewportGate()
modal.setAdmission(() => undefined)

// ── R. only plain option objects; unknown keys never hide ───────────────
// Every option document is validated field by field, so a Date or a class
// instance would pass as an empty document (silent defaults) and
// `{ unknown: undefined }` would slip past the key check.
class OptionBag {
  width = 40
}
const nonPlainDocuments: Array<[string, TuiModalOptions]> = [
  ['a Date', new Date(0) as unknown as TuiModalOptions],
  ['a class instance', new OptionBag() as unknown as TuiModalOptions],
  ['an array', [40] as unknown as TuiModalOptions],
  ['a Map', new Map([['width', 40]]) as unknown as TuiModalOptions],
]
for (const [name, document] of nonPlainDocuments) {
  let threw: unknown
  try {
    delta.ctx.tuiScenes.openModal('plain', document)
  } catch (error) {
    threw = error
  }
  check(`a non-plain options object is a TypeError (${name})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}
let nonPlainStyleThrew: unknown
try {
  delta.ctx.tuiScenes.openModal('plain', { style: new Date(0) as unknown as TuiModalStyle })
} catch (error) {
  nonPlainStyleThrew = error
}
check('a non-plain style object is a TypeError', nonPlainStyleThrew instanceof TypeError,
  nonPlainStyleThrew instanceof Error ? nonPlainStyleThrew.message : String(nonPlainStyleThrew))
const nullPrototypeStyle = Object.create(null) as TuiModalStyle
nullPrototypeStyle.paddingX = 3
const nullPrototypeDocument = Object.create(null) as TuiModalOptions
nullPrototypeDocument.width = 30
nullPrototypeDocument.style = nullPrototypeStyle
const nullPrototype = await closeAndAck(delta.ctx, 'plain', nullPrototypeDocument)
check('a null-prototype options object counts as plain',
  nullPrototype.options().width === 30 && nullPrototype.options().style?.paddingX === 3,
  JSON.stringify(nullPrototype.options()))
nullPrototype.close()

const unknownUndefinedKeys: Array<[string, TuiModalOptions]> = [
  ['unknown option key', { opactity: undefined } as unknown as TuiModalOptions],
  ['unknown style key', { style: { opacity: undefined } } as unknown as TuiModalOptions],
  ['unknown margin edge', { margin: { centre: undefined } } as unknown as TuiModalOptions],
]
for (const [name, document] of unknownUndefinedKeys) {
  let threw: unknown
  try {
    delta.ctx.tuiScenes.openModal('plain', document)
  } catch (error) {
    threw = error
  }
  check(`an unknown key set to undefined is a TypeError (${name})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}
const inert = await closeAndAck(delta.ctx, 'plain', { width: 30 })
for (const [name, patch] of unknownUndefinedKeys) {
  let threw: unknown
  try {
    inert.updateOptions(patch)
  } catch (error) {
    threw = error
  }
  check(`an unknown undefined key in updateOptions is a TypeError (${name})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}
check('the refused patches left the instance options untouched',
  inert.options().width === 30 && Object.keys(inert.options()).length === 1,
  JSON.stringify(inert.options()))
inert.updateOptions({ width: undefined })
check('a known key set to undefined still restores the descriptor default', inert.options().width === undefined)
inert.close()

// ── S. decimal percentages and Pi's anchor names ───────────────────────
const { MODAL_ANCHORS } = await import('../src/modal-options.js')
check('the nine anchors use Pi\'s middle-row names',
  MODAL_ANCHORS.join(',') === 'top-left,top-center,top-right,left-center,center,right-center,bottom-left,bottom-center,bottom-right',
  MODAL_ANCHORS.join(','))

const decimal = await closeAndAck(delta.ctx, 'plain',
  { width: '33.3%', height: '66.7%', row: '12.5%', col: '0.5%', maxHeight: '100%' })
check('a decimal percentage is accepted and kept verbatim',
  decimal.options().width === '33.3%' && decimal.options().height === '66.7%'
  && decimal.options().row === '12.5%' && decimal.options().col === '0.5%'
  && decimal.options().maxHeight === '100%', JSON.stringify(decimal.options()))
decimal.close()

const invalidPercentages: Array<[string, TuiModalOptions]> = [
  ['percentage above 100%', { width: '100.1%' }],
  ['negative percentage', { width: '-5%' }],
  ['zero width percentage', { width: '0%' }],
  ['percentage with a trailing dot', { width: '33.%' as unknown as `${number}%` }],
  ['NaN percentage', { width: 'NaN%' as unknown as `${number}%` }],
  ['bare percent sign', { width: '%' as unknown as `${number}%` }],
  ['space before the percent sign', { width: '33 %' as unknown as `${number}%` }],
  ['cell percentage above 100%', { row: '100.5%' }],
]
for (const [name, document] of invalidPercentages) {
  let threw: unknown
  try {
    delta.ctx.tuiScenes.openModal('plain', document)
  } catch (error) {
    threw = error
  }
  check(`a malformed percentage is a TypeError (${name})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}
const middleRow = await closeAndAck(delta.ctx, 'plain', { anchor: 'left-center' })
check('left-center is accepted as a middle-row anchor', middleRow.options().anchor === 'left-center')
middleRow.updateOptions({ anchor: 'right-center' })
check('right-center is accepted as the other middle-row anchor', middleRow.options().anchor === 'right-center')
middleRow.close()
for (const retired of ['center-left', 'center-right']) {
  let threw: unknown
  try {
    delta.ctx.tuiScenes.openModal('plain', { anchor: retired as unknown as 'center' })
  } catch (error) {
    threw = error
  }
  check(`the retired anchor name is a TypeError (${retired})`, threw instanceof TypeError,
    threw instanceof Error ? threw.message : String(threw))
}

// ── T. a closed handle never resurrects its instance ───────────────────
modal.closeAll()
const closing = await closeAndAck(delta.ctx, 'plain', { width: 30 })
modal.setBounds(closing, { left: 2, top: 3, columns: 30, rows: 8 })
const survivor = await closeAndAck(delta.ctx, 'plain')
check('the newest window owns input before the close', modal.focused() === survivor)
closing.close()
const stackAfterClose = modal.stack()
check('the closed instance leaves the stack and aborts its signal',
  !stackAfterClose.includes(closing) && stackAfterClose.length === 1 && closing.signal.aborted)
let lateNotified = 0
const offLate = modal.subscribe(() => { lateNotified += 1 })
closing.focus()
check('focusing a closed handle does not resurrect the aborted window',
  modal.stack() === stackAfterClose && modal.stack().length === 1
  && !modal.stack().includes(closing) && closing.signal.aborted
  && modal.focused() === survivor && !closing.isFocused(),
  modal.stack().map(instance => instance.id).join(','))
check('a closed handle reports no bounds', closing.getBounds() === undefined,
  JSON.stringify(closing.getBounds()))
closing.updateOptions({ width: 40, style: { paddingX: 1 } })
check('updateOptions on a closed handle changes nothing',
  closing.options().width === 30 && closing.options().style === undefined,
  JSON.stringify(closing.options()))
closing.setHidden(true)
check('setHidden on a closed handle changes nothing', !closing.isHidden())
closing.unfocus()
check('unfocus on a closed handle leaves the input owner alone',
  modal.focused() === survivor && survivor.isFocused())
modal.setBounds(closing, { left: 9, top: 9, columns: 50, rows: 20 })
check('a late host bounds report for a closed instance stays unreadable', closing.getBounds() === undefined)
check('none of the late calls notified the host', lateNotified === 0, `notified=${lateNotified}`)
offLate()
survivor.close()

modal.closeAll()
await delta.dispose()

await beta.dispose()
await root.fiber.dispose()
rmSync(fakeHome, { recursive: true, force: true })

if (failed > 0) {
  console.log(`\n${failed} plugin-modal runtime check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll plugin-modal runtime checks passed')
