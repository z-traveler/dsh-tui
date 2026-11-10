/** Compile first, then: node --import tsx/esm scripts/downstream/verify-custom-card-carrier.ts */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  Session,
  SessionId,
  SessionLogOffset,
  SessionSeq,
  appendPluginRecord,
  buildForkSeed,
  pluginRecordOf,
} from '@deepseek-ai/dsh-session'
import type { Session as DshSession } from '@deepseek-ai/dsh-session'
import { TUI_CARD_RECORD_TYPE, asTuiCardRecord } from '../../src/cards.js'
import { appendTuiCard } from '../../src/cards-dsh.js'
import type { TuiCardRecord } from '../../src/cards.js'

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:acme/internal': { readonly note: string }
  }
}

function readCards(session: DshSession) {
  return session.snapshotEvents().flatMap(event => {
    const record = pluginRecordOf(event)
    if (record?.type !== TUI_CARD_RECORD_TYPE) return []
    const card = asTuiCardRecord(record.data)
    return card === undefined ? [] : [{ seq: record.seq, card }]
  })
}

const source = Session.create(SessionId('custom-card-source'))
const firstInput = {
  version: 1,
  type: 'acme/report',
  id: 'report-1',
  data: { value: 'before' },
  fallback: { title: 'Report', body: 'before' },
} satisfies TuiCardRecord

const firstSeq = appendTuiCard(source, firstInput)
assert.equal(firstSeq, 0)
assert.equal(source.seq, 1)
firstInput.data.value = 'caller mutation'

const secondSeq = appendTuiCard(source, {
  ...firstInput,
  data: { value: 'second' },
  fallback: { title: 'Report', body: 'second' },
})
assert.equal(secondSeq, 1)
assert.throws(
  () => appendTuiCard(source, { ...firstInput, version: 2 } as never),
  /invalid Custom Card record/,
)
assert.equal(source.seq, 2, 'a rejected card does not change the log')

const unrelatedSeq = appendPluginRecord(source, 'plugin:acme/internal', { note: 'not a card' })
assert.equal(unrelatedSeq, 2)
assert.deepEqual(readCards(source).map(({ seq, card }) => ({ seq, data: card.data })), [
  { seq: 0, data: { value: 'before' } },
  { seq: 1, data: { value: 'second' } },
], 'committed sequence orders snapshots and unrelated records are not displayed')
assert.deepEqual(source.deriveMessages(), [])
assert.ok(source.snapshotEvents().every(event => source.deriveEventMessage(event) === null))

const restored = Session.fromRestore(
  source.id,
  structuredClone(source.snapshotEvents()),
  structuredClone(source.header),
  source.inheritedEventCount,
  'detached',
)
assert.deepEqual(readCards(restored), readCards(source), 'ordinary restore retains valid owned cards')
assert.deepEqual(restored.deriveMessages(), [])

const invalidEvents = structuredClone(source.snapshotEvents())
const invalidData: unknown = invalidEvents[0]?.data
assert.ok(invalidData !== null && typeof invalidData === 'object')
Object.assign(invalidData, { version: 2 })
const invalidRestored = Session.fromRestore(
  source.id,
  invalidEvents,
  structuredClone(source.header),
  source.inheritedEventCount,
  'detached',
)
assert.deepEqual(readCards(invalidRestored).map(({ seq }) => seq), [1], 'restored payloads require owner validation')

const forkEvents = buildForkSeed(source.snapshotEvents(), SessionSeq(firstSeq))
const fork = Session.create(
  SessionId('custom-card-fork'),
  forkEvents,
  { ...source.header, id: SessionId('custom-card-fork'), parentSession: source.id, isSeeded: true },
  SessionLogOffset(1),
)
assert.equal(fork.inheritedEventCount, 1)
assert.equal(fork.snapshotEvents()[1]?.type, 'session/end-seed')
assert.deepEqual(readCards(fork).map(({ seq, card }) => ({ seq, data: card.data })), [
  { seq: 0, data: { value: 'before' } },
], 'fork retains only the inclusive source prefix')

