/**
 * 对话卡片样式（下游）：transcript 内容卡片的外观契约——基础方案（`legacy`
 * 保持现有外观、`pi-like` 给整块类卡片上底色）、公共与按类型覆盖、执行状态
 * 底色，以及已有折叠类型开放的折叠参数。渲染接入属于各卡片组件自身，不在这里。
 *
 * 配置只走文件：`~/.dsh-tui/settings.json` 的 `dsh-tui` 用户层（`cardStyles`）
 * 优先于 `cordis.yml`/profile 的部署块，与 `statusBar` 等显示偏好同一优先级；
 * 设了该键的层整体替换下层，不做深合并。用户层改动随设置 watch 即时生效；
 * 部署块是启动快照，改了要重启。
 *
 * 值一律当不可信输入：`normalizeCardStyleConfig` 丢掉或夹取所有用不了的部分，
 * 手改错的配置只会退回方案默认值，不会让渲染崩掉。颜色是主题键（或显式颜色）
 * 在渲染时解析，所以跟随当前调色板；预置状态面在真彩档用一张固定的小色表，
 * 不新增主题键，也不存在真实透明度。
 *
 * `pi-like` 的用户卡面是唯一跟着**终端底色**走的底：默认面把主题正文色极淡地
 * 混在 `useTerminalBackground()` 报的实际终端背景上（`presetUser`），于是深色
 * 终端不会被盖一块浅色、浅色终端不会被盖一块深色；终端没有真实 alpha，那是
 * 极淡的实色，不是半透明。它不借悬停/选中高亮——那是交互反馈色。
 *
 * 三个执行状态在内置主题上都可辨：真彩档按主题明暗取一张固定的低饱和豆沙
 * 色表（`PRESET_STATE_COLORS`）——暗色盘三态都贴近黑底（中性、极淡灰绿、
 * 极淡豆沙玫瑰），亮色盘执行中沿用主题自己的中性消息面，成功灰绿、
 * 失败豆沙玫瑰；256 色档的 6×6×6 量化会把柔和色压成饱和立方色、也会把一对
 * 状态压进同一格，所以那一档发改过色相的终端槽位（`TIER_STATE_FILLS`），不
 * 再退到相邻灰阶；16 色档连可用的柔和色都没有，三态整体换成暗底/亮底各三个
 * 槽位，状态符号照旧保留（这一档呈现不了柔和色盘，见下游说明）。个人覆盖的
 * 底色永远按用户给的颜色画。低色档的取舍是能力限制，不是状态语义：映射仍只有
 * `cardStatusOf` 一处。
 * 用户卡面的默认底同理分档：真彩档是终端底色与正文色的极淡混色，256 色档取
 * 最近的中性灰阶（6×6×6 量化会把近黑/近白的实色抬成 `#5f5f5f` 一类的大块），
 * 16 色档不填充（呈现不了这么淡的底）。
 * 状态底色也可以逐状态覆盖（`states`），它与卡片的普通 `background` 是两层，
 * 互相关掉不掉，要关就把它设成 `none`。
 *
 * `pi-like` 的 diff 卡正文不在整张状态面上：代码区贴回终端底、split 的增删行
 * 让出衬底，是呈现层的 `components/diffAppearance.ts` 按这里给出的
 * `presetFace`/终端底色决定的，diff 的解析与算法不在这里。
 */
import chalk from 'chalk'
import type { Theme, ThemeName } from './theme.js'
import { isLightThemeActive, isThemeColorKey, normalizeThemeKey, parseFixedColor } from './theme.js'
import { isValidThemeColor } from './customTheme.js'
import { mix } from './trajectory/motion.js'
import { createLiveSetting, type ToolBackground } from './tuiDisplayPrefs.js'

/** Transcript 内容类型（覆盖范围见本文件头的方案说明）。纯呈现分类：
 *  只描述一行怎么画，不表达任何领域事实。 */
export const CARD_KINDS = ['user', 'assistant', 'thinking', 'tool', 'subagent', 'job', 'summary', 'notice', 'custom', 'other'] as const
export type CardKind = (typeof CARD_KINDS)[number]

/** 当前会报告执行状态的类型（`ToolRow.status` / `SubagentStatus` /
 *  `BackgroundJobStatus`），只有它们能配状态底色；解析结果的 `states` 字段就是
 *  这个能力与当前方案默认值的运行时答案。 */
export const STATEFUL_CARD_KINDS = ['tool', 'subagent', 'job'] as const
export type StatefulCardKind = (typeof STATEFUL_CARD_KINDS)[number]

/** 卡面区分的三种执行状态；领域里其余状态见 `cardStatusOf`。 */
export const CARD_STATUSES = ['running', 'success', 'failure'] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

/** 对话 job 卡的进度呈现：`line` 是 pi-like 的细线，`bar` 是原块状进度条。
 *  只有 `kinds.job` 消费这个字段；共享的 `/jobs` 面板仍是 `bar`。 */
export const JOB_PROGRESS_STYLES = ['line', 'bar'] as const
export type JobProgressStyle = (typeof JOB_PROGRESS_STYLES)[number]

export const CARD_STYLE_PRESETS = ['legacy', 'pi-like'] as const
export type CardStylePreset = (typeof CARD_STYLE_PRESETS)[number]

