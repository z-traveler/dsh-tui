/**
 * 子代理输入坞（下游）的原卡片布局：`SubagentMessage` 在固定区里按密度渲染
 * 时用到的固定行高与高度预算。由 `SubagentMessage` 调用，`SubagentInputDock`
 * 经它的再导出取用。
 */
import React from 'react'
import { Box } from '../../ui.js'
import type { CardStyle } from '../../cardStyles.js'
import { cardMarginTop } from '../cardSurface.js'

export type SubagentCardDensity = 'full' | 'compact' | 'collapsed'

export function subagentMessageContentRows(density: SubagentCardDensity): number {
  return density === 'full' ? 5 : density === 'compact' ? 3 : 1
}

export function ActivityRow({ fixed, children }: { fixed: boolean; children: React.ReactNode }): React.ReactNode {
  return fixed ? <Box height={1} flexShrink={0}>{children}</Box> : children
}

/** The original card's fixed dock height, including its surface and gap. */
export function subagentMessageHeight(style: CardStyle, density: SubagentCardDensity): number {
  const content = subagentMessageContentRows(density)
  const border = style.border === undefined || style.border.leftOnly ? 0 : 2
  return content + style.paddingY * 2 + border + cardMarginTop(false, style)
}

/** The card root's own height: absent outside the dock; grouped members sit
 *  inside the dock's single surface, so only their content rows count. */
export function subagentMessageBoxHeight(style: CardStyle, density: SubagentCardDensity | undefined, grouped: boolean): number | undefined {
  if (density === undefined) return undefined
  return grouped ? subagentMessageContentRows(density) : subagentMessageHeight(style, density) - cardMarginTop(false, style)
}
