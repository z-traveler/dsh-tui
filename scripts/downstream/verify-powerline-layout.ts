/** Focused regression for the powerline HUD options and field layout.
 * No provider calls, terminal or user state: pure config/layout seams.
 * node --import tsx/esm scripts/downstream/verify-powerline-layout.ts */
import assert from 'node:assert/strict'
import { normalizePowerlineOptions, parsePowerlineOptions } from '../../src/powerline/config.js'
import { layoutPowerlineFields } from '../../src/powerline/layout.js'

let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }

const DEFAULTS = {
  left: ['marker', 'model', 'context', 'cost', 'quota', 'shell', 'cwd', 'git', 'plugins'],
  right: ['agent'],
  separator: '\ue0b1',
  icons: 'nerd',
  padding: 1,
  secondaryOverflow: 'drop',
  path: 'basename',
  context: 'full',
  warnPercent: 70,
  errorPercent: 90,
  maxRows: 32,
  marker: '🐋',
  colors: {
    marker: 'accent',
    model: '#d787af',
    path: '#00afaf',
    gitClean: 'success',
    gitDirty: 'warning',
    context: 'subtle',
    warning: 'warning',
    error: 'error',
    separator: 'subtle',
    border: 'promptBorder',
    cost: 'text',
    thinking: 'subtle',
    plugin: 'text',
    agent: 'text',
    quota: 'text',
  },
  modelColors: [
    { pattern: 'deepseek', color: '#6e9bc5' },
    { pattern: 'gpt', color: '#f5f5f5' },
    { pattern: 'claude', color: '#fac03d' },
  ],
  modelIcons: [],
}

check('missing, null and non-record input resolve to the documented defaults', () => {
  for (const value of [undefined, null, 42, 'powerline', [], true]) {
    assert.deepEqual(normalizePowerlineOptions(value), DEFAULTS)
  }
})

check('resolved options are fresh copies, not shared defaults', () => {
  const first = normalizePowerlineOptions(undefined)
  first.left.push('extra')
  first.colors.model = '#000000'
  first.modelColors[0]!.pattern = 'changed'
  assert.deepEqual(normalizePowerlineOptions(undefined), DEFAULTS)
})

check('explicit empty field groups are respected', () => {
  assert.deepEqual(normalizePowerlineOptions({ left: [], right: [] }), {
    ...DEFAULTS, left: [], right: [],
  })
})

check('field ids are trimmed, deduplicated and non-strings skipped', () => {
  const options = normalizePowerlineOptions({
    left: [' model ', 'model', '', 3, 'git'],
    right: ['agent', 'agent'],
  })
  assert.deepEqual(options.left, ['model', 'git'])
  assert.deepEqual(options.right, ['agent'])
})

check('wrong top-level field types fall back per field', () => {
  const options = normalizePowerlineOptions({
    left: 'model', right: 7,
    separator: '', icons: 'emoji', padding: '1', secondaryOverflow: 'push',
    path: 'middle', context: 'tokens', warnPercent: '70', errorPercent: {},
    maxRows: 'many', marker: '   ', colors: 'blue', modelColors: 'deepseek',
  })
  assert.deepEqual(options, DEFAULTS)
})

check('padding and row budget are clamped to bounded ranges', () => {
  assert.equal(normalizePowerlineOptions({ padding: 100 }).padding, 8)
  assert.equal(normalizePowerlineOptions({ padding: -3 }).padding, 0)
  assert.equal(normalizePowerlineOptions({ padding: 2.7 }).padding, 2)
  assert.equal(normalizePowerlineOptions({ maxRows: 999 }).maxRows, 32)
  assert.equal(normalizePowerlineOptions({ maxRows: 0 }).maxRows, 1)
  assert.equal(normalizePowerlineOptions({ maxRows: 3.9 }).maxRows, 3)
})

check('percent thresholds clamp and an inverted pair falls back to defaults', () => {
  const clamped = normalizePowerlineOptions({ warnPercent: 65.8, errorPercent: 150 })
  assert.equal(clamped.warnPercent, 65)
  assert.equal(clamped.errorPercent, 100)
  const inverted = normalizePowerlineOptions({ warnPercent: 80, errorPercent: 80 })
  assert.equal(inverted.warnPercent, 70)
  assert.equal(inverted.errorPercent, 90)
})

check('separator and marker accept text and reject blank, oversized or control-bearing values', () => {
  assert.equal(normalizePowerlineOptions({ separator: '|' }).separator, '|')
  assert.equal(normalizePowerlineOptions({ separator: ' │ ' }).separator, ' │ ')
  assert.equal(normalizePowerlineOptions({ separator: '' }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ separator: 'x'.repeat(20) }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ separator: '\u001b[31m' }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ separator: '|\n|' }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ marker: 'DSH' }).marker, 'DSH')
  assert.equal(normalizePowerlineOptions({ marker: '  ' }).marker, '🐋')
  assert.equal(normalizePowerlineOptions({ marker: 'm'.repeat(20) }).marker, '🐋')
  assert.equal(normalizePowerlineOptions({ marker: '🐋\n' }).marker, '🐋')
  assert.equal(normalizePowerlineOptions({ marker: '\u0007' }).marker, '🐋')
})

