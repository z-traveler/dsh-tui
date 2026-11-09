/**
 * Generic plugin input-completion seam: real Cordis activation + mounted
 * PromptInput.
 *
 * The host owns token bounds, the merged menu and the replacement; plugins
 * only declare a trigger, a query and ordered candidates. This battery proves
 * the acceptance contract from `.scratch/skill-mention-tui/issues/02-input-completions.md`:
 *
 * - registration/dispose through a real Cordis activation (and the
 *   `dsh-tui-extensions` row that mounts the service);
 * - priority DESC, registration order for ties, per-source order preserved,
 *   and a source label on every row once more than one source contributes;
 * - the query's read-only session context and abort signal;
 * - source errors are isolated; stale draft/caret/session/provider results
 *   are rejected (the old signal is aborted);
 * - the token suffix (`@path#L12`, an atomic `[Image #1]` placeholder) is
 *   never part of the replacement;
 * - Enter/Tab accept the selected plugin candidate without submitting,
 *   steering or queueing while the model is busy; Esc only closes the menu;
 * - built-in `/` and `@` overlays keep priority over the plugin menu;
 * - an unloaded source closes its menu and its listener stops firing.
 *
 * Run: node --import tsx/esm scripts/verify-input-completions.tsx
 */
import './lib/fake-home.mjs'
import type { Channel } from '../src/dsh-adapter/channel.js'
import type {
  TuiInputCompletionCandidate,
  TuiInputCompletionContext,
  TuiInputCompletionHost,
  TuiInputCompletionProvider,
  TuiInputCompletionQuery,
} from '../src/input-completions.js'

process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'zh'
process.env.DSH_TUI_THEME = 'dark'

const [
  { Context },
  { TuiInputCompletionRuntime, getHostInputCompletions },
  { apply: applyExtensions },
  { completeCommands },
  { PassThrough, Writable },
  React,
  { Terminal: XTerm },
  { render, AlternateScreen, Box, useInput },
  { PromptInput },
  { Launchpad },
  { settled, viewportLines },
] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import('../src/dsh-adapter/input-completions.js'),
  import('../src/dsh-adapter/extensions.js'),
  import('../src/commands.js'),
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/components/PromptInput.js'),
  import('../src/screens/Launchpad.js'),
  import('./lib/term-test.mjs'),
])

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : `: ${detail}`}`)
}

const ROWS = 32
const CONTEXT = { backendId: 'dsh', sessionId: 'session-1', cwd: '/work/project' }

function source(id: string, options: {
  label?: string
  priority?: number
  query?: TuiInputCompletionProvider['query']
  trigger?: TuiInputCompletionProvider['trigger']
} = {}): TuiInputCompletionProvider {
  return {
    id,
    label: options.label ?? id,
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    trigger: options.trigger ?? ((token: { text: string; cursor: number }) =>
      token.text.startsWith('#') ? { query: token.text.slice(1, token.cursor) } : undefined),
    query: options.query ?? ((request: { query: string }) => [{
      id: `${id}-1`,
      name: `${id} ${request.query}`,
      description: `${id} description`,
      replacement: `#${id}:${request.query}`,
    }]),
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function createHost() {
  const root = new Context()
  await root.plugin(TuiInputCompletionRuntime)
  const runtime = root.get('tuiInputCompletions')
  const host = getHostInputCompletions(runtime)
  if (host === undefined) throw new Error('input-completion host facade is unavailable')
  const registerSource = async (provider: TuiInputCompletionProvider) => {
    const fiber = root.inject(['tuiInputCompletions'], ctx => {
      ctx.tuiInputCompletions.register(provider)
    })
    await fiber
    return fiber
  }
  return { root, runtime, host, registerSource }
}

async function resolve(host: TuiInputCompletionHost, text: string, cursor: number, signal = new AbortController().signal) {
  return host.resolve({ text, cursor, context: CONTEXT, signal })
}