/** `Box borderStyle` 能画的边框样式：cli-boxes 的键加上渲染器自己的 `dashed`。 */
export const CARD_BORDER_STYLES = ['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed'] as const
export type CardBorderStyle = (typeof CARD_BORDER_STYLES)[number]

/** 配置边界（与 `tuiDisplayPrefs` 的 clamp 约定一致：超出即夹取，不让一行
 *  配置吃掉版面）。 */
export const CARD_PADDING_X_MAX = 8
export const CARD_PADDING_Y_MAX = 4
export const CARD_GAP_MAX = 4
export const CARD_PREVIEW_LINES_MAX = 40

/**
 * `pi-like` 用户卡面默认底的混色比例：把主题正文色按这个比例混在**终端实际
 * 底色**上。12% 的实色混色让用户消息易于定位，同时保持低对比；终端没有真实
 * alpha，这不是半透明。深色主题提亮，浅色主题压暗。
 */
const USER_SURFACE_RATIO = 0.12

/** 只写了边框、没写颜色时的边框色：主题自己的边框键，不固定颜色。 */
const DEFAULT_BORDER_COLOR = 'promptBorder'

/** 一张卡面的底色，以及预置方案专用的呈现标记。 */
export interface CardBackground {
  /** 主题颜色键，或 `#rgb` / `rgb()` / `ansi256()` / `ansi:` 形式的显式颜色。 */
  readonly fill: string
  /** 这是预置方案给某个执行状态配的卡面（只有 pi-like 的 tool/subagent 带）。
   *  真彩档按明暗换成 `PRESET_STATE_COLORS` 的豆沙色，低色档换成
   *  `TIER_STATE_FILLS` 的有色槽位；个人覆盖的底色不带这个标记，永远按用户
   *  给的颜色画。 */
  readonly presetState?: CardStatus
  /** 这是预置方案给某类型配的普通卡面（只有 pi-like 的 tool/subagent 带）：
   *  呈现层据此识别「方案底」与用户显式 `background`，例如 diff 卡只在
   *  方案底下把代码区贴回终端底。个人覆盖的底色不带这个标记。 */
  readonly presetFace?: true
  /** 这是预置方案给用户卡片配的默认面（只有 pi-like 的 user 带）：解析时
   *  `fill` 不是铺满的底色而是**色偏**，按 `USER_SURFACE_RATIO` 极淡地混在
   *  实际终端底色上，于是它跟着终端走，不盖异色块。个人覆盖的底色不带这个
   *  标记，永远按用户给的颜色画。 */
  readonly presetUser?: true
  /** Neutral context-notice face, independent of the producer's task outcome. */
  readonly presetNotice?: true
}

export interface CardBorder {
  readonly style: CardBorderStyle
  readonly color: string
  readonly leftOnly?: true
}

/** 已有折叠机制开放的覆盖参数。两项都可以是"没设"（`undefined`）——那就是
 *  沿用该类型自己的既有折叠，方案默认与切换方案都不会改变它。 */
export interface CardFold {
  /** 落定行的默认展开状态；没设即沿用该机制自己的默认（工具/思考/摘要落定
   *  折叠、超长行只显示折叠预览）。流式思考的 `thinkingFold` 默认与
   *  `jobGroupFold` 的成组策略不归它管。 */
  readonly defaultExpanded: boolean | undefined
  /** 折叠时的行数预算；没设即沿用各视图自己的上限（工具正文 3 行、diff 8 行、
   *  流式思考预览 3 行）。设了就统一覆盖该类型已有的行数预算，不会新增正文。 */
  readonly previewLines: number | undefined
}

export interface CardStyle {
  /** User prompt text overrides; other card kinds keep their own typography. */
  readonly foreground?: string
  readonly bold?: boolean
  readonly background: CardBackground | undefined
  readonly border: CardBorder | undefined
  readonly paddingX: number
  readonly paddingY: number
  /** 本类型的卡片之间额外留出的空行（0 保持现有间距）。 */
  readonly gap: number
  /** 预设给的“至少一行未着色呼吸空间”（`pi-like` 默认 1，`legacy` 0）。
   *  个人显式 `gap` 覆盖时归零：那时的语义就是原有的“额外间距”加法。 */
  readonly minimumGap: number
  readonly fold: CardFold | undefined
  /** 只有 `job` 带：对话任务卡的进度呈现（`pi-like` 默认 `line`、`legacy`
   *  默认 `bar`，显式配置优先）。其它类型不解析这个字段。 */
  readonly progressStyle?: JobProgressStyle
  /** 三种执行状态的底色；只有会报告状态的类型才有，某项 `undefined` 表示该
   *  状态不涂底、回落 `background`。 */
  readonly states?: Readonly<Record<CardStatus, CardBackground | undefined>>
}

/** 一种执行状态底色的覆盖：`none` 明确不涂底（回落卡面），其余是主题键或显式颜色。 */
export type CardStateFill = 'none' | string

export interface CardStateOverrides {
  running?: CardStateFill
  success?: CardStateFill
  failure?: CardStateFill
}

