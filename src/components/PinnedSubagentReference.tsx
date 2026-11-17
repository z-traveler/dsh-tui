/**
 * 子代理输入区停靠（下游 subagent-input-dock）在 transcript 中留下的静态卡片：
 * 实时卡片停靠在转录底部时，MessageList 用本模块判定并绘制原卡片的静态折叠表头，
 * 并让该行的高度签名保持不变。
 */
import React from 'react'
import { Box } from '../ui.js'
import type { DOMElement } from '../ink/dom.js'
import type { SubagentRow } from '../dsh-adapter/channel.js'
import { SubagentMessage } from './Chat/SubagentMessage.js'

/** Whether the row's live card is docked (only a live subagent is). */
export function isPinnedLiveSubagent(pinLiveSubagents: boolean, subagent: SubagentRow | undefined): boolean {
  return pinLiveSubagents && (subagent?.status === 'starting' || subagent?.status === 'running')
}

/**
 * A pinned history row is the original card's collapsed header, drawn still.
 * Its fixed height depends only on the card style, which the row signature
 * already carries, so live body updates must not discard its measured height
 * and inflate offscreen spacers: a pinned row's height signature is a constant
 * marker in place of the card's height inputs; unpinning/settling changes the
 * signature and restores the full card.
 * Returns whether the row was pinned (its signature is complete).
 */
export function pushPinnedSubagentSignature(
  scratch: Array<string | number | boolean>,
  pinLiveSubagents: boolean,
  subagent: SubagentRow | undefined,
): boolean {
  if (!isPinnedLiveSubagent(pinLiveSubagents, subagent)) return false
  scratch.push(true)
  return true
}

export function PinnedSubagentReference({ subagent, marginTopOnTurn, boxRef, onClick, onOpenView }: {
  subagent: SubagentRow
  marginTopOnTurn: boolean
  boxRef: (el: DOMElement | null) => void
  onClick: () => void
  onOpenView?: () => void
}): React.ReactNode {
  return (
    <Box ref={boxRef} flexDirection="column">
      <SubagentMessage subagent={subagent} marginTopOnTurn={marginTopOnTurn} isExpanded={false} density="collapsed" still onClick={onClick} onOpenView={onOpenView} />
    </Box>
  )
}