check('colors accept theme keys and renderer forms and reject everything else', () => {
  const colors = normalizePowerlineOptions({
    colors: {
      model: '#000000', gitDirty: '', cost: 7, future: '#fff',
      path: 'accent', thinking: 'ansi256(200)', warning: 'ansi:red',
      error: 'not-a-color', context: '#12', border: '#header',
    },
  }).colors
  assert.deepEqual(colors, {
    ...DEFAULTS.colors,
    model: '#000000', path: 'accent', thinking: 'ansi256(200)', warning: 'ansi:red',
  })
  assert.equal(normalizePowerlineOptions({ colors: { model: '#000000\n' } }).colors.model, DEFAULTS.colors.model)
})

check('default colors are valid under the same color contract', () => {
  assert.deepEqual(parsePowerlineOptions(JSON.stringify(DEFAULTS)), DEFAULTS)
})

check('model color rules replace the defaults and malformed entries are skipped', () => {
  assert.deepEqual(normalizePowerlineOptions({ modelColors: [] }).modelColors, [])
  assert.deepEqual(normalizePowerlineOptions({
    modelColors: [
      { pattern: '[', color: '#ff0000' },
      { pattern: ' deepseek ', color: ' #6e9bc5 ' },
      { pattern: 'gpt' },
      { color: '#ffffff' },
      { pattern: 'claude', color: 'not-a-color' },
      'claude',
    ],
  }).modelColors, [{ pattern: 'deepseek', color: '#6e9bc5' }])
})

check('model icon rules replace the defaults and malformed entries are skipped', () => {
  assert.deepEqual(normalizePowerlineOptions({ modelIcons: [] }).modelIcons, [])
  assert.deepEqual(normalizePowerlineOptions({
    modelIcons: [
      { pattern: '[', icon: 'X' },
      { pattern: ' deepseek ', icon: '\uec19' },
      { pattern: 'gpt' },
      { icon: 'G' },
      { pattern: 'claude', icon: '' },
      { pattern: 'claude', icon: '   ' },
      { pattern: 'claude', icon: '\u001b[32m' },
      { pattern: 'claude', icon: 'a\nb' },
      { pattern: 'claude', icon: 'x'.repeat(9) },
      { pattern: 'claude', icon: '界界界界界' },
      { pattern: 'qwen', icon: '界界界' },
      'claude',
    ],
  }).modelIcons, [{ pattern: 'deepseek', icon: '\uec19' }, { pattern: 'qwen', icon: '界界界' }])
  assert.deepEqual(normalizePowerlineOptions({
    modelIcons: [{ pattern: 'b', icon: 'B' }, { pattern: 'a', icon: 'A' }],
  }).modelIcons, [{ pattern: 'b', icon: 'B' }, { pattern: 'a', icon: 'A' }])
})

check('parsePowerlineOptions resolves valid JSON and rejects malformed input', () => {
  assert.deepEqual(parsePowerlineOptions('{"left":["model"],"padding":2}'), normalizePowerlineOptions({ left: ['model'], padding: 2 }))
  assert.deepEqual(parsePowerlineOptions('{}'), DEFAULTS)
  for (const text of [
    'not json', '[]', '"powerline"', 'null', '1',
    '{"left":[1]}', '{"icons":"emoji"}', '{"padding":"1"}', '{"colors":{"model":1}}',
    '{"modelColors":[{"pattern":"x"}]}', '{"modelColors":"x"}', '{"secondaryOverflow":"push"}',
    '{"path":"middle"}', '{"context":"tokens"}',
    '{"colors":{"model":"not-a-color"}}', '{"colors":{"model":"#fff\\n"}}',
    '{"modelColors":[{"pattern":"gpt","color":"not-a-color"}]}',
    '{"modelIcons":"x"}', '{"modelIcons":[3]}', '{"modelIcons":[{"icon":"G"}]}',
    '{"modelIcons":[{"pattern":"gpt"}]}', '{"modelIcons":[{"pattern":"gpt","icon":""}]}',
    '{"modelIcons":[{"pattern":"gpt","icon":"  "}]}',
    '{"modelIcons":[{"pattern":"gpt","icon":"G\\n"}]}',
    '{"modelIcons":[{"pattern":"gpt","icon":"xxxxxxxxxxxxxxxxxxxx"}]}',
    '{"marker":""}', '{"marker":"🐋\\n"}', '{"separator":"\\u001b[31m"}',
    '{"separator":"xxxxxxxxxxxxxxxxxxxx"}',
  ]) {
    assert.equal(parsePowerlineOptions(text), undefined, text)
  }
  // An ESC glyph only reaches the parser as a real control character in JSON.
  assert.equal(
    parsePowerlineOptions(JSON.stringify({ modelIcons: [{ pattern: 'gpt', icon: '\u001b[31m' }] })),
    undefined,
  )
})