export interface ResolvedCardStyles {
  readonly preset: CardStylePreset
  readonly kinds: Readonly<Record<CardKind, CardStyle>>
}

/** 一层覆盖：每个字段都可省，省了就继承下一层（方案 → 公共 → 类型）。 */
export interface CardStyleOverrides {
  /** 用户消息文字色（主题键或显式颜色）与字重；仅 user 消费。 */
  foreground?: string
  bold?: boolean
  /** 无状态时的底色：`none` 为无填充，其余是主题键或显式颜色。它与状态底色是
   *  两层独立的设置——写了它不会关掉动态状态，要关请用 `states`。 */
  background?: CardStateFill
  /** 逐状态底色覆盖（只有工具/子代理/后台任务有状态）；`none` 关掉该状态的
   *  填充，其余是主题键或显式颜色。 */
  states?: CardStateOverrides
  border?: 'none' | CardBorderStyle
  borderColor?: string
  paddingX?: number
  paddingY?: number
  gap?: number
  defaultExpanded?: boolean
  previewLines?: number
  /** 后台任务卡的进度呈现（`line`|`bar`）；`common` 可写，但只有 `job`
   *  消费。非法值丢弃，回落方案默认。 */
  progressStyle?: JobProgressStyle
}

const NO_OVERRIDES: CardStyleOverrides = Object.freeze({})

/** 文件配置的形状：`settings.json` 的 `values.cardStyles` 或 `cordis.yml` 的
 *  `dsh-tui` 行 `config.cardStyles`。 */
export interface CardStyleConfig {
  preset?: CardStylePreset
  /** 公共覆盖：对每种类型生效，类型的同名覆盖优先。 */
  common?: CardStyleOverrides
  kinds?: Partial<Record<CardKind, CardStyleOverrides>>
}

/** 默认配置就是 `legacy`：什么都不设时外观与升级前一致。 */
export const DEFAULT_CARD_STYLE_CONFIG: CardStyleConfig = Object.freeze({})

interface PresetPalette {
  readonly paddingX: Readonly<Partial<Record<CardKind, number>>>
  readonly paddingY: Readonly<Partial<Record<CardKind, number>>>
  /** 类型自己的默认面；缺省即不涂底。 */
  readonly faces: Readonly<Partial<Record<CardKind, CardBackground>>>
  /** 执行状态底色，只有带状态的类型有。 */
  readonly states: Readonly<Partial<Record<StatefulCardKind, Readonly<Record<CardStatus, CardBackground>>>>>
  /** 相邻卡片之间至少保留的未着色行（见 `CardStyle.minimumGap`）；按类型给出。 */
  readonly minimumGap: Readonly<Record<CardKind, number>>
  /** 对话 job 卡的默认进度呈现（只有 `job` 消费）。 */
  readonly jobProgressStyle: JobProgressStyle
}

/** 一张全量类型表：`defaultGap` 是缺省值，`overrides` 单独收紧某几类。 */
function gapsOf(defaultGap: number, overrides: Readonly<Partial<Record<CardKind, number>>> = {}): Readonly<Record<CardKind, number>> {
  const gaps = {} as Record<CardKind, number>
  for (const kind of CARD_KINDS) gaps[kind] = overrides[kind] ?? defaultGap
  return Object.freeze(gaps)
}

/**
 * 状态卡面的主题侧兜底：主题自己的中性消息面（`bashMessageBackgroundColor`）。
 * 真彩档只有「亮色盘的执行中」和「ANSI 盘判通道」会用到它；暗色真彩三态
 * 走下面那张贴近黑底的固定表，低色档走槽位表。
 */
const STATE_SURFACE = 'bashMessageBackgroundColor'

/**
 * 真彩档的预置状态面：按主题明暗取一组低对比的实色。暗色盘整体贴近终端
 * 黑底（`#0d1013` / `#0e1b14` / `#21161d`），只有一点中性、灰绿、豆沙玫瑰
 * 的色相差别；正文对比远高于 4.5:1。亮色盘保留原来的 sage/rose 淡面，
 * 执行中回到主题自己的中性面（下表不列）。这张表只服务预置方案；个人
 * `states` 覆盖不走这里，`legacy` 也没有状态面。
 */
const PRESET_STATE_COLORS: Readonly<Record<PalettePolarity, Readonly<Partial<Record<CardStatus, string>>>>> = Object.freeze({
  dark: Object.freeze({ running: '#0d1013', success: '#0e1b14', failure: '#21161d' }),
  light: Object.freeze({ success: '#e8efe9', failure: '#f3e6ea' }),
})

/** `tool`/`subagent` 共用同一套状态底色。`fill` 是主题侧的中性兜底
 *  （亮色盘的执行中、ANSI 盘判通道）；`presetState` 标记让呈现层按色档换成
 *  `PRESET_STATE_COLORS` 的固定近黑面或 `TIER_STATE_FILLS` 的槽位，它不出现
 *  在任何用户覆盖上。后台任务（job）默认不涂底，也不带状态面——见 `PRESETS`。 */
const BLOCK_STATE_FACES: Readonly<Record<CardStatus, CardBackground>> = Object.freeze({
  running: { fill: STATE_SURFACE, presetState: 'running' },
  success: { fill: STATE_SURFACE, presetState: 'success' },
  failure: { fill: STATE_SURFACE, presetState: 'failure' },
})

