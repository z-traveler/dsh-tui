/**
 * 对话卡片表面（下游）：把 `cardStyles` 的解析结果落成一次渲染用的底色/
 * 边框/内边距，并把「卡片内容宽度」收窄成子树唯一的尺寸来源。
 *
 * 渲染接入只做这些：
 *
 * 1. 卡片组件在自己既有的根 Box 上摊开 `box`（不新增包装盒，legacy 无覆盖
 *    时每个字段都是空值，画面与升级前逐格一致）；
 * 2. 卡片内容包进 `CardContent`，它按「边框 + 水平内边距」收窄
 *    `TerminalSizeContext` 后下传——卡片内部自己算宽度的组件（markdown 表格、
 *    代码框、mermaid、终端图片、diff 分栏）因此自动拿到卡片实际留下的列数，
 *    不必各自知道内边距存在（与 PageMargin 同一套收窄策略）。legacy 的
 *    收窄量为 0，重提供的就是同一个尺寸对象，子树不会因多一层上下文而重渲染。
 *
 * 底色来自 `cardBackgroundOf`/`cardBackgroundColor`：状态底色与普通底色是
 * 两层，取消/终止这类领域状态没有卡面（`cardStatusOf` 返回 undefined），于是
 * 保持普通底色与原状态符号。选中高亮由各卡片自己优先，不走这里。预置的用户
 * 卡面还要跟着实际终端底色走，所以这里把 `useTerminalBackground()` 报的颜色
 * 一并交给解析（不自行查询终端）。
 */
import React from 'react'
import { useTheme } from '../ui.js'
import { getTheme } from '../theme.js'
import { useTerminalBackground } from './design-system/ThemeProvider.js'
import { TerminalSizeContext, type TerminalSize } from '../ink/components/TerminalSizeContext.js'
import { useTerminalSize } from '../ink/hooks/use-terminal-size.js'
import type { Color } from '../ink/styles.js'
import type { BorderStyle } from '../ink/render-border.js'
import type { ToolBackground } from '../tuiDisplayPrefs.js'
import {
  cardBackgroundColor,
  cardBackgroundOf,
  cardContentWidth,
  colorOf,
  cardStatusOf,
  getCardStyleConfig,
  resolveCardStyles,
  subscribeCardStyles,
  type CardKind,
  type CardStyle,
  type CardStylePreset,
  type ResolvedCardStyles,
} from '../cardStyles.js'

/**
 * 主题色值在 `Theme` 里是字符串（自定义主题可以写任何合法颜色），而 Box 的
 * 颜色属性是模板字面量联合。这里收窄一次：取值都经过 `cardStyles` 的
 * 合法性校验（主题键、显式颜色，或 `mix` 混出的 `rgb()`），三种形态都是
 * `Color` 接受的字面量。
 */
function asColor(value: string | undefined): Color | undefined {
  return value as Color | undefined
}

/** 卡片根 Box 的表面属性：直接摊到既有根 Box 上，不额外包一层。 */
export interface CardBoxProps {
  readonly backgroundColor: Color | undefined
  readonly borderStyle: BorderStyle | undefined
  /** 主题键或显式颜色（`CardBoxProps.backgroundColor` 同一套解析）。 */
  readonly borderColor: Color | undefined
  readonly borderLeft?: boolean
  readonly borderRight?: boolean
  readonly borderTop?: boolean
  readonly borderBottom?: boolean
  readonly paddingX: number
  readonly paddingY: number
}

export interface CardSurface {
  readonly style: CardStyle
  /** 当前方案（`legacy` / `pi-like`）。它是外观契约，不是尺寸：与
   *  `narrowed`（“内容宽真的收窄了”）分开，卡片需要方案标识时读这里。 */
  readonly preset: CardStylePreset
  /** 本帧的底色是否来自 pi-like 预置面（用户显式 `background`/`states`
   *  不带标记）。 */
  readonly presetFace: boolean
  /** 本帧该用的底色：状态底色 → 普通底色；`undefined` = 不涂底。 */
  readonly backgroundColor: Color | undefined
  /** Resolved user prompt foreground override; absent keeps its theme label. */
  readonly foregroundColor: Color | undefined
  /** `useTerminalBackground()` 报的实际终端底色（`#rrggbb`），与用户卡面
   *  同一个值，不另查终端；需要贴底的呈现（diff 代码区）用它。 */
  readonly terminalBackground: `#${string}`
  /** 卡片内容列数：边框与水平内边距扣宽后的唯一真源。卡片自己算宽度预算
   *  时用它替换 `useTerminalSize().columns`。 */
  readonly columns: number
  /** 下传给子树的终端尺寸（columns 已收窄，rows 原样）。 */
  readonly contentSize: TerminalSize
  /** 本卡片是否真的收窄了内容宽（无内边距、无边框时为 false）。 */
  readonly narrowed: boolean
  readonly box: CardBoxProps
}