// ── Real Cordis activation and the extensions row ──────────────────────────
{
  const root = new Context()
  applyExtensions(root)
  // `ctx.plugin()` schedules the child activation; one macrotask flush makes
  // the mounted-service lookup observable without a wall-clock wait.
  await new Promise(resolve => setImmediate(resolve))
  check('the dsh-tui-extensions row mounts tuiInputCompletions', root.get('tuiInputCompletions') !== undefined)
  await root.fiber.dispose()
}

// ── Host: bounds, context, signal, lifecycle ───────────────────────────────
{
  const { root, host, registerSource } = await createHost()
  let rootRejected = false
  try {
    root.get('tuiInputCompletions')?.register(source('root-leak'))
  } catch {
    rootRejected = true
  }
  check('a root context cannot register a source', rootRejected)
  const seen: TuiInputCompletionQuery[] = []
  const fiber = await registerSource(source('alpha', {
    query: request => {
      seen.push(request)
      return [{ id: 'skill', name: 'skill alpha', replacement: '#skill:alpha' }]
    },
  }))
  const menu = await resolve(host, 'say #sk tail', 7)
  check('host owns the whitespace token bounds', menu?.start === 4 && menu?.end === 7, JSON.stringify(menu))
  const insideWord = await resolve(host, '#skTAIL', 3)
  check('completion replacement ends at the caret and cannot delete later text', insideWord?.start === 0 && insideWord.end === 3)
  check('the query receives the fragment and read-only session context',
    seen.length === 2
      && seen[0].query === 'sk'
      && seen[0].context.backendId === 'dsh'
      && seen[0].context.sessionId === 'session-1'
      && seen[0].context.cwd === '/work/project'
      && Object.isFrozen(seen[0].context),
    JSON.stringify(seen))
  check('the host facade only exposes resolve/subscribe',
    JSON.stringify(Object.keys(host).sort()) === JSON.stringify(['resolve', 'subscribe']))
  await fiber.dispose()
  check('disposing the activation removes its source',
    await resolve(host, 'say #sk tail', 7) === undefined)

  let duplicate = false
  await registerSource(source('alpha'))
  await root.inject(['tuiInputCompletions'], ctx => {
    try {
      ctx.tuiInputCompletions.register(source('alpha'))
    } catch {
      duplicate = true
    }
  })
  check('duplicate source ids are rejected', duplicate)
  await root.fiber.dispose()
}

// ── Host: priority, ties, per-source order, labels ─────────────────────────
{
  const { root, host, registerSource } = await createHost()
  const fibers = []
  fibers.push(await registerSource(source('alpha', {
    query: () => [
      { id: 'a1', name: 'alpha one', replacement: '#alpha-one' },
      { id: 'a2', name: 'alpha two', replacement: '#alpha-two' },
    ],
  })))
  fibers.push(await registerSource(source('gamma', {
    query: () => [{ id: 'g1', name: 'gamma one', replacement: '#gamma-one' }],
  })))
  fibers.push(await registerSource(source('beta', {
    priority: 10,
    query: () => [{ id: 'b1', name: 'beta one', replacement: '#beta-one' }],
  })))
  const menu = await resolve(host, '#', 1)
  check('priority DESC, ties in registration order, per-source order kept',
    menu?.items.map(item => item.id).join(',') === 'b1,a1,a2,g1',
    JSON.stringify(menu?.items.map(item => [item.sourceId, item.id])))
  check('every item carries its source label and a stable source-qualified key',
    menu?.items.every(item => item.sourceLabel === item.sourceId && item.key.includes(item.sourceId)) === true
      && new Set(menu?.items.map(item => item.key)).size === 4)
  check('multi-source menus are labelled as such', menu?.multiSource === true)
  for (const fiber of fibers) await fiber.dispose()
  await root.fiber.dispose()
}

// ── Host: source errors are isolated ───────────────────────────────────────
{
  const { root, host, registerSource } = await createHost()
  const fibers = []
  fibers.push(await registerSource(source('bad-query', {
    query: () => { throw new Error('boom') },
  })))
  fibers.push(await registerSource(source('bad-trigger', {
    trigger: () => { throw new Error('boom') },
  })))
  fibers.push(await registerSource(source('good', {
    query: () => [{ id: 'good', name: 'good source', replacement: '#good' }],
  })))
  const menu = await resolve(host, '#', 1)
  check('a throwing source does not take the other sources down',
    menu?.items.length === 1 && menu.items[0].sourceId === 'good',
    JSON.stringify(menu?.items))
  for (const fiber of fibers) await fiber.dispose()
  await root.fiber.dispose()
}