const PRESETS: Readonly<Record<CardStylePreset, PresetPalette>> = Object.freeze({
  // legacy 就是升级前的样子：无边框、无内边距、无额外间距，工具卡只吃
  // `dsh-tui.toolBackground`（见 presetFace）。
  legacy: { paddingX: {}, paddingY: {}, faces: {}, states: {}, minimumGap: gapsOf(0), jobProgressStyle: 'bar' },
  // pi-like：无边框，原行水平/上下内边距为 0（正文与原组件的 `❯`/`⎿`/子代理
  // 自有缩进对齐）；用户/工具/子代理整块底色，相邻卡片之间留一行不着色的
  // 呼吸空间（`minimumGap`，已有的转场空行不再叠加）；后台任务默认既无普通
  // 面也无状态面，组内也与 legacy 一样紧贴（`job: 0`）。助手/思考/摘要保持
  // 无填充。
  'pi-like': {
    // Pi 的 custom/skill 消息不同于工具卡：紫色面，横纵各一格内边距。
    paddingX: { custom: 1 },
    paddingY: { custom: 1 },
    faces: {
      // 用户卡面不借悬停/选中高亮（dark 的 `userMessageBackgroundHover` 是
      // #3B5BDB 高饱和蓝，也不是"近透明"）：默认面是正文色极淡地混在实际
      // 终端底色上，解析见 `presetUserColor`。
      user: { fill: 'text', presetUser: true },
      notice: { fill: 'merged', presetNotice: true },
      // `presetFace` 标记「这是方案给的底」：diff 卡据此把代码区贴回终端底
      // （见 `diffBodyAppearance`），用户显式 background 不带这个标记。
      tool: { fill: 'toolCardBackgroundDim', presetFace: true },
      subagent: { fill: 'toolCardBackgroundDim', presetFace: true },
      custom: { fill: 'customMessageBackground', presetFace: true },
    },
    states: { tool: BLOCK_STATE_FACES, subagent: BLOCK_STATE_FACES },
    minimumGap: gapsOf(1, { job: 0 }),
    jobProgressStyle: 'line',
  },
})

/** 每种已有折叠机制支持哪个参数，以及该参数落到哪套既有机制上。其余折叠留在
 *  它们自己的设置里（`thinkingFold`、`jobGroupFold`、`foldTerminalCommand`），
 *  这里不重复一套，也不新增折叠。 */
const FOLD_SUPPORT = {
  // 纯文本行的超长单行裁剪（`utils/fold-long-lines.ts`）：按字符数，不按行数。
  user: { defaultExpanded: true, previewLines: false },
  assistant: { defaultExpanded: true, previewLines: false },
  // 落定后只剩表头；流式预览由 `dsh-tui.thinkingFold` 决定，`previewLines`
  // 只改那个固定行数 ticker（`PREVIEW_ROWS`），静态折叠不因它多出正文行。
  thinking: { defaultExpanded: true, previewLines: true },
  // 折叠正文预算：文本 3 行、diff 8 行；显式 `previewLines` 同时覆盖两者。
  tool: { defaultExpanded: true, previewLines: true },
  // 后台任务组的整组折叠：成组策略归 `dsh-tui.jobGroupFold`，`defaultExpanded`
  // 只是组的初始展开状态（等价于点开组头）。
  job: { defaultExpanded: true, previewLines: false },
  // 压缩摘要折叠成文字预览（`compact-summary-folded`），没有行数可调。
  summary: { defaultExpanded: true, previewLines: false },
} as const satisfies Readonly<Partial<Record<CardKind, { readonly defaultExpanded: boolean; readonly previewLines: boolean }>>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 配置边界接受的颜色：主题键（含已弃用别名）或渲染器接受的显式颜色。 */
function isCardColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && (isThemeColorKey(value) || isValidThemeColor(value))
}

function isCardBorderStyle(value: unknown): value is CardBorderStyle {
  return typeof value === 'string' && (CARD_BORDER_STYLES as readonly string[]).includes(value)
}

