/**
 * Generic command-draft seam: a plugin maps one settled LOCAL command result
 * to a replacement draft in the composer.
 *
 * Contract under test (docs/downstream/command-drafts.md):
 * - `ctx.tuiInput.registerCommandDraft(name, mapper)` is bound to the calling
 *   Cordis activation, rejects a root-context caller and duplicate names, and
 *   disappears with its activation;
 * - the mapper receives the settled `{ name, args, outcome, text }` of the
 *   command actually dispatched here, returns the draft text or `undefined`,
 *   and a throwing mapper leaves the command outcome untouched;
 * - only a success outcome carries `draftText` on `ExternalCommandOutcome`;
 *   a command without a mapper keeps the boolean consume semantics exactly;
 * - the composer fills the mapped text in the SAME atomic step that consumes
 *   the command line: no submit, no queue, no model request, and the big-input
 *   fold keeps every line;
 * - a late reply never overwrites a draft the user edited or a session that
 *   was replaced, and only the live local invocation path maps at all — the
 *   durable/replayed card renderers never write a draft.
 *
 * Run: node --import tsx/esm scripts/downstream/verify-command-drafts.tsx
 */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { Channel, ExternalCommandOutcome } from '../../src/dsh-adapter/channel.js'
import type { CommandRunResult } from '../../src/components/commandDraftFill.js'
import type { PromptController } from '../../src/components/PromptInput.js'
import type { TuiCommandDraftPacket } from '../../src/tui-input.js'

process.env.FORCE_COLOR = '3'
process.env.TERM = 'xterm-256color'
process.env.COLORTERM = 'truecolor'
process.env.DSH_TUI_LANG = 'zh'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
delete process.env.TMUX

const [
  { Context: CordisContext },
  { default: React },
  { Terminal: XTerm },
  ui,
  { PromptInput },
  { TuiInputRuntime, resolveCommandDraft },
  { apply: applyExtensions },
  { createExternalCommandInvoker },
  { settled, viewportLines },
] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import('react'),
  import('@xterm/headless'),
  import('../../src/ui.js'),
  import('../../src/components/PromptInput.js'),
  import('../../src/dsh-adapter/command-drafts.js'),
  import('../../src/dsh-adapter/extensions.js'),
  import('../../src/dsh-adapter/channel/external-commands.js'),
  import('../lib/term-test.mjs'),
])