// ── Host: image placeholder protection and @path#L suffix ──────────────────
{
  const { root, host, registerSource } = await createHost()
  const fiber = await registerSource(source('alpha'))
  check('a caret inside an atomic [Image #N] token cannot trigger a source',
    await resolve(host, '[Image #1]', 8) === undefined)
  check('an @path#L12 token does not trigger a # source',
    await resolve(host, 'see @src/a.ts#L12', 'see @src/a.ts#L12'.length) === undefined)
  const menu = await resolve(host, '#sk', 3)
  check('the same source still triggers outside protected spans', menu?.items.length === 1)
  await fiber.dispose()
  await root.fiber.dispose()
}

// ── Host: abort and provider-generation invalidation ───────────────────────
{
  const { root, host, registerSource } = await createHost()
  const started = deferred<void>()
  let aborted = false
  const fiber = await registerSource(source('slow', {
    query: (_request, signal) => new Promise<readonly TuiInputCompletionCandidate[]>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true
        reject(new Error('aborted'))
      })
      started.resolve(undefined)
    }),
  }))
  const controller = new AbortController()
  const pending = host.resolve({ text: '#sk', cursor: 3, context: CONTEXT, signal: controller.signal })
  await started.promise
  controller.abort()
  check('an aborted query produces no menu and reaches the provider signal',
    await pending === undefined && aborted)
  await fiber.dispose()

  const startedAgain = deferred<void>()
  let finish: ((items: readonly TuiInputCompletionCandidate[]) => void) | undefined
  const fiber2 = await registerSource(source('generation', {
    query: () => new Promise<readonly TuiInputCompletionCandidate[]>((resolveItems) => {
      finish = resolveItems
      startedAgain.resolve(undefined)
    }),
  }))
  const pendingAgain = host.resolve({ text: '#sk', cursor: 3, context: CONTEXT, signal: new AbortController().signal })
  await startedAgain.promise
  await fiber2.dispose()
  finish?.([{ id: 'late', name: 'late candidate', replacement: '#late' }])
  check('a provider added/removed while a query is in flight invalidates its result',
    await pendingAgain === undefined)
  await root.fiber.dispose()
}

// ── Mounted PromptInput ────────────────────────────────────────────────────
function makeChannel(options: {
  working?: boolean
  agentId?: string
  bindingGeneration?: number
  commands?: readonly { name: string; description: string }[]
  files?: readonly unknown[]
  submitted?: string[]
  steered?: string[]
  runs?: string[]
} = {}) {
  const submitted = options.submitted ?? []
  const steered = options.steered ?? []
  const runs = options.runs ?? []
  const notices: string[] = []
  const commands = options.commands ?? []
  const channel = {
    agentId: options.agentId ?? 'agent-1',
    sessionId: options.agentId ?? 'agent-1',
    agentBindingGeneration: options.bindingGeneration ?? 1,
    backendCapabilities: { backendId: 'dsh' },
    cwd: '/work/project',
    working: options.working ?? false,
    mode: { id: 'default', plan: false },
    modeIndex: 0,
    cycleMode() {},
    ready: true,
    pending: [],
    notifications: [],
    attachedContexts: [],
    expandEditor: false,
    status: 'idle',
    commandList: commands,
    commandCompletions: (input: string) => completeCommands(input, commands),
    listFileCandidates: async () => options.files ?? [],
    notify: (text: string) => { notices.push(text) },
    submit: (text: string) => { submitted.push(text) },
    steer: (text: string) => { steered.push(text) },
    cancel() {},
    removePending: () => false,
    stagedImageGeneration: () => 0,
    hasStagedImage: () => false,
    stagedImage: () => undefined,
    discardStagedImage() {},
    submitted,
    steered,
    runs,
    notices,
  }
  return channel
}