/** 有限数字夹取到 `[min, max]`；其余一律当作没写。 */
function clampCount(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 夹取到 `[min, max]`；没写或非法就用下一层的 `fallback`。 */
function clampOr(value: unknown, min: number, max: number, fallback: number): number {
  return clampCount(value, min, max) ?? fallback
}

/** 逐状态归一：未知状态名直接丢弃，用不了的颜色当作没写。 */
function normalizeStates(value: unknown): CardStateOverrides | undefined {
  if (!isRecord(value)) return undefined
  const states: CardStateOverrides = {}
  for (const status of CARD_STATUSES) {
    const fill = value[status]
    if (fill === 'none') states[status] = 'none'
    else if (isCardColor(fill)) states[status] = fill.trim()
  }
  return Object.keys(states).length === 0 ? undefined : states
}

function normalizeOverrides(value: unknown): CardStyleOverrides | undefined {
  if (!isRecord(value)) return undefined
  const overrides: CardStyleOverrides = {}
  if (isCardColor(value.foreground)) overrides.foreground = value.foreground.trim()
  if (typeof value.bold === 'boolean') overrides.bold = value.bold
  if (value.background === 'none') overrides.background = 'none'
  else if (isCardColor(value.background)) overrides.background = value.background.trim()
  const states = normalizeStates(value.states)
  if (states !== undefined) overrides.states = states
  if (value.border === 'none') overrides.border = 'none'
  else if (isCardBorderStyle(value.border)) overrides.border = value.border
  if (isCardColor(value.borderColor)) overrides.borderColor = value.borderColor.trim()
  const paddingX = clampCount(value.paddingX, 0, CARD_PADDING_X_MAX)
  if (paddingX !== undefined) overrides.paddingX = paddingX
  const paddingY = clampCount(value.paddingY, 0, CARD_PADDING_Y_MAX)
  if (paddingY !== undefined) overrides.paddingY = paddingY
  const gap = clampCount(value.gap, 0, CARD_GAP_MAX)
  if (gap !== undefined) overrides.gap = gap
  if (typeof value.defaultExpanded === 'boolean') overrides.defaultExpanded = value.defaultExpanded
  const previewLines = clampCount(value.previewLines, 1, CARD_PREVIEW_LINES_MAX)
  if (previewLines !== undefined) overrides.previewLines = previewLines
  if (value.progressStyle === 'line' || value.progressStyle === 'bar') overrides.progressStyle = value.progressStyle
  return Object.keys(overrides).length === 0 ? undefined : overrides
}

/**
 * 把配置层（用户层或部署块）的原始值归一成可用配置：非法方案、未知类型、
 * 用不了的边框/颜色一律丢弃，数值夹取到文档范围，其余保持原样。归一结果为空
 * 即返回共享的默认配置对象，方便调用方按引用判等。
 */
export function normalizeCardStyleConfig(value: unknown): CardStyleConfig {
  if (!isRecord(value)) return DEFAULT_CARD_STYLE_CONFIG
  const config: CardStyleConfig = {}
  if (value.preset === 'legacy' || value.preset === 'pi-like') config.preset = value.preset
  const common = normalizeOverrides(value.common)
  if (common !== undefined) config.common = common
  const input = isRecord(value.kinds) ? value.kinds : undefined
  const kinds: Partial<Record<CardKind, CardStyleOverrides>> = {}
  for (const kind of CARD_KINDS) {
    const overrides = normalizeOverrides(input?.[kind])
    if (overrides !== undefined) kinds[kind] = overrides
  }
  if (Object.keys(kinds).length > 0) config.kinds = kinds
  return Object.keys(config).length === 0 ? DEFAULT_CARD_STYLE_CONFIG : config
}

/**
 * 一次应用的两层配置：`settings.json` 用户层优先于部署块，且整体替换——用户
 * 只写一部分覆盖时，部署块的其它键不会从下面漏过来（与 `statusBar` 同规则）。
 */
export function cardStyleConfigFrom(user: unknown, deployment: unknown): CardStyleConfig {
  return normalizeCardStyleConfig(user ?? deployment)
}

/** 方案自己的底色。`legacy` 保持 `dsh-tui.toolBackground` 的旧语义（工具卡
 *  唯一的底），`pi-like` 接管工具卡、不再读该设置。 */
function presetFace(preset: CardStylePreset, kind: CardKind, toolBackground: ToolBackground): CardBackground | undefined {
  if (preset === 'legacy') {
    if (kind !== 'tool') return undefined
    if (toolBackground === 'subtle') return { fill: 'toolCardBackgroundDim' }
    if (toolBackground === 'strong') return { fill: 'toolCardBackground' }
    return undefined
  }
  return PRESETS[preset].faces[kind]
}

/** 一层层往后取最后一个写了的字段。 */
function pick<K extends keyof CardStyleOverrides>(layers: readonly CardStyleOverrides[], key: K): CardStyleOverrides[K] | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const value = layers[index]![key]
    if (value !== undefined) return value
  }
  return undefined
}

function foldOf(kind: CardKind, layers: readonly CardStyleOverrides[]): CardFold | undefined {
  if (!Object.hasOwn(FOLD_SUPPORT, kind)) return undefined
  const support = FOLD_SUPPORT[kind as keyof typeof FOLD_SUPPORT]
  return {
    defaultExpanded: pick(layers, 'defaultExpanded'),
    previewLines: support.previewLines ? clampCount(pick(layers, 'previewLines'), 1, CARD_PREVIEW_LINES_MAX) : undefined,
  }
}

/** 一层的状态底色（只看逐状态覆盖，不看卡片底色）。 */
function pickState(layers: readonly CardStyleOverrides[], status: CardStatus): CardStateFill | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const fill = layers[index]!.states?.[status]
    if (fill !== undefined) return fill
  }
  return undefined
}

/**
 * 状态底色：方案默认 ← 公共覆盖 ← 类型覆盖，逐状态各取最后一层。只有会报告
 * 状态的类型有；一项都没涂就整个省略，免得调用方去区分空对象。
 */
