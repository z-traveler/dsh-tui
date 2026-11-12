import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { createChannel } from '../../src/dsh-adapter/channel.js'

/** Fake published children, real DSH workflow-member event projection.
 * No workflow tool/model is executed; phases are advanced by the demo user. */
export function workflowDockFixture() {
  const ctx = new Context()
  const children = new Map<string, { status: string; session: { id: string; seq: number; events: unknown[]; header: Record<string, unknown> } }>()
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('agents', { get: (id: string) => children.get(id) })
  const session = { id: 'workflow-demo-parent', seq: 0, events: [] as unknown[], header: {} }
  const parent = { id: 'workflow-demo-parent', status: 'idle', options: {}, ctx, session, followup() {}, steer() {}, inbox: { remove() {} } }
  const scope = createScope(ctx, parent)
  parent.ctx = scope.ctx
  const channel = createChannel(ctx, parent as never, {
    model: 'fixture-model', provider: 'fixture', cwd: '/tmp/workflow-demo', activity: false, whale: false, smoothStreaming: false, subagentInputDock: true,
  })
  const phases = [
    { label: 'Plan', ids: ['WF_PLAN'] },
    { label: 'Parallel review', ids: ['WF_REVIEW_A', 'WF_REVIEW_B'] },
    { label: 'Merge', ids: ['WF_MERGE'] },
  ]
  const members = new Map<string, number>()
  const runningTools = new Map<string, string>()
  let toolSeq = 0
  let phase = 0
  const emit = (target: typeof session, type: string, data: unknown) => {
    const event = { type, data, seq: target.seq++, time: Date.now() }
    target.events.push(event)
    ;(ctx as unknown as { emit(...args: unknown[]): void }).emit(scopeTarget({}, parent), 'session/event', target, event)
  }
  const phaseLabel = () => phases[phase]?.label
    ?? ([...children.values()].some(child => child.status === 'running') ? 'Parallel extension' : 'Completed')
  const startMember = (id: string) => {
    const seq = members.size
    members.set(id, seq)
    children.set(id, { status: 'running', session: { id, seq: 0, events: [], header: { origin: 'subagent', parentSession: session.id } } })
    emit(session, 'tool-workflow/agent-start', { runId: 'dock-workflow', seq, childId: id, label: id, phase: phaseLabel() })
    emit(children.get(id)!.session, 'assistant/chunk', { chunk: { type: 'text-delta', text: `${phaseLabel()}: phase started\n` } })
  }
  const startPhase = () => { for (const id of phases[phase]?.ids ?? []) startMember(id) }
  const toolEnd = (id: string) => {
    const callId = runningTools.get(id)
    if (callId === undefined) return
    emit(children.get(id)!.session, 'tool/result', { message: { source: { callId }, content: [{ type: 'text', text: 'Simulated tool completed; no file or command was executed.' }] } })
    runningTools.delete(id)
  }
  const end = (id: string) => {
    const child = children.get(id)
    if (child?.status !== 'running') return
    toolEnd(id)
    child.status = 'idle'
    emit(session, 'tool-workflow/agent-end', { runId: 'dock-workflow', seq: members.get(id), outcome: 'completed' })
  }
  return {
    channel,
    toolStart(id: string, name: string, args: string) {
      toolEnd(id)
      const callId = `workflow-demo-tool:${++toolSeq}`
      runningTools.set(id, callId)
      emit(children.get(id)!.session, 'tool/call', { callId, name, arguments: args })
    },
    toolEnd,
    beginTurn: startPhase,
    phaseLabel,
    start: startMember,
    advance() {
      for (const id of children.keys()) end(id)
      phase = Math.min(phases.length, phase + 1)
      startPhase()
    },
    finish() { for (const id of children.keys()) end(id); phase = phases.length },
    progress(id: string, text: string) {
      const child = children.get(id)
      if (child?.status === 'running') emit(child.session, 'assistant/chunk', { chunk: { type: 'text-delta', text: `${text}\n` } })
    },
    reply(text: string) { emit(session, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text }] } }) },
    async cleanup() { channel.releaseContributions(); await scope.dispose(); await ctx.fiber.dispose() },
  }
}
