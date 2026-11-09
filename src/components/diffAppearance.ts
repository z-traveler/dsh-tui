/**
 * diff 卡的正文外观（下游）：pi-like 预置面下，代码区贴回终端底色，只有卡头
 * 保留轻微的执行状态面；双栏的增删行改铺自己的极淡衬底（新增灰绿、删除豆沙
 * 玫瑰），上下文行保持终端底。这一对衬底由主题自己的 `diffAddedWord` /
 * `diffRemovedWord` 极少量混入实际终端底色得到，不新增配色表；主体文字继续走
 * 原语法高亮，只有 changed 词使用语义词色。unified 与 split 两条路径都吃这里
 * 返回的同一份数据，diff 的解析、对齐与词级算法一行不动。
 *
 * 只在「pi-like + 预置面 + 正文确实是 diff」时启用：legacy 与当前生效的个人
 * `background`/`states` 面保持原样；选中/悬停时正文外层仍是整行真实的高亮底
 * （卡头、粗 gutter 与上下文行据此保留反馈，不被一块黑色子盒盖掉），但 split
 * 的增删行继续铺各自的内容层衬底——增删行的区别不会因为指针移上去就消失。
 * 增删词色始终按各自行衬底重挑可读槽位，不随高亮底清空；上下文/语法色仍与
 * 未选中一致。unified 没有行衬底，选中/悬停时按真实高亮底重挑增删词，不额外
 * 整行染色。
 *
 * 词色自适应：暗色代码区直接复用主题的 `diffAddedWord` / `diffRemovedWord`
 * （贴底时对比已 ≥4.5:1），压在新增的行衬底上若不足就只提亮 changed 词，不改
 * 整行语法色；浅色终端上这对词色是按深色底挑的浅粉彩，压在同色系的浅底上读不
 * 出来，于是按同一色相把亮度拉向黑/白直到达标。256 色档的增删行发明确的深绿/
 * 玫瑰槽位（不经过会把近黑压成 palette59 中灰的 6×6×6 量化），词色按该槽位的
 * 实际 RGB 重挑；16 色档没有可用的极淡阶，衬底让回终端底，词色仍只发终端自己的
 * 绿/红。高亮底另有一层（用于 unified 的增删词与没有行衬底的 16 色 split）：
 * 256 色档的高亮底会量化成中灰，直接发明确的浅绿/浅玫瑰槽位。解析与对比数学
 * 复用 `theme.ts` 的 `parseFixedColor` / `contrastRatio`，混色复用
 * `trajectory/motion` 的 `mix`。
 */
import type { Color } from '../ink/styles.js'
import type { Theme } from '../theme.js'
import { contrastRatio, parseFixedColor } from '../theme.js'
import { mix } from '../trajectory/motion.js'
import type { CardSurface } from './cardSurface.js'
import chalk from 'chalk'

/** diff 增删词的对比门槛；上下文保持原语法色，低色档限制见下文。 */
const MIN_WORD_CONTRAST = 4.5

/** 增删行衬底的混色比例：主题 diff 词色混入实际终端底色。真彩暗色底上约
 *  `#101b13` / `#201214`——有可辨色相、仍贴近黑，不压过正文。 */
const LINE_TINT_RATIO = 0.18

/** 一份 diff 正文的呈现数据，unified 行与 `SplitDiffView` 共用。 */
export interface DiffBodyAppearance {
  /** 代码区/正文的底色：pi-like 贴终端底，选中/悬停时就是整行的高亮底；
   *  `undefined` = 不涂底（legacy/用户显式面）。 */
  readonly background: Color | undefined
  /** split 的增删行让出原 `diffAddedDimmed`/`diffRemovedDimmed` 衬底
   *  （true 时上下文行透出 `background`，changed 行改铺下面的行衬底）。 */
  readonly quietTints: boolean
  /** split 增删行的极淡衬底；`undefined` = 与上下文一样透出 `background`
   *  （legacy/用户显式面、16 色档）。选中/悬停时仍按终端底计算并保留，
   *  反馈由外层高亮底、gutter 与上下文行承担。 */
  readonly addedLine: Color | undefined
  /** split 删除行的极淡衬底（见 `addedLine`）。 */
  readonly removedLine: Color | undefined
  /** 增/删词色：贴底（unified/上下文）可读的语义色；legacy 下就是原来的主题键。 */
  readonly addedWord: keyof Theme | Color
  /** 删/增词色（见 `addedWord`）。 */
  readonly removedWord: keyof Theme | Color
  /** split 增删行衬底上的词色：只在真彩/256 档铺了行衬底时给出（按该衬底
   *  重挑），其余场合与 `addedWord`/`removedWord` 相同或为 `undefined`。 */
  readonly addedLineWord: keyof Theme | Color | undefined
  readonly removedLineWord: keyof Theme | Color | undefined
}