/**
 * 当前生效的卡片样式（一次解析，按配置身份缓存）。列表层用它取折叠默认值
 * 与高度指纹；单个卡片用 `useCardSurface` 拿到自己那一份。
 */
export function useCardStyles(toolBackground: ToolBackground = 'none'): ResolvedCardStyles {
  const config = React.useSyncExternalStore(subscribeCardStyles, getCardStyleConfig)
  return React.useMemo(
    () => resolveCardStyles(config, { toolBackground }),
    [config, toolBackground],
  )
}

/**
 * 一种 transcript 内容的卡面。
 *
 * `status` 是领域自己报告的状态原文（`ToolRow.status`、`SubagentStatus`、
 * `BackgroundJobStatus`），映射只有 `cardStatusOf` 一处：映射不到的状态
 * （cancelled / killed / stopping / 未知）保持普通底色。
 */
export function useCardSurface(
  kind: CardKind,
  options: { readonly toolBackground?: ToolBackground; readonly status?: string | undefined } = {},
): CardSurface {
  const styles = useCardStyles(options.toolBackground)
  const [themeName] = useTheme()
  const terminalBackground = useTerminalBackground()
  const size = useTerminalSize()
  const style = styles.kinds[kind]
  const background = cardBackgroundOf(styles, kind, cardStatusOf(options.status))
  const foregroundColor = style.foreground === undefined ? undefined : asColor(colorOf(style.foreground, getTheme(themeName)))
  const backgroundColor = cardBackgroundColor(
    background,
    getTheme(themeName),
    themeName,
    terminalBackground,
  )
  const columns = cardContentWidth(size.columns, style)
  const narrowed = style.paddingX > 0 || style.border !== undefined
  // 无收窄时原样复用上下文尺寸：legacy 下子树看到的对象与升级前是同一个。
  const contentSize = React.useMemo(
    () => (narrowed ? { columns, rows: size.rows, screenRows: size.screenRows } : size),
    [narrowed, columns, size],
  )
  return {
    style,
    preset: styles.preset,
    presetFace: styles.preset === 'pi-like'
      && (background?.presetFace === true || background?.presetState !== undefined),
    backgroundColor: asColor(backgroundColor),
    foregroundColor,
    terminalBackground,
    columns,
    contentSize,
    narrowed,
    box: {
      backgroundColor: asColor(backgroundColor),
      borderStyle: style.border?.style,
      borderColor: asColor(style.border?.color),
      ...(style.border?.leftOnly ? { borderLeft: true, borderRight: false, borderTop: false, borderBottom: false } : {}),
      paddingX: style.paddingX,
      paddingY: style.paddingY,
    },
  }
}

/** 卡片内容的尺寸作用域：见文件头第 2 条。无收窄时不产生任何节点。 */
export function CardContent({ surface, children }: {
  readonly surface: CardSurface
  readonly children: React.ReactNode
}): React.ReactNode {
  if (!surface.narrowed) return children
  return <TerminalSizeContext.Provider value={surface.contentSize}>{children}</TerminalSizeContext.Provider>
}

/**
 * 卡片行的上边距：既有的转场空行加上本类型配置的额外间隔（`gap`），再取
 * 方案给的呼吸行下限（`minimumGap`：pi-like 默认 1，legacy 0；用户显式
 * `gap` 时归零，保留原有的“额外间距”加法语义）。同一行的这两个来源不会
 * 叠加成两层空白：max 取较大的那个。
 */
export function cardMarginTop(marginTopOnTurn: boolean, style: CardStyle): number {
  return Math.max((marginTopOnTurn ? 1 : 0) + style.gap, style.minimumGap)
}