function resolveStates(
  preset: CardStylePreset,
  kind: CardKind,
  layers: readonly CardStyleOverrides[],
): Readonly<Record<CardStatus, CardBackground | undefined>> | undefined {
  if (!(STATEFUL_CARD_KINDS as readonly string[]).includes(kind)) return undefined
  const base = PRESETS[preset].states[kind as StatefulCardKind]
  const resolved = {} as Record<CardStatus, CardBackground | undefined>
  let painted = false
  for (const status of CARD_STATUSES) {
    const requested = pickState(layers, status)
    resolved[status] = requested === undefined
      ? base?.[status]
      : requested === 'none' ? undefined : { fill: requested }
    if (resolved[status] !== undefined) painted = true
  }
  return painted ? resolved : undefined
}

function resolveKind(
  preset: CardStylePreset,
  kind: CardKind,
  layers: readonly CardStyleOverrides[],
  toolBackground: ToolBackground,
): CardStyle {
  const palette = PRESETS[preset]
  const requested = pick(layers, 'background')
  // 普通底色只管无状态的样子；状态底色是另一层（见 resolveStates）。
  const background = requested === undefined
    ? presetFace(preset, kind, toolBackground)
    : requested === 'none' ? undefined : { fill: requested }
  const border = pick(layers, 'border')
  const states = resolveStates(preset, kind, layers)
  const requestedGap = pick(layers, 'gap')
  const requestedProgress = pick(layers, 'progressStyle')
  return {
    background,
    border: border === undefined
      ? preset === 'pi-like' && kind === 'notice'
        ? { style: 'single', color: pick(layers, 'borderColor') ?? 'merged', leftOnly: true }
        : undefined
      : border === 'none' ? undefined : { style: border, color: pick(layers, 'borderColor') ?? DEFAULT_BORDER_COLOR },
    paddingX: clampOr(pick(layers, 'paddingX'), 0, CARD_PADDING_X_MAX, palette.paddingX[kind] ?? 0),
    paddingY: clampOr(pick(layers, 'paddingY'), 0, CARD_PADDING_Y_MAX, palette.paddingY[kind] ?? 0),
    gap: clampOr(requestedGap, 0, CARD_GAP_MAX, 0),
    // 显式 gap 保留“额外间距”的加法语义：写了就以它为准，不再叠加方案
    // 自己的呼吸行（否则同一条配置会变成“额外 + 至少一行”）。
    minimumGap: requestedGap === undefined ? palette.minimumGap[kind] : 0,
    fold: foldOf(kind, layers),
    // 只有 job 卡消费进度样式；`common` 可继承，类型层覆盖优先。
    ...(kind === 'job' ? { progressStyle: requestedProgress ?? palette.jobProgressStyle } : {}),
    ...(kind === 'user' ? { foreground: pick(layers, 'foreground'), bold: pick(layers, 'bold') ?? preset === 'legacy' } : {}),
    ...(states === undefined ? {} : { states }),
  }
}

/**
 * 配置的方案，未设即 `legacy`（现有外观）。卡片之外的呈现（例如代码框的
 * 默认形态）只读方案标识时用它，不重复这次回落。
 */
export function cardStylePreset(config: CardStyleConfig): CardStylePreset {
  return config.preset ?? 'legacy'
}

/**
 * 把（已归一的）配置解析成每种类型的完整样式：方案默认值 ← 公共覆盖 ← 类型
 * 覆盖。`toolBackground` 只影响 `legacy` 的工具卡底，方案切换不会清空任何覆盖，
 * 因为覆盖本来就是与方案无关的一层。
 */
export function resolveCardStyles(config: CardStyleConfig, context: { readonly toolBackground: ToolBackground }): ResolvedCardStyles {
  const preset = cardStylePreset(config)
  const kinds = {} as Record<CardKind, CardStyle>
  for (const kind of CARD_KINDS) {
    const overrides = config.kinds?.[kind]
    const layers = overrides === undefined ? [config.common ?? NO_OVERRIDES] : [config.common ?? NO_OVERRIDES, overrides]
    kinds[kind] = resolveKind(preset, kind, layers, context.toolBackground)
  }
  return { preset, kinds }
}

/**
 * 一行是否展开。`defaultExpanded` 只是「用户还没单独切换过」时的默认：行内
 * 切换（点击 / 消息选择回车）反转它，所以默认展开的行点一下就是收起；
 * 没有配置时完全沿用该类型既有的折叠语义。
 */
export function cardRowExpanded(toggled: boolean, defaultExpanded: boolean | undefined): boolean {
  return defaultExpanded === undefined ? toggled : defaultExpanded !== toggled
}

/**
 * 把领域状态映射到三种卡面。只映射领域已经报告的状态：取消/终止/未知
 * （`cancelled`、`killed`、`stopping`）保持普通底色与原状态符号，不在这里
 * 扩充成第四种状态。
 */
export function cardStatusOf(status: string | undefined): CardStatus | undefined {
  switch (status) {
    case 'running':
    case 'starting':
      return 'running'
    case 'ok':
    case 'completed':
      return 'success'
    case 'error':
    case 'failed':
      return 'failure'
    default:
      return undefined
  }
}

/** 一行当前该用哪种底色：有状态就取该状态的底色，否则（含取消/无状态）
 *  保持卡片自身的底色，于是只有状态变化才会改变一行。 */
