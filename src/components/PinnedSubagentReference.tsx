/**
 * 子代理输入区停靠（下游 subagent-input-dock）在 transcript 中留下的静态引用：
 * 实时卡片停靠在输入框上方时，MessageList 用本模块判定并绘制一行引用，并让
 * 该行的高度签名保持不变。
 */
import React from 'react'
import { Box, Text } from '../ui.js'
import { t } from '../i18n.js'
import type { DOMElement } from '../ink/dom.js'
import type { SubagentRow } from '../dsh-adapter/channel.js'

/** Whether the row's live card is docked above input (only a live subagent is). */
export function isPinnedLiveSubagent(pinLiveSubagents: boolean, subagent: SubagentRow | undefined): boolean {
  return pinLiveSubagents && (subagent?.status === 'starting' || subagent?.status === 'running')
}

/**
 * A pinned history row is always a one-line reference. Live body updates must
 * not discard its measured height and inflate offscreen spacers, so a pinned
 * row's height signature is a constant marker in place of the card's height
 * inputs; unpinning/settling changes the signature and restores the card.
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

export function PinnedSubagentReference({ subagent, boxRef, onClick }: {
  subagent: SubagentRow
  boxRef: (el: DOMElement | null) => void
  onClick: () => void
}): React.ReactNode {
  return (
    <Box ref={boxRef} height={1} flexShrink={0} paddingLeft={2} onClick={onClick}>
      <Text dimColor wrap="truncate-end">{t('subagent-pinned-reference', { description: subagent.description.replace(/\s+/g, ' ') })}</Text>
    </Box>
  )
}
