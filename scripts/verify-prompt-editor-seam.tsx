/**
 * Prompt editor integration seam: Ctrl+G still belongs to the TUI, and an
 * external plugin's provider may only EXTEND one launch.
 *
 * Two layers, both driving real code:
 *
 * A. runtime (`dsh-adapter/integration.ts` + `utils/externalEditor.ts`) over a
 *    real cordis root and a REAL editor child process that records its argv
 *    and environment:
 *    - no provider → the built-in launch, unchanged argv, inherited env;
 *    - a registered provider's argv + child env reach the child, `$EDITOR` and
 *      `process.env` stay untouched, and the edit round-trips into the draft;
 *    - `dispose` runs once, may be async (it is awaited), and runs after the
 *      child exited and before the terminal restore;
 *    - one provider owns the slot; declines, throws and rejections use the
 *      built-in launch; a second registration cannot replace or chain it;
 *    - an unloaded plugin stops extending the launch, and a composition-root
 *      caller cannot register at all.
 *
 * B. UI path (real Chat → PromptInput → util): the `promptEditor` prop reaches
 *    the launch, the hook sees the draft's session id and the draft
 *    file, and the edited text comes back into the composer draft. The
 *    terminal restore that follows the round-trip (and the submit path behind
 *    it) is `repro-external-editor`'s subject.
 *
 * Run: node --import tsx/esm scripts/verify-prompt-editor-seam.tsx
 */
export {}

process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'

const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-tui-editor-seam-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
mkdirSync(join(isolatedHome, '.dsh-tui'), { recursive: true })

const [
  { PassThrough, Writable },
  React,
  { Context },
  { render },
  { Chat },
  { QuestionStore },
  { TuiIntegrationRuntime, getHostIntegration },
  { editInExternalEditor },
  { settled, sleep },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@deepseek-ai/cordis'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/dsh-adapter/integration.js'),
  import('../src/utils/externalEditor.js'),
  import('./lib/term-test.mjs'),
])

import type { PromptEditorLaunch, PromptEditorPrepare, PromptEditorPrepareContext } from '../src/utils/promptEditorLaunch.js'

let failures = 0
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-tui-editor-seam-child-'))
/** A real editor: records its argv + our marker env, then writes known text. */
const editorScript = join(scratch, 'fake-editor.cjs')
writeFileSync(editorScript, `
const fs = require('node:fs')
const file = process.argv[process.argv.length - 1]
fs.writeFileSync(process.env.PROMPT_EDITOR_DUMP, JSON.stringify({
  argv: process.argv,
  mark: process.env.OMNI_TEST_MARK ?? null,
}))
fs.writeFileSync(file, 'edited by the fake editor\\n')
`)
delete process.env.VISUAL
delete process.env.OMNI_TEST_MARK
process.env.EDITOR = `"${process.execPath}" "${editorScript}"`
const SAVED_EDITOR = process.env.EDITOR

let dumps = 0
const nextDump = (): string => {
  const path = join(scratch, `dump-${dumps++}.json`)
  process.env.PROMPT_EDITOR_DUMP = path
  return path
}
const readDump = (path: string): { argv: string[]; mark: string | null } =>
  JSON.parse(readFileSync(path, 'utf8')) as { argv: string[]; mark: string | null }

// ── A. runtime over a real cordis root ─────────────────────────────────────
const root = new Context()
const warnings: string[] = []
root.logger.warn = (format: unknown, ...params: unknown[]) => {
  warnings.push([format, ...params].map(String).join(' '))
}
root.plugin(TuiIntegrationRuntime)
await settled(() => root.get('tuiIntegration') !== undefined)
const host = getHostIntegration(root.tuiIntegration as never)
if (host === undefined) throw new Error('host accessor missing')

let activations = 0
/** Register one provider from a live plugin activation; returns its teardown. */
const registerProvider = async (prepare: PromptEditorPrepare): Promise<() => Promise<void>> => {
  let registered = false
  let dispose: (() => void) | undefined
  const fiber = root.plugin({
    name: `editor-provider-${activations++}`,
    inject: ['tuiIntegration'],
    apply(pluginCtx: InstanceType<typeof Context>) {
      dispose = pluginCtx.tuiIntegration.registerEditor(prepare)
      registered = true
    },
  })
  await settled(() => registered)
  return async () => {
    dispose?.()
    await fiber.dispose()
  }
}

/** One real Ctrl+G launch through the host handle, as the prompt performs it. */
const launch = async (draft: string) => {
  const dump = nextDump()
  const outcome = await editInExternalEditor(draft, {
    sessionId: 'seam-session',
    prepare: host.prepareEditor,
  })
  return { outcome, dump }
}

/** `node <editor> <draft file>`: the argv the built-in launch produces. */
const builtInArgv = (argv: readonly string[]): boolean =>
  argv.length === 3 && argv[0] === process.execPath && argv[1] === editorScript && argv[2]!.endsWith('input.md')

