/** Real demo keyboard + real DSH workflow-member projection; no model calls.
 * node --import tsx/esm scripts/downstream/verify-subagent-dock-scenes.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
process.env.DSH_HOME = `${process.env.HOME}/.dsh`
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, ui, { Terminal }, { activateModernEmojiWidths }, { settled, viewportLines }, { SubagentDockDemoScene }, { workflowDockFixture }, { applyCardStyles }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('@xterm/headless'), import('../lib/modern-widths.mjs'), import('../lib/term-test.mjs'),
  import('./subagent-dock-demo-scene.js'), import('./subagent-workflow-fixture.js'), import('../../src/cardStyles.js'),
])
const workflow = workflowDockFixture()
try {
  workflow.beginTurn()
  assert.equal(workflow.channel.subagents.find(agent => agent.agentId === 'WF_PLAN')?.provider, 'workflow')
  workflow.toolStart('WF_PLAN', 'Read', '{"path":"demo.ts"}')
  assert.equal(workflow.channel.subagents.find(agent => agent.agentId === 'WF_PLAN')?.toolCalls.at(-1)?.status, 'running')
  workflow.toolEnd('WF_PLAN')
  assert.equal(workflow.channel.subagents.find(agent => agent.agentId === 'WF_PLAN')?.toolCalls.at(-1)?.status, 'completed')
  workflow.toolStart('WF_PLAN', 'Grep', '{"pattern":"TODO"}')
  workflow.advance()
  assert.ok(workflow.channel.subagents.find(agent => agent.agentId === 'WF_PLAN')?.toolCalls.every(tool => tool.status === 'completed'))
  assert.equal(workflow.channel.subagents.find(agent => agent.agentId === 'WF_PLAN')?.status, 'completed')
  assert.deepEqual(workflow.channel.subagents.filter(agent => agent.status === 'running').map(agent => agent.agentId), ['WF_REVIEW_A', 'WF_REVIEW_B'])
  assert.ok(await settled(() => workflow.channel.subagents.find(agent => agent.agentId === 'WF_REVIEW_A')?.output.some(text => text.includes('phase started')) === true))
  for (let i = 0; i < 12; i++) workflow.start(`WF_EXTRA_${i}`)
  assert.equal(workflow.channel.subagents.filter(agent => agent.status === 'running').length, 14)
  workflow.advance()
  assert.deepEqual(workflow.channel.subagents.filter(agent => agent.status === 'running').map(agent => agent.agentId), ['WF_MERGE'])
  assert.equal(workflow.channel.subagents.filter(agent => agent.status === 'completed').length, 15)
  workflow.finish()
  assert.equal(workflow.channel.subagents.filter(agent => agent.status === 'running').length, 0)
  console.log('PASS real workflow member events project plan → parallel review → merge → completed')
} finally { await workflow.cleanup() }
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const fullscreen of [false, true]) {
  applyCardStyles({ preset: 'pi-like' })
  const terminal = new Terminal({ cols: 100, rows: 40, scrollback: 300, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  class Output extends Writable { columns = 100; rows = 40; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input()
  const pending: Promise<unknown>[] = []
  const scene = <SubagentDockDemoScene fullscreen={fullscreen} onExit={() => undefined} onCleanup={promise => pending.push(promise)} />
  const instance = await ui.render(fullscreen ? <ui.AlternateScreen>{scene}</ui.AlternateScreen> : scene,
    { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const frame = () => viewportLines(terminal, 40).join('\n')
  const press = (key: string) => input.write(`\x1b${key}`)
  try {
    assert.ok(await settled(() => frame().includes('DOCK_TASK_Review') && frame().includes('DOCK_TASK_Tests')), frame())
    assert.ok(frame().includes('Alt+6 single'), 'scene shortcuts must stay in the visible viewport')
    assert.ok(await settled(() => frame().includes('Read (')), 'parallel demo must provide a real projected tool row\n' + frame())
    press('6')
    assert.ok(await settled(() => frame().includes('DOCK_TASK_Solo') && !frame().includes('DOCK_TASK_Review')), frame())
    assert.ok(await settled(() => frame().includes('Read (')), frame())
    assert.ok(await settled(() => /✓Read/.test(frame())), 'Read must complete\n' + frame())
    assert.ok(await settled(() => /✓Read.*Grep/.test(frame())), 'next tool must show beside the previous completed call\n' + frame())
    press('7')
    assert.ok(await settled(() => frame().includes('DOCK_TASK_Review') && frame().includes('DOCK_TASK_Tests') && !frame().includes('DOCK_TASK_Solo')), frame())
    press('8')
    assert.ok(await settled(() => frame().includes('WF_PLAN') && frame().includes('Workflow: Plan')), frame())
    assert.ok(await settled(() => frame().includes('Read (')), 'workflow child events must supply the tool row\n' + frame())
    press('9')
    assert.ok(await settled(() => frame().includes('WF_REVIEW_A') && frame().includes('WF_REVIEW_B') && frame().includes('Workflow: Parallel review')), frame())
    press('2')
    assert.ok(await settled(() => frame().includes('14 running') && frame().includes('8 folded')), frame())
    press('9')
    assert.ok(await settled(() => frame().includes('WF_MERGE') && frame().includes('Workflow: Merge')), frame())
    press('3')
    assert.ok(await settled(() => frame().includes('Workflow: Completed')), frame())
    press('4')
    assert.ok(await settled(() => frame().includes('Workflow: Plan') && frame().includes('WF_PLAN') && !frame().includes('WF_MERGE')), frame())
    press('5')
    assert.ok(await settled(() => frame().includes('pi-like + border/padding')), frame())
    press('7')
    assert.ok(await settled(() => frame().includes('DOCK_TASK_Review') && !frame().includes('WF_PLAN')), frame())
    console.log(`PASS ${fullscreen ? 'fullscreen' : 'inline'}: default parallel; Alt+6/7/8 scene isolation; Alt+9 workflow advance; finish/restart/style`)
  } finally { await instance.unmount(); await Promise.all(pending); terminal.dispose(); input.destroy() }
}
