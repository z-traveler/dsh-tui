/**
 * 对话 job 卡的细线进度（下游）：5 格左右的横线 + 弱化余段 + producer 原始的
 * `n/m` 计数。没有背景填充、没有块字符、没有百分比；颜色只表达比例（前 1/3
 * 主题 `accent`、中段 `ide`、后段 `success`），细线与计数用同一阶段色，不改
 * job 状态，也不把低进度染成失败红。
 *
 * 计数不是比例（自由文本、`0/0`、溢出的数字）时原文透传，不编造进度。header
 * 的固定槽位宽度（`width`）仍由调用方给出：计数长了先缩短细线，连 2 格都不够
 * 就只留计数；只留计数时仍按可解析的比例着色，并按该宽度截断——不许把 header
 * 撑开。宽度预算用仓库的 `stringWidth`（终端显示列），不用 `String.length`。
 */
import React from 'react'
import { Box, Text } from '../../ui.js'
import { stringWidth } from '../../ink/stringWidth.js'
import type { Theme } from '../../theme.js'
import type { JobProgressStyle } from '../../cardStyles.js'

/** `JobCard`'s `JobProgress` options added by card styles. */
export interface JobProgressOptions {
  /** `bar` (default) keeps the design-system bar; `line` renders here. */
  readonly style?: JobProgressStyle
  /** Fixed header slot width in terminal columns (line mode shrinks the line
   *  before it drops it in favour of the counter). */
  readonly width?: number
}

/** 普通宽度下的细线格数；槽位不够时先缩它。 */
const LINE_CELLS = 5
/** 少于两格就不再画线（一格既读不出比例也读不出颜色）。 */
const MIN_LINE_CELLS = 2
const FILLED = '━'
const REST = '─'

/** 进度比例对应的主题色：只表示完成度，与 job 的成功/失败状态无关。 */
function progressColor(ratio: number): keyof Theme {
  if (ratio < 1 / 3) return 'accent'
  if (ratio < 2 / 3) return 'ide'
  return 'success'
}

export function JobLineProgress({ progress, width }: {
  readonly progress: string
  /** header 里这个进度槽的终端列数；缺省按 5 格细线 + 计数排。 */
  readonly width?: number
}): React.ReactNode {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(progress.trim())
  const current = match === null ? Number.NaN : Number(match[1])
  const total = match === null ? Number.NaN : Number(match[2])
  const count = progress.trim()
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return <Text color="accent" wrap="truncate-end">{progress}</Text>
  }
  const ratio = Math.min(current, total) / total
  // 细线与计数是同一进度的两种呈现：颜色算一次，两处复用（含只留计数的窄槽）。
  const color = progressColor(ratio)
  const countWidth = stringWidth(count)
  const cells = width === undefined ? LINE_CELLS : Math.min(LINE_CELLS, width - 1 - countWidth)
  if (cells < MIN_LINE_CELLS) {
    return <Text color={color} wrap="truncate-end">{count}</Text>
  }
  // 任何非零进度至少点亮一格；其余按比例取整，超过总数只夹视觉比例。
  const filled = Math.min(cells, Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * cells)))
  return (
    <Box flexDirection="row" gap={1}>
      <Text>
        {filled > 0 && <Text color={color}>{FILLED.repeat(filled)}</Text>}
        {filled < cells && <Text dimColor>{REST.repeat(cells - filled)}</Text>}
      </Text>
      <Text color={color} wrap="truncate-end">{count}</Text>
    </Box>
  )
}
