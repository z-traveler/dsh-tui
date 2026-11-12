/** Real Chat + public Cordis modal calls; isolated HOME, in-memory backend.
 * node --import tsx/esm scripts/downstream/verify-plugin-modals.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_HOME = `${process.env.HOME}/.dsh`
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, { Context }, { Terminal }, ui, { Chat }, { QuestionStore }, { PermissionStore }, { TuiSceneRuntime, getHostSceneRuntime }, { pluginModalFixture }, { settled, viewportLines }, { TuiDialogStore }, { PluginModalExample }, prefs, { registerBuiltinPanels }] = await Promise.all([
  import('react'), import('@deepseek-ai/cordis'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/screens/Chat.js'), import('../../src/dsh-adapter/questions.js'), import('../../src/channel/permissions.js'),
  import('../../src/dsh-adapter/scenes.js'), import('./plugin-modal-fixture.js'), import('../lib/term-test.mjs'), import('../../src/dsh-adapter/dialogs.js'), import('./plugin-modal-example.js'), import('../../src/tuiDisplayPrefs.js'), import('../../src/components/sidePanel/builtinPanels.js'),
])
import type { TuiModalProps } from '../../src/scenes.js'
let checks = 0
function check(name: string) { console.log(`PASS ${++checks}: ${name}`) }
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
let serial = 0
const liveWindows = new Set<number>()
const releasedInputs: Array<{ listenerCount(event: string): number }> = []
function Window({ React: R, ui: kit, close, contentSize, focused, signal }: TuiModalProps) {
  const [id] = R.useState(() => ++serial)
  const [text, setText] = R.useState('')
  R.useEffect(() => { liveWindows.add(id); return () => { liveWindows.delete(id) } }, [id])
  const stdin = kit.useStdin()
  R.useEffect(() => () => { releasedInputs.push(stdin.internal_eventEmitter) }, [stdin.internal_eventEmitter])
  const measured = kit.useTerminalSize()
  assert.equal(measured.columns, contentSize.columns)
  assert.equal(measured.rows, contentSize.rows)
  kit.useInput((input, key) => { if (input === 'q') close(); else if (!key.ctrl && !key.meta && !key.return) setText(old => old + input) })
  return R.createElement(kit.Box, { flexDirection: 'column' },
    R.createElement(kit.Text, null, `WINDOW_${id} ${focused ? 'FOCUSED' : 'BACKGROUND'} ${contentSize.columns}x${contentSize.rows} ${signal.aborted ? 'CLOSED' : 'LIVE'}`),
    R.createElement(kit.Text, null, `LOCAL_${text}`))
}
function Page({ React: R, ui: kit, close }: import('../../src/scenes.js').TuiSceneProps) {
  kit.useInput((_input, key) => { if (key.escape) close() })
  return R.createElement(kit.Text, null, 'TEMPORARY_HOST_PAGE')
}
function Broken(): never { throw new Error('MODAL_TEST_RENDER_FAILURE') }
registerBuiltinPanels()
for (const fullscreen of [false, true]) {
  prefs.applySidePanelPanels('agents')
  prefs.applySidePanelOpen(fullscreen)
  const initialColumns = fullscreen ? 120 : 90
  const root = new Context()
  await root.plugin(TuiSceneRuntime)
  const host = getHostSceneRuntime(root.get('tuiScenes'))!
  assert.ok(host.modal, 'host must expose modal capability')
  let consumer!: import('@deepseek-ai/cordis').Context
  let loading = Promise.resolve('')
  function LoadingWindow({ React: R, ui: kit }: TuiModalProps) {
    return R.createElement(kit.Text, null, R.use(loading))
  }
  const owner = root.inject(['tuiScenes'], ctx => {
    consumer = ctx
    ctx.tuiScenes.registerModal({ id: 'test-window', title: 'PLUGIN_WINDOW', component: Window })
    ctx.tuiScenes.registerModal({ id: 'report', title: 'REPORT_WINDOW', component: PluginModalExample })
    ctx.tuiScenes.registerModal({ id: 'broken', title: 'BROKEN_WINDOW', component: Broken })
    ctx.tuiScenes.registerModal({ id: 'loading', title: 'LOADING_WINDOW', component: LoadingWindow })
    ctx.tuiScenes.register({ id: 'host-page', component: Page })
  })
  await owner
  const h = pluginModalFixture(root)
  if (!fullscreen) h.channel.setMinimalUi(true)
  const questions = new QuestionStore(), approvals = new PermissionStore(), dialogs = new TuiDialogStore()
  const terminal = new Terminal({ cols: initialColumns, rows: 30, scrollback: 500, allowProposedApi: true })
  class Output extends Writable { columns = initialColumns; rows = 30; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input()
  const controller: { current: import('../../src/components/PromptInput.js').PromptController | null } = { current: null }
  const content = (attach: boolean) => <ui.ThemeProvider theme="dark"><Chat channel={h.channel} questionStore={questions} approvalStore={approvals}
    modalHost={attach ? host.modal : undefined} extensionDialogs={dialogs} fullscreen={fullscreen} trajectorySeen promptControllerRef={controller} onExit={() => undefined}
    renderScene={(id, channel) => {
      const scene = host.active
      assert.equal(scene?.id, id)
      return React.createElement(scene!.component, { React, ui, channel, close: () => host.close() })
    }} /></ui.ThemeProvider>
  const rendered = await ui.render(fullscreen ? <ui.AlternateScreen>{content(false)}</ui.AlternateScreen> : content(false),
    { stdin: input as never, stdout: output as never, stderr: output as never, patchConsole: false, exitOnCtrlC: false })
  const frame = () => viewportLines(terminal, output.rows).join('\n')
  const tag = fullscreen ? 'fullscreen' : 'inline short frame'
  try {
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.append('PRESERVED_DRAFT')
    h.reply('VISIBLE_CHAT_BACKGROUND')
    assert.ok(await settled(() => frame().includes('PRESERVED_DRAFT') && frame().includes('VISIBLE_CHAT_BACKGROUND')), frame())
    const withoutModalHost = frame()
    rendered.rerender(fullscreen ? <ui.AlternateScreen>{content(true)}</ui.AlternateScreen> : content(true))
    assert.ok(await settled(() => frame() === withoutModalHost && controller.current?.text() === 'PRESERVED_DRAFT'), frame())
    check(`unused modal host preserves the original chat frame and draft (${tag})`)
    for (const [command, title, body] of [
      ['settings', 'Plugin settings', 'settings service absent'],
      ['jobs', 'Background Jobs', 'No background jobs in the current session'],
    ]) {
      const showPage = async () => {
        controller.current!.clear(); controller.current!.append(`/${command}`)
        input.write('\r')
        assert.ok(await settled(() => frame().includes(title!) && frame().includes(body!)), frame())
        return frame()
      }
      const closePage = async () => {
        input.write('\u001b')
        assert.ok(await settled(() => controller.current !== null && !frame().includes(title!)), frame())
      }
      const hostedPage = await showPage()
      await closePage()
      const previous = controller.current
      rendered.rerender(fullscreen ? <ui.AlternateScreen>{content(false)}</ui.AlternateScreen> : content(false))
      assert.ok(await settled(() => controller.current !== null && controller.current !== previous))
      assert.equal(await showPage(), hostedPage, `${command}: modal host must not alter the non-chat frame`)
      await closePage()
      const unhosted = controller.current
      rendered.rerender(fullscreen ? <ui.AlternateScreen>{content(true)}</ui.AlternateScreen> : content(true))
      assert.ok(await settled(() => controller.current !== null && controller.current !== unhosted))
      check(`unused modal host preserves the ${command} screen (${tag})`)
    }
    controller.current!.clear(); controller.current!.append('PRESERVED_DRAFT')
    h.beginTurn()
    assert.ok(await settled(() => h.channel.working && frame().includes('esc to interrupt')), frame())
    if (fullscreen) assert.ok(frame().includes('Agents'), 'exercise the modal with the real side panel open')
    const beforeRows = terminal.buffer.active.length
    const draftLine = frame().split('\n').findIndex(line => line.includes('PRESERVED_DRAFT'))
    const draftColumn = frame().split('\n')[draftLine]!.indexOf('PRESERVED_DRAFT') + 2
    const open = async (id = 'test-window') => {
      let outcome: import('../../src/scenes.js').TuiModalOpenResult | undefined
      void consumer.tuiScenes.openModal(id).then(value => { outcome = value })
      assert.ok(await settled(() => outcome !== undefined), `open never settled: ${frame()}`)
      return outcome!
    }
    const result = await open()
    assert.equal(result.status, 'opened')
    assert.ok(await settled(() => frame().includes('PLUGIN_WINDOW')), frame())
    assert.equal(controller.current?.text(), 'PRESERVED_DRAFT', 'composer stays mounted under the card')
    check(`real modal preserves the mounted draft (${tag})`)
    input.write('abc\r\u001b[A\u001b[6~')
    assert.ok(await settled(() => frame().includes('LOCAL_abc')), frame())
    assert.equal(h.submitted.length, 0)
    assert.equal(h.cancelCalls, 0)
    check(`text and navigation stay in modal (${tag})`)
    const second = await open()
    assert.equal(second.status, 'opened')
    assert.equal(host.modal.stack().length, 2)
    input.write('xyz')
    assert.ok(await settled(() => frame().includes('LOCAL_xyz')), frame())
    if (result.status === 'opened') result.instance.close()
    assert.equal(host.modal.stack().length, 1)
    assert.ok(frame().includes('LOCAL_xyz'), frame())
    check(`same type opens independent instances; bottom removal preserves top (${tag})`)
    if (fullscreen) {
      input.write(`\u001b[<0;${draftColumn};${draftLine + 1}M\u001b[<0;${draftColumn};${draftLine + 1}m`)
      input.write('M')
      assert.ok(await settled(() => frame().includes('LOCAL_xyzM')), frame())
    }
    input.write('\u001b')
    assert.ok(await settled(() => !frame().includes('PLUGIN_WINDOW')), frame())
    assert.equal(host.modal.stack().length, 0)
    assert.equal(h.cancelCalls, 0)
    assert.equal(h.submitted.length, 0)
    assert.ok(frame().includes('PRESERVED_DRAFT'), frame())
    assert.ok(!frame().includes('SHOULD_NOT_REPLAY'), frame())
    assert.equal(terminal.buffer.active.length, beforeRows, 'opening/closing must not inflate short inline scrollback')
    check(`Esc closes without cancelling backend, submitting or duplicating scrollback (${tag})`)
    if (fullscreen) {
      input.write('Z')
      assert.ok(await settled(() => controller.current?.text() === 'PRESERVED_DRAFTZ'), 'modal click must not move the background caret')
      controller.current!.clear(); controller.current!.append('PRESERVED_DRAFT')
      check('fullscreen pointer does not edit or move the background composer')
    }
    await open()
    input.write('\u0003\rSHOULD_NOT_REPLAY')
    assert.ok(await settled(() => host.modal.stack().length === 0))
    assert.equal(h.cancelCalls, 0)
    assert.equal(h.submitted.length, 0)
    assert.equal(controller.current?.text(), 'PRESERVED_DRAFT')
    check(`Ctrl+C consumes its batch and closes only the modal (${tag})`)
    const lower = await open(), upper = await open()
    assert.equal(lower.status, 'opened'); assert.equal(upper.status, 'opened')
    input.write('q')
    assert.ok(await settled(() => host.modal.stack().length === 1), `stack=${host.modal.stack().length}\n${frame()}`)
    if (lower.status === 'opened') assert.equal(lower.instance.signal.aborted, false)
    if (upper.status === 'opened') assert.equal(upper.instance.signal.aborted, true)
    input.write('u')
    assert.ok(await settled(() => frame().includes('LOCAL_u')), frame())
    if (lower.status === 'opened') lower.instance.close()
    assert.ok(await settled(() => liveWindows.size === 0))
    check(`plugin close key restores only the next window (${tag})`)
    const retained = await open()
    input.write('kept')
    assert.ok(await settled(() => frame().includes('LOCAL_kept')), frame())
    const mounted = [...liveWindows]
    const edge = () => Array.from({ length: output.rows }, (_, y) => {
      const line = terminal.buffer.active.getLine(terminal.buffer.active.baseY + y)
      return [0, 1, output.columns - 2, output.columns - 1].map(x => line?.getCell(x)?.getChars() ?? '').join('')
    }).join('\n')
    const oldEdge = edge()
    h.reply('STREAM_BACKGROUND_' + 's'.repeat(100) + '_END')
    assert.ok(await settled(() => edge() !== oldEdge && frame().includes('LOCAL_kept')), frame())
    assert.deepEqual([...liveWindows], mounted)
    check(`real background cells keep updating while the same window stays mounted (${tag})`)
    approvals.park({ sessionId: h.channel.sessionId, request: {
      requestId: 'modal-approval', toolName: 'fixture-tool', title: 'MODAL_APPROVAL', options: [{ id: 'reject', kind: 'reject' }],
    }, settle() {} })
    assert.ok(await settled(() => frame().includes('MODAL_APPROVAL') && !frame().includes('PLUGIN_WINDOW')), frame())
    assert.deepEqual([...liveWindows], mounted, 'hiding must not unmount window state')
    const refusedDuringApproval = await open()
    assert.ok(refusedDuringApproval.status === 'rejected' && refusedDuringApproval.code === 'admission-denied')
    approvals.decide('rejected')
    assert.ok(await settled(() => frame().includes('LOCAL_kept')), frame())
    check(`approval hides rather than destroys the stack and rejects opens (${tag})`)
    const questionAbort = new AbortController()
    const question = questions.ask({ questions: [{ id: 'modal-question', question: 'MODAL_QUESTION', options: [{ label: 'Yes' }], hideCustomInput: true }], signal: questionAbort.signal }).catch(() => undefined)
    assert.ok(await settled(() => frame().includes('MODAL_QUESTION') && !frame().includes('PLUGIN_WINDOW')), frame())
    questionAbort.abort()
    await question
    assert.ok(await settled(() => frame().includes('LOCAL_kept')), frame())
    check(`questionnaire suspends and restores the same window (${tag})`)
    const dialog = dialogs.ask({ kind: 'confirm', title: 'MODAL_DIALOG', confirmLabel: 'Yes', cancelLabel: 'No' })
    assert.ok(await settled(() => frame().includes('MODAL_DIALOG') && !frame().includes('PLUGIN_WINDOW')), frame())
    let dialogClosed = false
    void dialog.then(() => { dialogClosed = true })
    input.write('\u001b')
    assert.ok(await settled(() => dialogClosed), 'Esc must cancel the foreground dialog, not the hidden window')
    await dialog
    assert.ok(await settled(() => frame().includes('LOCAL_kept')), frame())
    check(`managed dialog suspends and restores the same window (${tag})`)
    assert.equal(consumer.tuiScenes.open('host-page'), true)
    assert.ok(await settled(() => frame().includes('TEMPORARY_HOST_PAGE') && !frame().includes('PLUGIN_WINDOW')), frame())
    const refusedOnPage = await open()
    assert.ok(refusedOnPage.status === 'rejected' && refusedOnPage.code === 'admission-denied')
    input.write('\u001b')
    assert.ok(await settled(() => frame().includes('LOCAL_kept')), frame())
    assert.deepEqual([...liveWindows], mounted)
    check(`temporary full-screen page retains stack; page rejects new windows (${tag})`)
    h.endTurn()
    assert.equal(await h.channel.newSession(), true)
    assert.ok(await settled(() => host.modal.stack().length === 0 && liveWindows.size === 0))
    if (retained.status === 'opened') assert.equal(retained.instance.signal.aborted, true)
    check(`session replacement closes the old stack (${tag})`)
    for (let i = 0; i < 30; i++) h.reply(`BACKGROUND_LINE_${i}`)
    const report = await open('report')
    assert.equal(report.status, 'opened')
    assert.ok(await settled(() => frame().includes('REPORT_ROW_00')), frame())
    input.write('\u001b[6~')
    assert.ok(await settled(() => !frame().includes('REPORT_ROW_00') && frame().includes('REPORT_ROW_')), frame())
    input.write('r')
    assert.ok(await settled(() => frame().includes('REFRESH_1')), frame())
    check(`rich report scrolls and refreshes within injected content dimensions (${tag})`)
    if (fullscreen) {
      const lines = frame().split('\n')
      const row = lines.findIndex(line => line.includes('REPORT_ROW_'))
      const first = lines[row]!.match(/REPORT_ROW_\d+/)![0]
      input.write(`\u001b[<65;${lines[row]!.indexOf('REPORT_ROW_') + 2};${row + 1}M`)
      assert.ok(await settled(() => !frame().includes(first)), frame())
      const current = frame(), backgroundEdge = edge()
      input.write('\u001b[<65;1;1M')
      // A keyboard refresh acts as a completion marker after the outside wheel.
      input.write('r')
      assert.ok(await settled(() => frame().includes('REFRESH_2')), frame())
      assert.equal(frame().match(/REPORT_ROW_\d+/)?.[0], current.match(/REPORT_ROW_\d+/)?.[0])
      assert.equal(edge(), backgroundEdge, 'outside wheel must not scroll the chat behind the card')
      check('fullscreen wheel scrolls inside the card but not through its backdrop')
    }
    output.columns = 54; output.rows = 14
    terminal.resize(54, 14); output.emit('resize')
    assert.ok(await settled(() => frame().includes('Esc / Ctrl+C close window') && frame().includes('46x6')), frame())
    output.columns = 8; output.rows = 4
    terminal.resize(8, 4); output.emit('resize')
    assert.ok(await settled(() => frame().includes('Esc / ^C')), frame())
    output.columns = 90; output.rows = 30
    terminal.resize(90, 30); output.emit('resize')
    assert.ok(await settled(() => frame().includes(fullscreen ? 'REFRESH_2' : 'REFRESH_1')), frame())
    check(`resize and tiny terminal retain plugin state and a close path (${tag})`)
    if (report.status === 'opened') report.instance.close()
    const broken = await open('broken')
    assert.equal(broken.status, 'failed')
    assert.ok(h.channel.notifications.some(item => item.text.includes('Plugin window "broken"') && item.text.includes('MODAL_TEST_RENDER_FAILURE')))
    assert.ok(await settled(() => host.modal.stack().length === 0))
    check(`render failure refuses opened-success and releases input (${tag})`)
    const deferred = Promise.withResolvers<string>()
    loading = deferred.promise
    let loadResult: import('../../src/scenes.js').TuiModalOpenResult | undefined
    void consumer.tuiScenes.openModal('loading').then(value => { loadResult = value })
    assert.ok(await settled(() => frame().includes('Loading window') && frame().includes('Esc / Ctrl+C close window')), frame())
    assert.equal(loadResult, undefined, 'a loading shell is not a successful content mount')
    deferred.resolve('READY_WINDOW_CONTENT')
    assert.ok(await settled(() => loadResult?.status === 'opened' && frame().includes('READY_WINDOW_CONTENT')), frame())
    if (loadResult?.status === 'opened') loadResult.instance.close()
    assert.ok(await settled(() => host.modal.stack().length === 0))
    check(`suspended content shows a closable loading shell and opens only when ready (${tag})`)
    const rejected = Promise.withResolvers<string>()
    loading = rejected.promise
    let failedLoad: import('../../src/scenes.js').TuiModalOpenResult | undefined
    void consumer.tuiScenes.openModal('loading').then(value => { failedLoad = value })
    assert.ok(await settled(() => frame().includes('Loading window')), frame())
    rejected.reject(new Error('MODAL_LOAD_FAILURE'))
    assert.ok(await settled(() => failedLoad?.status === 'failed' && host.modal.stack().length === 0))
    check(`async content load failure never reports opened (${tag})`)
    const cancelled = Promise.withResolvers<string>()
    loading = cancelled.promise
    let cancelledLoad: import('../../src/scenes.js').TuiModalOpenResult | undefined
    void consumer.tuiScenes.openModal('loading').then(value => { cancelledLoad = value })
    assert.ok(await settled(() => frame().includes('Loading window')), frame())
    input.write('\u001b')
    assert.ok(await settled(() => cancelledLoad?.status === 'failed' && host.modal.stack().length === 0))
    cancelled.resolve('LATE_WINDOW_CONTENT')
    const nextWindow = await open()
    assert.ok(!frame().includes('LATE_WINDOW_CONTENT'), frame())
    if (nextWindow.status === 'opened') nextWindow.instance.close()
    assert.ok(await settled(() => liveWindows.size === 0))
    check(`closing while loading prevents a late result from reviving the window (${tag})`)
    for (let i = 0; i < 6; i++) {
      const repeated = await open()
      assert.equal(repeated.status, 'opened')
      if (repeated.status === 'opened') repeated.instance.close()
      assert.ok(await settled(() => liveWindows.size === 0))
    }
    assert.ok(releasedInputs.every(emitter => emitter.listenerCount('input') === 0))
    check(`repeated opening and closing releases input subscriptions (${tag})`)
    controller.current!.clear()
    const imagePath = join(process.env.HOME!, 'modal-attachment.png')
    writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9f8AAAAASUVORK5CYII=', 'base64'))
    input.write(`\u001b[200~${imagePath}\u001b[201~`)
    assert.ok(await settled(() => controller.current?.previewImages?.().length === 1), frame())
    const attachments = controller.current!.previewImages!().map(item => item.image.id)
    const attached = await open()
    assert.equal(attached.status, 'opened')
    assert.deepEqual(controller.current!.previewImages!().map(item => item.image.id), attachments)
    if (attached.status === 'opened') attached.instance.close()
    assert.ok(await settled(() => host.modal.stack().length === 0))
    assert.deepEqual(controller.current!.previewImages!().map(item => item.image.id), attachments)
    check(`real pasted attachment bindings survive opening and closing (${tag})`)
    await open()
    await owner.dispose()
    assert.ok(await settled(() => host.modal.stack().length === 0 && liveWindows.size === 0))
    check(`unloading a plugin releases its windows and component effects (${tag})`)
  } finally {
    await rendered.unmount()
    h.cleanup()
    await owner.dispose()
    await root.fiber.dispose()
    terminal.dispose()
  }
}
console.log(`All ${checks} plugin modal checks passed`)