let checks = 0
async function check(label: string, test: () => void | Promise<void>): Promise<void> {
  await test()
  console.log(`PASS ${++checks}: ${label}`)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const DRAFT = ['You are a careful assistant.', '', '## Rules', '- answer briefly', '- cite files'].join('\n')

// ── Seam: lifecycle, ownership, isolation ──────────────────────────────────

await check('the dsh-tui-extensions row mounts ctx.tuiInput', async () => {
  const root = new CordisContext()
  applyExtensions(root)
  // `ctx.plugin()` schedules the child activation; one macrotask flush makes
  // the mounted-service lookup observable without a wall-clock wait.
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(root.get('tuiInput'), undefined)
  await root.fiber.dispose()
})

{
  const root = new CordisContext()
  await root.plugin(TuiInputRuntime)
  const runtime = root.get('tuiInput')
  await check('a root context cannot register a command-draft mapper', () => {
    assert.throws(() => runtime.registerCommandDraft('demo', () => DRAFT))
  })
  await root.fiber.dispose()
}

{
  const root = new CordisContext()
  await root.plugin(TuiInputRuntime)
  const runtime = root.get('tuiInput')
  const fiber = await root.inject(['tuiInput'], ctx => {
    ctx.tuiInput.registerCommandDraft('demo', packet => `draft:${packet.args ?? ''}`)
  })
  await check('registration is per activation, duplicate names are rejected, disposing unregisters', async () => {
    assert.equal(resolveCommandDraft(runtime, {
      name: 'demo', args: ' copy', outcome: 'success', text: 'ok',
    }), 'draft: copy')
    let duplicate = false
    await root.inject(['tuiInput'], ctx => {
      try {
        ctx.tuiInput.registerCommandDraft('demo', () => DRAFT)
      } catch {
        duplicate = true
      }
    })
    assert.ok(duplicate, 'the same command name must not gain a second mapper')
    await fiber.dispose()
    assert.equal(resolveCommandDraft(runtime, {
      name: 'demo', args: ' copy', outcome: 'success', text: 'ok',
    }), undefined)
  })
  await root.fiber.dispose()
}

{
  const root = new CordisContext()
  await root.plugin(TuiInputRuntime)
  const runtime = root.get('tuiInput')
  const fiber = await root.inject(['tuiInput'], ctx => {
    ctx.tuiInput.registerCommandDraft('boom', () => { throw new Error('mapper exploded') })
  })
  await check('a throwing mapper (or no mapper/service at all) resolves to no draft', () => {
    const packet: TuiCommandDraftPacket = { name: 'boom', outcome: 'success', text: 'ok' }
    assert.equal(resolveCommandDraft(runtime, packet), undefined)
    assert.equal(resolveCommandDraft(runtime, { name: 'unmapped', outcome: 'success', text: 'ok' }), undefined)
    assert.equal(resolveCommandDraft(undefined, packet), undefined)
  })
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── The real local command chain: createExternalCommandInvoker.invoke ──────

interface SettledResult { kind: 'success' | 'error'; text?: string }

/** One real `invoke()` against a fake command service: `ctx` is the same
 *  composition root the mapper registered on, so `ctx.get('tuiInput')` is the
 *  live seam. */
async function invoke(ctx: Context, options: {
  name: string
  rawInput: string
  result: SettledResult
}): Promise<ExternalCommandOutcome | undefined> {
  const definition = { name: options.name, handler: () => undefined }
  const service = {
    find: () => definition,
    execute: async () => ({ result: options.result }),
  }
  const invoker = createExternalCommandInvoker(ctx, {
    commandService: service as never,
    runtime: { mode: 'legacy', slices: [] },
    agent: () => ({}) as never,
    capture: () => 'capture',
    bindingCurrent: () => true,
    allows: () => true,
    composer: { snapshot: () => new Map(), includeLegacyImageRefs: () => new Map() } as never,
    attachments: () => undefined,
    notify: () => {},
  })
  return await invoker.invoke(options.name, options.rawInput)
}

{
  const root = new CordisContext()
  await root.plugin(TuiInputRuntime)
  const seen: TuiCommandDraftPacket[] = []
  const fiber = await root.inject(['tuiInput'], ctx => {
    ctx.tuiInput.registerCommandDraft('demo', packet => {
      seen.push(packet)
      return packet.text === 'ok' ? DRAFT : undefined
    })
  })

  await check('a settled local success maps through the registered mapper into the outcome', async () => {
    const outcome = await invoke(root, { name: 'demo', rawInput: ' copy', result: { kind: 'success', text: 'ok' } })
    assert.deepEqual(seen, [{ name: 'demo', args: ' copy', outcome: 'success', text: 'ok' }])
    assert.deepEqual(outcome, { kind: 'success', text: 'ok', consumeDraft: true, draftText: DRAFT })
  })
  await check('the same mapped text is produced again for the next command (no string dedupe)', async () => {
    const repeated = await invoke(root, { name: 'demo', rawInput: ' copy', result: { kind: 'success', text: 'ok' } })
    assert.equal(repeated?.kind === 'success' ? repeated.draftText : undefined, DRAFT)
  })
  await check('a command without a mapper keeps the boolean consume outcome unchanged', async () => {
    const plain = await invoke(root, { name: 'plain', rawInput: ' x', result: { kind: 'success', text: 'done' } })
    assert.deepEqual(plain, { kind: 'success', text: 'done', consumeDraft: true })
  })
  await check('an error result never carries a draft', async () => {
    const failed = await invoke(root, { name: 'demo', rawInput: ' copy', result: { kind: 'error', text: 'nope' } })
    assert.deepEqual(failed, { kind: 'error', text: 'nope', consumeDraft: true })
  })
  await check('a packet the mapper declines yields no draft while the command stays consumed', async () => {
    const declined = await invoke(root, { name: 'demo', rawInput: '', result: { kind: 'success', text: 'other' } })
    assert.deepEqual(declined, { kind: 'success', text: 'other', consumeDraft: true })
  })
  await check('a throwing mapper leaves the command success outcome untouched', async () => {
    const boom = await root.inject(['tuiInput'], ctx => {
      ctx.tuiInput.registerCommandDraft('boom', () => { throw new Error('mapper exploded') })
    })
    const thrown = await invoke(root, { name: 'boom', rawInput: '', result: { kind: 'success', text: 'ok' } })
    assert.deepEqual(thrown, { kind: 'success', text: 'ok', consumeDraft: true })
    await boom.dispose()
  })
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── Mounted prompt: the intent fills the composer atomically ──────────────

const COLS = 110
const ROWS = 32

interface PromptFixture {
  stdin: PassThrough
  lines: () => string[]
  draft: () => string
  runs: string[]
  submitted: string[]
  steered: string[]
  notices: string[]
  clearDraft(): void
  intent(next: () => boolean | Promise<CommandRunResult>): void
  replaceSession(): void
  unmount(): void
}

async function mount(): Promise<PromptFixture> {
  const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 200, allowProposedApi: true })
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      term.write(String(chunk), callback)
    },
  })
  Object.assign(stdout, { columns: COLS, rows: ROWS, isTTY: true })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  Object.assign(stderr, { isTTY: true })
  const stdin = new PassThrough()
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    setEncoding: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  })
  const runs: string[] = []
  const submitted: string[] = []
  const steered: string[] = []
  const notices: string[] = []
  let imageGeneration = 0
  let intent: () => boolean | Promise<CommandRunResult> = () => true
  const channel = {
    agentId: 'agent-1',
    sessionId: 'agent-1',
    agentBindingGeneration: 1,
    backendCapabilities: { backendId: 'dsh' },
    cwd: '/work/project',
    working: false,
    mode: { id: 'default', plan: false },
    modeIndex: 0,
    cycleMode() {},
    ready: true,
    pending: [],
    notifications: [],
    attachedContexts: [],
    expandEditor: false,
    status: 'idle',
    commandList: [{ name: 'demo', description: 'map a draft', external: true }],
    commandCompletions: () => [],
    listFileCandidates: async () => [],
    notify: (text: string) => { notices.push(text) },
    submit: (text: string) => { submitted.push(text) },
    steer: (text: string) => { steered.push(text) },
    cancel() {},
    removePending: () => false,
    stagedImageGeneration: () => imageGeneration,
    hasStagedImage: () => false,
    stagedImage: () => undefined,
    discardStagedImage() {},
  }
  const controllerRef: { current: PromptController | null } = { current: null }
  const ready = deferred<void>()
  const build = () => React.createElement(ui.AlternateScreen, null, React.createElement(PromptInput, {
    channel: channel as unknown as Channel,
    controllerRef: controllerRef as never,
    helpOpen: false,
    onToggleHelp() {},
    onInputReady: () => ready.resolve(undefined),
    onRunCommand: (name: string) => {
      runs.push(name)
      return intent()
    },
    selectionActive: false,
  }))
  const instance = await ui.render(build(), { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false })
  await ready.promise
  await settled(() => viewportLines(term)[ROWS - 1]?.startsWith('╰') === true)
  return {
    stdin,
    lines: () => viewportLines(term),
    draft: () => controllerRef.current?.text() ?? '<no prompt>',
    runs,
    submitted,
    steered,
    notices,
    clearDraft: () => { controllerRef.current?.clear() },
    intent: next => { intent = next },
    // A session replacement clears every staged capability: the composer's
    // image lease (generation) — the same fence a command reply must pass.
    replaceSession: () => { imageGeneration += 1 },
    unmount: () => { instance.unmount() },
  }
}