async function mount(host: TuiInputCompletionHost, options: Parameters<typeof makeChannel>[0] & { columns?: number; launchpad?: boolean } = {}) {
  const columns = options.columns ?? 110
  const term = new XTerm({ cols: columns, rows: ROWS, scrollback: 100, allowProposedApi: true })
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      term.write(String(chunk), callback)
    },
  })
  stdout.columns = columns
  stdout.rows = ROWS
  stdout.isTTY = true
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  stderr.isTTY = true
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  stdin.setEncoding = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  const channel = makeChannel(options)
  const ready = deferred<void>()
  function Fixture({ channel: nextChannel }: { channel: ReturnType<typeof makeChannel> }): React.ReactNode {
    // Chat-style key holder registered before the prompt, mirroring the
    // component-level input regressions.
    useInput(() => {})
    const [draft, setDraft] = React.useState('')
    const [caret, setCaret] = React.useState(0)
    const [focus, setFocus] = React.useState(-1)
    React.useEffect(() => { if (options.launchpad) ready.resolve(undefined) }, [])
    if (options.launchpad) return React.createElement(Launchpad, {
      query: draft, cursorOffset: caret, focusIndex: focus, isTerminalFocused: true,
      whale: false, whaleIdle: false, whaleGirl: false, starred: false, firstRun: false,
      actions: [], inputCompletions: host,
      inputCompletionContext: { backendId: 'dsh', sessionId: nextChannel.agentId, cwd: nextChannel.cwd, bindingGeneration: nextChannel.agentBindingGeneration },
      onFocusChange: setFocus, onAction() {}, onQueryChange: (text: string, position: number) => { setDraft(text); setCaret(position) },
      onSubmit: (text: string) => { nextChannel.submitted.push(text) }, onEscape() {}, onBlankClick: () => setFocus(-1),
    })
    return React.createElement(
      Box,
      { flexDirection: 'column', height: ROWS, justifyContent: 'flex-end' },
      React.createElement(Box, null, React.createElement(Box, null)),
      React.createElement(PromptInput, {
        channel: nextChannel as unknown as Channel,
        inputCompletions: host,
        helpOpen: false,
        onToggleHelp() {},
        onInputReady: () => ready.resolve(undefined),
        onRunCommand: (name: string) => { nextChannel.runs.push(name); return true },
        selectionActive: false,
      }),
    )
  }
  const build = (nextChannel = channel) => React.createElement(
    AlternateScreen,
    null,
    React.createElement(Fixture, { channel: nextChannel }),
  )
  const instance = await render(build(), { stdout, stderr, stdin, exitOnCtrlC: false, patchConsole: false })
  await ready.promise
  // The first commit can still be one row above the pinned bottom; typing
  // before the alt-screen frame settles would leave the previous bottom
  // border under the new input row's spaces. Wait for the prompt's bottom
  // border in the last viewport row.
  await settled(() => options.launchpad
    ? viewportLines(term).some(line => line.includes('╭'))
    : viewportLines(term)[ROWS - 1]?.startsWith('╰') === true)
  const lines = () => viewportLines(term)
  const menuRows = () => lines().filter(line => line.startsWith('│'))
  const rerender = (nextChannel: ReturnType<typeof makeChannel>) => {
    instance.rerender(build(nextChannel))
    return nextChannel
  }
  return { term, stdin, channel, instance, lines, menuRows, rerender, build }
}

function rowOf(lines: readonly string[], text: string): number {
  return lines.findIndex(line => line.trimStart().startsWith('│') && line.includes(text))
}

function clickRow(stdin: { write(chunk: string): unknown }, lines: readonly string[], row: number, needle: string): void {
  const col = lines[row]!.indexOf(needle) + 2
  stdin.write(`\x1b[<0;${col};${row + 1}M`)
  stdin.write(`\x1b[<0;${col};${row + 1}m`)
}

