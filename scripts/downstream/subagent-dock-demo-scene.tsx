import React from 'react'
import { Box, Text, ThemeProvider, useInput, useTerminalSize } from '../../src/ui.js'
import { TerminalSizeContext } from '../../src/ink/components/TerminalSizeContext.js'
import { Chat } from '../../src/screens/Chat.js'
import { QuestionStore } from '../../src/dsh-adapter/questions.js'
import { ApprovalStore } from '../../src/dsh-adapter/approvals.js'
import { applyCardStyles, type CardStyleConfig } from '../../src/cardStyles.js'
import { applySidePanelOpen, applySidePanelPanels } from '../../src/tuiDisplayPrefs.js'
import { registerBuiltinPanels } from '../../src/components/sidePanel/builtinPanels.js'
import { subagentDockFixture } from './subagent-dock-fixture.js'
import { workflowDockFixture } from './subagent-workflow-fixture.js'

export const DEMO_STYLES: { label: string; config: CardStyleConfig }[] = [
  { label: 'legacy', config: { preset: 'legacy' } },
  { label: 'pi-like', config: { preset: 'pi-like' } },
  { label: 'pi-like + border/padding', config: { preset: 'pi-like', kinds: { subagent: { border: 'round', paddingX: 1, paddingY: 1, gap: 0 } } } },
]
type Scene = 'single' | 'parallel' | 'workflow'

/** Shared by the human entry and headless keyboard regression. Switching a
 * scene replaces the entire fake session, rather than piling more labels on it. */
export function SubagentDockDemoScene({ fullscreen, initialStyle = 1, onExit, onCleanup }: {
  fullscreen: boolean
  initialStyle?: number
  onExit(): void
  onCleanup(promise: Promise<unknown>): void
}) {
  const size = useTerminalSize()
  // Inline output needs its final cursor row; otherwise the first hint scrolls away.
  const viewportRows = Math.max(1, size.rows - (fullscreen ? 0 : 1))
  const [scene, setScene] = React.useState<Scene>('parallel')
  const [revision, setRevision] = React.useState(0)
  const [styleIndex, setStyleIndex] = React.useState(initialStyle)
  const [workflowLabel, setWorkflowLabel] = React.useState('Plan')
  const h = React.useMemo(() => scene === 'workflow'
    ? { kind: 'workflow' as const, ...workflowDockFixture() }
    : { kind: scene, ...subagentDockFixture() }, [scene, revision])
  const questions = React.useMemo(() => new QuestionStore(), [h])
  const approvals = React.useMemo(() => new ApprovalStore(), [h])
  const extraId = React.useRef(0)
  const startReadTools = () => {
    for (const agent of h.channel.subagents) if (agent.status === 'running' && agent.toolCalls.length === 0) h.toolStart(agent.agentId, 'Read', '{"path":"demo.ts"}')
  }
  React.useEffect(() => {
    registerBuiltinPanels()
    applySidePanelPanels('agents')
    applySidePanelOpen(false)
    h.beginTurn()
    if (h.kind === 'workflow') setWorkflowLabel(h.phaseLabel())
    else for (const id of h.kind === 'single' ? ['Solo'] : ['Review', 'Tests']) {
      h.start(id)
      h.progress(id, `${id}: reading files 中英混排`)
    }
    startReadTools()
    for (let i = 0; i < 40; i++) h.reply(`MAIN_REPLY_${i}: scroll up; the dock stays above input.`)
    let tick = 0
    const timer = setInterval(() => {
      tick++
      for (const agent of h.channel.subagents) if (agent.status === 'running') {
        if (tick % 2 === 1) h.toolEnd(agent.agentId)
        else h.toolStart(agent.agentId, tick % 4 === 0 ? 'Read' : 'Grep', tick % 4 === 0 ? '{"path":"demo.ts"}' : '{"pattern":"TODO","path":"demo.ts"}')
        h.progress(agent.agentId, `Live activity ${tick}: checking files 中英混排`)
      }
      h.reply(`MAIN_REPLY_tick_${tick}`)
    }, 1500)
    return () => { clearInterval(timer); onCleanup(Promise.resolve(h.cleanup())) }
  }, [h, onCleanup])
  useInput((input, key, event) => {
    if (key.ctrl && input === 'c') { event.stopImmediatePropagation(); onExit(); return }
    if (!key.meta || !['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(input)) return
    event.stopImmediatePropagation()
    if (input === '1') h.channel.setSubagentInputDock(!h.channel.subagentInputDock)
    if (input === '2') {
      for (let i = 0; i < 12; i++) h.start(`${h.kind === 'workflow' ? 'WF_EXTRA' : 'Extra'}_${++extraId.current}`)
      startReadTools()
      if (h.kind === 'workflow') setWorkflowLabel(h.phaseLabel())
    }
    if (input === '3') {
      if (h.kind === 'workflow') { h.finish(); setWorkflowLabel(h.phaseLabel()) }
      else for (const agent of h.channel.subagents) h.end(agent.agentId)
    }
    if (input === '4') setRevision(value => value + 1)
    if (input === '5') {
      const next = (styleIndex + 1) % DEMO_STYLES.length
      applyCardStyles(DEMO_STYLES[next]!.config)
      setStyleIndex(next)
    }
    if (input === '6' || input === '7' || input === '8') {
      setScene(input === '6' ? 'single' : input === '7' ? 'parallel' : 'workflow')
      setRevision(value => value + 1)
    }
    if (input === '9' && h.kind === 'workflow') { h.advance(); startReadTools(); setWorkflowLabel(h.phaseLabel()) }
  }, { prepend: true })
  return <ThemeProvider theme="dark">
    <Box flexDirection="column" height={viewportRows}>
      <Box flexDirection="column" flexShrink={0}>
        <Text wrap="truncate-end">{'Alt+6 single · Alt+7 parallel · Alt+8 workflow'}</Text>
        <Text dimColor wrap="truncate-end">{`${scene} · ${DEMO_STYLES[styleIndex]!.label} · Alt+5 style · Alt+2 +12 · Alt+3 finish`}</Text>
        <Text dimColor wrap="truncate-end">{'Alt+1 dock · Alt+4 restart scene · Ctrl+C exit'}</Text>
        {scene === 'workflow' && <Text wrap="truncate-end">{`Workflow: ${workflowLabel} · Alt+9 next phase`}</Text>}
      </Box>
      <TerminalSizeContext.Provider value={{ ...size, rows: Math.max(1, viewportRows - (scene === 'workflow' ? 4 : 3)) }}>
        <Chat key={`${scene}-${revision}`} channel={h.channel as never} questionStore={questions} approvalStore={approvals} fullscreen={fullscreen} trajectorySeen onExit={onExit} />
      </TerminalSizeContext.Provider>
    </Box>
  </ThemeProvider>
}
