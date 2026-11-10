/**
 * 对话卡片样式（下游 card-styles）在 transcript 列表上的接入：MessageList 用这里
 * 的行类型映射、折叠默认值、呼吸行、高度指纹，以及内联行的卡面根 Box。
 */
import React from 'react'
import { Box } from '../ui.js'
import type { ChatRow, JobRow } from '../dsh-adapter/channel.js'
import type { ToolBackground } from '../tuiDisplayPrefs.js'
import { cardRowDensity } from '../channel/card-row.js'
import { cardRowExpanded, type CardKind, type ResolvedCardStyles } from '../cardStyles.js'
import { CardContent, cardMarginTop, useCardStyles, type CardSurface } from './cardSurface.js'

/** Transcript row kind → card style kind (cardStyles.ts). The style taxonomy
 *  is coarser than the transcript's: thinking is the `thinking` card, the
 *  compaction summary is `summary`, context notices are `notice`, and ordinary
 *  notices / interrupts / local echoes / the turn ledger draw as `other`. */
export function cardKindOf(kind: ChatRow['kind']): CardKind {
  switch (kind) {
    case 'user': return 'user'
    case 'assistant': return 'assistant'
    case 'reasoning': return 'thinking'
    case 'tool': return 'tool'
    case 'subagent': return 'subagent'
    case 'job': return 'job'
    case 'compact': return 'summary'
    case 'card':
    case 'skill':
    case 'command': return 'custom'
    case 'context-notice': return 'notice'
    default: return 'other'
  }
}

/**
 * Conversation card styles resolved once for the whole list (each card
 * component resolves its own face for its own theme), used for the fold
 * defaults and as a height fingerprint: card padding, borders, gaps and
 * folded-line budgets change a row's height the same way width does, and a
 * stale cached height would leave blank bands behind after a live style change.
 */
export function useTranscriptCardStyles(toolBackground: ToolBackground): {
  cardStyles: ResolvedCardStyles
  cardHeightKey: string
} {
  const cardStyles = useCardStyles(toolBackground)
  const cardHeightKey = React.useMemo(() => JSON.stringify(cardStyles), [cardStyles])
  return { cardStyles, cardHeightKey }
}

/**
 * The configured job-fold default is a fold input (it decides whether a run
 * renders folded), so it joins the consecutive-job fingerprint.
 */
export function jobFoldDefaultSig(cardStyles: ResolvedCardStyles): number {
  const jobFoldDefault = cardStyles.kinds.job.fold?.defaultExpanded
  return jobFoldDefault === undefined ? 0 : jobFoldDefault ? 16 : 32
}

/**
 * Live progress joins the consecutive-job fingerprint: grouped rows are shallow
 * copies made in the fold pass, so a progress-only `row.job` reassignment on a
 * running grouped job would otherwise keep rendering the copied-out old job.
 */
export function hashJobProgress(sig: number, job: JobRow): number {
  const progress = job.progress ?? ''
  for (let c = 0; c < progress.length; c++) sig = (sig * 33 + progress.charCodeAt(c)) | 0
  return sig
}

/**
 * `defaultExpanded` is a job run's INITIAL state, i.e. the equivalent of
 * clicking the group head open: it can only open a run the policy would have
 * folded, never fold one the policy left open (grouping and the live-work rule
 * stay where they are).
 */
export function jobGroupOpened(cardStyles: ResolvedCardStyles, headToggled: boolean): boolean {
  return cardRowExpanded(headToggled, cardStyles.kinds.job.fold?.defaultExpanded)
}

/**
 * `minimumGap` adds a real top row even for the first block (the preset's
 * breathing space); measured turn tops have to include it. Group members apply
 * their minimum breathing space inside the card. A card that declared
 * `density: 'compact'` has no face gap to add — also while the window folded
 * its view away.
 */
export function cardBreathing(cardStyles: ResolvedCardStyles, row: ChatRow, member: boolean): boolean {
  return !member && cardStyles.kinds[cardKindOf(row.kind)].minimumGap > 0
    && cardRowDensity(row.card) !== 'compact'
}

/**
 * Per-row expansion: the configured `defaultExpanded` is only the default for a
 * row the user has not toggled (a click/Enter reverses it), and Ctrl+O still
 * forces every row open. Job rows are the exception — their default is the
 * GROUP state decided in the fold pass, and the flag keeps meaning "the row was
 * toggled" for the card body. A live thinking row's preview/full choice belongs
 * to `dsh-tui.thinkingFold` and its per-row override, not to the card default
 * (see CardFold): the default only reaches settled rows.
 */
export function transcriptRowExpanded(cardStyles: ResolvedCardStyles, row: ChatRow, toggled: boolean): boolean {
  const liveThinking = row.kind === 'reasoning' && (row.streaming === true || row.thinkingOpen === true)
  return row.kind === 'job' || liveThinking
    ? toggled
    : cardRowExpanded(toggled, cardStyles.kinds[cardKindOf(row.kind)].fold?.defaultExpanded)
}

type BoxProps = React.ComponentProps<typeof Box>

/**
 * The root Box of a row TranscriptRow draws inline (streaming assistant,
 * notices, interrupts, local echoes, the turn ledger, the compaction summary)
 * with the row's card face spread onto it — the same single Box, no extra
 * wrapper. It takes the row's original layout props and maps them onto the
 * face: `marginTop` (0/1, the block transition) becomes `cardMarginTop`, a
 * `paddingLeft` indent grows by the face padding (and the right side gets the
 * face padding), the row's own `backgroundColor` (selection) wins over the
 * face background, and the content goes inside `CardContent`.
 */
export function CardBox({
  surface,
  marginTop = 0,
  paddingLeft,
  backgroundColor,
  children,
  ...rest
}: Omit<BoxProps, 'marginTop' | 'paddingLeft' | 'backgroundColor'> & {
  surface: CardSurface
  marginTop?: 0 | 1
  paddingLeft?: number
  backgroundColor?: 'messageActionsBackground' | undefined
}): React.ReactNode {
  const padding = paddingLeft === undefined
    ? { paddingX: surface.box.paddingX }
    : { paddingLeft: paddingLeft + surface.box.paddingX, paddingRight: surface.box.paddingX }
  return (
    <Box
      {...rest}
      marginTop={cardMarginTop(marginTop === 1, surface.style)}
      {...padding}
      paddingY={surface.box.paddingY}
      backgroundColor={backgroundColor ?? surface.box.backgroundColor}
      borderStyle={surface.box.borderStyle}
      borderColor={surface.box.borderColor}
    >
      <CardContent surface={surface}>{children}</CardContent>
    </Box>
  )
}
