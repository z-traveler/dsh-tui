/**
 * Foreground integration seam (`dsh-adapter/integration.ts`): what an external
 * plugin reads and hears must follow a REAL channel binding, not a copy.
 *
 * Covered, over a real cordis root and the real `createChannel`:
 *
 * - late mount: the `dsh-tui-extensions` row can mount AFTER the channel
 *   started (the standalone entry mounts the screen before the profile
 *   composes) — the binding is published on arrival, so `getForeground()`
 *   answers immediately instead of on the next change;
 * - late attach: a plugin that applies after the initial bind reads
 *   `getForeground()` synchronously; `onChange` notifies once on subscribe
 *   and the listener reads the binding itself, without callback arguments;
 * - switch: `/new` moves the binding and notifies the listener;
 * - cwd move: a `/workspace` handoff republishes the same kind of change with
 *   the new directory;
 * - release: teardown notifies and the foreground reader returns `undefined`;
 * - detach: a plugin that unloads stops hearing (its listener is dropped with
 *   its activation), and repeated identical publications never fire twice;
 * - containment: a root (host) caller and a throwing listener are refused /
 *   logged, never propagated into the TUI;
 * - absence: a channel on a root without the row behaves exactly as before;
 * - DSH-native `/bg` and rewind: real DSH agent/session services adopt a new
 *   foreground, including a working-directory move and stale-work fencing.
 *
 * Run: node --import tsx/esm scripts/verify-foreground-seam.ts
 */
export {}

// The optional dsh-working-directory plugin is not a dependency of this
// fixture; its durable event is the one consumed by the DSH translator.
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'working-directory/change': { cwd: string }
  }
}

const { mkdtempSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-tui-foreground-seam-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
process.env.DSH_HOME = join(isolatedHome, 'dsh-home')
process.env.DSH_TUI_SESSION_ROOT = join(isolatedHome, 'sessions')
process.env.DSH_TUI_ADAPTER_MODE = 'legacy'
delete process.env.DSH_TUI_IDE_PORT
delete process.env.DSH_TUI_IDE_TOKEN
delete process.env.DSH_TUI_PRESET
mkdirSync(join(isolatedHome, '.dsh-tui'), { recursive: true })

const [{ Context }, { createChannel }, { TuiIntegrationRuntime, getHostIntegration }, { settled }] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import('../src/dsh-adapter/channel.js'),
  import('../src/dsh-adapter/integration.js'),
  import('./lib/term-test.mjs'),
])

let failures = 0
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

type SessionListener = (events: readonly import('../src/agent/events.js').AgentEvent[], meta: import('../src/agent/events.js').AgentEventMeta) => void

type FakeSession = {
  ref: { backendId: string; sessionId: string }
  cwd: string
  status: 'idle'
  capabilities: { native: Record<string, never> }
  history(): Promise<never[]>
  subscribe(listener: SessionListener): () => void
  emit(event: import('../src/agent/events.js').AgentEvent): void
  submit(): Promise<{ accepted: true }>
  cancel(): Promise<{ stillQueued: never[] }>
  dispose(): Promise<void>
}

const fakeSession = (sessionId: string, cwd: string): FakeSession => {
  const listeners = new Set<SessionListener>()
  return {
    ref: { backendId: 'fake', sessionId },
    cwd,
    status: 'idle',
    capabilities: { native: {} },
    history: () => Promise.resolve([]),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    emit(event) { for (const listener of listeners) listener([event], { replay: false }) },
    submit: () => Promise.resolve({ accepted: true }),
    cancel: () => Promise.resolve({ stillQueued: [] }),
    dispose: () => Promise.resolve(),
  }
}

const workdir = join(isolatedHome, 'project')
const otherDir = join(isolatedHome, 'other-project')
mkdirSync(workdir, { recursive: true })
mkdirSync(otherDir, { recursive: true })