{
  const prompt = await mount()
  const pending = deferred<CommandRunResult>()
  prompt.intent(() => pending.promise)
  await dispatch(prompt, '/demo copy')
  await check('the settled command line is consumed and replaced by the full mapped text', async () => {
    assert.equal(prompt.draft(), '/demo copy', 'the command line stays editable while it settles')
    pending.resolve({ consumeDraft: true, draftText: DRAFT })
    await settled(() => prompt.draft() === DRAFT)
    assert.equal(prompt.draft(), DRAFT)
    assert.deepEqual(prompt.submitted, [])
    assert.deepEqual(prompt.steered, [])
  })

  await check('the same mapped text fills again for the next command (no string dedupe)', async () => {
    prompt.clearDraft()
    await settled(() => prompt.draft() === '')
    // 固定窗: 跨过 PromptInput 的 80ms CR/LF Enter 去重窗，让这次 Enter 生效
    await new Promise(resolve => setTimeout(resolve, 120))
    const again = deferred<CommandRunResult>()
    prompt.intent(() => again.promise)
    await dispatch(prompt, '/demo copy')
    again.resolve({ consumeDraft: true, draftText: DRAFT })
    await settled(() => prompt.draft() === DRAFT)
    assert.equal(prompt.draft(), DRAFT)
    assert.deepEqual(prompt.submitted, [])
  })

  prompt.unmount()
}