async function withRuntime(run: (host: TuiInputCompletionHost, registerSource: Awaited<ReturnType<typeof createHost>>['registerSource']) => Promise<void>): Promise<void> {
  const { root, host, registerSource } = await createHost()
  try {
    await run(host, registerSource)
  } finally {
    await root.fiber.dispose()
  }
}

// ── UI: multi-source order, labels, click ──────────────────────────────────
await withRuntime(async (host, registerSource) => {
  const fibers = []
  fibers.push(await registerSource(source('alpha', {
    query: () => [
      { id: 'a1', name: 'alpha one', replacement: '#alpha-one' },
      { id: 'a2', name: 'alpha two', replacement: '#alpha-two' },
    ],
  })))
  fibers.push(await registerSource(source('gamma', {
    query: () => [{ id: 'g1', name: 'gamma one', replacement: '#gamma-one' }],
  })))
  fibers.push(await registerSource(source('beta', {
    priority: 10,
    query: () => [{ id: 'b1', name: 'beta one', replacement: '#beta-one' }],
  })))
  const ui = await mount(host)
  ui.stdin.write('#')
  const opened = await settled(() => rowOf(ui.lines(), 'beta one') >= 0)
  check('the plugin menu opens from a mounted PromptInput', opened, JSON.stringify(ui.lines()))
  const lines = ui.lines()
  const rows = ['beta one', 'alpha one', 'alpha two', 'gamma one'].map(row => rowOf(lines, row))
  check('the visible menu keeps priority/registration/per-source order',
    rows.every(row => row >= 0) && rows[0]! < rows[1]! && rows[1]! < rows[2]! && rows[2]! < rows[3]!,
    JSON.stringify(rows))
  check('every visible row names its source when several sources contribute',
    ['[beta]', '[alpha]', '[gamma]'].every(label => ui.lines().some(line => line.startsWith('│') && line.includes(label))),
    JSON.stringify(ui.menuRows()))
  clickRow(ui.stdin, ui.lines(), rowOf(ui.lines(), 'gamma one'), 'gamma one')
  check('clicking a row accepts that row and keeps the draft editable',
    await settled(() => ui.lines().some(line => line.includes('#gamma-one')))
      && !ui.lines().some(line => line.startsWith('│')),
    JSON.stringify(ui.lines().filter(line => line.includes('#gamma-one'))))
  ui.instance.unmount()
  for (const fiber of fibers) await fiber.dispose()
})

// ── UI: a late higher-priority source keeps the selected item's identity ───
await withRuntime(async (host, registerSource) => {
  await registerSource(source('alpha', {
    query: () => [
      { id: 'a1', name: 'alpha one', replacement: '#alpha-one' },
      { id: 'a2', name: 'alpha two', replacement: '#alpha-two' },
    ],
  }))
  const ui = await mount(host)
  ui.stdin.write('#')
  await settled(() => rowOf(ui.lines(), 'alpha one') >= 0)
  // Select the second row, then let a higher-priority source arrive. The
  // visible order changes, but Enter must still accept alpha two.
  ui.stdin.write('\x1b[B')
  await registerSource(source('omega', {
    priority: 20,
    query: () => [{ id: 'o1', name: 'omega one', replacement: '#omega-one' }],
  }))
  check('a late higher-priority source is shown above the old rows',
    await settled(() => rowOf(ui.lines(), 'omega one') >= 0)
      && rowOf(ui.lines(), 'omega one') < rowOf(ui.lines(), 'alpha one'),
    JSON.stringify(ui.menuRows()))
  ui.stdin.write('\r')
  check('a late higher-priority source does not silently swap the selected item identity',
    await settled(() => ui.lines().some(line => line.includes('#alpha-two')))
      && !ui.lines().some(line => line.includes('#omega-one')),
    JSON.stringify(ui.lines().filter(line => line.includes('#'))))
  ui.instance.unmount()
})