const LEGACY_APPEARANCE: DiffBodyAppearance = {
  background: undefined,
  quietTints: false,
  addedLine: undefined,
  removedLine: undefined,
  addedWord: 'diffAddedWord',
  removedWord: 'diffRemovedWord',
  addedLineWord: undefined,
  removedLineWord: undefined,
}

/** 深底上词色太暗时，保持色相向白提亮到至少 `MIN_WORD_CONTRAST:1`。 */
function lighterUntilReadable(
  color: readonly [number, number, number],
  background: readonly [number, number, number],
): Color {
  for (let step = 1; step <= 10; step += 1) {
    const ratio = step / 10
    const channels = color.map(value => Math.round(value + (255 - value) * ratio))
    if (contrastRatio(channels as [number, number, number], background) >= MIN_WORD_CONTRAST) {
      return `rgb(${channels.join(',')})` as Color
    }
  }
  return 'rgb(255,255,255)'
}

/**
 * 浅底上的可读深词色：主题词色是按深色底挑的浅粉彩，压在浅色终端上读不出来
 * （light 主题的 `diffAddedWord` 在纯白上只有 1.5:1）。这里换成同色相的深色：
 * 真彩档发逐通道深色；256 色档直接发 22/52 槽位（`rgb(0,95,0)` 经 chalk 的
 * 6×6×6 量化会落到 28 号 `#008700`，对偏灰的白底不够；22/52 是 `#005f00` /
 * `#5f0000`，绿/玫瑰仍分得开且可读）；16 色档没有可用的深绿，只能发终端
 * 自己的绿/红槽位——可读性取决于用户的重定义，详见下游说明。
 */
const READABLE_DARK_WORDS = { added: 'rgb(0,95,0)', removed: 'rgb(95,0,0)' } as const
const READABLE_DARK_SLOTS = { added: 'ansi256(22)', removed: 'ansi256(52)' } as const
const READABLE_ANSI_WORDS = { added: 'ansi:green', removed: 'ansi:red' } as const
/** 256 色档暗高亮底上的词色：主题词色经 chalk 量化后只有 108/138，压在
 *  palette59（#5f5f5f）上约 2.6/2.0:1；这两个浅槽位对同一底约 5.8/4.8:1。 */
const READABLE_HIGHLIGHT_SLOTS = { added: 'ansi256(194)', removed: 'ansi256(224)' } as const

/** 贴底可读的词色：深底直接复用主题原词色；浅底换成可读深色。 */
function readablyOn(
  color: string,
  background: string,
  side: keyof typeof READABLE_DARK_WORDS,
): Color {
  const foreground = parseFixedColor(color)
  const behind = parseFixedColor(background)
  if (foreground === undefined || behind === undefined) return color as Color
  if (contrastRatio(foreground, behind) >= MIN_WORD_CONTRAST) return color as Color
  // 0.299/0.587/0.114：ThemeProvider 判终端明暗的同一套权重。
  const light = 0.299 * behind[0] + 0.587 * behind[1] + 0.114 * behind[2] >= 128
  if (!light) return lighterUntilReadable(foreground, behind)
  if (chalk.level >= 3) return READABLE_DARK_WORDS[side] as Color
  if (chalk.level >= 2) return READABLE_DARK_SLOTS[side] as Color
  return READABLE_ANSI_WORDS[side] as Color
}

/**
 * 选中/悬停高亮底上的词色。高亮底与终端底不同：256 色档里主题的暗色高亮
 * （`messageActionsBackground` / `toolCardBackground`）都会量化到 palette59
 * 一类的中灰，按未量化的 RGB 挑词色会差出两档以上，所以暗高亮底直接发浅色
 * 槽位；亮高亮底沿用浅底深词色。16 色档没有细阶可选，只能发终端绿/红，对比
 * 取决于用户重定义的 0–15 色（与浅底分支同一契约，不做虚假保证）。
 */