/** One real channel over `root`, with the opener recording what it opened. */
function mountChannel(root: InstanceType<typeof Context>, first: FakeSession) {
  const opened: FakeSession[] = []
  const channel = createChannel(root, first as never, {
    model: 'fake-model',
    provider: '',
    cwd: workdir,
    activity: false,
    backendLabel: 'Fake Agent',
    openSession: async target => {
      if (target.kind !== 'create') throw new Error(`unexpected open: ${target.kind}`)
      const next = fakeSession(`opened-${opened.length + 1}`, target.cwd)
      opened.push(next)
      return next as never
    },
  })
  return { channel, opened }
}

// ── the seam mounted AFTER the channel started ───────────────────────────
{
  const root = new Context()
  const warnings: string[] = []
  root.logger.warn = (format: unknown, ...params: unknown[]) => {
    warnings.push([format, ...params].map(String).join(' '))
  }
  const first = fakeSession('first-session', workdir)
  const { channel, opened } = mountChannel(root, first)
  check('channel starts with no integration service mounted', root.get('tuiIntegration') === undefined)

  // The profile composes later: this is the row arriving after the bind.
  root.plugin(TuiIntegrationRuntime)
  await settled(() => root.get('tuiIntegration') !== undefined)
  const integration = root.tuiIntegration
  await settled(() => integration.getForeground() !== undefined)
  check('late mount: the already-bound foreground is published on arrival',
    integration.getForeground()?.sessionId === 'first-session', integration.getForeground())
  check('the binding carries the session working directory',
    integration.getForeground()?.cwd === workdir, integration.getForeground())

  // A plugin attaching after the initial bind reads it synchronously.
  const seen: Array<{ sessionId: string; cwd: string } | undefined> = []
  const callbackArgs: number[] = []
  const following: Array<string | undefined> = []
  let lateRead: string | undefined
  let disposers: { unsubscribe?: () => void; detach?: () => void } = {}
  const pluginFiber = root.plugin({
    name: 'foreground-follower',
    inject: ['tuiIntegration'],
    apply(pluginCtx: InstanceType<typeof Context>) {
      lateRead = pluginCtx.tuiIntegration.getForeground()?.sessionId
      disposers.unsubscribe = pluginCtx.tuiIntegration.onChange((...args: unknown[]) => {
        callbackArgs.push(args.length)
        const current = pluginCtx.tuiIntegration.getForeground()
        seen.push(current === undefined ? undefined : { ...current })
        // A throwing listener is contained: the TUI and the next listener
        // must both survive it.
        if (current?.sessionId === 'opened-1') throw new Error('listener-boom')
      })
      pluginCtx.tuiIntegration.onChange(() => { following.push(pluginCtx.tuiIntegration.getForeground()?.sessionId) })
      pluginCtx.effect(() => () => { disposers.detach = () => undefined })
    },
  })
  await settled(() => lateRead !== undefined)
  check('late attach reads the live binding synchronously', lateRead === 'first-session', lateRead)
  check('subscribe notifies once and the listener reads the current binding',
    seen.length === 1 && seen[0]?.sessionId === 'first-session' && seen[0]?.cwd === workdir, seen)

  // ── switch: /new ────────────────────────────────────────────────────────
  check('/new opens a fresh session', await channel.newSession() === true && opened.length === 1)
  await settled(() => integration.getForeground()?.sessionId === 'opened-1')
  check('switch republishes the binding', integration.getForeground()?.sessionId === 'opened-1', integration.getForeground())
  check('onChange follows the replaced binding',
    seen.length === 2 && seen[0]?.sessionId === 'first-session' && seen[1]?.sessionId === 'opened-1' && seen[1]?.cwd === workdir, seen)
  check('a throwing listener did not break the switch or the next listener',
    integration.getForeground()?.sessionId === 'opened-1' && following.length === 2 && following[1] === 'opened-1'
    && warnings.some(line => line.includes('onChange listener failed')), { warnings, following })

  // ── cwd move: /workspace hands off to a fresh session there ─────────────
  const switched = await channel.switchWorkspace({ cwd: otherDir, label: 'other' } as never)
  check('/workspace opens a session in the new directory', switched === true && opened.length === 2, opened.length)
  await settled(() => integration.getForeground()?.sessionId === 'opened-2')
  check('cwd move republishes the binding with the new directory',
    integration.getForeground()?.sessionId === 'opened-2' && integration.getForeground()?.cwd === otherDir,
    integration.getForeground())
  check('the cwd move is one change following the replaced binding',
    seen.length === 3 && seen[1]?.sessionId === 'opened-1' && seen[2]?.sessionId === 'opened-2' && seen[2]?.cwd === otherDir, seen)

  // A native cwd update changes the live directory without changing sessions.
  const liveDirectory = join(otherDir, 'nested')
  mkdirSync(liveDirectory)
  opened[1]!.emit({ type: 'session.cwd', cwd: liveDirectory })
  await settled(() => integration.getForeground()?.cwd === liveDirectory)
  check('live session.cwd publishes the working directory, not the adoption directory',
    integration.getForeground()?.sessionId === 'opened-2' && integration.getForeground()?.cwd === liveDirectory,
    integration.getForeground())
  check('live cwd change notifies followers of the same session',
    seen.length === 4 && seen[3]?.sessionId === 'opened-2' && seen[3]?.cwd === liveDirectory, seen)
  check('all onChange deliveries are notification-only', callbackArgs.length === 4 && callbackArgs.every(count => count === 0), callbackArgs)

  // ── detach: the plugin unloads, its listener goes with it ───────────────
  const beforeUnload = seen.length
  const beforeFollowingUnload = following.length
  await pluginFiber.dispose()
  await channel.newSession()
  check('an unloaded plugin stops hearing',
    seen.length === beforeUnload && following.length === beforeFollowingUnload,
    { seen: seen.length - beforeUnload, following: following.length - beforeFollowingUnload })

  // ── release: the channel ends, the seam reports nothing live ─────────────
  const released: Array<{ sessionId: string; cwd: string } | undefined> = []
  const releaseCallbackArgs: number[] = []
  const releaseFiber = root.plugin({
    name: 'foreground-release-watcher',
    inject: ['tuiIntegration'],
    apply(pluginCtx: InstanceType<typeof Context>) {
      pluginCtx.tuiIntegration.onChange((...args: unknown[]) => {
        releaseCallbackArgs.push(args.length)
        const current = pluginCtx.tuiIntegration.getForeground()
        released.push(current === undefined ? undefined : { ...current })
        // Nothing to detach: this activation outlives the channel.
      })
    },
  })
  await settled(() => released.length === 1)
  channel.releaseContributions()
  check('release notifies the transition from a binding to undefined',
    released.length === 2 && released[0]?.sessionId === 'opened-3' && released[1] === undefined, released)
  check('release notifications also carry no arguments', releaseCallbackArgs.length === 2 && releaseCallbackArgs.every(count => count === 0), releaseCallbackArgs)
  check('getForeground answers undefined after release', integration.getForeground() === undefined, integration.getForeground())

  // ── containment: host/root callers cannot subscribe ─────────────────────
  const rootCalls = warnings.length
  const rootNoop = root.tuiIntegration.onChange(() => { failures += 1 })
  check('a composition-root caller is refused (and gets a no-op disposer)',
    typeof rootNoop === 'function' && warnings.length === rootCalls + 1,
    warnings.slice(rootCalls))
  rootNoop()

  // ── repeated identical publications never fire twice ────────────────────
  const host = getHostIntegration(root.tuiIntegration as never)
  if (host === undefined) throw new Error('host accessor missing')
  const repeats: number[] = []
  let repeatSubscribed = false
  const repeatFiber = root.plugin({
    name: 'foreground-repeat-watcher',
    inject: ['tuiIntegration'],
    apply(pluginCtx: InstanceType<typeof Context>) {
      pluginCtx.tuiIntegration.onChange(() => { repeats.push(1) })
      repeatSubscribed = true
    },
  })
  await settled(() => repeatSubscribed)
  // Nothing is live after the release above, so the first publication is the
  // subscriber's change and the identical repeat is dropped.
  host.publishForeground({ sessionId: 'same', cwd: '/same' })
  check('the first publication reaches the subscriber', repeats.length === 1, repeats.length)
  host.publishForeground({ sessionId: 'same', cwd: '/same' })
  check('identical re-publication is a no-op', repeats.length === 1, repeats.length)
  host.publishForeground(undefined)
  check('clearing is a change', repeats.length === 2, repeats.length)
  await repeatFiber.dispose()
  await releaseFiber.dispose()
}