// ── UI: Enter/Tab while busy accept without submit/steer/queue ─────────────
for (const [keyName, key] of [['Enter', '\r'], ['Tab', '\t']] as const) {
  await withRuntime(async (host, registerSource) => {
    await registerSource(source('alpha', {
      query: () => [{ id: 'skill', name: 'skill:foo', replacement: '#skill:foo' }],
    }))
    const ui = await mount(host, { working: true })
    ui.stdin.write('#sk')
    check(`${keyName}: plugin menu opens while the model is busy`,
      await settled(() => rowOf(ui.lines(), 'skill:foo') >= 0))
    ui.stdin.write(key)
    check(`${keyName}: accepts the candidate without submitting or steering while busy`,
      await settled(() => ui.lines().some(line => line.includes('#skill:foo')))
        && ui.channel.submitted.length === 0
        && ui.channel.steered.length === 0
        && ui.channel.notices.every((notice: string) => !notice.includes('queued')),
      JSON.stringify({ submitted: ui.channel.submitted, steered: ui.channel.steered, notices: ui.channel.notices }))
    check(`${keyName}: the accepted menu closes and stays closed for this token`,
      ui.menuRows().length === 0, JSON.stringify(ui.menuRows()))
    ui.instance.unmount()
  })
}

// ── UI: Esc closes only the menu ───────────────────────────────────────────
await withRuntime(async (host, registerSource) => {
  await registerSource(source('alpha'))
  const ui = await mount(host)
  ui.stdin.write('#sk')
  await settled(() => rowOf(ui.lines(), 'alpha sk') >= 0)
  ui.stdin.write('\x1b')
  check('Esc closes the plugin menu without clearing the draft',
    await settled(() => ui.menuRows().length === 0)
      && ui.lines().some(line => line.includes('#sk'))
      && ui.channel.submitted.length === 0,
    JSON.stringify(ui.lines()))
  ui.instance.unmount()
})

// ── UI: built-in / and @ keep priority over the plugin menu ────────────────
await withRuntime(async (host, registerSource) => {
  let pluginQueries = 0
  await registerSource(source('all-tokens', {
    trigger: token => token.cursor > 0 ? { query: token.text } : undefined,
    query: () => {
      pluginQueries += 1
      return [{ id: 'plugin', name: 'plugin candidate', replacement: 'PLUGIN' }]
    },
  }))
  const commands = [{ name: 'status', description: 'show status' }]
  const slash = await mount(host, { commands })
  slash.stdin.write('/')
  check('the built-in slash menu wins and the plugin menu stays closed',
    await settled(() => slash.lines().some(line => line.startsWith('│') && line.includes('status')))
      && !slash.lines().some(line => line.startsWith('│') && line.includes('plugin candidate')),
    JSON.stringify(slash.menuRows()))
  check('the plugin source is not even queried inside a slash command', pluginQueries === 0)
  slash.stdin.write('\r')
  check('Enter on the built-in slash menu still runs the command',
    await settled(() => slash.channel.runs.includes('status'))
      && slash.channel.submitted.length === 0,
    JSON.stringify({ runs: slash.channel.runs, submitted: slash.channel.submitted }))
  slash.instance.unmount()

  const at = await mount(host, {
    files: [{
      id: 'src/a.ts',
      path: 'src/a.ts',
      displayPath: 'src/a.ts',
      name: 'a.ts',
      kind: 'file',
      score: 0,
    }],
  })
  at.stdin.write('@')
  check('the built-in @ menu wins and the plugin menu stays closed',
    await settled(() => at.menuRows().some(line => line.includes('a.ts')))
      && !at.menuRows().some(line => line.includes('plugin candidate')),
    JSON.stringify(at.menuRows()))
  check('the plugin source is not even queried inside a built-in @ token', pluginQueries === 0)
  at.instance.unmount()
})

// ── UI: suffix and atomic spans survive acceptance ─────────────────────────
await withRuntime(async (host, registerSource) => {
  await registerSource(source('alpha', {
    query: () => [{ id: 'skill', name: 'skill:foo', replacement: '#skill:foo' }],
  }))
  const ui = await mount(host, { columns: 120 })
  const draft = '#sk @a#L1 [Image #1]'
  ui.stdin.write(draft)
  // Caret after `#sk` (offset 3): 17 left-arrows from the end of `draft`.
  ui.stdin.write('\x1b[D'.repeat(draft.length - 3))
  const menuOpened = await settled(() => rowOf(ui.lines(), 'skill:foo') >= 0)
  check('the menu opens for a mid-sentence token with a protected suffix', menuOpened)
  ui.stdin.write('\r')
  check('accepting replaces only the token: the sentence suffix, @path#L and image token survive',
    await settled(() => ui.lines().some(line => line.includes('#skill:foo @a#L1 [Image #1]'))),
    JSON.stringify(ui.lines()))
  ui.instance.unmount()
})

