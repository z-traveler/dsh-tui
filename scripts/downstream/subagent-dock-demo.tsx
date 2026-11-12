/** Credential-free real Chat demo, defaults to two parallel subagents + pi-like.
 * node --import tsx/esm scripts/downstream/subagent-dock-demo.tsx [--inline] [--legacy]
 * Alt+6 single / Alt+7 parallel / Alt+8 workflow; Alt+9 advances workflow.
 * Alt+5 style, Alt+2 add 12 (every scene), Alt+3 finish, Alt+4 restart scene,
 * Alt+1 toggle dock. Ctrl+C exits and removes only this demo's temporary HOME. */
import home from '../lib/fake-home.mjs'
import { rmSync } from 'node:fs'
process.env.DSH_HOME = `${home}/.dsh`
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
process.env.DSH_TUI_LANG = 'en'
const [React, ui, { SubagentDockDemoScene, DEMO_STYLES }, { applyCardStyles }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('./subagent-dock-demo-scene.js'), import('../../src/cardStyles.js'),
])
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this demo in a terminal')
const inline = process.argv.includes('--inline')
const initialStyle = process.argv.includes('--legacy') ? 0 : 1
applyCardStyles(DEMO_STYLES[initialStyle]!.config)
let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })
const pending: Promise<unknown>[] = []
const scene = <SubagentDockDemoScene fullscreen={!inline} initialStyle={initialStyle} onExit={finish} onCleanup={promise => pending.push(promise)} />
const instance = await ui.render(inline ? scene : <ui.AlternateScreen>{scene}</ui.AlternateScreen>, { patchConsole: false, exitOnCtrlC: false })
process.once('SIGINT', () => finish())
process.once('SIGTERM', () => finish())
try { await done } finally {
  await instance.unmount()
  await Promise.all(pending)
  rmSync(home, { recursive: true, force: true })
}
