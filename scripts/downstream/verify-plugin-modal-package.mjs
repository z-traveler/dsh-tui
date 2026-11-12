/** Consume an actual npm tarball, never src aliases; strict NodeNext, no skipLibCheck.
 * node scripts/downstream/verify-plugin-modal-package.mjs /absolute/package.tgz
 * Keeps the extracted package/fixture for inspection. Only dependency symlinks
 * point at the checkout's installed node_modules; this is not a stable install. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const tarball = process.argv[2]
assert.ok(tarball, 'pass an actual npm tarball path')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sandbox = mkdtempSync(join(tmpdir(), 'dsh-modal-consumer-'))
const modules = join(sandbox, 'node_modules')
const packageDir = join(modules, '@deepseek-harness-tui/dsh-tui')
mkdirSync(packageDir, { recursive: true })
const home = join(sandbox, 'home')
mkdirSync(home)
function run(command, args, cwd = sandbox) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh') } })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert.equal(result.status, 0, `${command} failed (${result.error ?? result.signal ?? result.status}); sandbox: ${sandbox}`)
}
run('tar', ['-xzf', resolve(tarball), '--strip-components=1', '-C', packageDir])
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
for (const group of ['dependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(manifest[group] ?? {})) {
    assert.ok(!/^(workspace:|file:|link:)/u.test(String(version)), `${name} leaks a workspace dependency; pack through with-publish-manifest.mjs`)
  }
}
for (const entry of readdirSync(join(root, 'node_modules'))) {
  if (entry.startsWith('.') || entry === '@deepseek-harness-tui') continue
  symlinkSync(join(root, 'node_modules', entry), join(modules, entry), 'dir')
}
writeFileSync(join(sandbox, 'consumer.mts'), `
import type { Context } from '@deepseek-ai/cordis'
import { TuiSceneRuntime } from '@deepseek-harness-tui/dsh-tui/scenes'
import type { TuiModalProps, TuiModalDescriptor, TuiModalOpenResult, TuiModalOptions } from '@deepseek-harness-tui/dsh-tui/scenes'

function Report({ React, ui, focused, contentSize, signal, close }: TuiModalProps) {
  const [count, setCount] = React.useState(0)
  ui.useInput((input) => { if (input === 'r') setCount(count + 1); if (input === 'q') close() })
  const columns: number = ui.useTerminalSize().columns
  return React.createElement(ui.Text, null, String(count + columns + contentSize.rows) + focused + signal.aborted)
}
export const options: TuiModalOptions = { width: '66.7%', minWidth: 24, height: 12, maxHeight: '80%',
  anchor: 'left-center', row: '25%', col: '50%', offsetX: 1, offsetY: -1, margin: { left: 2, right: 2 },
  visible: (columns, rows) => columns >= 40 && rows >= 10, nonCapturing: false,
  style: { backgroundColor: '#123456', borderStyle: 'double', borderColor: 'accent', titleColor: null, paddingX: 2, paddingY: 1, chrome: true, backdrop: false },
}
export const descriptor: TuiModalDescriptor = { id: 'consumer-report', component: Report, options }
export function register(ctx: Context) { return ctx.tuiScenes.registerModal(descriptor) }
export async function open(ctx: Context): Promise<TuiModalOpenResult> {
  const version: 1 = ctx.tuiScenes.modalOptionsVersion
  const result = await ctx.tuiScenes.openModal('consumer-report', options)
  if (result.status === 'opened') {
    const window = result.instance
    window.updateOptions({ width: '50%', style: { paddingX: undefined } })
    window.setHidden(true); const hidden: boolean = window.isHidden(); window.setHidden(false)
    window.focus(); const focused: boolean = window.isFocused(); window.unfocus()
    const current: Readonly<TuiModalOptions> = window.options()
    const bounds = window.getBounds()
    if (bounds) {
      const columns: number = bounds.columns
      // @ts-expect-error bounds are a read-only host projection
      bounds.left = 2
    }
    window.close(); const signal: AbortSignal = window.signal; return result
  }
  const message: string = result.message
  return result
}
export const legacyOpen = (ctx: Context) => ctx.tuiScenes.openModal('consumer-report')
export const runtime: typeof TuiSceneRuntime = TuiSceneRuntime
// @ts-expect-error opacity is deliberately not a supported option
export const fakeAlpha: TuiModalOptions = { opacity: 0.5 }
// @ts-expect-error visible must return boolean
export const invalidVisibility: TuiModalOptions = { visible: () => 1 }
// @ts-expect-error modal component must receive the typed host props
export const invalid: TuiModalDescriptor = { id: 'bad', component: (props: number) => null }
// @ts-expect-error a rejected result has no window instance
export const invalidResult: TuiModalOpenResult = { status: 'rejected', code: 'not-registered', message: 'absent', instance: {} }
`)
writeFileSync(join(sandbox, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
  esModuleInterop: true, types: ['node'],
}, files: ['consumer.mts'] }, null, 2))
run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(sandbox, 'tsconfig.json')])
writeFileSync(join(sandbox, 'smoke.mjs'), `import assert from 'node:assert/strict';
import { TuiSceneRuntime } from '@deepseek-harness-tui/dsh-tui/scenes';
import { Context } from '@deepseek-ai/cordis';
const root = new Context();
await root.plugin(TuiSceneRuntime);
let opened;
const owner = root.inject(['tuiScenes'], ctx => {
  assert.equal(ctx.tuiScenes.modalOptionsVersion, 1);
  ctx.tuiScenes.registerModal({ id: 'smoke-window', component: () => null, options: { width: '33.3%', anchor: 'left-center' } });
  opened = ctx.tuiScenes.openModal('smoke-window', { nonCapturing: true, style: { backgroundColor: '#123456' } });
});
await owner;
const result = await opened;
assert.equal(result.status, 'rejected');
assert.equal(result.code, 'host-unavailable');
await owner.dispose(); await root.fiber.dispose();
console.log('PASS packaged modal runtime import, version detection and options call');\n`)
run(process.execPath, [join(sandbox, 'smoke.mjs')])
console.log(`PASS strict NodeNext tarball consumer; SANDBOX=${sandbox}`)