// ── UI: stale results, identical query, session/provider changes, unmount ──
{
  const { root, host, registerSource } = await createHost()
  const calls: Array<{ query: string; context: TuiInputCompletionContext; signal: AbortSignal; finish: (items: readonly TuiInputCompletionCandidate[]) => void }> = []
  const sourceFiber = await registerSource(source('slow', {
    trigger: token => token.text.startsWith('#') ? { query: token.text } : undefined,
    query: (request, signal) => new Promise<readonly TuiInputCompletionCandidate[]>((resolveItems) => {
      calls.push({ query: request.query, context: request.context, signal, finish: resolveItems })
    }),
  }))
  const ui = await mount(host)
  ui.stdin.write('#ab')
  await settled(() => calls.length === 1)
  // Move the caret inside the SAME token; the provider's query string is
  // intentionally cursor-independent, so this is the "identical query" case.
  ui.stdin.write('\x1b[D')
  await settled(() => calls.length === 2)
  check('moving the caret aborts the old query even with an identical query string',
    calls[1]!.query === calls[0]!.query && calls[0]!.signal.aborted)
  calls[0]!.finish([{ id: 'stale', name: 'stale candidate', replacement: '#stale' }])
  calls[1]!.finish([{ id: 'fresh', name: 'fresh candidate', replacement: '#fresh' }])
  check('a stale result never replaces the current menu',
    await settled(() => ui.lines().some(line => line.includes('fresh candidate')))
      && !ui.lines().some(line => line.includes('stale candidate')),
    JSON.stringify(ui.lines().filter(line => line.startsWith('│'))))

  // Session change: same draft, same query string, new channel identity.
  ui.stdin.write('\x1b[D')
  await settled(() => calls.length === 3)
  const oldSignal = calls[2]!.signal
  ui.rerender(makeChannel({ agentId: 'agent-2', bindingGeneration: 2 }))
  await settled(() => calls.length === 4)
  check('a session/binding change aborts the previous query and passes the new context',
    oldSignal.aborted && calls[3]!.context.sessionId === 'agent-2',
    JSON.stringify({ oldAborted: oldSignal.aborted, contexts: calls.map(call => call.context.sessionId) }))
  calls[2]!.finish([{ id: 'old-session', name: 'old session candidate', replacement: '#old' }])
  calls[3]!.finish([{ id: 'new-session', name: 'new session candidate', replacement: '#new' }])
  check('old-session results are not shown after the switch',
    await settled(() => ui.lines().some(line => line.includes('new session candidate')))
      && !ui.lines().some(line => line.includes('old session candidate')),
    JSON.stringify(ui.lines().filter(line => line.startsWith('│'))))

  // Provider removal while a menu is open closes it and stops the listener.
  calls.length = 0
  ui.stdin.write('c')
  await settled(() => calls.length === 1)
  calls[0]!.finish([{ id: 'visible', name: 'visible candidate', replacement: '#visible' }])
  check('the menu is visible before its source unloads',
    await settled(() => ui.lines().some(line => line.includes('visible candidate'))))
  await sourceFiber.dispose()
  check('unloading the source closes its owned menu', await settled(() => !ui.lines().some(line => line.startsWith('│'))))

  // Unmount cancels an in-flight query.
  await registerSource(source('slow', {
    trigger: token => token.text.startsWith('#') ? { query: token.text } : undefined,
    query: (request, signal) => new Promise<readonly TuiInputCompletionCandidate[]>((resolveItems) => {
      calls.push({ query: request.query, context: request.context, signal, finish: resolveItems })
    }),
  }))
  calls.length = 0
  ui.stdin.write('z')
  await settled(() => calls.length === 1)
  const unmountCall = calls[0]!
  ui.instance.unmount()
  check('unmounting the prompt aborts its in-flight query', unmountCall.signal.aborted)

  await root.fiber.dispose()
}

