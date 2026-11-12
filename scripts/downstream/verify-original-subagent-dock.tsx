/** Original subagent card relocation, not a second compact view.
 * node --import tsx/esm scripts/downstream/verify-original-subagent-dock.tsx */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
process.env.DSH_HOME = `${process.env.HOME}/.dsh`
process.env.DSH_TUI_LANG = 'en'
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
const [React, ui, { Terminal }, { activateModernEmojiWidths }, { settled, viewportLines, findText, sleep }, { SubagentDockDemoScene }, { applyCardStyles }, { subagentDockFixture }, { Chat }, { QuestionStore }, { ApprovalStore }] = await Promise.all([
  import('react'), import('../../src/ui.js'), import('@xterm/headless'), import('../lib/modern-widths.mjs'), import('../lib/term-test.mjs'),
  import('./subagent-dock-demo-scene.js'), import('../../src/cardStyles.js'), import('./subagent-dock-fixture.js'),
  import('../../src/screens/Chat.js'), import('../../src/dsh-adapter/questions.js'), import('../../src/dsh-adapter/approvals.js'),
])
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const preset of ['legacy', 'pi-like'] as const) for (const fullscreen of [false, true]) {
  applyCardStyles({ preset })
  const terminal = new Terminal({ cols: 100, rows: 40, scrollback: 400, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  class Output extends Writable { columns = 100; rows = 40; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input(), pending: Promise<unknown>[] = []
  const scene = <SubagentDockDemoScene fullscreen={fullscreen} initialStyle={preset === 'legacy' ? 0 : 1} onExit={() => undefined} onCleanup={promise => pending.push(promise)} />
  const app = await ui.render(fullscreen ? <ui.AlternateScreen>{scene}</ui.AlternateScreen> : scene,
    { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => viewportLines(terminal, 40)
  const frame = () => lines().join('\n')
  const press = (key: string) => input.write(`\x1b${key}`)
  const tag = `${preset}/${fullscreen ? 'fullscreen' : 'inline'}`
  const assertOriginalPinned = (id: string, activityRows: number) => {
    const rows = lines(), main = rows.findLastIndex(line => line.includes('MAIN_REPLY_tick_'))
    const headers = rows.map((line, index) => line.includes(`Subagent: ${id}`) ? index : -1).filter(index => index >= 0)
    assert.equal(headers.length, 1, `${tag}: exactly one ORIGINAL card for ${id}\n${frame()}`)
    const at = headers[0]!, prompt = rows.findIndex(line => line.includes('⌸ ❯'))
    assert.ok(at > main && at < prompt, `${tag}: original card must remain below newer main output\n${frame()}`)
    assert.ok(rows[at]!.includes('⤢'), `${tag}: original view action survives`)
    if (activityRows > 0) assert.equal(rows.slice(at + 1, at + 2 + activityRows).filter(line => line.includes('│')).length, activityRows, `${tag}: every original waterfall row survives\n${frame()}`)
  }
  try {
    assert.ok(await settled(() => frame().includes('DOCK_TASK_Review') && frame().includes('DOCK_TASK_Tests')))
    press('8')
    assert.ok(await settled(() => frame().includes('Workflow: Plan')))
    press('9')
    assert.ok(await settled(() => frame().includes('Workflow: Parallel review') && frame().includes('MAIN_REPLY_tick_2')), frame())
    assertOriginalPinned('WF_REVIEW_A', 1)
    assertOriginalPinned('WF_REVIEW_B', 1)
    assert.ok(frame().includes('Subagent reference: WF_REVIEW_A'), `${tag}: static history reference replaces live card`)
    const first = lines().findIndex(line => line.includes('Subagent: WF_REVIEW_A'))
    input.write('CHECK_DRAFT')
    assert.ok(await settled(() => frame().includes('CHECK_DRAFT')))
    assert.equal(lines().findIndex(line => line.includes('Subagent: WF_REVIEW_A')), first)
    if (fullscreen) {
      const hit = findText(terminal, '⤢')
      assert.ok(hit)
      input.write(`\x1b[<0;${hit.col + 1};${hit.row + 1}M`)
      await sleep(30) // 固定窗:pacing 鼠标 press→release 步间
      input.write(`\x1b[<0;${hit.col + 1};${hit.row + 1}m`)
      assert.ok(await settled(() => frame().includes('Agent transcript') && !frame().includes('CHECK_DRAFT')), frame())
      input.write('\x1b')
      await sleep(80) // 固定窗:pacing 既有 Agent View composer 先失焦、再退出
      input.write('\x1b')
      assert.ok(await settled(() => frame().includes('CHECK_DRAFT') && frame().includes('Workflow: Parallel review')), frame())
    }
    press('2')
    assert.ok(await settled(() => frame().includes('14 running') && frame().includes(preset === 'legacy' ? '7 folded' : '8 folded')), frame())
    assertOriginalPinned('WF_REVIEW_A', 0)
    assertOriginalPinned('WF_REVIEW_B', 0)
    press('9')
    assert.ok(await settled(() => frame().includes('Workflow: Merge') && frame().includes('Subagent: WF_MERGE')), frame())
    assertOriginalPinned('WF_MERGE', 3)
    assert.ok(!frame().includes('14 running'), `${tag}: advancing settles extra members too`)
    console.log(`PASS ${tag}: original workflow cards + one-line history references, pressure and stage settlement`)
  } finally { await app.unmount(); await Promise.all(pending); terminal.dispose(); input.destroy() }
}

for (const fullscreen of [false, true]) {
  applyCardStyles({ preset: 'pi-like' })
  const h = subagentDockFixture()
  const terminal = new Terminal({ cols: 100, rows: 40, scrollback: 300, allowProposedApi: true })
  activateModernEmojiWidths(terminal)
  class Output extends Writable { columns = 100; rows = 40; isTTY = true; _write(data: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(data), done) } }
  const output = new Output(), input = new Input()
  const node = <ui.ThemeProvider theme="dark"><Chat channel={h.channel as never} questionStore={new QuestionStore()} approvalStore={new ApprovalStore()} fullscreen={fullscreen} trajectorySeen onExit={() => undefined} /></ui.ThemeProvider>
  const app = await ui.render(fullscreen ? <ui.AlternateScreen>{node}</ui.AlternateScreen> : node,
    { stdout: output as never, stderr: output as never, stdin: input as never, patchConsole: false, exitOnCtrlC: false })
  const lines = () => viewportLines(terminal, 40)
  const frame = () => lines().join('\n')
  const reference = (id: string) => `Subagent reference: DOCK_TASK_${id}`
  try {
    h.beginTurn()
    for (let i = 0; i < 30; i++) h.reply(`REFERENCE_BASE_${i}`)
    h.start('REFERENCE')
    h.progress('REFERENCE', 'STATIC_REFERENCE_OLD_OUTPUT')
    assert.ok(await settled(() => frame().includes(reference('REFERENCE')) && frame().includes('STATIC_REFERENCE_OLD_OUTPUT')), frame())
    input.write('REF_DRAFT')
    assert.ok(await settled(() => frame().includes('REF_DRAFT')))
    const staticLine = lines().find(line => line.includes(reference('REFERENCE')))
    h.progress('REFERENCE', 'STATIC_REFERENCE_NEW_OUTPUT')
    assert.ok(await settled(() => frame().includes('STATIC_REFERENCE_NEW_OUTPUT')))
    assert.equal(lines().find(line => line.includes(reference('REFERENCE'))), staticLine, 'reference text never becomes live activity')
    if (fullscreen) {
      const hit = findText(terminal, reference('REFERENCE'))
      assert.ok(hit)
      input.write(`\x1b[<0;${hit.col + 1};${hit.row + 1}M`)
      await sleep(30) // 固定窗:pacing 静态引用的真实鼠标 press→release
      input.write(`\x1b[<0;${hit.col + 1};${hit.row + 1}m`)
      assert.ok(await settled(() => frame().includes('Summary') && !frame().includes('REF_DRAFT')), frame())
      input.write('\x1b')
      await sleep(80) // 固定窗:pacing 详情→面板→聊天的既有退出层次
      input.write('\x1b')
      assert.ok(await settled(() => frame().includes('REF_DRAFT')), frame())
    }
    const storedFacts = () => {
      const row = h.channel.rows.find(row => row.subagent?.agentId === 'REFERENCE')
      assert.ok(row?.subagent, 'history row must still exist')
      const subagent = structuredClone(row.subagent)
      // Elapsed projection time is not a persisted fact changed by a UI toggle.
      delete subagent.durationMs
      return { id: row.id, subagent }
    }
    const facts = storedFacts()
    await h.channel.settingsHost()!.write('dsh-tui', [{ op: 'set', path: ['subagentInputDock'], value: false }])
    h.reply('AFTER_UNPIN_CHECK')
    assert.ok(await settled(() => !frame().includes(reference('REFERENCE')) && frame().includes('AFTER_UNPIN_CHECK')), frame())
    assert.ok(lines().findIndex(line => line.includes('Subagent: DOCK_TASK_REFERENCE')) < lines().findIndex(line => line.includes('AFTER_UNPIN_CHECK')), frame())
    await h.channel.settingsHost()!.write('dsh-tui', [{ op: 'set', path: ['subagentInputDock'], value: true }])
    assert.ok(await settled(() => frame().includes(reference('REFERENCE')) && frame().includes('STATIC_REFERENCE_NEW_OUTPUT')), frame())
    assert.ok(lines().findIndex(line => line.includes('Subagent: DOCK_TASK_REFERENCE')) > lines().findIndex(line => line.includes('AFTER_UNPIN_CHECK')), frame())
    assert.deepEqual(storedFacts(), facts, 'presentation toggles never remove rows or rewrite session facts')
    h.end('REFERENCE')
    for (const status of ['completed', 'failed', 'cancelled', 'unknown'] as const) {
      const agent = `END_${status}`
      h.start(agent)
      assert.ok(await settled(() => frame().includes(reference(agent))), frame())
      h.end(agent, status)
      assert.ok(await settled(() => !frame().includes(reference(agent)) && frame().includes(`Subagent: DOCK_TASK_${agent}`)), frame())
      assert.equal(h.channel.rows.find(row => row.subagent?.agentId === agent)?.subagent?.status, status)
    }
    assert.ok(frame().includes('REF_DRAFT'), frame())
    console.log(`PASS ${fullscreen ? 'fullscreen' : 'inline'}: static reference, live toggle/cache remeasurement, preserved facts and every terminal state`)
  } finally { await app.unmount(); h.cleanup(); terminal.dispose(); input.destroy() }
}