export function cardBackgroundOf(styles: ResolvedCardStyles, kind: CardKind, status?: CardStatus): CardBackground | undefined {
  const style = styles.kinds[kind]
  return status === undefined ? style.background : style.states?.[status] ?? style.background
}

/**
 * 低色档的预置状态底色，直接发调色板槽位而不是主题混色：
 *  - 256 色档的 6×6×6 量化把每个通道只分成 6 级，柔和的中性面会被压成饱和的
 *    立方色（暗色卡面会落进 palette 59 这类较亮灰色），一对状态会被压进同一格
 *    （codex-paper 的成功/失败同为 palette 188），也会把暗色主题的成功面抬亮
 *    到正文对比 4.5:1 以下（dark 3.96、pink-night 3.59、claude-dark 4.10、
 *    codex-lavender 3.96）；
 *  - 16 色档连暗绿/暗红都没有，发 ansi 名字的成功面还要看用户自己的盘（xterm
 *    的 green `#00cd00` 上白字只有 2.2:1）。
 *
 * 256 档不再发无色相灰阶：那会继续把三态读成一排灰。暗色盘用深青绿 23
 * （#005f5f，白字 7.49:1）与豆沙玫瑰 95（#875f5f，白字 5.48:1），执行中
 * 保持中性 236；亮色盘用柔和 sage 151（#afd7af，黑字 13.16:1）与 rose 181
 * （#d7afaf，黑字 10.64:1），执行中 254。暗 green 65 只有 4.10:1，不选。
 * 成功/失败色相不同，且都不是黑白灰。16 色档只有三段「可辨且可读」的槽位，
 * 呈现不了这种柔和色盘（下游说明已写明），状态符号与状态词照旧保留。
 * 想把低色档换回自己的色相，逐状态覆盖 `states` 即可——用户覆盖不走这张表。
 */
const TIER_STATE_FILLS = Object.freeze({
  ansi256: Object.freeze({
    dark: Object.freeze({ running: 'ansi256(236)', success: 'ansi256(23)', failure: 'ansi256(95)' }),
    light: Object.freeze({ running: 'ansi256(254)', success: 'ansi256(151)', failure: 'ansi256(181)' }),
  }),
  ansi16: Object.freeze({
    dark: Object.freeze({ running: 'ansi:black', success: 'ansi:blue', failure: 'ansi:red' }),
    light: Object.freeze({ running: 'ansi:white', success: 'ansi:green', failure: 'ansi:redBright' }),
  }),
} as const)

type PalettePolarity = 'dark' | 'light'

/** 当前 chalk 色档（仓库唯一的颜色能力接缝，见 `ink/colorize.ts`）。0/1 都按
 *  16 色处理：0 会把颜色整体剥掉，具体槽位不影响输出。 */
function stateTier(): keyof typeof TIER_STATE_FILLS {
  return chalk.level >= 2 ? 'ansi256' : 'ansi16'
}

function tierStateFill(status: CardStatus, polarity: PalettePolarity): string {
  return TIER_STATE_FILLS[stateTier()][polarity][status]
}

// The existing motion mixer reads rgb() only; theme files also accept hex.
function fixedRgb(color: string): string {
  const channels = parseFixedColor(color)
  return channels === undefined ? color : `rgb(${channels.join(',')})`
}

/** Resolve a validated theme key or explicit card colour; empty theme slots stay unpainted. */
export function colorOf(color: string, theme: Theme): string | undefined {
  const key = normalizeThemeKey(color)
  // 主题里取空值表示该调色板不涂这个底（如 dark 的 userMessageBackground）。
  if (key !== undefined) return theme[key] || undefined
  return isValidThemeColor(color) ? color : undefined
}

/** Rec. 601 luma（`ThemeProvider` 判终端明暗用的同一套权重）。 */
function lumaOf(color: string): number | undefined {
  const channels = parseFixedColor(color)
  if (channels === undefined) return undefined
  return 0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]
}

/** 与 `color` 最近的中性灰阶槽位（232–255 这一段没有色相）。 */
function greySlot(color: string): string | undefined {
  const luma = lumaOf(color)
  if (luma === undefined) return undefined
  const step = Math.min(23, Math.max(0, Math.round((luma - 8) / 10)))
  return `ansi256(${232 + step})`
}

/**
 * `pi-like` 用户卡面的默认底（`presetUser`）：把主题正文色极淡地混在**实际
 * 终端底色**上。终端没有真实 alpha，所以那是一个极淡的实色，不是半透明；深色
 * 主题的正文色更亮，于是极轻提亮、浅色主题极轻压暗，深色终端不会被盖一块浅色。
 * `terminalBackground` 是 `useTerminalBackground()` 报的 `#rrggbb`，缺失时按主题
 * 明暗取纯黑/纯白——与 `ThemeProvider` 的 OSC 11 回退同一口径。
 *
 * 低色档只有中性灰阶可用：6×6×6 量化会把近黑/近白的实色抬成 `#5f5f5f` 一类的
 * 块（rgb(30,30,34) 会落到 palette 59），所以 256 色档直接发与混出色最近的灰阶
 * 槽位（边界只能取到 232 / 255）；16 色档呈现不了这么淡的底，这一档不填充，
 * 比铺一块饱和色更接近"近透明"。没有通道可混的 `ansi:` 调色板在真彩档也走
 * 256 槽位（与预置状态面同一规则）。用户覆盖的底色不带 `presetUser`，不过这里。
 */