function readablyOnHighlight(color: string, background: string, side: keyof typeof READABLE_DARK_WORDS): Color {
  const foreground = parseFixedColor(color)
  const behind = parseFixedColor(background)
  if (foreground === undefined || behind === undefined) return color as Color
  if (chalk.level < 2) return READABLE_ANSI_WORDS[side] as Color
  // 0.299/0.587/0.114：ThemeProvider 判终端明暗的同一套权重。
  const light = 0.299 * behind[0] + 0.587 * behind[1] + 0.114 * behind[2] >= 128
  if (chalk.level < 3) return (light ? READABLE_DARK_SLOTS[side] : READABLE_HIGHLIGHT_SLOTS[side]) as Color
  return readablyOn(color, background, side)
}

/** 词色在给定底上是否已经达标（达标就不再为行衬底改词）。 */
function readsOn(color: string, background: string): boolean {
  const foreground = parseFixedColor(color)
  const behind = parseFixedColor(background)
  return foreground !== undefined && behind !== undefined && contrastRatio(foreground, behind) >= MIN_WORD_CONTRAST
}

/** 行衬底上的词色：原本已可读就保持原词色；否则走高亮底那套重挑——真彩档
 *  提亮/压深，256 色档改发明确的浅绿/浅玫瑰（暗底）或深绿/深玫瑰（亮底）
 *  槽位，避免朝白提亮后又被量化成与语法色相同的中灰。 */
function lineWordOn(color: string, tint: LineTint, side: keyof typeof READABLE_DARK_WORDS): Color {
  if (readsOn(color, tint.contrastBase)) return color as Color
  // `ansi:` words carry no channels to lift: use the explicit words that match
  // the tint's own polarity (the same slots the 256-colour tier uses).
  if (parseFixedColor(color) === undefined) return tintFallbackWord(tint, side)
  return readablyOnHighlight(color, tint.contrastBase, side)
}

/** 行衬底上「原词色没有通道可用」时的显式可读词色槽位。 */
function tintFallbackWord(tint: LineTint, side: keyof typeof READABLE_DARK_WORDS): Color {
  const behind = parseFixedColor(tint.contrastBase)
  // 0.299/0.587/0.114：与 ThemeProvider 判明暗同一套权重。
  const light = behind !== undefined && 0.299 * behind[0] + 0.587 * behind[1] + 0.114 * behind[2] >= 128
  return (light ? READABLE_DARK_SLOTS : READABLE_HIGHLIGHT_SLOTS)[side] as Color
}

/** 一条 split 增删行衬底：真正画给渲染器的颜色，以及词色对比要量的那个底
 *  （256 档的槽位要把它的实际 RGB 拿来算，不能拿量化前的混色）。 */
interface LineTint {
  readonly fill: Color
  /** `readablyOn` 能解析的 `rgb()` 形式：槽位用 xterm cube 的实际通道值。 */
  readonly contrastBase: string
}

/**
 * 256 色档的增删行衬底：6×6×6 量化会把近黑的 `rgb()` 混色抬成 palette59
 * 一类的中灰，所以直接命名有色的深槽位。暗色盘用 22（`#005f00` 深绿）与
 * 52（`#5f0000` 深玫瑰）；亮色盘用 151（sage）与 181（rose）。两组都保持
 * 近黑/近白的深度，且没有用灰阶冒充色相——这正是本轮要修掉的 256 退化。
 * `contrastBase` 是同一槽位的 RGB，词色按它重挑。
 */
const TIER_LINE_TINTS = {
  dark: {
    added: { fill: 'ansi256(22)', contrastBase: 'rgb(0,95,0)' },
    removed: { fill: 'ansi256(52)', contrastBase: 'rgb(95,0,0)' },
  },
  light: {
    added: { fill: 'ansi256(151)', contrastBase: 'rgb(175,215,175)' },
    removed: { fill: 'ansi256(181)', contrastBase: 'rgb(215,175,175)' },
  },
} as const satisfies Readonly<Record<'dark' | 'light', Readonly<Record<'added' | 'removed', LineTint>>>>