check('parsePowerlineOptions keeps partial colors and skips unparsable patterns', () => {
  assert.deepEqual(parsePowerlineOptions('{"colors":{"gitDirty":"#ff0000"}}'), {
    ...DEFAULTS, colors: { ...DEFAULTS.colors, gitDirty: '#ff0000' },
  })
  assert.deepEqual(parsePowerlineOptions('{"colors":{"gitDirty":"ansi:red"}}'), {
    ...DEFAULTS, colors: { ...DEFAULTS.colors, gitDirty: 'ansi:red' },
  })
  assert.deepEqual(parsePowerlineOptions('{"modelColors":[{"pattern":"[","color":"#ff0000"}]}'), {
    ...DEFAULTS, modelColors: [],
  })
  assert.deepEqual(parsePowerlineOptions('{"modelIcons":[{"pattern":"[","icon":"X"}]}'), {
    ...DEFAULTS, modelIcons: [],
  })
  assert.deepEqual(parsePowerlineOptions('{"modelIcons":[{"pattern":"deepseek","icon":"D"}]}'), {
    ...DEFAULTS, modelIcons: [{ pattern: 'deepseek', icon: 'D' }],
  })
})

const field = (key: string, width: number) => ({ key, width })
const keys = (fields: readonly { key: string }[]) => fields.map(entry => entry.key)
const options = (overrides: Parameters<typeof normalizePowerlineOptions>[0]) => normalizePowerlineOptions(overrides)

check('a wide row keeps every configured field in its group', () => {
  const fields = [...DEFAULTS.left, 'agent'].map(key => field(key, 5))
  const layout = layoutPowerlineFields(fields, options(undefined), 200)
  assert.deepEqual(keys(layout.left), DEFAULTS.left)
  assert.deepEqual(keys(layout.right), ['agent'])
  assert.deepEqual(layout.secondary, [])
})

check('right fields reserve width first and the left row stops at the first nonfit', () => {
  const layout = layoutPowerlineFields(
    [field('a', 4), field('b', 4), field('c', 4), field('r', 6)],
    options({ left: ['a', 'b', 'c'], right: ['r'], separator: '|' }),
    20,
  )
  assert.deepEqual(keys(layout.left), ['a'])
  assert.deepEqual(keys(layout.right), ['r'])
  assert.deepEqual(layout.secondary.map(keys), [['b', 'c']])
})

check('right fields beyond the reserved prefix overflow into the rows', () => {
  const layout = layoutPowerlineFields(
    [field('a', 2), field('r1', 4), field('r2', 4)],
    options({ left: ['a'], right: ['r1', 'r2'], separator: '|' }),
    10,
  )
  assert.deepEqual(keys(layout.left), ['a'])
  assert.deepEqual(keys(layout.right), ['r1'])
  assert.deepEqual(layout.secondary.map(keys), [['r2']])
})

check('configured ids render once even when repeated or placed in two groups', () => {
  const model = field('model', 3)
  const other = field('model', 99)
  const layout = layoutPowerlineFields(
    [model, other, field('agent', 3), field('cost', 3)],
    options({ left: ['model', 'model', 'cost'], right: ['agent', 'model', 'cost'] }),
    200,
  )
  assert.deepEqual(keys(layout.left), ['model', 'cost'])
  assert.equal(layout.left[0], model)
  assert.deepEqual(keys(layout.right), ['agent'])
  assert.deepEqual(layout.secondary, [])
})

check('unknown configured ids are ignored and unconfigured fields never render', () => {
  const layout = layoutPowerlineFields(
    [field('a', 2), field('b', 2), field('unused', 2)],
    options({ left: ['a', 'missing', 'plugin:unknown'], right: [] }),
    40,
  )
  assert.deepEqual(keys(layout.left), ['a'])
  assert.deepEqual(layout.right, [])
  assert.deepEqual(layout.secondary, [])
})

check('a namespace sentinel selects namespaced fields in input order', () => {
  const layout = layoutPowerlineFields(
    [field('marker', 2), field('plugins:git', 3), field('plugins:todo', 3), field('plugin:other', 3)],
    options({ left: ['marker', 'plugins'], right: [] }),
    40,
  )
  assert.deepEqual(keys(layout.left), ['marker', 'plugins:git', 'plugins:todo'])
  assert.deepEqual(layout.right, [])
  assert.deepEqual(layout.secondary, [])
})

