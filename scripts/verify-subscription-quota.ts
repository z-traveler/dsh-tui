/** Subscription quota lifecycle through a real createChannel and a real 0.2.2 AgentLoop, offline.
 * Covers bind, modern route selection, legacy route switch, turn/end, absent/withdrawn service,
 * late answers, expiry and disposal. No network, credentials or real user state.
 * Run: node --import tsx/esm scripts/verify-subscription-quota.ts */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

const root = mkdtempSync(join(tmpdir(), 'dsh-tui-quota-'))
process.env.HOME = root
process.env.USERPROFILE = root
process.env.DSH_HOME = join(root, 'home')
process.env.DSH_TUI_LANG = 'en'
const [
  { Context }, { default: AgentRegistry }, { default: AgentLoop },
  { default: LlmRuntime, LlmAdapter, createUserMessage, ReasoningEffortId },
  { default: SessionStore }, { default: SessionProjectionRegistry }, { default: SystemPrompt },
  { default: ToolRuntime }, NativeExecutor, { createChannel }, { settled },
] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-agent'), import('@deepseek-ai/dsh-agent-loop'),
  import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'),
  import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-tool-executor-native'),
  import('../src/dsh-adapter/channel.js'), import('./lib/term-test.mjs'),
])
const { SessionId } = await import('@deepseek-ai/dsh-session')
const a = { provider: 'fixture', model: 'a' }
const b = { provider: 'fixture', model: 'b' }
type Snapshot = { windows: { name: string; utilization: number; resetsAt?: number }[]; fetchedAt: number; expiresAt: number }
const snap = (utilization: number, ttl = 60_000): Snapshot => ({ windows: [{ name: 'seven_day', utilization }], fetchedAt: Date.now(), expiresAt: Date.now() + ttl })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(done => setImmediate(done))
const info = (provider: string, model: string): LlmResolvedModelInfo => ({ provider, id: model, name: model, context: { contextWindow: 32000 } })

async function runtime() {
  const ctx = new Context()
  class Offline extends LlmAdapter {
    async resolveModel(provider: string, model: string) { return info(provider, model) }
    async listModels(provider: string) { return ['a', 'b'].map(model => info(provider, model)) }
    async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, ToolRuntime, NativeExecutor, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(SystemPrompt, { personaPrefix: 'x' })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fixture'], new Offline())
  const create = (id: string) => ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: a })
  const turn = async (agent: Agent, text: string) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle()
  }
  return { ctx, create, turn }
}

/** A recording service whose answers the test can hold back. */
function service(answer: (route: { provider: string; model: string }, call: number) => Promise<Snapshot | undefined> | Snapshot | undefined) {
  const calls: { provider: string; model: string }[] = []
  return { calls, query: (route: { provider: string; model: string }) => { calls.push({ ...route }); return Promise.resolve(answer(route, calls.length)) } }
}
/** Service name is outside the typed Context surface (the provider owns that augmentation). */
const provide = (ctx: { provide(name: string, value: unknown): void }, svc: unknown): void => ctx.provide('subscriptionQuota', svc)
const windows = (channel: { rateLimit?: { windows: readonly { utilization: number }[] } }) => channel.rateLimit?.windows.map(window => window.utilization)

let failures = 0
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failures++; console.error(`FAIL ${name}`, error) }
}
async function open(modern = true, label = 'q') {
  const test = await runtime()
  const handle: AgentHandle = await test.create(label)
  const agent = modern ? handle.agent : Object.create(handle.agent, { model: { value: undefined } }) as Agent
  const open = (): ReturnType<typeof createChannel> => createChannel(test.ctx, agent, { ...a, cwd: root, activity: false })
  return { ...test, handle, open }
}
const close = async (ctx: InstanceType<typeof Context>, channel?: { releaseContributions(): void }) => { channel?.releaseContributions(); await ctx.fiber.dispose() }

await check('absent service shows nothing; a provider arriving later is picked up', async () => {
  const t = await open()
  const channel = t.open()
  await tick()
  assert.equal(channel.rateLimit, undefined)
  provide(t.ctx, service(() => snap(.1)))
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  await close(t.ctx, channel)
})

await check('bind queries the foreground route and shows normalised windows', async () => {
  const t = await open()
  const svc = service(() => snap(.25))
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  assert.deepEqual(svc.calls, [a])
  assert.deepEqual(windows(channel), [.25])
  await close(t.ctx, channel)
})

