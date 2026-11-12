import type { AgentSession } from '../../src/agent/session.js'
import type { AgentEvent } from '../../src/agent/events.js'
import { createChannel } from '../../src/dsh-adapter/channel.js'
import type { Context } from '@deepseek-ai/cordis'

/** Real Channel with an in-memory backend: no credentials, network or model requests. */
export function pluginModalFixture(host: Context) {
  let receive: Parameters<AgentSession['subscribe']>[0] | undefined
  let sequence = 0
  let cancelCalls = 0
  const submitted: string[] = []
  const session: AgentSession = {
    ref: { backendId: 'codex', sessionId: 'plugin-modal-fixture' },
    cwd: '/tmp/plugin-modal-fixture', status: 'idle', capabilities: { native: {}, tasks: { stop: async () => false }, images: { limits: {
      mediaTypes: ['image/png'], maxImageBytes: 1024 * 1024, maxImagesPerMessage: 4,
      maxMessageImageBytes: 4 * 1024 * 1024, maxImageDimension: 1024, maxImagePixels: 1024 * 1024,
    } } },
    history: async () => [],
    subscribe(listener) { receive = listener; return () => { receive = undefined } },
    submit: async input => { submitted.push(input.text); return { accepted: false } },
    cancel: async () => {
      cancelCalls++
      receive?.([{ type: 'turn.end', turn: 1, reason: { kind: 'aborted' }, time: Date.now() }], { replay: false })
      return { stillQueued: [], outcome: 'confirmed' }
    },
    dispose: async () => undefined,
  }
  const channel = createChannel(host, session, {
    model: 'fixture-model', provider: '', cwd: session.cwd,
    activity: false, whale: false, smoothStreaming: false,
    openSession: async () => ({ ...session, ref: { ...session.ref, sessionId: 'second-modal-session' } }),
  })
  const send = (...events: AgentEvent[]) => {
    if (!receive) throw new Error('modal fixture is not subscribed')
    receive(events, { replay: false })
  }
  return {
    channel, submitted,
    get cancelCalls() { return cancelCalls },
    beginTurn() { send({ type: 'turn.start', turn: 1, time: Date.now() }) },
    endTurn() { send({ type: 'turn.end', turn: 1, reason: { kind: 'completed' }, time: Date.now() }) },
    reply(text: string) {
      const seq = ++sequence
      send({ type: 'assistant.message', seq, anchor: `modal-${seq}`, attemptId: `modal-${seq}`, time: Date.now(), blocks: [{ type: 'text', text }], canonical: true })
    },
    cleanup() { channel.releaseContributions() },
  }
}