check('outer padding and separator spaces are charged per rendered row', () => {
  const fields = [field('a', 3), field('b', 3)]
  const padded = options({ left: ['a', 'b'], right: [], padding: 2, separator: '界' })
  // Row = 2*2 outer cells + a(3) + (界=2 plus two spaces) + b(3) = 14 cells.
  assert.deepEqual(keys(layoutPowerlineFields(fields, padded, 7).left), ['a'])
  assert.deepEqual(keys(layoutPowerlineFields(fields, padded, 14).left), ['a', 'b'])
  assert.deepEqual(layoutPowerlineFields(fields, padded, 9).secondary.map(keys), [['b']])
})

check('padding 0 keeps only the separator spaces between fields', () => {
  const fields = [field('a', 4), field('b', 4), field('r', 6)]
  const bare = options({ left: ['a', 'b'], right: ['r'], padding: 0, separator: '|' })
  // Right row = r(6), no outer cells; left budget = width - 6.
  // Left row = a(4) + |+2 spaces + b(4) = 11 cells, so 17 fits and 16 does not.
  assert.deepEqual(keys(layoutPowerlineFields(fields, bare, 17).left), ['a', 'b'])
  assert.deepEqual(keys(layoutPowerlineFields(fields, bare, 16).left), ['a'])
  const narrow = layoutPowerlineFields(fields, bare, 13)
  assert.deepEqual(keys(narrow.left), ['a'])
  assert.deepEqual(keys(narrow.right), ['r'])
  assert.deepEqual(narrow.secondary.map(keys), [['b']])
})

check('padding 2 applies once per row and once to the reserved right row', () => {
  const fields = [field('a', 3), field('r1', 2), field('r2', 2)]
  const padded = options({ left: ['a'], right: ['r1', 'r2'], padding: 2, separator: '|' })
  // Right row = 2*2 + r1(2) + |+2 spaces + r2(2) = 11 cells; left budget = width - 11.
  // Left row = 2*2 + a(3) = 7 cells, so 18 fits and 17 does not.
  const fitting = layoutPowerlineFields(fields, padded, 18)
  assert.deepEqual(keys(fitting.left), ['a'])
  assert.deepEqual(keys(fitting.right), ['r1', 'r2'])
  const tight = layoutPowerlineFields(fields, padded, 17)
  assert.deepEqual(keys(tight.left), [])
  assert.deepEqual(tight.secondary.map(keys), [['a']])
  // At width 10 the right row keeps r1 (6 cells) and overflows r2.
  const narrow = layoutPowerlineFields(fields, padded, 10)
  assert.deepEqual(keys(narrow.right), ['r1'])
  assert.deepEqual(narrow.secondary.map(keys), [['a']])
})

check('drop mode stops at the first nonfit in a row', () => {
  const fields = [field('a', 3), field('b', 3), field('c', 5), field('d', 3)]
  const layout = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'c', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'drop',
  }), 9)
  assert.deepEqual(keys(layout.left), ['a', 'b'])
  assert.deepEqual(layout.secondary.map(keys), [['c']])
})

check('wrap mode moves the nonfit field to a new row and keeps ordering', () => {
  const fields = [field('a', 3), field('b', 3), field('c', 5), field('d', 3)]
  const layout = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'c', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'wrap',
  }), 9)
  assert.deepEqual(keys(layout.left), ['a', 'b'])
  assert.deepEqual(layout.secondary.map(keys), [['c'], ['d']])
})

check('a field wider than a whole row is dropped without shrinking it', () => {
  const wide = field('e', 10)
  const fields = [field('a', 3), field('b', 3), wide, field('d', 3)]
  const wrapped = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'e', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'wrap',
  }), 9)
  assert.deepEqual(keys(wrapped.left), ['a', 'b'])
  assert.deepEqual(wrapped.secondary.map(keys), [['d']])
  const dropped = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'e', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'drop',
  }), 9)
  assert.deepEqual(dropped.secondary, [])
})

check('row count is capped by the bounded row budget', () => {
  const fields = [field('a', 2), field('b', 2), field('c', 2)]
  const layout = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'c'], right: [], padding: 0, separator: '|', secondaryOverflow: 'wrap', maxRows: 1,
  }), 2)
  assert.deepEqual(layout.secondary.map(keys), [['b']])
})

check('non-positive rows produce no fields at all', () => {
  const fields = [field('a', 3), field('r', 3)]
  for (const width of [0, -5, Number.NaN]) {
    assert.deepEqual(layoutPowerlineFields(fields, options(undefined), width), { left: [], right: [], secondary: [] })
  }
})

console.log(`${checks} checks passed`)