// 1. No provider at all: the built-in launch.
{
  const { outcome, dump } = await launch('draft')
  const child = readDump(dump)
  check('no provider: the built-in argv reaches the editor (script, then the draft file)',
    builtInArgv(child.argv), child.argv)
  check('no provider: no injected child env', child.mark === null, child.mark)
  check('no provider: the edit round-trips into the draft',
    outcome.kind === 'edited' && outcome.text === 'edited by the fake editor', outcome)
}

// 2. A registered provider extends argv + child env and owns a cleanup.
{
  const contexts: PromptEditorPrepareContext[] = []
  const order: string[] = []
  const teardown = await registerProvider((context: PromptEditorPrepareContext): PromptEditorLaunch => {
    contexts.push(context)
    return {
      // The fake editor is `node <script>`, so extra arguments go before the
      // draft file — the shape `nvim -u <loader> <file>` has with a one-word
      // `$EDITOR`.
      argv: [context.argv[0]!, context.argv[1]!, '-u', 'omni-loader.lua', context.argv.at(-1)!],
      env: { OMNI_TEST_MARK: 'child-only' },
      dispose: async () => {
        // Async on purpose: the launch must await it.
        await Promise.resolve()
        order.push('dispose')
      },
    }
  })
  const { outcome, dump } = await launch('draft')
  const child = readDump(dump)
  check('provider: the hook sees the foreground session facts',
    contexts.length === 1 && contexts[0]!.sessionId === 'seam-session'
      && Object.keys(contexts[0]!).sort().join(',') === 'argv,file,sessionId',
    contexts)
  check('provider: the hook sees the resolved argv ending with the draft file',
    contexts[0]?.argv.length === 3 && contexts[0]?.argv.at(-1) === contexts[0]?.file, contexts[0]?.argv)
  check('provider: the extended argv reaches the child',
    child.argv[1] === editorScript && child.argv[2] === '-u' && child.argv[3] === 'omni-loader.lua'
    && child.argv.at(-1)!.endsWith('input.md'), child.argv)
  check('provider: the child env entry reaches the child', child.mark === 'child-only', child.mark)
  check('provider: the host process env was not mutated', process.env.OMNI_TEST_MARK === undefined, process.env.OMNI_TEST_MARK)
  check('provider: $EDITOR is untouched by the launch', process.env.EDITOR === SAVED_EDITOR, process.env.EDITOR)
  check('provider: dispose ran once, awaited, after the child', order.join(',') === 'dispose', order)
  check('provider: the edit still round-trips', outcome.kind === 'edited' && outcome.text === 'edited by the fake editor', outcome)
  await teardown()
}

// 3. No opinion and failures all fall back to the built-in launch.
{
  const cases: { name: string; prepare: PromptEditorPrepare }[] = [
    { name: 'declines', prepare: () => undefined },
    { name: 'throws synchronously', prepare: () => { throw new Error('provider-boom') } },
    { name: 'rejects', prepare: async () => { throw new Error('provider-reject') } },
  ]
  for (const entry of cases) {
    const before = warnings.length
    const teardown = await registerProvider(entry.prepare)
    const { outcome, dump } = await launch('draft')
    const child = readDump(dump)
    check(`a provider that ${entry.name}: the built-in argv runs`, builtInArgv(child.argv), child.argv)
    check(`a provider that ${entry.name}: no child env is injected`, child.mark === null, child.mark)
    check(`a provider that ${entry.name}: the edit still round-trips`, outcome.kind === 'edited', outcome)
    if (entry.name !== 'declines') {
      check(`a provider that ${entry.name}: the failure is logged, not propagated`,
        warnings.length > before && warnings.some(line => line.includes('editor provider failed')), warnings.slice(before))
    }
    await teardown()
  }
}

// 4. One provider slot: no ordered fallback chain or silent replacement.
{
  let firstAsked = 0
  let secondAsked = false
  const first = await registerProvider(() => { firstAsked += 1; return undefined })
  const before = warnings.length
  const second = await registerProvider(context => {
    secondAsked = true
    return { argv: [...context.argv], env: { OMNI_TEST_MARK: 'second' } }
  })
  check('a second editor registration is explicitly refused', warnings.slice(before).some(line => line.includes('already has an editor provider')), warnings.slice(before))
  const live = await launch('draft')
  check('a declining owner uses the built-in launch, not a second provider', builtInArgv(readDump(live.dump).argv) && readDump(live.dump).mark === null)
  check('the refused provider is never consulted', secondAsked === false)
  await second()
  await launch('draft')
  check('disposing a refused registration leaves its owner intact', firstAsked === 2, firstAsked)
  await first()
  const replacement = await registerProvider(context => ({ argv: [...context.argv], env: { OMNI_TEST_MARK: 'replacement' } }))
  const fresh = await launch('draft')
  check('the slot is available after its owner unloads', readDump(fresh.dump).mark === 'replacement')
  await replacement()
}

