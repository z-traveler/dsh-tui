/** Real Session/Projection delivery into the DSH channel's Fast adapter.
 * Run: node --import tsx/esm scripts/downstream/verify-fast-mode-projection.ts */
import '../lib/default-lang-zh.mjs'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { createFastModeStatus, publishFastModelSelection } from '../../src/dsh-adapter/channel/fast-mode.js'
import { createChannelOwner } from '../../src/dsh-adapter/channel/owner.js'
import type { ChannelState } from '../../src/dsh-adapter/channel/types.js'

const schema = z.object({ enabled: z.boolean(), applicable: z.boolean(), provider: z.string(), model: z.string(),
  lastFallback: z.object({ id: z.string(), seq: z.number(), provider: z.string(), model: z.string() }).nullable(),
})
type Wire = z.infer<typeof schema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { piAiFast: Wire }
  interface SessionProjectionMap { piAiFast: Wire }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap { 'plugin:test/fast-mode': Wire }
}
const initial: Wire = { enabled: false, applicable: false, provider: 'offline', model: 'gpt-fixture', lastFallback: null }
const ctx = new Context()
const owner = createChannelOwner()
const notices: string[] = []
let changes = 0
const state: Pick<ChannelState, 'fastMode' | 'fastModeSnapshot' | 'emit' | 'notify'> = {
  fastModeSnapshot: undefined,
  get fastMode() { return this.fastModeSnapshot?.() },
  emit: () => { changes++ }, notify: text => { notices.push(text) },
}
try {
  await ctx.plugin(Sessions)
  await ctx.plugin(Projections)
  const release = ctx.sessionProjections.register({
    key: 'piAiFast', stateSchema: schema, stateVersion: 1, init: () => initial,
    apply: (state, event) => {
      const record = pluginRecordOf(event)
      return record?.type === 'plugin:test/fast-mode' ? schema.parse(record.data) : state
    },
    wire: { viewSchema: schema, view: state => state },
  })
  const one = ctx.sessions.create(SessionId('one'))
  const two = ctx.sessions.create(SessionId('two'))
  const adapter = createFastModeStatus(ctx, state, owner)
  await ctx.fiber.await()
  // The TUI plugin's own activation does not inject this optional service, and
  // Cordis rejects reading a registered service that was not injected.
  let probeError: unknown
  await ctx.plugin({ name: 'fast-probe', apply(child: Context) {
    const probeOwner = createChannelOwner()
    try { createFastModeStatus(child, { ...state, fastModeSnapshot: undefined }, probeOwner) } catch (error) { probeError = error }
    finally { probeOwner.dispose() }
  } })
  assert.equal(probeError, undefined, 'an activation without the optional inject still creates the adapter')
  adapter.seed(one)
  assert.equal(state.fastMode?.enabled, false)
  appendPluginRecord(one, 'plugin:test/fast-mode', { ...initial, enabled: true, applicable: true })
  assert.equal(state.fastMode?.applicable, true)
  const before = changes
  appendPluginRecord(two, 'plugin:test/fast-mode', { ...initial, enabled: true, applicable: true })
  assert.equal(changes, before, 'background sessions cannot publish into the current footer')
  appendPluginRecord(one, 'plugin:test/fast-mode', { ...initial, enabled: true, applicable: true,
    lastFallback: { id: 'request-one', seq: one.seq, provider: 'offline', model: 'gpt-fixture' } })
  assert.equal(notices.length, 1)
  appendPluginRecord(one, 'plugin:test/fast-mode', { ...initial, enabled: false, lastFallback: { id: 'request-one', seq: 1, provider: 'offline', model: 'gpt-fixture' } })
  assert.equal(notices.length, 1, 'repeated metadata is not another failed request')
  adapter.seed(two)
  appendPluginRecord(one, 'plugin:test/fast-mode', { ...initial, enabled: false })
  assert.equal(state.fastMode?.enabled, true, 'an old session cannot overwrite the new binding')
  const seen: string[] = []
  ctx.on('session/event', (session, event) => { if (session === two) seen.push(event.type) })
  publishFastModelSelection(ctx, two, { provider: 'offline', model: 'gpt-next' })
  assert.equal(seen.at(-1), 'model/selection', 'real TUI choice uses the public model-selection event')
  await release()
  assert.equal(state.fastMode, undefined, 'removed capability cannot leave an active marker')
  const count = two.seq
  publishFastModelSelection(ctx, two, { provider: 'offline', model: 'gpt-other' })
  assert.equal(two.seq, count, 'no extra model event without Fast capability')
  // The registry reads only the keys asked for, so a failing optional read is
  // proven on the Fast key itself: its view throws while the footer stays up.
  ctx.sessionProjections.register({ key: 'piAiFast', stateSchema: schema, stateVersion: 1, init: () => initial,
    apply: state => state,
    wire: { viewSchema: schema, view: () => { throw new Error('controlled projection read failure') } },
  })
  assert.doesNotThrow(() => adapter.seed(two))
  assert.equal(state.fastMode, undefined, 'a failed optional read hides the marker')
  assert.doesNotThrow(() => publishFastModelSelection(ctx, two, { provider: 'offline', model: 'gpt-failed-read' }))
  assert.equal(two.seq, count, 'an unreadable capability cannot publish a selection')
  owner.dispose()
  assert.equal(state.fastMode, undefined)
  console.log('PASS: Fast projection binding, background isolation, notices and public selection')
} finally {
  owner.dispose()
  await ctx.fiber.dispose()
}
