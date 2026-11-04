/** Focused regression for the powerline HUD options and field layout.
 * No provider calls, terminal or user state: pure config/layout seams.
 * node --import tsx/esm scripts/downstream/verify-powerline-layout.ts */
import assert from 'node:assert/strict'
import { normalizePowerlineOptions, parsePowerlineOptions } from '../../src/powerline/config.js'
import { layoutPowerlineFields } from '../../src/powerline/layout.js'

let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }

const DEFAULTS = {
  left: ['marker', 'model', 'context', 'cost', 'shell', 'cwd', 'git', 'plugins'],
  right: ['agent'],
  secondary: [],
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
  },
  modelColors: [
    { pattern: 'deepseek', color: '#6e9bc5' },
    { pattern: 'gpt', color: '#f5f5f5' },
    { pattern: 'claude', color: '#fac03d' },
  ],
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
  assert.deepEqual(normalizePowerlineOptions({ left: [], right: [], secondary: [] }), {
    ...DEFAULTS, left: [], right: [], secondary: [],
  })
})

check('field ids are trimmed, deduplicated and non-strings skipped', () => {
  const options = normalizePowerlineOptions({
    left: [' model ', 'model', '', 3, 'git'],
    right: ['agent', 'agent'],
    secondary: ['cost'],
  })
  assert.deepEqual(options.left, ['model', 'git'])
  assert.deepEqual(options.right, ['agent'])
  assert.deepEqual(options.secondary, ['cost'])
})

check('wrong top-level field types fall back per field', () => {
  const options = normalizePowerlineOptions({
    left: 'model', right: 7, secondary: null,
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

check('separator and marker accept text and reject blank or oversized values', () => {
  assert.equal(normalizePowerlineOptions({ separator: '|' }).separator, '|')
  assert.equal(normalizePowerlineOptions({ separator: ' │ ' }).separator, ' │ ')
  assert.equal(normalizePowerlineOptions({ separator: '' }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ separator: 'x'.repeat(20) }).separator, '\ue0b1')
  assert.equal(normalizePowerlineOptions({ marker: 'DSH' }).marker, 'DSH')
  assert.equal(normalizePowerlineOptions({ marker: '  ' }).marker, '🐋')
  assert.equal(normalizePowerlineOptions({ marker: 'm'.repeat(20) }).marker, '🐋')
})

check('colors merge per key and ignore malformed values', () => {
  const colors = normalizePowerlineOptions({
    colors: { model: '#000000', gitDirty: '', cost: 7, future: '#fff' },
  }).colors
  assert.deepEqual(colors, { ...DEFAULTS.colors, model: '#000000' })
})

check('model color rules replace the defaults and malformed patterns are skipped', () => {
  assert.deepEqual(normalizePowerlineOptions({ modelColors: [] }).modelColors, [])
  assert.deepEqual(normalizePowerlineOptions({
    modelColors: [
      { pattern: '[', color: '#ff0000' },
      { pattern: ' deepseek ', color: ' #6e9bc5 ' },
      { pattern: 'gpt' },
      { color: '#ffffff' },
      'claude',
    ],
  }).modelColors, [{ pattern: 'deepseek', color: '#6e9bc5' }])
})

check('parsePowerlineOptions resolves valid JSON and rejects malformed input', () => {
  assert.deepEqual(parsePowerlineOptions('{"left":["model"],"padding":2}'), normalizePowerlineOptions({ left: ['model'], padding: 2 }))
  assert.deepEqual(parsePowerlineOptions('{}'), DEFAULTS)
  for (const text of [
    'not json', '[]', '"powerline"', 'null', '1',
    '{"left":[1]}', '{"icons":"emoji"}', '{"padding":"1"}', '{"colors":{"model":1}}',
    '{"modelColors":[{"pattern":"x"}]}', '{"modelColors":"x"}', '{"secondaryOverflow":"push"}',
  ]) {
    assert.equal(parsePowerlineOptions(text), undefined, text)
  }
})

check('parsePowerlineOptions keeps partial colors and skips unparsable patterns', () => {
  assert.deepEqual(parsePowerlineOptions('{"colors":{"gitDirty":"#ff0000"}}'), {
    ...DEFAULTS, colors: { ...DEFAULTS.colors, gitDirty: '#ff0000' },
  })
  assert.deepEqual(parsePowerlineOptions('{"modelColors":[{"pattern":"[","color":"#ff0000"}]}'), {
    ...DEFAULTS, modelColors: [],
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

check('secondary-configured ids render on the primary row, not the overflow rows', () => {
  const fields = ['model', 'cost', 'git'].map(key => field(key, 5))
  const layout = layoutPowerlineFields(fields, options({ left: ['model'], secondary: ['cost'], right: [] }), 200)
  assert.deepEqual(keys(layout.left), ['model', 'cost'])
  assert.deepEqual(layout.secondary, [])
  assert.deepEqual(keys(layout.right), [])
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
    options({ left: ['model', 'model', 'cost'], right: ['agent', 'model', 'cost'], secondary: ['cost'] }),
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
    options({ left: ['a', 'missing', 'plugin:unknown'], right: [], secondary: [] }),
    40,
  )
  assert.deepEqual(keys(layout.left), ['a'])
  assert.deepEqual(layout.right, [])
  assert.deepEqual(layout.secondary, [])
})

check('a namespace sentinel selects namespaced fields in input order', () => {
  const layout = layoutPowerlineFields(
    [field('marker', 2), field('plugins:git', 3), field('plugins:todo', 3), field('plugin:other', 3)],
    options({ left: ['marker', 'plugins'], right: [], secondary: [] }),
    40,
  )
  assert.deepEqual(keys(layout.left), ['marker', 'plugins:git', 'plugins:todo'])
  assert.deepEqual(layout.right, [])
  assert.deepEqual(layout.secondary, [])
})

check('padding and separator cells are charged per field', () => {
  const fields = [field('a', 3), field('b', 3)]
  const padded = options({ left: ['a', 'b'], right: [], padding: 2, separator: '界' })
  assert.deepEqual(keys(layoutPowerlineFields(fields, padded, 7).left), ['a'])
  assert.deepEqual(keys(layoutPowerlineFields(fields, padded, 16).left), ['a', 'b'])
  assert.deepEqual(layoutPowerlineFields(fields, padded, 9).secondary.map(keys), [['b']])
})

check('drop mode stops at the first nonfit in a row', () => {
  const fields = [field('a', 3), field('b', 3), field('c', 5), field('d', 3)]
  const layout = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'c', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'drop',
  }), 7)
  assert.deepEqual(keys(layout.left), ['a', 'b'])
  assert.deepEqual(layout.secondary.map(keys), [['c']])
})

check('wrap mode moves the nonfit field to a new row and keeps ordering', () => {
  const fields = [field('a', 3), field('b', 3), field('c', 5), field('d', 3)]
  const layout = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'c', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'wrap',
  }), 7)
  assert.deepEqual(keys(layout.left), ['a', 'b'])
  assert.deepEqual(layout.secondary.map(keys), [['c'], ['d']])
})

check('a field wider than a whole row is dropped without shrinking it', () => {
  const wide = field('e', 10)
  const fields = [field('a', 3), field('b', 3), wide, field('d', 3)]
  const wrapped = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'e', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'wrap',
  }), 7)
  assert.deepEqual(keys(wrapped.left), ['a', 'b'])
  assert.deepEqual(wrapped.secondary.map(keys), [['d']])
  const dropped = layoutPowerlineFields(fields, options({
    left: ['a', 'b', 'e', 'd'], right: [], padding: 0, separator: '|', secondaryOverflow: 'drop',
  }), 7)
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