// A rendered menu must not be accepted after a same-batch caret move.
await withRuntime(async (host, registerSource) => {
  await registerSource(source('cursor-fence', {
    query: () => [{ id: 'one', name: 'cursor-row', replacement: '#changed' }],
  }))
  const ui = await mount(host)
  ui.stdin.write('#sk')
  check('cursor-fence menu is visible before the same-batch edit', await settled(() => rowOf(ui.lines(), 'cursor-row') >= 0))
  ui.stdin.write('\x1b[D\r')
  check('same-batch caret movement cannot accept the previously rendered menu',
    await settled(() => ui.lines().some(line => line.includes('#sk')))
      && !ui.lines().some(line => line.includes('#changed')) && ui.channel.submitted.length === 0)
  ui.instance.unmount()
})

// Revocation must be synchronous even before React can redraw the menu.
{
  const { root, host } = await createHost()
  let remove = () => {}
  const fiber = root.inject(['tuiInputCompletions'], ctx => {
    remove = ctx.tuiInputCompletions.register(source('revoked', {
      query: () => [{ id: 'one', name: 'revoked-row', replacement: '#revoked' }],
    }))
  })
  await fiber
  const ui = await mount(host)
  ui.stdin.write('#sk')
  check('revocation menu is visible before removing its source', await settled(() => rowOf(ui.lines(), 'revoked-row') >= 0))
  remove()
  ui.stdin.write('\r')
  check('source revocation prevents acceptance before the next render',
    !ui.lines().some(line => line.includes('#revoked'))
      && ui.channel.submitted.every(text => !text.includes('#revoked')))
  ui.instance.unmount()
  await root.fiber.dispose()
}

// A source that ignores cancellation cannot hold the host resolve open.
{
  const { root, host, registerSource } = await createHost()
  let signal: AbortSignal | undefined
  const fiber = await registerSource(source('ignores-abort', {
    query: (_request, borrowed) => {
      signal = borrowed
      return new Promise(() => {})
    },
  }))
  const controller = new AbortController()
  const pending = resolve(host, '#sk', 3, controller.signal)
  controller.abort()
  const result = await Promise.race([pending, new Promise(resolveTurn => setImmediate(() => resolveTurn('still-pending')))])
  check('cancellation releases host resolution even when a provider ignores its signal', result === undefined && signal?.aborted === true)
  await fiber.dispose()
  await root.fiber.dispose()
}

// The default startup composer is a real entry point, not only Chat's prompt.
await withRuntime(async (host, registerSource) => {
  await registerSource(source('landing', {
    query: () => [{ id: 'one', name: 'landing', replacement: '#skill:alpha' }],
  }))
  const ui = await mount(host, { launchpad: true })
  ui.stdin.write('#sk tail')
  ui.stdin.write('\x1b[D'.repeat(5))
  check('the default launchpad composer opens the generic plugin menu',
    await settled(() => rowOf(ui.lines(), 'landing') >= 0))
  ui.stdin.write('\r')
  check('launchpad Enter accepts only the token and preserves the sentence suffix',
    await settled(() => ui.lines().some(line => line.includes('#skill:alpha tail'))) && ui.channel.submitted.length === 0)
  ui.instance.unmount()
  const escape = await mount(host, { launchpad: true, columns: 40 })
  escape.stdin.write('#sk')
  check('the plugin menu is available on a narrow launchpad',
    await settled(() => rowOf(escape.lines(), 'landing') >= 0))
  escape.stdin.write('\x1b')
  check('launchpad Escape closes the plugin menu without clearing or submitting the draft',
    await settled(() => rowOf(escape.lines(), 'landing') < 0)
      && escape.lines().some(line => line.includes('#sk')) && escape.channel.submitted.length === 0)
  escape.instance.unmount()
})

console.log(`verify-input-completions: ${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
