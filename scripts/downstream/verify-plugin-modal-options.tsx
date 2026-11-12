/** Public options and handles through real Cordis + Chat, with xterm cells.
 * node --import tsx/esm scripts/downstream/verify-plugin-modal-options.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_HOME = `${process.env.HOME}/.dsh`
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, { Context }, { Terminal }, ui, { Chat }, { QuestionStore }, { PermissionStore }, { TuiSceneRuntime, getHostSceneRuntime }, { pluginModalFixture }, { settled, viewportLines }] = await Promise.all([
  import('react'), import('@deepseek-ai/cordis'), import('@xterm/headless'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/questions.js'), import('../../src/channel/permissions.js'), import('../../src/dsh-adapter/scenes.js'),
  import('./plugin-modal-fixture.js'), import('../lib/term-test.mjs'),
])
import type { TuiModalProps, TuiModalOpenResult, TuiModalOptions } from '../../src/scenes.js'
let checks = 0
function check(label: string) { console.log(`PASS ${++checks}: ${label}`) }
function Widget({ React: R, ui: kit, focused, contentSize }: TuiModalProps) {
  const [count, setCount] = R.useState(0)
  const [native, setNative] = R.useState(0)
  const size = kit.useTerminalSize()
  assert.equal(size.columns, contentSize.columns); assert.equal(size.rows, contentSize.rows)
  kit.useInput(input => { if (input === 'x') setCount(value => value + 1) })
  return R.createElement(kit.Box, { flexDirection: 'column', tabIndex: 0, autoFocus: true,
    onKeyDown: event => { if (event.key === 'n') setNative(value => value + 1) },
  }, R.createElement(kit.Text, null, `STATE_${count} ${focused ? 'FOCUS' : 'PASSIVE'} ${size.columns}x${size.rows}`),
  R.createElement(kit.Text, null, `NATIVE_${native}`))
}
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const fullscreen of [false, true]) {
  const root = new Context()
  await root.plugin(TuiSceneRuntime)
  let consumer!: import('@deepseek-ai/cordis').Context
  const owner = root.inject(['tuiScenes'], ctx => {
    consumer = ctx
    ctx.tuiScenes.registerModal({ id: 'styled', title: 'CUSTOM_FRAME', component: Widget, options: {
      width: 34, height: 12, anchor: 'top-left', margin: 1,
      style: { backgroundColor: '#123456', borderStyle: 'double', borderColor: '#abcdef', titleColor: '#feca01', paddingX: 2, paddingY: 1 },
    } })
    ctx.tuiScenes.registerModal({ id: 'raw', component: ({ React: R, ui: kit, contentSize }: TuiModalProps) =>
      R.createElement(kit.Text, null, `RAW_ONE_ROW ${contentSize.columns}x${contentSize.rows}`) })
    ctx.tuiScenes.registerModal({ id: 'responsive', title: 'RESPONSIVE_FRAME', component: Widget, options: { width: 32, height: 9, visible: columns => columns >= 90 } })
  })
  await owner
  assert.equal(consumer.tuiScenes.modalOptionsVersion, 1, 'detectable advanced options, never ignored by an old host')
  const host = getHostSceneRuntime(root.get('tuiScenes'))!.modal
  const h = pluginModalFixture(root)
  h.channel.setMinimalUi(true)
  const questions = new QuestionStore(), approvals = new PermissionStore()
  const terminal = new Terminal({ cols: 100, rows: 30, scrollback: 500, allowProposedApi: true })
  class Output extends Writable { columns = 100; rows = 30; isTTY = true; _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) } }
  const output = new Output(), input = new Input()
  const controller: { current: import('../../src/components/PromptInput.js').PromptController | null } = { current: null }
  let backgroundNativeKeys = 0
  const body = <ui.ThemeProvider theme="dark"><Chat channel={h.channel} questionStore={questions} approvalStore={approvals} modalHost={host}
    fullscreen={fullscreen} trajectorySeen promptControllerRef={controller} onExit={() => undefined} />
    <ui.Box position="absolute" bottom={0} left={0} width={1} height={1} tabIndex={0} autoFocus
      onKeyDown={event => { if (event.key === 'n') backgroundNativeKeys++ }} />
  </ui.ThemeProvider>
  const rendered = await ui.render(fullscreen ? <ui.AlternateScreen>{body}</ui.AlternateScreen> : body,
    { stdout: output as never, stderr: output as never, stdin: input as never, exitOnCtrlC: false, patchConsole: false })
  const frame = () => viewportLines(terminal, output.rows).join('\n')
  const cell = (row: number, col: number) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.getCell(col)
  const tag = fullscreen ? 'fullscreen' : 'inline'
  const open = async (id = 'styled', options?: TuiModalOptions) => {
    let result: TuiModalOpenResult | undefined
    void consumer.tuiScenes.openModal(id, options).then(value => { result = value })
    assert.ok(await settled(() => result !== undefined), frame())
    assert.equal(result!.status, 'opened')
    if (result!.status !== 'opened') throw new Error(result!.message)
    return result!.instance
  }
  try {
    assert.ok(await settled(() => controller.current !== null))
    controller.current!.append('DRAFT')
    if (!fullscreen) {
      assert.ok(await settled(() => frame().includes('DRAFT')))
      const shortBackground = frame()
      let shortRows = 0
      const short = await open('raw', { visible: (_columns, rows) => { shortRows = rows; return true } })
      assert.ok(shortRows < output.rows - 2, 'exercise a genuinely short inline chat frame')
      assert.equal(short.getBounds()?.rows, Math.max(1, Math.min(26, shortRows - (shortRows >= 9 ? 4 : 2))), 'default retains the original short-frame margins')
      short.close()
      assert.ok(await settled(() => frame() === shortBackground))
      const priorKeys = backgroundNativeKeys
      input.write('n')
      assert.ok(await settled(() => backgroundNativeKeys === priorKeys + 1), 'first modal restores the pre-existing native focus')
      controller.current!.clear(); controller.current!.append('DRAFT')
      check('short inline defaults and initial background DOM focus remain compatible')
    }
    for (let i = 0; i < 28; i++) h.reply(`OPTIONS_BACKGROUND_${i}`)
    assert.ok(await settled(() => frame().includes('OPTIONS_BACKGROUND_27')), frame())
    const background = frame().split('\n')
    const first = await open()
    assert.ok(await settled(() => frame().includes('STATE_0 FOCUS 28x6')), frame())
    assert.deepEqual(first.getBounds(), { left: 1, top: 1, columns: 34, rows: 12 })
    const lines = frame().split('\n'), titleRow = lines.findIndex(line => line.includes('CUSTOM_FRAME'))
    const titleCol = lines[titleRow]!.indexOf('CUSTOM_FRAME')
    assert.equal(cell(titleRow, titleCol)?.getBgColor(), 0x123456)
    assert.equal(cell(titleRow, titleCol)?.getFgColor(), 0xfeca01)
    assert.equal(cell(titleRow - 1, 1)?.getChars(), '╔', `titleRow=${titleRow} titleCol=${titleCol}\n${frame()}`)
    assert.equal(cell(titleRow - 1, 1)?.getFgColor(), 0xabcdef)
    check(`descriptor styles paint background/title/border and padding budgets (${tag})`)
    const blankRow = frame().split('\n').findIndex((line, row) => row > titleRow + 2 && row < titleRow + 8
      && background[row]?.includes('OPTIONS_BACKGROUND_') && line.slice(4, 15).trim() === '')
    assert.ok(blankRow >= 0, 'pick a card blank cell that previously contained chat text')
    first.updateOptions({ style: { backgroundColor: null } })
    assert.ok(await settled(() => cell(titleRow, titleCol)?.isBgDefault() === true), frame())
    assert.equal(cell(blankRow, 8)?.getChars(), ' ', 'terminal-default fill is still opaque, not text transparency')
    check(`terminal-default background remains opaque rather than fake alpha (${tag})`)
    input.write('x')
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS')), frame())
    first.updateOptions({ width: '70%', height: 10, anchor: 'bottom-right', margin: 2, style: { borderStyle: 'none', paddingX: 0, paddingY: 0, backgroundColor: '#223344', backdrop: false } })
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS 70x8')), frame())
    const updated = first.getBounds()!
    assert.deepEqual({ left: updated.left, columns: updated.columns, rows: updated.rows }, { left: 28, columns: 70, rows: 10 })
    assert.ok(updated.top >= 2 && updated.top + updated.rows <= output.rows - 2, 'bottom-right stays inside the visible frame, including inline cursor reserve')
    assert.equal(first.signal.aborted, false)
    check(`instance geometry/style updates preserve component state (${tag})`)
    first.setHidden(true)
    assert.ok(await settled(() => !frame().includes('CUSTOM_FRAME')), frame())
    assert.equal(first.isHidden(), true); assert.equal(first.getBounds(), undefined); assert.equal(first.isFocused(), false)
    input.write('z')
    assert.ok(await settled(() => controller.current?.text() === 'DRAFTz'))
    first.setHidden(false)
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS 70x8')), frame())
    assert.equal(first.isFocused(), true)
    check(`manual hide/show releases input and retains state (${tag})`)
    const second = await open('styled', { width: 26, height: 8, anchor: 'top-right' })
    assert.equal(second.isFocused(), true); assert.equal(first.isFocused(), false)
    first.focus()
    assert.ok(await settled(() => first.isFocused() && !second.isFocused()))
    input.write('x')
    assert.ok(await settled(() => frame().includes('STATE_2 FOCUS')), frame())
    second.close()
    assert.equal(first.isFocused(), true)
    check(`focus brings an existing instance forward without remounting (${tag})`)
    const passive = await open('styled', { width: 26, height: 8, anchor: 'top-right', nonCapturing: true })
    assert.equal(passive.isFocused(), false); assert.equal(first.isFocused(), true)
    first.close()
    assert.ok(await settled(() => !first.isFocused() && frame().includes('STATE_0 PASSIVE')), frame())
    input.write('x')
    assert.ok(await settled(() => controller.current?.text() === 'DRAFTzx'))
    input.write('\u0003')
    assert.ok(await settled(() => controller.current?.text() === ''))
    assert.equal(passive.signal.aborted, false, 'passive window must not steal background Ctrl+C')
    input.write('\tn')
    assert.ok(await settled(() => controller.current?.text() === 'n'))
    assert.ok(frame().includes('NATIVE_0'), frame())
    check(`nonCapturing does not grab hook input, native Tab focus or Ctrl+C (${tag})`)
    if (fullscreen) {
      const backgroundRows = () => frame().match(/OPTIONS_BACKGROUND_\d+/gu)?.join(',')
      const beforeWheel = backgroundRows()
      input.write('\u001b[<64;5;5M')
      assert.ok(await settled(() => backgroundRows() !== beforeWheel), 'passive windows must allow wheel input to reach the background transcript')
      assert.equal(passive.isFocused(), false)
      const lines = frame().split('\n')
      const row = lines.findIndex(line => line.includes('CUSTOM_FRAME'))
      const col = lines[row].indexOf('CUSTOM_FRAME')
      input.write(`\u001b[<0;${col + 1};${row + 1}M\u001b[<0;${col + 1};${row + 1}m`)
      assert.ok(await settled(() => passive.isFocused() && frame().includes('STATE_0 FOCUS')))
      assert.equal(controller.current?.text(), 'n', 'clicking the passive card cannot edit the background')
      check('fullscreen passive wheel passthrough and click-to-focus use real pointer routing')
    }
    passive.focus()
    assert.ok(await settled(() => passive.isFocused()))
    input.write('x')
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS')), frame())
    passive.unfocus()
    assert.ok(await settled(() => !passive.isFocused() && frame().includes('STATE_1 PASSIVE')), frame())
    passive.close()
    assert.ok(await settled(() => host.stack().length === 0))
    check(`passive instances can explicitly focus and release focus (${tag})`)
    controller.current!.clear(); controller.current!.append('RESP')
    const responsive = await open('responsive')
    input.write('x')
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS')), frame())
    output.columns = 80; terminal.resize(80, 30); output.emit('resize')
    assert.ok(await settled(() => !frame().includes('RESPONSIVE_FRAME')), frame())
    assert.equal(responsive.getBounds(), undefined); assert.equal(responsive.isFocused(), false)
    assert.equal(responsive.signal.aborted, false)
    input.write('b')
    assert.ok(await settled(() => controller.current?.text() === 'RESPb'))
    const refused = await consumer.tuiScenes.openModal('responsive')
    assert.ok(refused.status === 'rejected' && refused.code === 'admission-denied')
    output.columns = 100; terminal.resize(100, 30); output.emit('resize')
    assert.ok(await settled(() => frame().includes('RESPONSIVE_FRAME') && frame().includes('STATE_1 FOCUS')), frame())
    assert.ok(responsive.getBounds())
    check(`responsive visibility tracks resize without hidden input locks (${tag})`)
    approvals.park({ sessionId: h.channel.sessionId, request: { requestId: 'options-approval', title: 'OPTIONS_APPROVAL', toolName: 'fixture', options: [{ id: 'reject', kind: 'reject' }] }, settle() {} })
    assert.ok(await settled(() => frame().includes('OPTIONS_APPROVAL') && !frame().includes('RESPONSIVE_FRAME')), frame())
    assert.equal(responsive.isFocused(), false); assert.equal(responsive.getBounds(), undefined)
    approvals.decide('rejected')
    assert.ok(await settled(() => frame().includes('STATE_1 FOCUS')), frame())
    check(`critical host interaction still outranks customized windows (${tag})`)
    const faulty = await open()
    faulty.updateOptions({ visible: () => { throw new Error('OPTIONS_VISIBILITY_FAILURE') } })
    assert.ok(await settled(() => faulty.signal.aborted && responsive.isFocused()))
    assert.ok(await settled(() => frame().includes('RESPONSIVE_FRAME')), frame())
    assert.ok(h.channel.notifications.some(item => item.text.includes('OPTIONS_VISIBILITY_FAILURE')))
    const rejectedPredicate = await consumer.tuiScenes.openModal('styled', { visible: () => { throw new Error('OPTIONS_OPEN_VISIBILITY_FAILURE') } })
    assert.ok(rejectedPredicate.status === 'rejected' && rejectedPredicate.code === 'admission-denied')
    assert.equal(host.stack().length, 1)
    check(`a failing visibility predicate releases only its own instance (${tag})`)
    const raw = await open('raw', { width: 26, height: 1, style: { chrome: false, borderStyle: 'none', paddingX: 0, paddingY: 0, backgroundColor: null } })
    assert.ok(await settled(() => frame().includes('RAW_ONE_ROW 26x1')), frame())
    assert.equal(raw.getBounds()?.rows, 1)
    assert.throws(() => raw.updateOptions({ style: { chrome: 'bad' as never } }), /chrome.*boolean/u)
    raw.close()
    check(`frameless one-row content can opt out of host title/footer (${tag})`)
    responsive.close()
    assert.ok(await settled(() => host.stack().length === 0 && !frame().includes('RAW_ONE_ROW') && !frame().includes('RESPONSIVE_FRAME')))
    const priorNativeKeys = backgroundNativeKeys
    input.write('n')
    assert.ok(await settled(() => backgroundNativeKeys === priorNativeKeys + 1), 'closing the last native-focused window restores the background DOM focus')
    check(`last close restores native background focus as well as hook input (${tag})`)
  } finally {
    await rendered.unmount(); h.cleanup(); await owner.dispose(); await root.fiber.dispose(); terminal.dispose()
  }
}
console.log(`All ${checks} modal customization checks passed`)