// ── DSH-native adoption through the actual channel extension ──────────────
{
  // The same in-memory DSH service stack as verify-fork-resume, without its
  // persistence provider: no model adapter, credentials, network or profile.
  const [
    { default: AgentRegistry },
    { default: AgentLoop },
    { default: LlmRuntime, createUserMessage },
    { default: SessionStore, SessionId },
    { default: SessionProjectionRegistry },
    { default: SystemPrompt },
    { default: ToolRuntime },
  ] = await Promise.all([
    import('@deepseek-ai/dsh-agent'),
    import('@deepseek-ai/dsh-agent-loop'),
    import('@deepseek-ai/dsh-llm'),
    import('@deepseek-ai/dsh-session'),
    import('@deepseek-ai/dsh-session-projection'),
    import('@deepseek-ai/dsh-system-prompt'),
    import('@deepseek-ai/dsh-tools'),
  ])
  const root = new Context()
  let channel: ReturnType<typeof createChannel> | undefined
  let replacement: ReturnType<typeof createChannel> | undefined
  let blockNextCreation = false
  let unblockCreation: (() => void) | undefined
  try {
    for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) {
      await root.plugin(plugin)
    }
    await root.plugin(AgentLoop, { agents: [] })
    await root.plugin(TuiIntegrationRuntime)
    const first = await root.agents.create({ sessionId: SessionId('dsh-foreground-first'), meta: { cwd: workdir } })
    channel = createChannel(root, first.agent, { handle: first, cwd: workdir, model: 'fixture-model', provider: 'fixture', activity: false, upstreamRetry: false })
    const integration = root.tuiIntegration
    if (!await settled(() => integration.getForeground()?.sessionId === 'dsh-foreground-first')) throw new Error('DSH initial foreground not published')

    const seen: Array<{ sessionId: string; cwd: string } | undefined> = []
    const callbackArgs: number[] = []
    let watching = false
    root.plugin({
      name: 'dsh-foreground-follower',
      inject: ['tuiIntegration'],
      apply(pluginCtx: InstanceType<typeof Context>) {
        pluginCtx.tuiIntegration.onChange((...args: unknown[]) => {
          callbackArgs.push(args.length)
          const current = pluginCtx.tuiIntegration.getForeground()
          seen.push(current === undefined ? undefined : { ...current })
        })
        watching = true
      },
    })
    if (!await settled(() => watching)) throw new Error('DSH foreground follower did not attach')
    check('DSH initial binding is the live agent and its cwd',
      seen.length === 1 && seen[0]?.sessionId === String(first.agent.session.id) && seen[0]?.cwd === workdir, seen)

    // The durable event uses the same extension-event fixture as
    // verify-working-directory: the live cwd differs from the header cwd.
    const movedDir = join(workdir, 'worktree')
    mkdirSync(movedDir)
    first.agent.session.append('working-directory/change', { cwd: movedDir })
    check('DSH working-directory change reaches the seam',
      await settled(() => integration.getForeground()?.cwd === movedDir)
      && integration.getForeground()?.sessionId === String(first.agent.id), integration.getForeground())

    const backgroundSeen = seen.length
    const background = await channel.backgroundCurrent()
    const backgroundId = channel.agentId
    const backgroundAgent = root.agents.get(SessionId(backgroundId))
    check('DSH /bg parks the original agent and adopts a fresh agent',
      background.ok && background.backgroundedSessionId === String(first.agent.id)
      && root.agents.get(first.agent.id) === first.agent
      && backgroundId !== String(first.agent.id) && backgroundAgent !== undefined, background)
    if (backgroundAgent === undefined) throw new Error('DSH /bg did not create a live agent')
    check('DSH /bg publishes the new identity with its own working directory',
      await settled(() => integration.getForeground()?.sessionId === backgroundId)
      && integration.getForeground()?.cwd === workdir, integration.getForeground())
    check('DSH /bg notifies the follower of the adopted binding once',
      seen.length === backgroundSeen + 1 && seen[backgroundSeen]?.sessionId === backgroundId
      && seen[backgroundSeen]?.cwd === workdir, seen.slice(backgroundSeen))
    first.agent.session.append('working-directory/change', { cwd: otherDir })
    await Promise.resolve()
    check('a parked DSH agent cannot overwrite the new foreground cwd',
      integration.getForeground()?.sessionId === backgroundId && integration.getForeground()?.cwd === workdir, integration.getForeground())

    // Two real Session turns give the DSH rewind action a nonempty seed. A
    // move in the retained prefix must be replayed into the adopted fork.
    const session = backgroundAgent.session
    for (const turn of [1, 2]) {
      if (turn === 2) session.append('working-directory/change', { cwd: movedDir })
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `rewind turn ${turn}` }] }), { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    if (!await settled(() => channel!.rows.some(row => row.kind === 'user' && row.text === 'rewind turn 2'))) throw new Error('DSH rewind row not projected')
    const row = channel.rows.find(row => row.kind === 'user' && row.text === 'rewind turn 2')!
    if (!await settled(() => integration.getForeground()?.cwd === movedDir)) throw new Error('DSH retained cwd not published')
    const rewindSeen = seen.length
    const restored = await channel.rewindTo(row)
    const rewindId = channel.agentId
    check('DSH rewind adopts a real fork and returns the selected draft',
      restored === 'rewind turn 2' && rewindId !== backgroundId && root.agents.get(SessionId(rewindId)) !== undefined, restored)
    check('DSH rewind publishes the fork identity and replayed working directory',
      await settled(() => integration.getForeground()?.sessionId === rewindId)
      && integration.getForeground()?.cwd === movedDir, integration.getForeground())
    check('DSH rewind notifies once, never with a half-adopted identity/cwd pair',
      seen.length === rewindSeen + 1 && seen[rewindSeen]?.sessionId === rewindId
      && seen[rewindSeen]?.cwd === movedDir, seen.slice(rewindSeen))

    // Delay one real AgentLoop creation at its documented serial lifecycle
    // event. The next switch uses the same registry normally; the delayed
    // background candidate must be disposed rather than publishing over it.
    let blockedId: string | undefined
    root.on('agent/created', async ({ agent }) => {
      if (!blockNextCreation) return undefined
      blockNextCreation = false
      blockedId = String(agent.id)
      await new Promise<void>(resolve => { unblockCreation = resolve })
      return undefined
    }, { global: true })
    blockNextCreation = true
    const pendingBackground = channel.backgroundCurrent()
    if (!await settled(() => unblockCreation !== undefined)) throw new Error('DSH background creation did not reach the lifecycle gate')
    const staleId = blockedId!
    const switched = await channel.switchWorkspace({ kind: 'local', uri: otherDir, cwd: otherDir, label: 'other', badge: '' })
    const switchedId = channel.agentId
    check('DSH workspace switch wins while an older /bg creation is pending',
      switched && switchedId !== rewindId && await settled(() => integration.getForeground()?.sessionId === switchedId)
      && integration.getForeground()?.cwd === otherDir, integration.getForeground())
    const afterSwitch = seen.length
    unblockCreation!()
    unblockCreation = undefined
    const staleBackground = await pendingBackground
    check('the older DSH /bg is abandoned and cannot overwrite the new binding',
      !staleBackground.ok && await settled(() => root.agents.get(SessionId(staleId)) === undefined)
      && integration.getForeground()?.sessionId === switchedId && integration.getForeground()?.cwd === otherDir
      && seen.length === afterSwitch, staleBackground)

    blockNextCreation = true
    blockedId = undefined
    const pendingAtRelease = channel.backgroundCurrent()
    if (!await settled(() => unblockCreation !== undefined)) throw new Error('DSH release race did not reach the lifecycle gate')
    const releaseStaleId = blockedId!
    const next = await root.agents.create({ sessionId: SessionId('dsh-foreground-replacement'), meta: { cwd: workdir } })
    await Promise.resolve()
    const current = root.agents.get(SessionId(switchedId))
    if (current === undefined) throw new Error('DSH switched foreground agent missing')
    const beforeRelease = seen.length
    // Queue a foreground publication, then release and replace the channel in
    // the same turn, before the old channel's microtask can run.
    current.session.append('working-directory/change', { cwd: movedDir })
    check('the old DSH cwd changed while its seam publication is still pending',
      channel.workingDirectory === movedDir && integration.getForeground()?.sessionId === switchedId
      && integration.getForeground()?.cwd === otherDir, integration.getForeground())
    channel.releaseContributions()
    check('DSH release synchronously notifies and clears the foreground',
      integration.getForeground() === undefined && seen.at(-1) === undefined, seen.at(-1))
    replacement = createChannel(root, next.agent, { handle: next, cwd: workdir, model: 'fixture-model', provider: 'fixture', activity: false, upstreamRetry: false })
    if (!await settled(() => integration.getForeground()?.sessionId === String(next.agent.id))) throw new Error('DSH replacement foreground not published')
    check('queued old DSH publication cannot reappear between release and replacement',
      seen.length === beforeRelease + 2 && seen[beforeRelease] === undefined
      && seen[beforeRelease + 1]?.sessionId === String(next.agent.id) && seen[beforeRelease + 1]?.cwd === workdir,
      seen.slice(beforeRelease))
    const afterReplacement = seen.length
    channel.releaseContributions()
    unblockCreation!()
    unblockCreation = undefined
    const releasedBackground = await pendingAtRelease
    check('late DSH creation and repeated old release cannot overwrite the replacement binding',
      !releasedBackground.ok && await settled(() => root.agents.get(SessionId(releaseStaleId)) === undefined)
      && integration.getForeground()?.sessionId === String(next.agent.id) && integration.getForeground()?.cwd === workdir
      && seen.length === afterReplacement, integration.getForeground())
    const beforeFinalRelease = seen.length
    replacement.releaseContributions()
    check('DSH replacement release notifies and leaves no foreground',
      integration.getForeground() === undefined && seen.length === beforeFinalRelease + 1 && seen.at(-1) === undefined,
      integration.getForeground())
    check('DSH notifications carry no callback arguments', callbackArgs.length > 1 && callbackArgs.every(count => count === 0), callbackArgs)
  } finally {
    blockNextCreation = false
    unblockCreation?.()
    channel?.releaseContributions()
    replacement?.releaseContributions()
    await root.fiber.dispose()
  }
}

// ── absent integration: a channel without the row is unchanged ─────────────
{
  const root = new Context()
  const { channel, opened } = mountChannel(root, fakeSession('plain-1', workdir))
  check('no row: nothing to read', root.get('tuiIntegration') === undefined)
  check('no row: /new still works', await channel.newSession() === true && opened.length === 1)
  check('no row: the channel still carries the live session', channel.agentId === 'opened-1', channel.agentId)
  channel.releaseContributions()
}

console.log(failures === 0 ? 'verify-foreground-seam: OK' : `verify-foreground-seam: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
