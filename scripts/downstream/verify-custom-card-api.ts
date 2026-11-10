/** Run: node --import tsx/esm scripts/downstream/verify-custom-card-api.ts */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-custom-card-api-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.DSH_HOME = join(fakeHome, '.dsh')
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_ADAPTER_MODE = 'new'

const cards = await import('../../src/cards.js')

const record = cards.asTuiCardRecord({
  version: 1,
  type: 'acme/report',
  id: 'report-1',
  data: { rows: [{ name: 'alpha', value: 1 }] },
  fallback: { title: 'Report', body: 'alpha: 1', summary: 'One row' },
})
assert.ok(record)
assert.equal(cards.asTuiCardRecord({ ...record, version: 2 }), undefined)
assert.equal(cards.asTuiCardRecord({ ...record, data: { bad: undefined } }), undefined)
assert.equal(cards.asTuiCardRecord({ ...record, data: new Array(1) }), undefined, 'sparse arrays are not lossless JSON')

const view = cards.asTuiCardView({
  title: 'Report',
  label: 'acme',
  summary: 'One row',
  blocks: [
    { kind: 'text', text: 'plain' },
    { kind: 'markdown', text: '**bold**' },
    { kind: 'table', columns: ['Name', 'Value'], rows: [['alpha', '1']] },
  ],
})
assert.ok(view)
const overview = cards.asTuiCardView({
  title: 'Overview',
  preview: [{ kind: 'distribution', total: 100, segments: [{ value: 20, kind: 'filled' }, { value: 80, kind: 'empty' }] }],
  blocks: [{ kind: 'table', layout: 'compact', columns: ['Category', 'Tokens'], rows: [['Tools', '≈ 20']] }],
})
assert.equal(overview?.preview?.[0]?.kind, 'distribution', 'collapsed preview is preserved as pure data')
assert.equal(overview?.blocks[0]?.kind === 'table' && overview.blocks[0].layout, 'compact')
const compact = cards.asTuiCardView({ ...view, density: 'compact' })
assert.equal(compact?.density, 'compact', 'a view keeps the density its producer declared')
assert.equal('density' in view, false, 'an absent density stays absent: no default is materialized into the snapshot')
for (const density of ['wide', 'Compact', '', 0, null, true]) {
  assert.equal(cards.asTuiCardView({ ...view, density }), undefined, `density ${JSON.stringify(density)} is not a trusted view`)
}
for (const total of [0, -1, Infinity]) {
  assert.equal(cards.asTuiCardView({ title: 'Invalid', blocks: [{ kind: 'distribution', total, segments: [] }] }), undefined)
}
assert.equal(cards.asTuiCardView({ title: 'Invalid', blocks: [{ kind: 'distribution', total: 10, segments: [{ kind: 'filled', value: -1 }] }] }), undefined)
assert.equal(cards.asTuiCardView({ title: 'Invalid', blocks: [], preview: [{ kind: 'html', text: 'not supported' }] }), undefined)
assert.equal(cards.cardPlainText(overview!), 'Overview\nCategory | Tokens\nTools | ≈ 20', 'preview does not duplicate the full reading in searchable text')
const gridOnly = { title: 'Capacity', blocks: overview!.preview! }
assert.equal(cards.cardPlainText(gridOnly), 'Capacity\n⛁ 20 · ⛶ 80 / 100', 'plain reading preserves grid facts without internal enum names')
const mutableReading = {
  title: 'Detached',
  preview: [{ kind: 'table', layout: 'compact', columns: ['Label'], rows: [['before']] }],
  blocks: [{ kind: 'distribution', total: 10, segments: [{ kind: 'filled', value: 3 }] }],
}
const detachedReading = cards.asTuiCardView(mutableReading)!
mutableReading.preview[0]!.rows[0]![0] = 'after'
mutableReading.blocks[0]!.segments[0]!.value = 9
assert.equal(detachedReading.preview?.[0]?.kind === 'table' && detachedReading.preview[0].rows[0]?.[0], 'before')
assert.equal(detachedReading.blocks[0]?.kind === 'distribution' && detachedReading.blocks[0].segments[0]?.value, 3)
assert.equal(cards.asTuiCardView({ title: 'Invalid', blocks: [{ kind: 'table', layout: 'unknown', columns: [], rows: [] }] }), undefined)
const mutableView = { title: 'Snapshot', blocks: [{ kind: 'table', columns: ['Name'], rows: [['before']] }] }
const snapshotView = cards.asTuiCardView(mutableView)
mutableView.blocks[0]!.rows[0]![0] = 'after'
assert.equal(snapshotView?.blocks[0]?.kind === 'table' ? snapshotView.blocks[0].rows[0]?.[0] : undefined, 'before', 'presentation tables are detached snapshots')
assert.equal(cards.asTuiCardView({ ...view, blocks: [{ kind: 'html', text: 'no' }] }), undefined)
assert.equal(cards.asTuiCardView({ ...view, actions: [() => undefined] }), undefined, 'a presentation cannot retain callbacks in unknown fields')
assert.equal(cards.asTuiCardView({ ...view, blocks: [{ kind: 'table', columns: ['Only'], rows: [['first', 'lost']] }] }), undefined, 'a table cannot silently lose extra cells')
assert.equal(cards.asTuiCardView({ ...view, blocks: [{ kind: 'table', columns: new Array(1), rows: [['value']] }] }), undefined, 'table headers cannot contain holes')
assert.equal(cards.asTuiCardView({ ...view, blocks: [{ kind: 'table', columns: ['Name'], rows: [new Array(1)] }] }), undefined, 'table cells cannot contain holes')
assert.match(cards.cardPlainText(view), /alpha/)
assert.match(cards.cardPlainText(cards.fallbackCardView(record)), /alpha: 1/)
assert.equal(cards.cardPlainText(cards.fallbackCardView({ ...record, fallback: undefined })), 'acme/report\n{\n  "rows": [\n    {\n      "name": "alpha",\n      "value": 1\n    }\n  ]\n}')