// 5. Unloaded plugin: its provider goes with the activation.
{
  const teardown = await registerProvider(context => ({
    argv: [...context.argv],
    env: { OMNI_TEST_MARK: 'temporary' },
  }))
  const live = await launch('draft')
  check('a registered provider is consulted', readDump(live.dump).mark === 'temporary', readDump(live.dump).mark)
  await teardown()
  const gone = await launch('draft')
  check('an unloaded plugin stops extending the launch', readDump(gone.dump).mark === null, readDump(gone.dump).mark)
}

// 6. A composition-root caller cannot register a provider.
{
  const before = warnings.length
  const noop = root.tuiIntegration.registerEditor(context => ({
    argv: [...context.argv],
    env: { OMNI_TEST_MARK: 'root' },
  }))
  check('a composition-root registration is refused',
    typeof noop === 'function' && warnings.length === before + 1, warnings.slice(before))
  const { dump } = await launch('draft')
  check('the refused provider never runs', readDump(dump).mark === null, readDump(dump).mark)
}

// ── B. the real UI path: Chat → PromptInput → the launch ───────────────────
{
  class FakeStdout extends Writable {
    columns = 100
    rows = 32
    isTTY = true
    _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void): void {
      callback()
    }
  }
  class FakeStderr extends Writable {
    isTTY = true
    _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void): void {
      callback()
    }
  }
  class FakeStdin extends PassThrough {
    isTTY = true
    setRawMode(): this {
      return this
    }
    ref(): this {
      return this
    }
    unref(): this {
      return this
    }
  }
  const channel = {
    version: 1,
    rows: [],
    status: 'idle',
    sessionTitle: 'seam',
    agentId: 'chat-session',
    cwd: '/chat/project',
    displayCwd: '/chat/project',
    model: 'seam-model',
    mode: { plan: false },
    working: false,
    pending: [],
    commandList: [],
    notifications: [],
    subscribe: () => () => undefined,
    submit: () => undefined,
    cancel: () => undefined,
    clear: () => undefined,
    steer: () => undefined,
    interruptAndDeliver: () => 0,
    removePending: () => true,
    cycleMode: () => Promise.resolve(),
    listFiles: () => Promise.resolve([]),
    notify: () => undefined,
    listModels: () => Promise.resolve([]),
    listSessions: () => [],
    setResumeTarget: () => undefined,
    loadOlder: () => undefined,
    mcpStatus: () => [],
    whaleIdle: false,
  }
  const stdinObj = new FakeStdin()
  const hookCalls: PromptEditorPrepareContext[] = []
  const controllerRef: { current: { text?(): string } | null } = { current: null }
  const instance = await render(
    React.createElement(Chat, {
      channel: channel as never,
      questionStore: new QuestionStore(),
      onExit: () => undefined,
      promptControllerRef: controllerRef,
      promptEditor: (context: PromptEditorPrepareContext): PromptEditorLaunch => {
        hookCalls.push(context)
        return { argv: [...context.argv], env: { OMNI_TEST_MARK: 'chat-layer' }, dispose: () => undefined }
      },
    } as never),
    {
      stdout: new FakeStdout() as unknown as NodeJS.WriteStream,
      stdin: stdinObj as unknown as NodeJS.ReadStream,
      stderr: new FakeStderr() as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  try {
    // 固定窗:pacing 首帧上屏后才注册按键监听；FakeStdout 丢弃帧，没有可轮询的锚点。
    await sleep(600)
    const dump = nextDump()
    stdinObj.write('\x07')
    check('the Ctrl+G launch reaches the plugin hook', await settled(() => hookCalls.length === 1), hookCalls.length)
    check('the hook sees the foreground session of the real screen',
      hookCalls[0]?.sessionId === 'chat-session' && !('cwd' in hookCalls[0]) && !('session' in hookCalls[0]),
      hookCalls[0])
    check('the hook sees the draft file the TUI created',
      hookCalls[0]?.argv.at(-1) === hookCalls[0]?.file && hookCalls[0]!.file.endsWith('input.md'), hookCalls[0]?.argv)
    check('the plugin env reaches the real child',
      await settled(() => existsSync(dump) && readDump(dump).mark === 'chat-layer'),
      existsSync(dump) ? readDump(dump).mark : 'no dump')
    check('the edited text is the composer draft',
      await settled(() => controllerRef.current?.text?.() === 'edited by the fake editor'),
      controllerRef.current?.text?.())
  } finally {
    await instance.unmount()
  }
}

console.log(failures === 0 ? 'verify-prompt-editor-seam: OK' : `verify-prompt-editor-seam: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
