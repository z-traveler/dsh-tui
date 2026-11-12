import React from 'react'
import { Box, Text, useAnimationFrame, useTerminalSize } from '../../ui.js'
import type { SubagentRow, SubagentState } from '../../adapter/ports/channel-view.js'
import type { Theme } from '../../theme.js'
import { t } from '../../i18n.js'
import { resolvePreset } from '../activityFrames.js'
import { toolNameColor } from '../messages/AssistantToolUseMessage.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { isMinimalUiMode } from '../../minimalUiMode.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import { CardBox, useCardSurface } from '../cardSurface.js'
import { compactStatusMarker } from '../compactStatusMarker.js'
import { THINKING_SPINNER_FRAMES, THINKING_SPINNER_INTERVAL_MS } from '../../terminal-utils/figures.js'
import { CARD_INDENT, subagentCardBudget } from './subagentCardBudget.js'
import { ActivityRow, subagentMessageBoxHeight, type SubagentCardDensity } from './subagentDockLayout.js'

/** The waterfall window is a Kimi Code style constant-height region. */
const WATERFALL_ROWS = 3
/** The `│ ` gutter prefix inside the content area. */
const WATERFALL_GUTTER = 4

function duration(ms = 0): string {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`
}
function tokens(row: Pick<SubagentRow, 'tokens'>): string {
  const total = row.tokens?.total ?? ((row.tokens?.input ?? 0) + (row.tokens?.output ?? 0) || 0)
  return total > 0 ? `${total} tok` : '- tok'
}
function status(row: Pick<SubagentRow, 'status'>): { glyph: string; label: string; color: keyof Theme | undefined } {
  const minimalUi = isMinimalUiMode()
  if (row.status === 'completed') return { glyph: minimalUi ? '✓' : '🟢', label: t('subagent-status-completed'), color: minimalUi ? undefined : 'success' }
  if (row.status === 'failed') return { glyph: minimalUi ? '×' : '🔴', label: t('subagent-status-failed'), color: minimalUi ? undefined : 'error' }
  if (row.status === 'cancelled') return { glyph: minimalUi ? '×' : '🔴', label: t('subagent-status-cancelled'), color: minimalUi ? undefined : 'error' }
  // No end was ever reported (the run's process is gone): settled, unknown.
  if (row.status === 'unknown') return { glyph: minimalUi ? '·' : '⚪', label: t('subagent-status-unknown'), color: minimalUi ? undefined : 'subtle' }
  return { glyph: minimalUi ? '·' : '🟡', label: t('subagent-status-running'), color: minimalUi ? undefined : 'warning' }
}
/** Hard single-line clip by display width — a wrapped waterfall row would
 * break the constant-height window. */
function clipLine(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return ''
  let width = 0
  let index = 0
  while (index < text.length) {
    // Advance by the next full code point so wide glyphs (CJK, emoji) are
    // never split in half.
    const next = text.codePointAt(index)!
    const char = String.fromCodePoint(next)
    const charWidth = char === '\r' || char === '\n' ? 1 : stringWidth(char)
    if (width + charWidth > maxWidth - 1) break
    width += charWidth
    index += char.length
  }
  // Normalize only the visible prefix: a long streamed reply must not be
  // scanned/allocated in full on every animation tick. Newlines occupy a space.
  const visible = text.slice(0, index).replace(/[\r\n]/g, ' ')
  return index < text.length ? `${visible}…` : visible
}

/**
 * Borderless, fixed-height activity card embedded directly in the transcript
 * (Kimi Code visual language). Running: header + one-line current tool + a
 * constant 3-row waterfall (each row hard-clipped to one terminal line so
 * the card height never changes). Settled: folds to the header line alone
 * (failure keeps one error line). Legacy's running glyph reuses the user's
 * working-activity preset (`/activity`), so the indicator follows the same
 * setting as the main spinner. Pi-like always uses a single-cell braille spinner.
 */
export function SubagentMessage({ subagent, marginTopOnTurn, activityFrames, onClick, onOpenView, density, grouped = false }: {
  subagent: SubagentRow | SubagentState
  /** Absent = unchanged transcript card; dock densities use this same renderer. */
  density?: SubagentCardDensity
  /** The dock owns the single surrounding surface and already narrowed its columns. */
  grouped?: boolean
  marginTopOnTurn: boolean
  activityFrames?: string
  isExpanded: boolean
  onClick?(event: ClickEvent): void
  /** 在主屏打开子代理转录：与卡片点击（→ 详情）并列的独立动作；拦截冒泡，
   *  普通正文点击与选区不受影响。 */
  onOpenView?(): void
}): React.ReactNode {
  const settled = subagent.status === 'completed' || subagent.status === 'failed' || subagent.status === 'cancelled' || subagent.status === 'unknown'
  // 动画订阅仅限运行中的卡片：settled 后传 null 退出共享 clock（keepAlive
  // 归零 → interval 清除），否则历史里的每张完成卡片都以 120ms 永久驱动
  // React commit。viewportRef 必须挂到根节点——useTerminalViewport 初始
  // isVisible:true，ref 不挂就永远不修正（虚拟化滚出视口的卡片继续动画）。
  // The card's face follows the reported status: a cancel/unknown run keeps the
  // ordinary face and its own glyph (cardStatusOf maps neither).
  const card = useCardSurface('subagent', { status: subagent.status })
  const size = useTerminalSize()
  const columns = grouped ? size.columns : card.columns
  const piLike = card.preset === 'pi-like'
  const [viewportRef, time] = useAnimationFrame(settled ? null : piLike ? THINKING_SPINNER_INTERVAL_MS : 120)
  const info = { ...status(subagent), ...(piLike ? compactStatusMarker(subagent.status, isMinimalUiMode()) : {}) }
  const [hovered, setHovered] = React.useState(false)
  const clickable = onClick !== undefined
  const elapsed = subagent.completedAt
    ? 'outputLines' in subagent ? subagent.durationMs : subagent.completedAt - subagent.startedAt
    : Date.now() - subagent.startedAt
  const lastRunning = [...subagent.toolCalls].reverse().find(tool => tool.status === 'running')
  const previousDone = lastRunning
    ? subagent.toolCalls[subagent.toolCalls.indexOf(lastRunning) - 1]
    : subagent.toolCalls[subagent.toolCalls.length - 1]
  const preset = React.useMemo(() => resolvePreset(activityFrames), [activityFrames])
  const waterfallRows = density === 'collapsed' ? 0 : density === 'compact' ? 1 : WATERFALL_ROWS
  const output = 'outputLines' in subagent ? subagent.outputLines : subagent.output
  const activity = settled || waterfallRows === 0 ? [] : output.slice(-waterfallRows)
  const runningGlyph = piLike
    ? THINKING_SPINNER_FRAMES[Math.floor(time / THINKING_SPINNER_INTERVAL_MS) % THINKING_SPINNER_FRAMES.length]!.trimStart()
    : preset.frames[Math.floor(time / preset.intervalMs) % preset.frames.length] ?? '·'
  const { indent, compact, headerWrap, showStatus, showModel, showCounts } = subagentCardBudget(card, columns, { grouped, docked: density !== undefined })
  const rowWidth = Math.max(20, (columns ?? 80) - indent - WATERFALL_GUTTER)
  const statusGlyph = <Text color={hovered && clickable ? 'accent' : info.color}>{settled ? info.glyph : piLike ? runningGlyph : ` ${runningGlyph}`}</Text>

  // 点击打开详情场景；hover 不刷整行背景（转录视觉保持安静），只把状态
  // glyph 提亮为品牌色作为可点指示。
  return <CardBox surface={grouped ? undefined : card}
    flexDirection="column"
    marginTop={grouped ? 0 : marginTopOnTurn ? 1 : 0}
    flexShrink={density === undefined ? undefined : 0}
    height={subagentMessageBoxHeight(card.style, density, grouped)}
    // The card's own indent is content, not surface: it rides on top of the
    // configured horizontal padding (which already narrowed `columns`).
    paddingLeft={grouped ? CARD_INDENT : card.box.paddingX + CARD_INDENT}
    ref={viewportRef}
    onClick={onClick}
    onMouseEnter={clickable ? () => setHovered(true) : undefined}
    onMouseLeave={clickable ? () => setHovered(false) : undefined}
  >
    <Box flexDirection="row" gap={1} height={compact ? 1 : undefined}>
      {compact ? <Box flexShrink={0}>{statusGlyph}</Box> : statusGlyph}
      <Text wrap={headerWrap} bold color={hovered && clickable ? 'accent' : undefined}>{`${t('subagent-card-prefix')}${subagent.description}`}</Text>
      {showModel && <>
        <Text dimColor>·</Text><Text wrap={headerWrap}>{subagent.model ?? subagent.provider ?? 'default'}</Text>
        {subagent.effort && <><Text dimColor>·</Text><Text wrap={headerWrap} dimColor>{subagent.effort}</Text></>}
        <Text dimColor>·</Text><Text wrap={headerWrap} dimColor>{duration(elapsed)}</Text>
      </>}
      {showCounts && <>
        <Text dimColor>·</Text><Text wrap={headerWrap} dimColor>{tokens(subagent)}</Text>
        <Text dimColor>·</Text><Text wrap={headerWrap} dimColor>{subagent.toolCalls.length} tools</Text>
      </>}
      {showStatus && <><Text dimColor>·</Text><Text wrap={headerWrap} color={info.color}>{info.label}</Text></>}
      {onOpenView !== undefined && (
        <Box
          flexShrink={0}
          marginLeft={1}
          onClick={(event: ClickEvent) => {
            // 拦截冒泡：这一格是「主屏查看」，不是卡片点击（→详情）。
            event.stopImmediatePropagation()
            onOpenView()
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* 字形位（与面板 ⤢ 全屏同一词汇）：卡片行是恒定高度的水流行，
              长标签会把状态列顶折行；完整名称留给 Dashboard/Detail 入口。 */}
          <Text color={hovered ? 'accent' : 'subtle'}>{'⤢'}</Text>
        </Box>
      )}
    </Box>
    {!settled && density !== 'collapsed' && (lastRunning ?? previousDone) !== undefined && (
      <ActivityRow fixed={density !== undefined}><Text wrap="truncate">
        {lastRunning !== undefined ? (
          <>
            {previousDone !== undefined && (
              <>
                <Text dimColor>{'  · '}</Text>
                <Text color="success">✓</Text>
                <Text color={toolNameColor(previousDone.name)}>{previousDone.name}</Text>
                <Text dimColor>{' · '}</Text>
              </>
            )}
            {lastRunning.argsPreview === undefined && (
              <Text color={toolNameColor(lastRunning.name)}>{lastRunning.name}</Text>
            )}
            {lastRunning.argsPreview !== undefined && (
              <>
                <Text color={toolNameColor(lastRunning.name)}>{lastRunning.name}</Text>
                <Text dimColor>{` (${clipLine(lastRunning.argsPreview.replace(/\s+/g, ' ').trim(), Math.max(10, rowWidth - lastRunning.name.length - 6))})`}</Text>
              </>
            )}
          </>
        ) : (
          previousDone !== undefined && (
            <>
              <Text dimColor>{'  · '}</Text>
              <Text color="success">✓</Text>
              <Text color={toolNameColor(previousDone.name)}>{previousDone.name}</Text>
              {previousDone.argsPreview !== undefined && (
                <Text dimColor>{` (${clipLine(previousDone.argsPreview.replace(/\s+/g, ' ').trim(), Math.max(10, rowWidth - previousDone.name.length - 6))})`}</Text>
              )}
            </>
          )
        )}
      </Text></ActivityRow>
    )}
    {!settled && Array.from({ length: waterfallRows }, (_, index) => (
      // key 不含 time：含 time 的 key 让每个 animation tick 都变成
      // unmount+mount，DOMElement/Yoga node churn 且 nodeCache 失配扩大
      // terminal damage。内容更新走 in-place diff。
      <ActivityRow key={`${subagent.agentId}-wf-${index}`} fixed={density !== undefined}>
        <Text dimColor wrap="truncate">{`  │ ${clipLine(activity[index] ?? '', rowWidth)}`}</Text>
      </ActivityRow>
    ))}
    {/* Keep replies next to the header when there is no tool. The spare slot
        trails them, keeping the input and following agents stable on tool start. */}
    {!settled && density !== undefined && density !== 'collapsed' && (lastRunning ?? previousDone) === undefined && <Box height={1} flexShrink={0} />}
    {settled && subagent.status === 'failed' && subagent.error && (
      <Text color="error" wrap="truncate">{`  └ ${clipLine(subagent.error, rowWidth)}`}</Text>
    )}
  </CardBox>
}
