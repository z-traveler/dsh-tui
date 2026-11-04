import React from 'react'
import { Box, Text, useAnimationFrame, useTerminalSize } from '../ui.js'
import { truncateToWidth } from '../ink/truncateToWidth.js'
import { stringWidth } from '../ink/stringWidth.js'
import { formatDuration, formatTokens } from '../terminal-utils/format.js'
import { TooltipTarget } from '../components/Tooltip.js'
import { t, tOr } from '../i18n.js'
import type { ChannelUi } from '../adapter/channel/ui-policy.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const VERBS: Record<string, string> = { requesting: 'connecting', thinking: 'thinking', responding: 'responding', 'tool-use': 'checking', 'tool-input': 'working' }

export function PowerlineWorking({ channel, line, suffix, uploadTokens, elapsed }: {
  channel: ChannelUi
  line?: string
  suffix?: string
  uploadTokens: number
  elapsed: () => number
}): React.ReactNode {
  const [ref, time] = useAnimationFrame(80)
  const { columns } = useTerminalSize()
  const timer = formatDuration(Math.max(0, elapsed()))
  const verb = VERBS[channel.spinnerMode] ?? 'working'
  const text = line || `${tOr(`spinner-verb-${verb}`, verb)}…`
  const counters = channel.statusBar.workingCounters
    ? `${uploadTokens > 0 ? `↑ ${formatTokens(uploadTokens)} · ` : ''}↓ ${formatTokens(Math.round(channel.responseChars / 4))}`
    : undefined
  const tail = ` ${timer}${counters ? ` · ${counters}` : ''} · ${t(channel.cancelPending ? 'statusline-hint-interrupting' : 'statusline-hint-working')}`
  const phase = `${text}${suffix ? ` · ${suffix}` : ''}`
  const budget = Math.max(0, columns - 3 - stringWidth(tail))
  const shown = stringWidth(phase) > budget ? `${truncateToWidth(phase, Math.max(0, budget - 1))}…` : phase
  return <TooltipTarget content={phase}><Box ref={ref} marginTop={1} marginBottom={1} paddingLeft={1} width="100%" height={1} overflow="hidden">
    <Text wrap="truncate-end"><Text color="accent">{FRAMES[Math.floor(time / 80) % FRAMES.length]} </Text>
      <Text dimColor>{shown}{tail}</Text>
    </Text>
  </Box></TooltipTarget>
}