/** Type one command line and let it dispatch; the draft stays the command. */
async function dispatch(prompt: PromptFixture, line: string): Promise<void> {
  const before = prompt.runs.length
  prompt.stdin.write(line)
  await settled(() => prompt.draft() === line)
  prompt.stdin.write('\r')
  await settled(() => prompt.runs.length === before + 1)
}

{
  const big = Array.from({ length: 40 }, (_, index) => `line ${index + 1} of the prompt`).join('\n')
  const prompt = await mount()
  const pending = deferred<CommandRunResult>()
  prompt.intent(() => pending.promise)
  await dispatch(prompt, '/demo copy')
  await check('a big mapped text reuses the input fold and submits every line only on Enter', async () => {
    pending.resolve({ consumeDraft: true, draftText: big })
    await settled(() => prompt.draft() === big)
    assert.ok(prompt.lines().some(line => line.includes('40 行')), JSON.stringify(prompt.lines()))
    assert.deepEqual(prompt.submitted, [], 'filling the draft never submits it')
    // 固定窗: 跨过 PromptInput 的 80ms CR/LF Enter 去重窗，让这次 Enter 生效
    await new Promise(resolve => setTimeout(resolve, 120))
    prompt.stdin.write('\r')
    await settled(() => prompt.submitted.length === 1)
    assert.deepEqual(prompt.submitted, [big])
  })
  prompt.unmount()
}

{
  const prompt = await mount()
  const pending = deferred<CommandRunResult>()
  prompt.intent(() => pending.promise)
  await dispatch(prompt, '/demo plain')
  await check('a command without a draft intent still just clears its line', async () => {
    pending.resolve(true)
    await settled(() => prompt.draft() === '')
    assert.equal(prompt.draft(), '')
    assert.deepEqual(prompt.submitted, [])
  })
  prompt.unmount()
}

{
  const prompt = await mount()
  const pending = deferred<CommandRunResult>()
  prompt.intent(() => pending.promise)
  await dispatch(prompt, '/demo copy')
  prompt.stdin.write('X')
  await settled(() => prompt.draft() === '/demo copyX')
  await check('a late draft reply never overwrites text the user typed meanwhile', async () => {
    pending.resolve({ consumeDraft: true, draftText: DRAFT })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(prompt.draft(), '/demo copyX')
    assert.deepEqual(prompt.submitted, [])
  })
  prompt.unmount()
}

{
  const prompt = await mount()
  const pending = deferred<CommandRunResult>()
  prompt.intent(() => pending.promise)
  await dispatch(prompt, '/demo copy')
  prompt.replaceSession()
  await check('a draft reply from a replaced session never fills the new draft', async () => {
    pending.resolve({ consumeDraft: true, draftText: DRAFT })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(prompt.draft(), '/demo copy')
  })
  prompt.unmount()
}

// ── Only the live local invocation path maps a draft ──────────────────────

await check('durable card, replay and UI modules never map a draft; only the local invocation does', () => {
  const root = join(import.meta.dirname, '..', '..')
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  for (const path of [
    'src/channel/projection.ts',
    'src/channel/session-card-projection.ts',
    'src/dsh-adapter/backend/session-card-facts.ts',
    'src/dsh-adapter/channel/session-card-restore.ts',
    'src/components/messages/CommandCardRow.tsx',
  ]) {
    const source = read(path)
    assert.ok(!source.includes('draftText'), `${path} must not write a draft from a replayed card`)
    assert.ok(!source.includes('tuiInput'), `${path} must not read the command-draft seam`)
  }
  assert.ok(read('src/dsh-adapter/channel/external-commands.ts').includes('resolveCommandDraft('),
    'the live local invocation is the mapping call site')
  for (const path of ['src/dsh-adapter/channel.ts', 'src/screens/Chat.tsx', 'src/components/PromptInput.tsx']) {
    assert.ok(!read(path).includes('resolveCommandDraft('), `${path} must not map drafts outside the invocation`)
  }
})

console.log(`\n${checks} checks passed`)
