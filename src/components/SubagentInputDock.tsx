import React from 'react'
import { Box, Text, useTerminalSize } from '../ui.js'
import type { SubagentState } from '../adapter/ports/channel-view.js'
import { t } from '../i18n.js'
import { SubagentMessage } from './Chat/SubagentMessage.js'
import { subagentMessageHeight, subagentMessageContentRows, type SubagentCardDensity } from './Chat/subagentDockLayout.js'
import { CardContent, cardMarginTop, useCardSurface } from './cardSurface.js'

/** Relocate the original live card presentation; the transcript keeps a
 * static reference. The backend still owns every fact and history anchor. */
export function SubagentInputDock({ subagents, activityFrames, onOpen, onOpenView, onOpenDashboard }: {
  subagents: readonly SubagentState[]
  activityFrames?: string
  onOpen(agentId: string): void
  onOpenView(agentId: string): void
  onOpenDashboard(): void
}): React.ReactNode {
  const { rows } = useTerminalSize()
  const surface = useCardSurface('subagent', { status: 'running' })
  const live = subagents.filter(agent => agent.status === 'starting' || agent.status === 'running')
  if (live.length === 0) return null
  const budget = Math.max(1, Math.min(8, Math.floor(rows / 4), rows - 12))
  const densities: readonly SubagentCardDensity[] = ['full', 'compact', 'collapsed']
  // Border, padding and breathing gap belong to the whole group, never each agent.
  const gap = cardMarginTop(false, surface.style)
  const chrome = subagentMessageHeight(surface.style, 'collapsed') - 1
  const available = budget - chrome
  const density = densities.find(value => live.length * subagentMessageContentRows(value) <= available) ?? 'collapsed'
  const cardRows = subagentMessageContentRows(density)
  const count = live.length * cardRows <= available ? live.length : Math.max(0, Math.floor((available - 1) / cardRows))
  // A count is not a substitute task card: when chrome cannot fit, this row
  // opens the existing dashboard, where every task remains available.
  const summary = <Box height={1} flexShrink={0} backgroundColor={count === 0 ? surface.backgroundColor : undefined} paddingX={count === 0 ? surface.box.paddingX : 0} onClick={onOpenDashboard}>
    <Text dimColor wrap="truncate-end">{count === 0
      ? t('subagent-dock-summary', { count: live.length })
      : t('subagent-dock-hidden', { total: live.length, visible: count, count: live.length - count })}</Text>
  </Box>
  if (count === 0) return summary
  return <Box {...surface.box} flexDirection="column" flexShrink={0} marginTop={gap}
    height={count * cardRows + (count < live.length ? 1 : 0) + chrome - gap}>
    <CardContent surface={surface}>
    {live.slice(0, count).map(agent => <SubagentMessage
      key={agent.agentId} subagent={agent} marginTopOnTurn={false} activityFrames={activityFrames}
      isExpanded={density !== 'collapsed'} density={density} grouped
      onClick={() => onOpen(agent.agentId)} onOpenView={() => onOpenView(agent.agentId)}
    />)}
    {count < live.length && summary}
    </CardContent>
  </Box>
}