await check('modern route selection clears at once, queries the new route and drops late old answers', async () => {
  const t = await open()
  const held = deferred<Snapshot | undefined>()
  const svc = service((route, call) => call === 1 ? snap(.1) : route.model === 'b' && call === 2 ? held.promise : snap(.9))
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => windows(channel)?.[0] === .1))
  t.handle.agent.model.select(b)
  assert.equal(channel.rateLimit, undefined, 'the previous route is hidden before the new answer')
  await tick()
  t.handle.agent.model.select({ ...b, reasoningEffort: ReasoningEffortId('high') })
  await tick()
  assert.equal(svc.calls.length, 2, 'effort-only selection does not query')
  t.handle.agent.model.select(a)
  assert.ok(await settled(() => windows(channel)?.[0] === .9))
  held.resolve(snap(.5))
  await tick()
  assert.deepEqual(windows(channel), [.9], 'a late answer for the old route is ignored')
  assert.deepEqual(svc.calls.map(call => call.model), ['a', 'b', 'a'])
  await close(t.ctx, channel)
})

await check('turn end refreshes the pending route in place', async () => {
  const t = await open()
  let level = .1
  const svc = service(() => snap(level))
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => windows(channel)?.[0] === .1))
  level = .4
  await t.turn(t.handle.agent, 'work')
  assert.ok(await settled(() => windows(channel)?.[0] === .4))
  assert.equal(svc.calls.at(-1)?.model, 'a')
  await close(t.ctx, channel)
})

await check('legacy host: switchModel queries once for the new route', async () => {
  const t = await open(false, 'legacy')
  const svc = service(() => snap(.3))
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  assert.equal(await channel.switchModel(b.provider, b.model), true)
  assert.equal(channel.rateLimit, undefined)
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  assert.deepEqual(svc.calls.map(call => call.model), ['a', 'b'])
  await close(t.ctx, channel)
})

await check('rebinding to another session clears and re-queries; a late answer from the old binding is dropped', async () => {
  const t = await open()
  const held = deferred<Snapshot | undefined>()
  const svc = service((_route, call) => call === 1 ? held.promise : snap(.7))
  provide(t.ctx, svc)
  const channel = t.open()
  const other = await t.create('other')
  assert.deepEqual(await channel.resumeTo(String(other.agent.id)), { ok: true })
  assert.ok(await settled(() => windows(channel)?.[0] === .7))
  held.resolve(snap(.2))
  await tick()
  assert.deepEqual(windows(channel), [.7])
  await close(t.ctx, channel)
})

await check('service withdrawal clears the view', async () => {
  const t = await open()
  const svc = service(() => snap(.3))
  let provider: Awaited<ReturnType<typeof t.ctx.plugin>> | undefined
  provider = await t.ctx.plugin({ name: 'quota-provider', apply(child: InstanceType<typeof Context>) { provide(child, svc) } })
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  await provider!.dispose()
  assert.ok(await settled(() => channel.rateLimit === undefined))
  await close(t.ctx, channel)
})

await check('expiry hides the snapshot; invalid, rejected or undefined answers show nothing', async () => {
  const t = await open()
  const answers: (() => Promise<Snapshot | undefined>)[] = [
    async () => snap(.3, 60), async () => snap(.3, -1), async () => undefined, async () => { throw new Error('offline') },
  ]
  const svc = service((_route, call) => answers[call - 1]!())
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  assert.ok(await settled(() => channel.rateLimit === undefined), 'a snapshot disappears at expiresAt without further events')
  for (let call = 2; call <= 4; call++) {
    await t.turn(t.handle.agent, `t${call}`)
    await tick()
    assert.equal(channel.rateLimit, undefined)
  }
  await close(t.ctx, channel)
})

await check('a hung refresh cannot keep an expired snapshot visible', async () => {
  const t = await open()
  const held = deferred<Snapshot | undefined>()
  const svc = service((_route, call) => call === 1 ? snap(.3, 80) : held.promise)
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  await t.turn(t.handle.agent, 'x')
  assert.equal(svc.calls.length, 2)
  assert.ok(await settled(() => channel.rateLimit === undefined), 'expiry fires while the refresh is still pending')
  held.resolve(snap(.9))
  await close(t.ctx, channel)
})

await check('a provider arriving after the binding was released is not queried', async () => {
  const t = await open()
  const channel = t.open()
  channel.releaseContributions()
  const svc = service(() => snap(.1))
  provide(t.ctx, svc)
  await tick()
  assert.equal(svc.calls.length, 0)
  await close(t.ctx)
})

await check('disposal cancels the timer and ignores late answers', async () => {
  const t = await open()
  const held = deferred<Snapshot | undefined>()
  const svc = service((_route, call) => call === 1 ? snap(.3, 60_000) : held.promise)
  provide(t.ctx, svc)
  const channel = t.open()
  assert.ok(await settled(() => channel.rateLimit !== undefined))
  await t.turn(t.handle.agent, 'x')
  channel.releaseContributions()
  held.resolve(snap(.9))
  await tick()
  assert.equal(channel.rateLimit, undefined, 'released channel is cleared and stays so')
  await close(t.ctx)
})

if (failures > 0) { console.error(`${failures} failed`); process.exit(1) }
console.log('verify-subscription-quota: OK')
process.exit(0)
