/** Plugin footer segment regression: real Cordis admission and terminal rendering.
 * node --import tsx/esm scripts/downstream/verify-status-field-segments.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'

process.env.FORCE_COLOR = '3'
process.env.TERM = 'xterm-256color'
process.env.COLORTERM = 'truecolor'
process.env.DSH_TUI_LANG = 'en'
delete process.env.TMUX

const [{ Context }, { TuiStatusRuntime, getHostStatusStore }] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import('../../src/dsh-adapter/status.js'),
])

const root = new Context()
const warnings: string[] = []
root.logger.exporter({
  colors: false,
  levels: { default: 4 },
  export(message: { type: string; args: unknown[] }): void {
    if (message.type === 'warn') warnings.push(message.args.map(String).join(' '))
  },
})
await root.plugin(TuiStatusRuntime)
const store = getHostStatusStore(root.get('tuiStatus'))!
let pluginCtx: InstanceType<typeof Context> | undefined
const fiber = root.inject(['tuiStatus'], ctx => { pluginCtx = ctx })
await fiber
const status = pluginCtx!.tuiStatus

try {
  assert.equal(status.fieldSegmentsVersion, 1)
  status.setField('metric', 'RATE · 42%', {
    tone: 'warning',
    segments: [{ text: 'RATE', tone: 'accent' }, { text: ' · ' }, { text: '42%', tone: 'success' }],
  })
  const entry = store.getFieldSnapshot()[0]!
  assert.equal(entry.text, 'RATE · 42%')
  assert.deepEqual(entry.segments, [
    { text: 'RATE', tone: 'accent' },
    { text: ' · ', tone: 'warning' },
    { text: '42%', tone: 'success' },
  ])
  assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.segments))
  assert.ok(entry.segments!.every(Object.isFrozen))
  console.log('PASS: segmented field admission and immutable snapshot')

  const segmentInputs = [{ text: 'old', tone: 'error' as const }]
  status.setField('metric', 'old', { segments: segmentInputs })
  const saved = store.getFieldSnapshot()[0]!
  segmentInputs[0]!.text = 'mutated'
  segmentInputs.push({ text: 'extra', tone: 'error' })
  assert.deepEqual(saved.segments, [{ text: 'old', tone: 'error' }])
  status.setField('metric', 'new')
  assert.equal(store.getFieldSnapshot()[0]!.text, 'new')
  assert.equal(store.getFieldSnapshot()[0]!.segments, undefined)
  assert.equal(store.getFieldSnapshot()[0]!.tone, 'warning')
  status.setField('metric', 'again', { segments: [{ text: 'again' }] })
  status.setField('metric', 'updated', { segments: undefined })
  assert.equal(store.getFieldSnapshot()[0]!.segments, undefined)
  console.log('PASS: updates clear old segments and retain other options')

  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  const badSegments: unknown[] = [
    null, 'not an array', [], Array.from({ length: 9 }, () => ({ text: 'x' })),
    [null], [3], [['x']], [{ text: 12 }], [{ text: '' }], [{ text: '\u200B\u202E' }],
    [{ text: 'updated', tone: 'rainbow' }], [{ text: 'updated', tone: null }],
    [{ text: 'not the text' }],
    [{ get text(): never { throw new Error('text getter') } }],
    [{ text: 'updated', get tone(): never { throw new Error('tone getter') } }],
    new Proxy([{ text: 'updated' }], { get(target, key, receiver) {
      if (key === 'length') throw new Error('length getter')
      return Reflect.get(target, key, receiver)
    } }),
    new Proxy([{ text: 'updated' }], { get(target, key, receiver) {
      if (key === '0') throw new Error('item getter')
      return Reflect.get(target, key, receiver)
    } }),
    revoked.proxy,
  ]
  for (const [index, value] of badSegments.entries()) {
    const before = store.getFieldSnapshot()[0]
    const count = warnings.length
    assert.doesNotThrow(() => status.setField('metric', 'updated', { segments: value as never }), `case ${index}`)
    assert.strictEqual(store.getFieldSnapshot()[0], before, `case ${index} must not replace the field`)
    assert.equal(warnings.length, count + 1, `case ${index} must warn`)
  }
  {
    const before = store.getFieldSnapshot()[0]
    const count = warnings.length
    assert.doesNotThrow(() => status.setField('metric', 'updated', { get segments(): never { throw new Error('options getter') } }))
    assert.strictEqual(store.getFieldSnapshot()[0], before)
    assert.equal(warnings.length, count + 1)
  }
  // Matching only the truncated prefix must not let a forged suffix through.
  {
    const before = store.getFieldSnapshot()[0]
    const count = warnings.length
    status.setField('metric', 'ABCDEFG', { maxCells: 2, segments: [{ text: 'ABCFAKE' }] })
    assert.strictEqual(store.getFieldSnapshot()[0], before)
    assert.equal(warnings.length, count + 1)
  }
  {
    const before = store.getFieldSnapshot()[0]
    const count = warnings.length
    status.setField('metric', '123456789', { segments: [...'123456789'].map(text => ({ text })) })
    assert.strictEqual(store.getFieldSnapshot()[0], before)
    assert.equal(warnings.length, count + 1)
  }
  console.log('PASS: invalid, forged and unreadable segments warn without writing')

  {
    const reads = { options: 0, length: 0, text: 0, tone: 0 }
    const segments = new Proxy([{
      get text() { reads.text += 1; return 'once' },
      get tone() { reads.tone += 1; return 'success' as const },
    }], { get(target, key, receiver) {
      if (key === 'length') reads.length += 1
      return Reflect.get(target, key, receiver)
    } })
    status.setField('metric', 'once', { get segments() { reads.options += 1; return segments } })
    assert.deepEqual(reads, { options: 1, length: 1, text: 1, tone: 1 })
    assert.deepEqual(store.getFieldSnapshot()[0]!.segments, [{ text: 'once', tone: 'success' }])
    const eight = 'abcdefgh'.split('').map(text => ({ text }))
    status.setField('metric', 'abcdefgh', { segments: eight })
    assert.equal(store.getFieldSnapshot()[0]!.segments?.length, 8)
    status.setField('metric', false, { segments: [{ text: 'false' }] })
    assert.equal(store.getFieldSnapshot()[0]!.text, 'false')
  }
  console.log('PASS: bounded segments and single-read getters')

  {
    const segments = [
      { text: '  \x1b[31m甲\u202E  ', tone: 'accent' as const },
      { text: '\t乙\x1b[0m ', tone: 'success' as const },
      { text: ' 丙\u200B ', tone: 'dim' as const },
    ]
    status.setField('metric', segments.map(segment => segment.text).join(''), { maxCells: 32, segments })
    const sanitized = store.getFieldSnapshot()[0]!
    assert.equal(sanitized.text, '甲 乙 丙')
    assert.deepEqual(sanitized.segments, [
      { text: '甲 ', tone: 'accent' }, { text: '乙 ', tone: 'success' }, { text: '丙', tone: 'dim' },
    ])
  }
  const [{ cleanStatusFieldText }, { stringWidth }] = await Promise.all([
    import('../../src/dsh-adapter/sanitize.js'), import('../../src/ink/stringWidth.js'),
  ])
  const family = '👩‍👩‍👧‍👦'
  const splitClusters = [
    ['👩‍', '👩‍', '👧‍', '👦', 'a'.repeat(30)],
    ['🇨', '🇳'],
    ['e', '\u0301'],
    ['✳', '\ufe0f'],
    ['\ud83d', '\udc69'],
    ['a'.repeat(35), '👩‍', '👩‍👧‍👦'],
    // Even at grapheme boundaries, contextual width can be non-additive.
    ['क्ष', family],
  ]
  assert.equal(stringWidth(family + 'a'.repeat(30)), 32)
  assert.equal(splitClusters[0]!.reduce((width, part) => width + stringWidth(part), 0), 38)
  assert.equal(stringWidth('e') + stringWidth('\u0301'), stringWidth('e\u0301'))
  assert.notEqual(stringWidth('क्ष') + stringWidth(family), stringWidth('क्ष' + family))
  for (const parts of splitClusters) {
    const before = store.getFieldSnapshot()[0]
    const count = warnings.length
    assert.doesNotThrow(() => status.setField('metric', parts.join(''), {
      maxCells: 32, segments: parts.map(text => ({ text })),
    }))
    assert.strictEqual(store.getFieldSnapshot()[0], before, `unsafe segment boundary: ${JSON.stringify(parts)}`)
    assert.equal(warnings.length, count + 1)
  }
  console.log('PASS: segment boundaries cannot split graphemes or change width')

  const widthCases = [
    { raw: 'AB中文XY', segments: [{ text: 'AB', tone: 'accent' }, { text: '中文', tone: 'warning' }, { text: 'XY', tone: 'success' }], max: 5, expected: 'AB中…', colors: ['accent', 'warning'] },
    { raw: 'AB中文XY', segments: [{ text: 'AB', tone: 'accent' }, { text: '中文XY', tone: 'warning' }], max: 3, expected: 'AB…', colors: ['accent', 'warning'] },
    { raw: 'AB中文XY', segments: [{ text: 'AB', tone: 'accent' }, { text: '中文XY', tone: 'warning' }], max: 1, expected: '…', colors: ['accent'] },
  ] as const
  for (const sample of widthCases) {
    status.setField('metric', sample.raw, { maxCells: sample.max, segments: sample.segments })
    const current = store.getFieldSnapshot()[0]!
    assert.equal(current.text, sample.expected)
    assert.equal(current.segments?.map(segment => segment.text).join(''), sample.expected)
    assert.deepEqual(current.segments?.map(segment => segment.tone), sample.colors)
    assert.ok(stringWidth(current.text) <= sample.max)
  }
  for (const segments of [
    [{ text: '前', tone: 'accent' as const }, { text: '中文', tone: 'success' as const }, { text: '尾XYZ', tone: 'error' as const }],
    [{ text: 'A', tone: 'accent' as const }, { text: '👩‍👩‍👧', tone: 'success' as const }, { text: 'XY', tone: 'error' as const }],
    [{ text: 'A', tone: 'accent' as const }, { text: '🇨🇳字', tone: 'success' as const }, { text: 'Z', tone: 'error' as const }],
  ]) {
    const raw = segments.map(segment => segment.text).join('')
    for (let maxCells = 1; maxCells <= 12; maxCells += 1) {
      status.setField('metric', raw, { maxCells, segments })
      const current = store.getFieldSnapshot()[0]!
      assert.equal(current.text, cleanStatusFieldText(raw, maxCells), `${raw} / ${maxCells}`)
      assert.equal(current.segments?.map(segment => segment.text).join(''), current.text, `${raw} / ${maxCells}`)
      assert.ok(current.segments?.every(segment => segment.text !== ''))
    }
  }
  console.log('PASS: sanitization and cross-segment display-width truncation')

  const [React, { Terminal }, { PassThrough, Writable }, ui, { StatusLine }, { PowerlineStatus }, { settled, viewportLines }] = await Promise.all([
    import('react'), import('@xterm/headless'), import('node:stream'), import('../../src/ui.js'),
    import('../../src/screens/StatusLine.js'), import('../../src/powerline/Status.js'), import('../lib/term-test.mjs'),
  ])
  class Input extends PassThrough {
    isTTY = true
    setRawMode() { return this }
    ref() { return this }
    unref() { return this }
  }
  const channel = {
    minimalUi: false,
    statusBar: {
      compact: true, model: true, thinking: false, cwd: false, contextUsage: false,
      cache: false, tokens: false, cost: false, tps: false, gitBranch: false,
      sessionTitle: false, sessionId: false, goal: false, mode: false, contextBar: false,
      activity: false, trajectory: false, shortcutHint: false, pluginFields: true, pluginFieldsOrder: '*',
      powerline: { left: ['model', 'plugins'], right: [], icons: 'none', padding: 0, separator: '|' },
    },
    model: 'MODELX', provider: 'test', contextWindow: 64000, displayCwd: '/w', cwd: '/w',
    mode: { plan: false, sandbox: 'workspace-write', approval: 'on-request' }, modeIndex: 0,
    tokens: { input: 0, output: 0 }, tpsSamples: [], backgroundJobs: [], contextSegments: {},
    working: false, activityFrames: [], agentId: 'abcdef0123456789',
    sessionRef: { backendId: 'fixture', sessionId: 'abcdef0123456789' }, contextBarEnabled: false,
  }
  status.setField('metric', 'RED GREEN DIM', {
    maxCells: 32, tone: 'warning',
    segments: [{ text: 'RED', tone: 'error' }, { text: ' GREEN', tone: 'success' }, { text: ' DIM', tone: 'dim' }],
  })
  const colored = store.getFieldSnapshot()[0]!
  for (const style of ['classic', 'powerline'] as const) for (const fullscreen of [false, true]) for (const columns of [40, 100]) {
    const rows = 12
    const terminal = new Terminal({ cols: columns, rows, scrollback: 100, allowProposedApi: true })
    class Output extends Writable {
      columns = columns
      rows = rows
      isTTY = true
      _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
    }
    const output = new Output(), input = new Input()
    const node = (field: typeof colored) => {
      const content = style === 'classic'
        ? <StatusLine channel={channel as never} pluginFields={[field]} />
        : <PowerlineStatus channel={channel as never} fields={[]} pluginFields={[field]} used={undefined} capacity={undefined} surface="row" detail={() => null} />
      const themed = <ui.ThemeProvider theme="dark">{content}</ui.ThemeProvider>
      return fullscreen ? <ui.AlternateScreen>{themed}</ui.AlternateScreen> : themed
    }
    const instance = await ui.render(node(colored), { stdout: output as never, stderr: output as never, stdin: input as never, exitOnCtrlC: false, patchConsole: false })
    const lines = () => viewportLines(terminal, rows)
    try {
      assert.ok(await settled(() => lines().some(line => line.includes('RED GREEN DIM'))), `${style}/${fullscreen}/${columns}: ${lines().join('\n')}`)
      const y = lines().findIndex(line => line.includes('RED GREEN DIM'))
      const row = lines()[y]!
      const cells = terminal.buffer.active.getLine(terminal.buffer.active.baseY + y)!
      assert.equal(cells.getCell(row.indexOf('RED'))!.getFgColor(), 0xda8a93, `${style}: error tone`)
      assert.equal(cells.getCell(row.indexOf('GREEN'))!.getFgColor(), 0x82b89d, `${style}: success tone`)
      assert.equal(cells.getCell(row.indexOf('DIM'))!.getFgColor(), 0x8d95a6, `${style}: dim tone`)
      if (style === 'powerline') {
        assert.ok(row.includes('MODELX | RED GREEN DIM'), row)
        assert.equal((row.match(/\|/g) ?? []).length, 1, row)
      }
      status.setField('metric', 'LEGACY', { tone: 'warning', maxCells: 32 })
      const legacy = store.getFieldSnapshot()[0]!
      instance.rerender(node(legacy))
      assert.ok(await settled(() => lines().some(line => line.includes('LEGACY'))))
      const legacyY = lines().findIndex(line => line.includes('LEGACY'))
      const legacyRow = lines()[legacyY]!
      assert.equal(terminal.buffer.active.getLine(terminal.buffer.active.baseY + legacyY)!.getCell(legacyRow.indexOf('LEGACY'))!.getFgColor(), 0xd8b270)
      status.setField('metric', '甲乙丙丁', {
        maxCells: 5, segments: [{ text: '甲', tone: 'success' }, { text: '乙丙丁', tone: 'error' }],
      })
      instance.rerender(node(store.getFieldSnapshot()[0]!))
      assert.ok(await settled(() => lines().some(line => line.includes('甲乙…'))))
      const wideY = lines().findIndex(line => line.includes('甲乙…'))
      const wideRow = lines()[wideY]!
      const wideCell = stringWidth(wideRow.slice(0, wideRow.indexOf('甲')))
      const wideCells = terminal.buffer.active.getLine(terminal.buffer.active.baseY + wideY)!
      assert.equal(wideCells.getCell(wideCell)!.getFgColor(), 0x82b89d)
      assert.equal(wideCells.getCell(wideCell + 2)!.getFgColor(), 0xda8a93)
      assert.equal(wideCells.getCell(wideCell + 4)!.getFgColor(), 0xda8a93)
      console.log(`PASS: ${style} real terminal colors, truncation and legacy fallback (${fullscreen ? 'fullscreen' : 'inline'}, ${columns} columns)`)
    } finally {
      await instance.unmount()
      terminal.dispose()
      input.destroy()
    }
  }

  // Model a terminal that combines ZWJ emoji into one two-cell grapheme;
  // xterm's default Unicode provider predates these emoji sequences.
  status.setField('metric', family + 'a'.repeat(30), {
    maxCells: 32, segments: [{ text: family, tone: 'error' }, { text: 'a'.repeat(30), tone: 'success' }],
  })
  status.setField('neighbor', 'TAIL', { tone: 'accent', maxCells: 32 })
  const intact = store.getFieldSnapshot().find(field => field.key === 'metric')!
  const neighbor = store.getFieldSnapshot().find(field => field.key === 'neighbor')!
  assert.equal(intact.text, family + 'a'.repeat(30))
  assert.equal(intact.segments!.reduce((width, segment) => width + stringWidth(segment.text), 0), 32)
  // Per-segment width errors cancel globally: Yoga must not place the spans separately.
  const first = 'क्ष' + family
  const second = '1\u20e3' + family + 'a'.repeat(25)
  assert.deepEqual([stringWidth(first), stringWidth(second)], [3, 29])
  assert.equal(stringWidth(first + second), 32)
  status.setField('metric', first + second, {
    maxCells: 32, segments: [{ text: first, tone: 'error' }, { text: second, tone: 'success' }],
  })
  const balanced = store.getFieldSnapshot().find(field => field.key === 'metric')!
  assert.equal(balanced.text, first + second)
  assert.equal(balanced.segments?.length, 2)
  for (const style of ['classic', 'powerline'] as const) for (const fullscreen of [false, true]) for (const columns of [52, 100]) {
    const rows = 12
    const terminal = new Terminal({ cols: columns, rows, scrollback: 100, allowProposedApi: true })
    let previous = 0
    terminal.unicode.register({
      version: 'dsh-zwj-fixture',
      wcwidth: (cp: number) => stringWidth(String.fromCodePoint(cp)),
      charProperties(cp: number, preceding: number) {
        let width = stringWidth(String.fromCodePoint(cp))
        let join = preceding !== 0 && (width === 0 || (previous === 0x200d && /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp))))
        previous = cp
        if (join) {
          const previousWidth = (preceding >> 1) & 3
          if (previousWidth === 0) join = false
          else width = previousWidth
        }
        return (width << 1) | (join ? 1 : 0)
      },
    })
    terminal.unicode.activeVersion = 'dsh-zwj-fixture'
    class Output extends Writable {
      columns = columns
      rows = rows
      isTTY = true
      _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
    }
    const output = new Output(), input = new Input()
    const content = style === 'classic'
      ? <StatusLine channel={channel as never} pluginFields={[intact, neighbor]} />
      : <PowerlineStatus channel={channel as never} fields={[]} pluginFields={[intact, neighbor]} used={undefined} capacity={undefined} surface="row" detail={() => null} />
    const themed = <ui.ThemeProvider theme="dark">{content}</ui.ThemeProvider>
    const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{themed}</ui.AlternateScreen> : themed,
      { stdout: output as never, stderr: output as never, stdin: input as never, exitOnCtrlC: false, patchConsole: false })
    const lines = () => viewportLines(terminal, rows)
    const expected = `${family}${'a'.repeat(30)} ${style === 'classic' ? '·' : '|'} TAIL`
    try {
      assert.ok(await settled(() => lines().some(line => line.includes(expected))), `${style}/${fullscreen}/${columns}: ${lines().join('\n')}`)
      const y = lines().findIndex(line => line.includes(expected))
      const row = lines()[y]!
      const familyColumn = row.indexOf(family)
      const cells = terminal.buffer.active.getLine(terminal.buffer.active.baseY + y)!
      assert.equal(cells.getCell(familyColumn)!.getChars(), family)
      assert.equal(cells.getCell(familyColumn + 2)!.getChars(), 'a')
      assert.equal(cells.getCell(familyColumn + 31)!.getChars(), 'a')
      assert.equal(cells.getCell(familyColumn + 33)!.getChars(), style === 'classic' ? '·' : '|')
      assert.equal(cells.getCell(familyColumn + 35)!.getChars(), 'T')
      assert.equal(cells.getCell(familyColumn + 38)!.getChars(), 'L')
      assert.equal(cells.getCell(familyColumn)!.getFgColor(), 0xda8a93)
      assert.equal(cells.getCell(familyColumn + 2)!.getFgColor(), 0x82b89d)
      assert.equal(cells.getCell(familyColumn + 35)!.getFgColor(), 0x7da1de)
      console.log(`PASS: ${style} intact family emoji is 2 cells and preserves its neighbor (${fullscreen ? 'fullscreen' : 'inline'}, ${columns} columns)`)

      const balancedContent = style === 'classic'
        ? <StatusLine channel={channel as never} pluginFields={[balanced, neighbor]} />
        : <PowerlineStatus channel={channel as never} fields={[]} pluginFields={[balanced, neighbor]} used={undefined} capacity={undefined} surface="row" detail={() => null} />
      const balancedTheme = <ui.ThemeProvider theme="dark">{balancedContent}</ui.ThemeProvider>
      instance.rerender(fullscreen ? <ui.AlternateScreen>{balancedTheme}</ui.AlternateScreen> : balancedTheme)
      const balancedExpected = `${first}${second} ${style === 'classic' ? '·' : '|'} TAIL`
      assert.ok(await settled(() => lines().some(line => line.includes(balancedExpected))),
        `${style}/${fullscreen}/${columns}: ${lines().join('\n')}`)
      const balancedY = lines().findIndex(line => line.includes(balancedExpected))
      const balancedRow = lines()[balancedY]!
      const start = balancedRow.indexOf('क्ष')
      const balancedCells = terminal.buffer.active.getLine(terminal.buffer.active.baseY + balancedY)!
      assert.equal(balancedCells.getCell(start + 2)!.getChars(), family)
      assert.equal(balancedCells.getCell(start + 4)!.getChars(), '1\u20e3')
      assert.equal(balancedCells.getCell(start + 5)!.getChars(), family)
      assert.equal(balancedCells.getCell(start + 7)!.getChars(), 'a')
      assert.equal(balancedCells.getCell(start + 31)!.getChars(), 'a')
      assert.equal(balancedCells.getCell(start + 35)!.getChars(), 'T')
      assert.equal(balancedCells.getCell(start + 2)!.getFgColor(), 0xda8a93)
      assert.equal(balancedCells.getCell(start + 5)!.getFgColor(), 0x82b89d)
      console.log(`PASS: ${style} balanced segment widths preserve both emoji and the neighbor (${fullscreen ? 'fullscreen' : 'inline'}, ${columns} columns)`)
    } finally {
      await instance.unmount()
      terminal.dispose()
      input.destroy()
    }
  }
} finally {
  await fiber.dispose()
  await root.fiber.dispose()
}
