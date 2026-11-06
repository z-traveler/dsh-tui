/**
 * Real registry -> channel -> Chat -> xterm regression for local command reports.
 *
 * Two contracts share this fixture. With `sessionCards` off, a registry
 * command's settled text reaches the transcript only through the dispatcher's
 * local report rows (`local` + `local-output`) and its toast. With it on, the
 * durable `command/run` + `command/done` pair is the single presentation of
 * that text: no local report rows, no duplicate success toast, and only a
 * failure keeps its transient error read. Both are driven through the real
 * Chat dispatcher (`/demo`, `/compact`, `/permission <preset>`) over faked
 * session events, never by calling the projection directly.
 * Run: node --import tsx/esm scripts/verify-plugin-command-output.mjs
 */
process.env.DSH_TUI_LANG = 'en'
process.env.FORCE_COLOR = '3'
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const home = mkdtempSync(join(tmpdir(), 'dsh-command-report-'))
process.env.HOME = home
process.env.USERPROFILE = home
try {
const [assert, React, { Writable, PassThrough }, { Terminal }, ui, { Chat },
  { createChannel }, { QuestionStore }, { settle, settled, sleep, findText },
  { cleanBlockLines, cleanCommandReport }, { stringWidth }, { default: instances },
  { getSelectedText }, { DATA_DIR }, { MAX_ROWS }] = await Promise.all([
  import('node:assert/strict'), import('react'), import('node:stream'), import('@xterm/headless'),
  import('../src/ui.js'), import('../src/screens/Chat.js'), import('../src/dsh-adapter/channel.js'),
  import('../src/dsh-adapter/questions.js'), import('./lib/term-test.mjs'),
  import('../src/channel/sanitize.js'), import('../src/ink/stringWidth.js'),
  import('../src/ink/instances.js'), import('../src/ink/selection.js'),
  import('../src/utils/paths.js'), import('../src/channel/transcript.js'),
])
assert.equal(DATA_DIR, join(home, '.dsh-tui'), 'application imports must see the isolated home')

// Count input units passed through the real width function: a deterministic
// work bound, independent of machine speed, on the production sanitizer.
const original = new URL('../src/channel/sanitize.ts', import.meta.url)
const measured = new URL(`./sanitize.work-${process.pid}.ts`, original)
writeFileSync(measured, readFileSync(original, 'utf8').replace(
  "import { stringWidth } from '../ink/stringWidth.js'",
  "import { stringWidth as actualWidth } from '../ink/stringWidth.js'\nexport let measuredUnits = 0\nfunction stringWidth(value: string): number { measuredUnits += value.length; return actualWidth(value) }"))
try {
  const probe = await import(measured.href)
  const input = '中文😀'.repeat(3000)
  assert.equal(probe.cleanCommandReport(input).truncated, true)
  assert.ok(probe.measuredUnits < input.length * 4, 'report clipping must not repeatedly measure growing prefixes')
} finally { rmSync(measured, { force: true }) }

assert.deepEqual(cleanBlockLines('  one  two\n\nthree', 100), ['one two', 'three'])
assert.deepEqual(cleanCommandReport('  one\n\n\x1b[31m中文😀\x1b[0m\x1b]0;hidden\x07\x00').lines, ['  one', '', '中文😀 '])
for (const value of ['x'.repeat(65_537), '中文😀'.repeat(3000), 'line\n'.repeat(201), 'x'.repeat(65_535) + '😀']) {
  const report = cleanCommandReport(value)
  assert.equal(report.truncated, true)
  assert.ok(report.lines.length <= 200)
  assert.ok(report.lines.every(line => stringWidth(line) <= 4000 && !/[\uD800-\uDBFF]$/u.test(line)))
}
console.log('PASS report bounds, Unicode, ANSI/OSC/C0, indentation, blank lines, unchanged explicit blocks')

async function harness(fullscreen, execute, options = {}) {
  let calls = 0
  // The durable session log this fixture delivers on `session/event`, plus the
  // `submit` inbox: a registry command's own lifecycle is the only writer here.
  const durable = []
  const submitted = []
  let seq = 0
  const listeners = new Map()
  const on = (name, listener) => {
    const set = listeners.get(name) ?? new Set()
    listeners.set(name, set)
    set.add(listener)
    return () => { set.delete(listener) }
  }
  const definitions = (options.commands ?? ['demo']).map(name => ({ name, description: `${name} fixture`, input: { hint: '', images: false } }))
  const makeAgent = id => ({
    id, status: 'idle', session: { id, seq: 0, events: id === 'origin' ? durable : [] },
    ctx: { on: () => () => {} }, followup: input => submitted.push(input), steer() {}, cancel() {},
  })
  const origin = makeAgent('origin')
  /** Deliver one durable DSH session event the way the host does: append it to
   *  the session log, then hand it to every `session/event` listener of this
   *  agent's session (the channel's translator and the DSH extensions). */
  const emitSession = (type, data) => {
    const event = { type, seq: ++seq, time: 1_700_000_000_000 + seq, data }
    origin.session.seq = event.seq
    durable.push(event)
    for (const listener of [...(listeners.get('session/event') ?? [])]) listener(origin.session, event)
    return event
  }
  const commands = {
    list: () => definitions,
    find: (_agent, name) => definitions.find(definition => definition.name === name),
    async execute(_agent, line) {
      calls += 1
      const commandId = `cmd-${calls}`
      const name = line.slice(1).split(/\s+/u)[0] ?? ''
      // The host logs `command/run` before the handler and `command/done` once
      // it settles; `options.lifecycle` replays that pair, so the channel sees
      // the same durable fact a real composition would.
      if (options.lifecycle === true) {
        emitSession('command/run', { commandId, name, args: line.slice(1 + name.length), source: { kind: 'user' } })
      }
      const result = await execute(name)
      if (options.lifecycle === true) {
        // A compaction checkpoint lands before the `command/done` that points
        // at it (`sourceEventSeq`): the record owning the richer presentation
        // is the checkpoint itself.
        const checkpoint = result.checkpoint === undefined
          ? undefined
          : emitSession('user/message', {
            id: `checkpoint-${commandId}`,
            content: [{ type: 'text', text: result.checkpoint }],
            source: { kind: 'compact-checkpoint' },
          }).seq
        emitSession('command/done', {
          commandId,
          kind: result.kind,
          text: result.text,
          ...(checkpoint === undefined ? {} : { sourceEventSeq: checkpoint }),
        })
      }
      return { commandId, result: { kind: result.kind, text: result.text } }
    },
  }
  const ctx = {
    on,
    get: name => name === 'commands' ? commands
      : name === 'agents' ? { create: async () => ({ agent: makeAgent('replacement'), dispose: async () => {} }) }
      : undefined,
    logger: { warn() {}, info() {}, debug() {} },
  }
  const channel = createChannel(ctx, origin, {
    model: 'fake-model', provider: '', cwd: home, activity: false,
    ...(options.sessionCards === undefined ? {} : { sessionCards: options.sessionCards }),
  })
  const term = new Terminal({ cols: 90, rows: 50, scrollback: 1000, allowProposedApi: true })
  const stdout = new Writable({ write(chunk, _encoding, callback) { term.write(String(chunk), callback) } })
  Object.assign(stdout, { columns: 90, rows: 50, isTTY: true })
  const stdin = new PassThrough()
  Object.assign(stdin, { isTTY: true, setRawMode() { return this }, ref() { return this }, unref() { return this } })
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const chat = React.createElement(Chat, { channel, fullscreen, questionStore: new QuestionStore(), onExit() {}, trajectorySeen: true })
  const app = await ui.render(fullscreen ? React.createElement(ui.AlternateScreen, { mouseTracking: true }, chat) : chat,
    { stdout, stdin, stderr, patchConsole: false, exitOnCtrlC: false })
  const screen = () => Array.from({ length: term.buffer.active.baseY + term.rows }, (_, y) => term.buffer.active.getLine(y)?.translateToString(true) ?? '').join('\n')
  await settle(() => screen().includes('fake-model'))
  const run = async (line = '/demo') => {
    for (const char of line) stdin.write(char)
    await settle(() => screen().includes(line))
    stdin.write('\r')
  }
  return { channel, term, stdin, stdout, run, screen, calls: () => calls, durable, submitted,
    close: async () => { await app.unmount(); channel.releaseContributions(); term.dispose() } }
}

const text = Array.from({ length: 30 }, (_, i) => i === 14 ? '' : `  REPORT-${i + 1} 中文😀`).join('\n')
for (const fullscreen of [false, true]) {
  for (const kind of ['success', 'error']) {
    const h = await harness(fullscreen, async () => ({ kind, text }), { sessionCards: false })
    await h.run()
    await settle(() => h.channel.rows.filter(row => row.kind === 'local-output').length === 30)
    const rows = h.channel.rows.filter(row => row.kind === 'local-output')
    assert.equal(rows[0].text, '  REPORT-1 中文😀')
    assert.equal(rows[29].text, '  REPORT-30 中文😀')
    assert.equal(rows[14].text.trim(), '')
    assert.equal(h.calls(), 1)
    assert.equal(h.durable.length, 0)
    assert.equal(h.submitted.length, 0)
    assert.equal(h.channel.notifications.some(notice => notice.color === 'error'), kind === 'error')
    await settle(() => h.screen().includes('REPORT-1 ') && h.screen().includes('REPORT-30 '))
    if (fullscreen) {
      const first = findText(h.term, 'REPORT-1 ')
      const last = findText(h.term, 'REPORT-30 ')
      h.stdin.write(`\x1b[<0;${first.col + 1};${first.row + 1}M`)
      h.stdin.write(`\x1b[<32;${last.col + 20};${last.row + 1}M`)
      h.stdin.write(`\x1b[<0;${last.col + 20};${last.row + 1}m`)
      const ink = instances.get(h.stdout)
      assert.ok(await settled(() => getSelectedText(ink.selection, ink.frontFrame.screen).includes('REPORT-30')))
      const copied = getSelectedText(ink.selection, ink.frontFrame.screen)
      assert.ok(copied.includes('REPORT-1 ') && copied.includes('REPORT-30'))
    }
    console.log(`PASS real registry/channel ${kind}, ${fullscreen ? 'fullscreen SGR copy' : 'inline scrollback'}, 30 lines, one execution, no model/durable writes`)
    if (kind === 'success') console.log(`SCREEN ${fullscreen ? 'fullscreen' : 'inline'}\n${h.screen()}\nEND SCREEN`)
    await h.close()
  }
}

{
  const h = await harness(false, async () => ({ kind: 'success', text: 'line\n'.repeat(201) }), { sessionCards: false })
  await h.run()
  await settle(() => h.channel.rows.some(row => row.text.includes('command output truncated')))
  assert.equal(h.channel.rows.filter(row => row.kind === 'local-output').length, 201)
  await h.close()
  console.log('PASS visible truncation marker through real Chat')
}
{
  const h = await harness(false, async () => ({ kind: 'success', text: 'retained' }), { sessionCards: false })
  h.channel.rows.push({ id: -1, kind: 'user', text: 'backend fact must survive local report eviction' })
  for (let i = 0; i < 8; i++) h.channel.pushLocal(`REPORT ${i}`, Array(200).fill(`line ${i}`), { preserveWhitespace: true })
  assert.ok(h.channel.rows.filter(row => row.kind === 'local' || row.kind === 'local-output').length <= MAX_ROWS)
  assert.equal(h.channel.rows.find(row => row.id === -1)?.text, 'backend fact must survive local report eviction')
  assert.equal(h.channel.rows.at(-1).text, 'line 7')
  assert.equal(h.channel.rows.find(row => row.kind === 'local')?.text, 'REPORT 6', 'evict whole old reports')
  await h.close()
  console.log('PASS bounded aggregate local reports; newest whole blocks and backend facts retained')
}
{
  let resolve
  const h = await harness(false, () => new Promise(done => { resolve = done }), { sessionCards: false })
  await h.run()
  await settle(() => typeof resolve === 'function')
  assert.equal(await h.channel.newSession(), true)
  resolve({ kind: 'success', text: 'STALE-REPORT' })
  // 固定窗:pacing Allow a settled old registry result to reach both binding fences.
  await sleep(100)
  assert.ok(!h.channel.rows.some(row => row.text.includes('STALE-REPORT')))
  assert.equal(h.calls(), 1)
  await h.close()
  console.log('PASS actual session replacement drops late result')
}

/** The composer's own row: the draft is cleared (or kept) there, never in a
 *  transcript card whose headline repeats the same command line. */
const promptLine = screen => screen.split('\n').find(line => line.includes('❯')) ?? ''

// ── `sessionCards` on: one durable card owns the settled text ───────────────
{
  // The generic plugin-command route (`{ report: true }`). The card carries the
  // whole 30-line body; the dispatcher's report rows must not be laid on top.
  const h = await harness(false, async () => ({ kind: 'success', text }), { lifecycle: true })
  await h.run()
  await settle(() => h.channel.rows.some(row => row.kind === 'command'))
  const cards = h.channel.rows.filter(row => row.kind === 'command')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].text, text)
  assert.equal(cards[0].command.status, 'success')
  assert.equal(h.channel.rows.filter(row => row.kind === 'local' || row.kind === 'local-output').length, 0,
    'the card owns the body: no duplicate local report rows')
  assert.deepEqual(h.channel.notifications.map(notice => [notice.text, notice.color]), [],
    'the card owns the body: no duplicate success toast')
  assert.deepEqual(h.durable.map(event => event.type), ['command/run', 'command/done'])
  assert.equal(h.calls(), 1)
  assert.equal(h.submitted.length, 0)
  await settle(() => !promptLine(h.screen()).includes('/demo'))
  assert.ok(!promptLine(h.screen()).includes('/demo'), 'a settled success still consumes the draft')
  await h.close()
  console.log('PASS sessionCards: report route -> one card, no local rows, no duplicate success toast, draft consumed')
}
{
  // The single-line route: a short success text used to arrive twice (card and
  // toast). The durable card is the only presentation now.
  const h = await harness(false, async () => ({ kind: 'success', text: 'Compacted 12 history items.' }),
    { sessionCards: true, lifecycle: true, commands: ['compact'] })
  await h.run('/compact')
  await settle(() => h.channel.rows.some(row => row.kind === 'command'))
  const cards = h.channel.rows.filter(row => row.kind === 'command')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].command.name, 'compact')
  assert.equal(cards[0].text, 'Compacted 12 history items.')
  assert.deepEqual(h.channel.notifications.map(notice => notice.text), [],
    'a settled success text must not also arrive as a toast')
  assert.equal(h.channel.rows.filter(row => row.kind === 'local' || row.kind === 'local-output').length, 0)
  await settle(() => !promptLine(h.screen()).includes('/compact'))
  assert.ok(!promptLine(h.screen()).includes('/compact'))
  await h.close()
  console.log('PASS sessionCards: short success result -> card only, no duplicate toast, draft consumed')
}
{
  // Switch off: the upstream shape stays byte for byte (toast, no card).
  const h = await harness(false, async () => ({ kind: 'success', text: 'Compacted 12 history items.' }),
    { sessionCards: false, lifecycle: true, commands: ['compact'] })
  await h.run('/compact')
  await settle(() => h.channel.notifications.length > 0)
  assert.equal(h.channel.rows.filter(row => row.kind === 'command').length, 0)
  assert.deepEqual(h.channel.notifications.map(notice => [notice.text, notice.color]), [['Compacted 12 history items.', undefined]])
  assert.equal(h.channel.rows.filter(row => row.kind === 'local' || row.kind === 'local-output').length, 0)
  await h.close()
  console.log('PASS sessionCards off: short success result keeps the upstream toast and no card')
}
{
  // Errors keep the transient read (colour + timeout) next to the error card in
  // both routes, and stepping aside for a success must not swallow them.
  const h = await harness(false, async () => ({ kind: 'error', text: 'compaction failed: nothing to compact' }),
    { sessionCards: true, lifecycle: true, commands: ['compact'] })
  await h.run('/compact')
  await settle(() => h.channel.rows.some(row => row.kind === 'command'))
  const cards = h.channel.rows.filter(row => row.kind === 'command')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].command.status, 'error')
  assert.deepEqual(h.channel.notifications.map(notice => [notice.text, notice.color]),
    [['compaction failed: nothing to compact', 'error']])
  await h.close()
  console.log('PASS sessionCards: settled error -> error card plus its transient error toast')
}
{
  // `/permission <preset>` has its own dispatch (`runPermissionCommand`) and its
  // own toast: a mounted registry command settles into the same card.
  const h = await harness(false, async () => ({ kind: 'success', text: 'Permission preset set to bypass' }),
    { sessionCards: true, lifecycle: true, commands: ['permission'] })
  await h.run('/permission bypass')
  await settle(() => h.channel.rows.some(row => row.kind === 'command'))
  const cards = h.channel.rows.filter(row => row.kind === 'command')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].command.name, 'permission')
  // The row keeps the invocation's raw input (`/permission bypass` → ` bypass`);
  // the headline trims it.
  assert.equal(cards[0].command.args?.trim(), 'bypass')
  assert.deepEqual(h.channel.notifications.map(notice => notice.text), [],
    'the card already shows the preset switch')
  assert.deepEqual(h.durable.map(event => event.type), ['command/run', 'command/done'])
  await h.close()
  console.log('PASS sessionCards: /permission success -> card only, no duplicate toast')
}
{
  const h = await harness(false, async () => ({ kind: 'error', text: 'preset rejected: unknown preset' }),
    { sessionCards: true, lifecycle: true, commands: ['permission'] })
  await h.run('/permission bypass')
  await settle(() => h.channel.rows.some(row => row.kind === 'command'))
  assert.equal(h.channel.rows.filter(row => row.kind === 'command')[0]?.command.status, 'error')
  assert.deepEqual(h.channel.notifications.map(notice => [notice.text, notice.color]),
    [['preset rejected: unknown preset', 'error']])
  await h.close()
  console.log('PASS sessionCards: /permission rejection keeps its error toast')
}
{
  // `sourceEventSeq` marks a record that already owns a richer presentation
  // (`/compact`'s checkpoint): no generic card and no generic toast on top of it.
  const h = await harness(false, async () => ({
    kind: 'success', text: 'Compacted 12 history items.', checkpoint: 'SUMMARY-OF-PRIOR-CONTEXT',
  }), { sessionCards: true, lifecycle: true, commands: ['compact'] })
  await h.run('/compact')
  await settle(() => h.channel.rows.some(row => row.kind === 'compact'))
  assert.equal(h.channel.rows.find(row => row.kind === 'compact')?.text, 'SUMMARY-OF-PRIOR-CONTEXT',
    'the checkpoint keeps its own presentation')
  assert.equal(h.channel.rows.filter(row => row.kind === 'command').length, 0,
    'a covered command result adds no duplicate card')
  assert.deepEqual(h.channel.notifications.map(notice => notice.text), [])
  assert.equal(h.channel.rows.filter(row => row.kind === 'local' || row.kind === 'local-output').length, 0)
  await h.close()
  console.log('PASS sessionCards: sourceEventSeq-covered compact keeps its checkpoint and adds nothing')
}
{
  // The control for the assertion above: the same fixture with the switch off
  // still delivers the upstream toast, so `no toast` there is the switch at
  // work, not an unobserved callback.
  const h = await harness(false, async () => ({
    kind: 'success', text: 'Compacted 12 history items.', checkpoint: 'SUMMARY-OF-PRIOR-CONTEXT',
  }), { sessionCards: false, lifecycle: true, commands: ['compact'] })
  await h.run('/compact')
  await settle(() => h.channel.notifications.length > 0)
  assert.deepEqual(h.channel.notifications.map(notice => notice.text), ['Compacted 12 history items.'])
  assert.equal(h.channel.rows.filter(row => row.kind === 'command').length, 0)
  await h.close()
  console.log('PASS sessionCards off: covered compact keeps the upstream toast')
}
console.log('verify-plugin-command-output: all checks passed')
} finally { rmSync(home, { recursive: true, force: true }) }