const { Context } = await import('@deepseek-ai/cordis')
const { TuiRendererRuntime, getHostRenderers } = await import('../../src/dsh-adapter/renderers.js')
const { mountAdmitted, mountAdmissionHost, testManifest } = await import('../lib/plugin-test-utils.js')
const root = new Context()

try {
  await root.plugin(TuiRendererRuntime)
  await mountAdmissionHost(root, 'custom card API')
  const host = getHostRenderers(root.get('tuiRenderers'))!
  const rootRenderers = root.get('tuiRenderers')!

  assert.equal(cards.cardPlainText(host.presentCard(record)), 'Report\nOne row\nalpha: 1')
  assert.equal(host.hasCard('acme/report'), false)
  rootRenderers.registerCard('acme/root', () => view)
  assert.equal(host.hasCard('acme/root'), false, 'root callers cannot register cards')

  let disposeCard = () => {}
  let disposeLegacy = () => {}
  const admitted = await mountAdmitted(root, 'custom-card-producer', testManifest({ id: 'com.example.custom-card-producer' }))
  const contributions = admitted.context.inject(['tuiRenderers'], (ctx) => {
    const renderers = ctx.get('tuiRenderers')!
    disposeCard = renderers.registerCard('acme/report', () => view)
    const duplicate = renderers.registerCard('acme/report', () => ({ title: 'replacement', blocks: [] }))
    duplicate()
    renderers.registerCard('acme/lifecycle', () => view)
    renderers.registerCard('acme/throw', () => { throw new Error('presenter failed') })
    renderers.registerCard('acme/invalid', () => ({ title: 'bad', blocks: [{ kind: 'html', text: '<b>bad</b>' }] }) as never)
    renderers.registerCard('acme/compact', () => ({ ...view, density: 'compact' }))
    renderers.registerCard('acme/bad-density', () => ({ ...view, density: 'wide' }) as never)
    renderers.registerCard('command/model-context', data => ({
      title: 'Context',
      blocks: [{ kind: 'markdown', text: (data as { text: string }).text }],
    }))
    disposeLegacy = renderers.register('acme/note', () => ({ title: 'legacy', lines: ['unchanged'] }))
  })
  await contributions
  const pluginRenderers = admitted.context.get('tuiRenderers')!
  assert.equal('presentCard' in pluginRenderers, false, 'host presentation is not plugin-visible')
  assert.equal('hasCard' in pluginRenderers, false, 'host discrimination is not plugin-visible')
  assert.equal(host.hasCard('acme/report'), true)
  assert.equal(host.presentCard(record).title, 'Report', 'duplicate registration cannot replace the owner')
  assert.equal(host.presentCard({ ...record, type: 'acme/throw', fallback: undefined }).blocks[0]?.kind, 'text')
  assert.match(cards.cardPlainText(host.presentCard({ ...record, type: 'acme/throw', fallback: undefined })), /"rows"/)
  assert.equal(cards.cardPlainText(host.presentCard({ ...record, type: 'acme/invalid' })), 'Report\nOne row\nalpha: 1')
  assert.equal(host.presentCard({ ...record, type: 'acme/compact' }).density, 'compact', 'the host passes a declared density through')
  assert.equal(cards.cardPlainText(host.presentCard({ ...record, type: 'acme/bad-density' })), 'Report\nOne row\nalpha: 1', 'an unknown density degrades through the existing fallback')
  assert.equal(host.hasCard('command/model-context'), true)
  assert.equal(host.presentCard({ ...record, type: 'command/model-context', data: { text: '**context**' } }).blocks[0]?.kind, 'markdown')
  assert.deepEqual(host.render('acme/note', {}), { title: 'legacy', lines: ['unchanged'] })
  assert.equal(host.hasCard('not valid'), false)

  disposeCard()
  assert.equal(host.hasCard('acme/report'), false)
  assert.equal(cards.cardPlainText(host.presentCard(record)), 'Report\nOne row\nalpha: 1')
  disposeLegacy()
  assert.equal(host.render('acme/note', {}), undefined)

  await admitted.fiber.dispose()
  assert.equal(host.hasCard('acme/lifecycle'), false, 'activation unload removes card presenters')
  assert.equal(host.hasCard('command/model-context'), false)
  pluginRenderers.registerCard('acme/inactive', () => view, admitted.context)
  assert.equal(host.hasCard('acme/inactive'), false, 'inactive activations cannot register cards')

  console.log('custom card API: neutral contract and lifecycle registry passed')
} finally {
  await root.fiber.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
}
