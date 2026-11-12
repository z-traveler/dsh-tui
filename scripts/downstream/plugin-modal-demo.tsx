/** Credential-free real Chat + public plugin modal demo.
 * node --import tsx/esm scripts/downstream/plugin-modal-demo.tsx [--inline] [--custom]
 * Customization: Alt+C change size/style, Alt+P passive report, Alt+H hide/show,
 * Alt+J focus/unfocus the last opened report. --custom starts with preset styles.
 * Alt+O open another report, Alt+A approval, Alt+Q question, Alt+G full-screen
 * scene, Alt+N new session, Alt+U unload/reload report plugin, Alt+X broken window.
 * In a report: arrows/page scroll, r refresh, q/Esc/Ctrl+C close. Ctrl+C outside
 * a modal interrupts first; twice on an empty idle prompt exits. This creates
 * and removes only its own temporary HOME. */
import home from '../lib/fake-home.mjs'
import { rmSync } from 'node:fs'
process.env.DSH_HOME = `${home}/.dsh`
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, { Context }, ui, { Chat }, { QuestionStore }, { PermissionStore }, { TuiSceneRuntime, getHostSceneRuntime }, { pluginModalFixture }, { PluginModalExample }] = await Promise.all([
  import('react'), import('@deepseek-ai/cordis'), import('../../src/ui.js'), import('../../src/screens/Chat.js'),
  import('../../src/dsh-adapter/questions.js'), import('../../src/channel/permissions.js'), import('../../src/dsh-adapter/scenes.js'),
  import('./plugin-modal-fixture.js'), import('./plugin-modal-example.js'),
])
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this demo in a terminal')
const root = new Context()
await root.plugin(TuiSceneRuntime)
const host = getHostSceneRuntime(root.get('tuiScenes'))!
const h = pluginModalFixture(root)
const questions = new QuestionStore(), approvals = new PermissionStore()
let plugin!: import('@deepseek-ai/cordis').Context
let lastWindow: import('../../src/scenes.js').TuiModalInstance | undefined
let preset = 0
const presets: import('../../src/scenes.js').TuiModalOptions[] = [
  { width: '70%', minWidth: 26, height: '65%', maxHeight: '90%', anchor: 'center', margin: 1,
    visible: columns => columns >= 45,
    style: { backgroundColor: null, borderStyle: 'single', borderColor: '#70b7ff', titleColor: '#ffd480', paddingX: 2, paddingY: 1, backdrop: false } },
  { width: '55%', minWidth: 26, height: 14, maxHeight: '90%', anchor: 'top-right', margin: 1,
    visible: columns => columns >= 45,
    style: { backgroundColor: null, borderStyle: 'single', borderColor: '#db9aff', titleColor: '#ffdf80', paddingX: 1, paddingY: 0, backdrop: false } },
]
function FullPage({ React: R, ui: kit, close }: import('../../src/scenes.js').TuiSceneProps) {
  kit.useInput((_input, key) => { if (key.escape || key.return) close() })
  return R.createElement(kit.Text, null, 'HOST_PAGE — Esc/Enter returns; Alt+O must be rejected')
}
function BrokenWindow(): never { throw new Error('Intentional demo render failure') }
const activate = () => root.inject(['tuiScenes'], ctx => {
  plugin = ctx
  ctx.tuiScenes.registerModal({ id: 'demo-report', title: 'Generic plugin report', component: PluginModalExample, options: process.argv.includes('--custom') ? presets[0] : undefined })
  ctx.tuiScenes.registerModal({ id: 'demo-broken', title: 'Broken plugin', component: BrokenWindow })
  ctx.tuiScenes.register({ id: 'demo-page', component: FullPage })
})
let owner = activate()
await owner
let reloading = false
let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })
let count = 0
const fullscreen = !process.argv.includes('--inline')
function Demo() {
  ui.useInput((input, key, event) => {
    if (!key.meta || key.escape) return
    if (!['o', 'a', 'q', 'g', 'n', 'u', 'x', 'c', 'p', 'h', 'j'].includes(input)) return
    event.stopImmediatePropagation()
    if (reloading) return
    if (input === 'c') {
      preset = (preset + 1) % presets.length
      lastWindow?.updateOptions(presets[preset])
    } else if (input === 'h') lastWindow?.setHidden(!lastWindow.isHidden())
    else if (input === 'j') { if (lastWindow?.isFocused()) lastWindow.unfocus(); else lastWindow?.focus() }
    else if (input === 'o' || input === 'x' || input === 'p') {
      const options: import('../../src/scenes.js').TuiModalOptions | undefined = input === 'p' ? { nonCapturing: true }
        : input === 'o' ? { width: `${Math.max(25, 85 - host.modal.stack().length * 12)}%`, height: '85%', anchor: 'right-center' }
        : undefined
      void plugin.tuiScenes.openModal(input === 'x' ? 'demo-broken' : 'demo-report', options).then(result => {
        if (result.status === 'opened') { lastWindow = result.instance; preset = 0 }
        h.channel.notify(`Open result: ${result.status}${result.status === 'opened' ? '' : ` / ${result.code}`}`)
      })
    } else if (input === 'a') approvals.park({ sessionId: h.channel.sessionId, request: {
      requestId: `demo-approval-${++count}`, toolName: 'demo-local-action', title: 'DEMO_APPROVAL',
      options: [{ id: 'allow-once', kind: 'allow-once' }, { id: 'reject', kind: 'reject' }],
    }, settle() {} })
    else if (input === 'q') void questions.ask({ questions: [{ id: `demo-question-${++count}`, question: 'DEMO_QUESTION', options: [{ label: 'Continue' }], hideCustomInput: true }] }).catch(() => undefined)
    else if (input === 'g') plugin.tuiScenes.open('demo-page')
    else if (input === 'n') {
      h.endTurn()
      void h.channel.newSession().then(opened => {
        if (opened) { h.beginTurn(); h.channel.notify('DEMO_NEW_SESSION') }
      })
    } else if (input === 'u') {
      reloading = true
      void owner.dispose().then(async () => { owner = activate(); await owner }).finally(() => { reloading = false })
    }
  }, { prepend: true })
  return <Chat channel={h.channel} questionStore={questions} approvalStore={approvals} modalHost={host.modal}
    renderScene={(id, channel) => {
      const descriptor = host.active
      if (descriptor?.id !== id) throw new Error('Demo scene unavailable')
      return React.createElement(descriptor.component, { React, ui, channel, close: () => host.close() })
    }} fullscreen={fullscreen} trajectorySeen onExit={finish} />
}
h.reply('LIVE_CHAT_BACKGROUND — Alt+O report · Alt+A approval · Alt+Q question')
h.reply('Alt+G host page · Alt+N new session · Alt+U unload/reload · Alt+X render failure')
if (process.argv.includes('--custom')) h.reply('CUSTOM — Alt+C style · Alt+P passive · Alt+H hide/show · Alt+J focus/unfocus')
h.beginTurn()
const timer = setInterval(() => { h.reply(`BACKGROUND_UPDATE_${++count}`) }, 1800)
const content = <ui.ThemeProvider theme="dark"><Demo /></ui.ThemeProvider>
const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{content}</ui.AlternateScreen> : content, { patchConsole: false, exitOnCtrlC: false })
process.once('SIGINT', finish)
process.once('SIGTERM', finish)
try { await done } finally {
  clearInterval(timer)
  await instance.unmount()
  h.cleanup()
  await owner.dispose()
  await root.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
}