const forkSeq = appendTuiCard(fork, {
  ...firstInput,
  data: { value: 'forked' },
  fallback: { title: 'Report', body: 'forked' },
})
assert.equal(forkSeq, 2)
assert.deepEqual(readCards(fork).map(({ seq, card }) => ({ seq, data: card.data })), [
  { seq: 0, data: { value: 'before' } },
  { seq: 2, data: { value: 'forked' } },
])
assert.deepEqual(readCards(source).map(({ seq }) => seq), [0, 1], 'fork writes do not alter the source')
assert.deepEqual(fork.deriveMessages(), [])

const neutralEntry = new URL('../../lib/types/cards.js', import.meta.url).href
const smoke = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { registerHooks } from 'node:module'
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('@deepseek-ai/') || specifier === 'react') {
      throw new Error('Optional peer unavailable: ' + specifier)
    }
    return next(specifier, context)
  } })
  const cards = await import(${JSON.stringify(neutralEntry)})
  if (!cards.asTuiCardRecord({ version: 1, type: 'acme/report', id: 'neutral', data: null })) process.exit(2)
`], { encoding: 'utf8' })
assert.equal(smoke.status, 0, `neutral ./cards must import without optional DSH/React peers: ${smoke.stderr}`)

const library = new URL('../../lib/types/', import.meta.url).href
const legacy = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict'
  import { registerHooks } from 'node:module'
  const sessionUrl = import.meta.resolve('@deepseek-ai/dsh-session')
  const sessionApi = await import(sessionUrl)
  // The pinned 0.1.5-alpha.2 source exports neither plugin-record helper.
  // Keep all other exports so only that observed ABI difference is tested.
  const exports = Object.keys(sessionApi).filter(name => !['appendPluginRecord', 'pluginRecordOf'].includes(name))
    .map(name => 'export { ' + name + ' } from ' + JSON.stringify(sessionUrl)).join(';')
  const legacyUrl = 'data:text/javascript,' + encodeURIComponent(exports)
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-session' && context.parentURL?.startsWith(${JSON.stringify(library)})) {
      return { url: legacyUrl, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  const { appendTuiCard } = await import(${JSON.stringify(new URL('../../lib/types/cards-dsh.js', import.meta.url).href)})
  let wrote = false
  const session = { append() { wrote = true; throw new Error('must not bypass the host') } }
  assert.throws(() => appendTuiCard(session, { version: 1, type: 'acme/report', id: 'unsupported', data: null }),
    /Custom Cards require.*plugin.record/i)
  assert.equal(wrote, false, 'unsupported hosts must not receive fabricated records')
  const { createDshTranslator } = await import(${JSON.stringify(new URL('../../lib/types/dsh-adapter/backend/translate.js', import.meta.url).href)})
  const { prepareReplayEvents } = await import(${JSON.stringify(new URL('../../lib/types/dsh-adapter/channel/transcript.js', import.meta.url).href)})
  const event = { type: 'user/message', seq: 0, time: 1,
    data: { id: 'legacy-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'kept' }] } }
  const replay = prepareReplayEvents([event])
  assert.deepEqual(replay, [event], 'ordinary replay must survive the absent optional API')
  const translator = createDshTranslator({ tools: () => undefined, scope: () => undefined, attachments: () => undefined })
  assert.ok(translator.translateEvent(event).some(item => item.type === 'user.message' && item.text === 'kept'))
`], { encoding: 'utf8', cwd: new URL('../../', import.meta.url) })
assert.equal(legacy.status, 0, `legacy host must load the producer and both transcript consumers without optional plugin-record APIs: ${legacy.stderr}`)

console.log('custom card carrier: append, restore, fork, model invisibility, neutral and legacy import passed')
