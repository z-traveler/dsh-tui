import type { AgentSession } from '../../src/agent/session.js'
import type { AgentEvent } from '../../src/agent/events.js'
import { createChannel } from '../../src/dsh-adapter/channel.js'
import Schema from '@deepseek-ai/schemastery'
import { configValues } from '../../src/dsh-adapter/compat/settings.js'
import { createTuiSettingsService } from '../../src/dsh-adapter/tui-settings.js'
import { getLocalSettingsSectionsHost } from '../../src/dsh-adapter/settings-sections.js'
import { SETTING_GROUPS, settingField } from '../../src/settings/definitions.js'
import { writeTuiSettings } from '../../src/tuiSettingsFile.js'

let fixtureId = 0

/** Shared by the mounted regression and the credential-free human demo. */
export function subagentDockFixture(enabled = true) {
  let receive: Parameters<AgentSession['subscribe']>[0] | undefined
  let seq = 0
  const session: AgentSession = {
    ref: { backendId: 'codex', sessionId: 'dock-demo' }, cwd: '/tmp/dock-demo', status: 'idle', capabilities: { native: {}, subagents: { interrupt: async () => true } },
    history: async () => [],
    subscribe: listener => { receive = listener; return () => { receive = undefined } },
    submit: async () => ({ accepted: false }), cancel: async () => ({ stillQueued: [], outcome: 'confirmed' }), dispose: async () => undefined,
  }
  const file = `${process.env.HOME}/dock-fixture-${++fixtureId}.json`
  writeTuiSettings({ version: 1, values: { subagentInputDock: enabled } }, file)
  const settings = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'fixture', keys: ['subagentInputDock'] })
  // The production local settings service uses the non-volatile scope schema;
  // Config itself wraps editable fields for a modern Cordis Loader.
  const scope = settings.register('dsh-tui', Schema.object({ subagentInputDock: Schema.boolean() }))
  const host = { on: () => () => undefined, get: (name: string) => name === 'settings' ? settings : undefined, logger: { warn() {}, info() {}, debug() {} } }
  const unregister = getLocalSettingsSectionsHost(host as never).register({ ns: 'dsh-tui', title: 'TUI', groups: [...SETTING_GROUPS], fields: [settingField('subagentInputDock')] })
  const channel = createChannel(host as never, session, {
    model: 'fixture-model', provider: '', cwd: session.cwd, activity: false, whale: false, smoothStreaming: false,
    subagentInputDock: enabled, openSession: async () => ({ ...session, ref: { ...session.ref, sessionId: 'empty-session' } }),
  })
  const unwatch = scope.watch(value => channel.setSubagentInputDock(configValues(value).subagentInputDock ?? enabled))
  const send = (...events: AgentEvent[]) => {
    if (receive === undefined) throw new Error('fixture session not started')
    receive(events, { replay: false })
  }
  const runningTools = new Map<string, string>()
  const toolEnd = (id: string) => {
    const callId = runningTools.get(id)
    if (callId === undefined) return
    send({ type: 'tool.result', seq: ++seq, turn: 1, step: 1, callId, parentCallId: `demo-lane:${id}`, isError: false, time: Date.now(), content: [], text: 'Simulated tool completed; no file or command was executed.' })
    runningTools.delete(id)
  }
  return {
    channel,
    toolStart(id: string, name: string, args: string) {
      toolEnd(id)
      const callId = `demo-tool:${++seq}`
      runningTools.set(id, callId)
      send({ type: 'tool.call', seq, turn: 1, step: 1, callId, parentCallId: `demo-lane:${id}`, name, argsJson: args, time: Date.now() })
    },
    toolEnd,
    cleanup() { unwatch(); unregister(); channel.releaseContributions() },
    beginTurn() { send({ type: 'turn.start', turn: 1, time: Date.now() }) },
    endTurn() { send({ type: 'turn.end', turn: 1, reason: { kind: 'completed' }, time: Date.now() }) },
    start(id: string) { send({ type: 'subagent.start', agentId: id, parentCallId: `demo-lane:${id}`, description: `DOCK_TASK_${id}`, background: true, time: Date.now() }) },
    progress(id: string, text: string) { send({ type: 'subagent.progress', agentId: id, summary: text }) },
    end(id: string, status: 'completed' | 'failed' | 'cancelled' | 'unknown' = 'completed') { toolEnd(id); send({ type: 'subagent.end', agentId: id, status, time: Date.now(), summary: 'fixture finished' }) },
    reply(text: string) {
      seq++
      send({ type: 'assistant.message', seq, anchor: `demo-${seq}`, attemptId: `demo-${seq}`, time: Date.now(), blocks: [{ type: 'text', text }], canonical: true })
    },
  }
}