/** 真彩档的增删行衬底：主题自己的 diff 词色按 `LINE_TINT_RATIO` 混入实际
 *  终端底色。`diffAddedWord` 是绿偏、`diffRemovedWord` 是玫瑰偏，色相与词色
 *  同源；混色没有可解析通道（`ansi:` 主题）时这一侧不铺衬底。 */
function mixedLineTint(word: string, background: string): LineTint | undefined {
  const ink = parseFixedColor(word)
  const base = parseFixedColor(background)
  if (ink === undefined || base === undefined) return undefined
  const from = `rgb(${base.join(',')})`
  const fill = mix(from, `rgb(${ink.join(',')})`, LINE_TINT_RATIO)
  const channels = parseFixedColor(fill)
  if (channels === undefined || channels.every((value, index) => value === base[index])) return undefined
  return { fill, contrastBase: fill }
}

/** 本帧的增删行衬底：从主题词色与终端底算出，选中/悬停时同类保留。 */
function lineTintsOf(theme: Theme, terminalBackground: string): { added?: LineTint; removed?: LineTint } {
  const background = parseFixedColor(terminalBackground)
  if (background === undefined || chalk.level < 2) return {}
  if (chalk.level >= 3) {
    const added = mixedLineTint(theme.diffAddedWord, terminalBackground)
    const removed = mixedLineTint(theme.diffRemovedWord, terminalBackground)
    // An `ansi:` palette has no channels to mix; use the tier slots so its
    // split still keeps the add/del distinction even with truecolour output.
    // 0.299/0.587/0.114：实际终端底色的明暗决定取哪组槽位。
    const fallback = 0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2] >= 128
      ? TIER_LINE_TINTS.light
      : TIER_LINE_TINTS.dark
    return { added: added ?? fallback.added, removed: removed ?? fallback.removed }
  }
  // 0.299/0.587/0.114：实际终端底色的明暗决定取哪组槽位。
  const polarity = 0.299 * background[0] + 0.587 * background[1] + 0.114 * background[2] >= 128
    ? 'light'
    : 'dark'
  return { added: TIER_LINE_TINTS[polarity].added, removed: TIER_LINE_TINTS[polarity].removed }
}

/**
 * 本帧的 diff 正文外观。`active` 由卡片说明「正文是不是 diff」（错误正文、
 * 终端输出、读文件都不是）；`highlight` 是选中/悬停时整行背后的真实底色
 * （`undefined` = 没有高亮反馈，正文贴终端底）。
 */
export function diffBodyAppearance(
  surface: Pick<CardSurface, 'preset' | 'presetFace' | 'terminalBackground'>,
  theme: Theme,
  options: { readonly active: boolean; readonly highlight?: string | undefined },
): DiffBodyAppearance {
  if (!options.active || surface.preset !== 'pi-like' || !surface.presetFace) {
    return LEGACY_APPEARANCE
  }
  const highlight = options.highlight
  const background = (highlight ?? surface.terminalBackground) as Color
  // 行衬底只取决于主题词色与终端底：选中/悬停也照常铺，增删行区别不随指针
  // 消失；changed 词按各自衬底重挑。unified 没有行衬底，始终用贴终端底/真实
  // 高亮底的 `addedWord`/`removedWord`，不为统一视图新建一套染色。
  const tints = lineTintsOf(theme, surface.terminalBackground)
  return {
    background,
    quietTints: true,
    addedLine: tints.added?.fill,
    removedLine: tints.removed?.fill,
    addedWord: highlight === undefined
      ? readablyOn(theme.diffAddedWord, background, 'added')
      : readablyOnHighlight(theme.diffAddedWord, background, 'added'),
    removedWord: highlight === undefined
      ? readablyOn(theme.diffRemovedWord, background, 'removed')
      : readablyOnHighlight(theme.diffRemovedWord, background, 'removed'),
    addedLineWord: tints.added === undefined
      ? undefined
      : lineWordOn(theme.diffAddedWord, tints.added, 'added'),
    removedLineWord: tints.removed === undefined
      ? undefined
      : lineWordOn(theme.diffRemovedWord, tints.removed, 'removed'),
  }
}
