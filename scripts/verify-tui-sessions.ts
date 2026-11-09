/** Public session seam over a real Cordis activation and channel.
 * Run: node --import tsx/esm scripts/verify-tui-sessions.ts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession } from '../src/agent/session.js'

const home = mkdtempSync(join(tmpdir(), 'dsh-tui-sessions-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, 'dsh')
const { Context } = await import('@deepseek-ai/cordis')
const { attachTuiSessionsChannel, publishTuiSessionDerived } = await import('../src/dsh-adapter/tui-sessions.js')
const extensions = await import('../src/dsh-adapter/extensions.js')
const { createChannel } = await import('../src/dsh-adapter/channel.js')
const { createStartingSession } = await import('../src/agent/starting-session.js')
const { settled } = await import('./lib/term-test.mjs')
const root = new Context()
const warnings: unknown[] = []
root.logger.warn = (...args: unknown[]) => { warnings.push(args) }
const session = (id: string): AgentSession => ({
  ref: { backendId: 'fake', sessionId: id }, cwd: home, status: 'idle',
  capabilities: { native: {} }, history: async () => [], subscribe: () => () => {},
  submit: async () => ({ accepted: true }), cancel: async () => ({ stillQueued: [] }), dispose: async () => {},
})
const first = session('first')
first.capabilities.fork = { fork: async () => ({ sessionId: 'forked' }) }
first.capabilities.rewind = { rewind: async () => ({ kind: 'success', session: { backendId: 'fake', sessionId: 'rewound' } }) }
let next = 0
const channel = createChannel(root, first, {
  cwd: home, model: 'fake', provider: 'fake', activity: false,
  onSessionDerived: event => publishTuiSessionDerived(root, event),
  openSession: async target => session(target.kind === 'resume' ? target.sessionId : `new-${++next}`),
})
const detach = attachTuiSessionsChannel(root, channel)
const runtime = root.plugin(extensions)
await runtime
assert.throws(() => root.tuiSessions.current(), /plugin|activation|root/iu)
assert.throws(() => root.tuiSessions.subscribe(() => {}), /plugin|activation|root/iu)
let ctx: InstanceType<typeof Context> | undefined
const plugin = root.plugin({ name: 'sessions-probe', inject: ['tuiSessions', 'tuiIntegration'], apply(c) { ctx = c } })
await plugin
assert.ok(ctx)
const seen: unknown[] = []
const off = ctx.tuiSessions.subscribe(value => seen.push(value))
assert.deepEqual(seen, [{ sessionId: 'first', backend: 'fake' }])
assert.deepEqual(ctx.tuiSessions.current(), seen[0])
// Both released seams must coexist on the same extensions activation.
const integration = ctx.tuiIntegration
assert.ok(integration)
assert.ok(await settled(() => integration.getForeground()?.sessionId === 'first'))
assert.equal(integration.getForeground()?.cwd, home)
const derived: unknown[] = []
ctx.tuiSessions.onDerived(value => derived.push(value))
ctx.tuiSessions.onDerived(() => { throw new Error('listener failure') })
ctx.tuiSessions.onDerived(async () => { throw new Error('async listener failure') })
assert.equal(await channel.forkSession(), true)
assert.ok(await settled(() => warnings.length >= 2), 'synchronous and asynchronous listener failures are contained')
assert.deepEqual(derived, [{ kind: 'fork', sourceSessionId: 'first', sessionId: 'forked' }])
assert.deepEqual(seen.at(-1), { sessionId: 'first', backend: 'fake' })
assert.equal(await channel.rewindTo({ text: 'retry', anchor: { kind: 'message', id: '1' } } as never), 'retry')
assert.deepEqual(derived.at(-1), { kind: 'rewind', sourceSessionId: 'first', sessionId: 'rewound' })
assert.deepEqual(seen.at(-1), { sessionId: 'rewound', backend: 'fake' })
assert.equal(await channel.newSession(), true)
assert.deepEqual(seen.at(-1), { sessionId: 'new-1', backend: 'fake' })
assert.ok(await settled(() => integration.getForeground()?.sessionId === ctx!.tuiSessions.current()?.sessionId))
off()
assert.equal(await channel.newSession(), true)
assert.equal(seen.length, 3)
const disposed: unknown[] = []
ctx.tuiSessions.subscribe(value => disposed.push(value))
await plugin.dispose()
const warningCount = warnings.length
publishTuiSessionDerived(root, { kind: 'fork', sourceSessionId: 'old', sessionId: 'after-unload' })
await new Promise(resolve => setImmediate(resolve))
assert.equal(warnings.length, warningCount, 'unloaded listeners cannot receive derivations')
assert.equal(derived.length, 2)
assert.equal(await channel.newSession(), true)
assert.equal(disposed.length, 1)
detach()
channel.releaseContributions()
assert.equal(integration.getForeground(), undefined, 'channel release clears the coexisting foreground seam')
await runtime.dispose()

// A channel can mount before its session or this service. The next activation
// receives undefined immediately, then the adopted session, and HMR replays it.
const opening = Promise.withResolvers<{ session: AgentSession; history: readonly never[] }>()
const starting = createChannel(root, createStartingSession('fake', home), {
  cwd: home, model: 'fake', provider: 'fake', activity: false, startup: opening.promise,
})
attachTuiSessionsChannel(root, starting)
const runtime2 = root.plugin(extensions)
await runtime2
let late: InstanceType<typeof Context> | undefined
const latePlugin = root.plugin({ name: 'sessions-late', inject: ['tuiSessions'], apply(c) { late = c } })
await latePlugin
assert.ok(late)
const startupSeen: unknown[] = []
late.tuiSessions.subscribe(value => startupSeen.push(value))
assert.deepEqual(startupSeen, [undefined])
opening.resolve({ session: session('startup'), history: [] })
assert.ok(await settled(() => startupSeen.length === 2))
assert.deepEqual(startupSeen[1], { sessionId: 'startup', backend: 'fake' })
await latePlugin.dispose()
let reloaded: InstanceType<typeof Context> | undefined
const reload = root.plugin({ name: 'sessions-late', inject: ['tuiSessions'], apply(c) { reloaded = c } })
await reload
assert.ok(reloaded)
const replay: unknown[] = []
reloaded.tuiSessions.subscribe(value => replay.push(value))
assert.deepEqual(replay, [{ sessionId: 'startup', backend: 'fake' }])
starting.releaseContributions()
assert.deepEqual(replay, [{ sessionId: 'startup', backend: 'fake' }, undefined])
await reload.dispose()
await runtime2.dispose()
rmSync(home, { recursive: true, force: true })
console.log('tui sessions: binding replay, switch and cleanup passed')