function presetUserColor(tone: string | undefined, polarity: PalettePolarity, terminalBackground: string | undefined): string | undefined {
  if (tone === undefined) return undefined
  const base = fixedRgb(terminalBackground ?? (polarity === 'light' ? '#FFFFFF' : '#000000'))
  const mixed = mix(base, fixedRgb(tone), USER_SURFACE_RATIO)
  if (chalk.level >= 3 && mixed !== base) return mixed
  return chalk.level >= 2 ? greySlot(mixed) : undefined
}

/**
 * 把一个底色解析成渲染器接受的颜色：主题键取当前调色板的值，显式颜色原样。
 *
 * 预置状态面（`presetState`）比普通底色多一道色档判断：真彩档用
 * `PRESET_STATE_COLORS` 的固定色表（暗色三态都贴近黑底，亮色的执行中仍是
 * 主题自己的中性面）；256/16 色档换成 `TIER_STATE_FILLS` 的槽位（原因见
 * 那里的注释）。用户覆盖的底色没有这个标记，任何色档都按用户给的颜色画。
 *
 * 预置用户面（`presetUser`）走自己的解析：`fill` 当色偏，混在 `terminalBackground`
 * （实际终端底色）上，见 `presetUserColor`。
 *
 * `themeName` 只用来判明暗极性（`isLightThemeActive`），不参与取色；
 * `terminalBackground` 只有预置用户面会用到。
 */
export function cardBackgroundColor(
  background: CardBackground | undefined,
  theme: Theme,
  themeName: ThemeName,
  terminalBackground?: string,
): string | undefined {
  if (background === undefined) return undefined
  const polarity: PalettePolarity = isLightThemeActive(themeName) ? 'light' : 'dark'
  if (background.presetNotice === true) {
    if (chalk.level >= 3) return polarity === 'light' ? '#f3eef7' : '#19151f'
    return chalk.level >= 2 ? polarity === 'light' ? 'ansi256(254)' : 'ansi256(235)' : undefined
  }
  if (background.presetUser === true) return presetUserColor(colorOf(background.fill, theme), polarity, terminalBackground)
  if (background.presetState !== undefined) {
    // 低色档直接发有色槽位，不再经过主题混色。
    if (chalk.level < 3) return tierStateFill(background.presetState, polarity)
    // 成功/失败用固定的低对比色表：不依赖主题通道，ANSI 盘上也能画出
    // 真实色相（暗色盘贴近黑底）。
    const fixed = PRESET_STATE_COLORS[polarity][background.presetState]
    if (fixed !== undefined) {
      // 成功/失败不依赖主题通道：ANSI 盘上也能画出真实色相。
      if (background.presetState !== 'running') return fixed
      // 执行中的固定暗面同样不交给 `ansi:` 盘；没有真实通道的主题仍回
      // 256 中性槽位，不把可读性交给用户自己的 16 色盘。
      const face = colorOf(background.fill, theme)
      return face === undefined || face.startsWith('ansi:') ? tierStateFill('running', polarity) : fixed
    }
    // 亮色盘的执行中沿用主题自己的中性消息面。
    const face = colorOf(background.fill, theme)
    return face === undefined || face.startsWith('ansi:') ? tierStateFill('running', polarity) : face
  }
  return colorOf(background.fill, theme)
}

/**
 * 卡片内容可用列数：外层宽度减去左右边框与水平内边距，至少一列。入参是终端
 * 显示列数（`useTerminalSize()` 或父级盒宽），不是 JS 字符串长度。
 */
export function cardContentWidth(width: number, style: CardStyle): number {
  const inset = style.paddingX * 2 + (style.border === undefined ? 0 : style.border.leftOnly ? 1 : 2)
  return Math.max(1, Math.floor(width) - inset)
}

// ── 活的配置存储 ──────────────────────────────────────────────────────
// 卡片组件直接订阅这个模块级存储（与 pageMargin 等显示偏好同一个接缝），
// 不经过 channel 的版本号：一次 /settings 或配置文件改动不该重放 transcript。

let lastApplied: { readonly config: CardStyleConfig; readonly key: string } | undefined

/** 归一后按内容判等：值没变就复用上一个对象，于是无关的设置改动不会让订阅
 *  卡片重渲染（`createLiveSetting` 按引用判等）。 */
function normalizeApplied(value: unknown): CardStyleConfig {
  const config = normalizeCardStyleConfig(value)
  const key = JSON.stringify(config)
  if (lastApplied?.key === key) return lastApplied.config
  lastApplied = { config, key }
  return config
}

const cardStyleStore = createLiveSetting<CardStyleConfig>(DEFAULT_CARD_STYLE_CONFIG, normalizeApplied)
export const subscribeCardStyles = cardStyleStore.subscribe
export const getCardStyleConfig = cardStyleStore.get
/** 当前生效的配置（用户层已优先于部署块，见 `cardStyleConfigFrom`）。 */
export const applyCardStyles = cardStyleStore.apply
