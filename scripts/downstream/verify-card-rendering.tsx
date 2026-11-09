/**
 * 对话卡片集成回归：真实渲染，读终端单元格的底色/字色。
 *
 * 覆盖 docs/downstream/card-styles.md 的呈现面：
 *   - legacy 默认：不增外框、不加留白、不涂底（工具卡的 toolBackground 旧语义保留）
 *   - pi-like：用户/工具/子代理整块底色、上下内边距 0，相邻卡之间一行不着色
 *     呼吸行；后台任务默认透明；助手/思考/摘要无填充
 *   - 公共与按类型覆盖（底色、边框、内边距、间隔）真的画在屏上
 *   - 工具/子代理两种执行状态各自成面；后台任务默认无面（显式 states 仍可
 *     启用）；取消/终止回普通底色并保留原符号
 *   - 已有折叠机制的默认展开与预览行数（未单独切换时生效，点击/Ctrl+O 仍优先）
 *   - 窄屏 + CJK/emoji：卡片内容宽度随内边距收窄，不溢出、不截断
 *   - 选中与卡面仍可分辨
 *   - Edit diff 正文：pi-like 贴终端底，选中/悬停仍保留真实高亮反馈（不吞反
 *     馈）；unified 与 split 共用呈现，split 的增删行在普通/选中/悬停都保留
 *     各自的内容衬底，增删词在三档都保持语义色且可读（16 色档只断言 ≥2:1）；
 *     悬停经真实 stdin SGR 指针移动驱动
 *   - 状态底色：真彩、256、16 色三档下三态两两可辨、正文对比达标（真彩档是
 *     低饱和豆沙色表，256 档是有色槽位，16 档是受限的可辨槽位；见
 *     `src/cardStyles.ts` 的 `PRESET_STATE_COLORS` / `TIER_STATE_FILLS`）
 *
 * 颜色断言不写死 RGB：渲染器在本机可能按 256 色量化输出。脚本先用同一终端
 * 「采样」主题键/颜色串落成的单元格底色（reference render），卡片断言再与
 * 采样值比较，环境色彩档变化不会让断言失真。
 *
 * 运行：node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
 * 预览：DSH_TUI_DUMP_FRAMES=1 打印每个场景的终屏。
 */
// Colour tiers: the default run measures truecolor; `FORCE_COLOR=2` measures the
// 256-colour tier every state tint has to survive (tmux clamps chalk there, see
// src/ink/colorize.ts); `FORCE_COLOR=1` exercises the 16-colour degradation.
// All three must pass — the cell-level assertions compare against paints sampled
// from the same renderer, so they hold at every tier.
process.env.FORCE_COLOR ??= '3'
process.env.DSH_TUI_TMUX_TRUECOLOR ??= '1'
process.env.DSH_TUI_LANG = 'en'

const [{ default: chalk }, { mkdtempSync, mkdirSync }, { tmpdir }, { join: joinPath }] = await Promise.all([
  import('chalk'),
  import('node:fs'),
  import('node:os'),
  import('node:path'),
])
// 家目录隔离在任何 lib 导入之前（DATA_DIR 在模块加载时定死）。
const isolatedHome = mkdtempSync(joinPath(tmpdir(), 'dshtui-card-render-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome
mkdirSync(joinPath(isolatedHome, '.dsh-tui'), { recursive: true })

const [{ Writable, PassThrough }, React, { Terminal: XTerm }, uiMod, listMod, stylesMod, themeMod, termTest, diffMod, jobsPanelMod] =
  await Promise.all([
    import('node:stream'),
    import('react'),
    import('@xterm/headless'),
    import('../../src/ui.js'),
    import('../../src/components/MessageList.js'),
    import('../../src/cardStyles.js'),
    import('../../src/theme.js'),
    import('../lib/term-test.mjs'),
    import('../../src/components/diffAppearance.js'),
    import('../../src/components/JobsPanel.js'),
  ])

const { render, Box, Text, ThemeProvider, AlternateScreen, useInput } = uiMod as unknown as {
  render: typeof import('../../src/ui.js').render
  Box: React.ComponentType<Record<string, unknown>>
  Text: React.ComponentType<Record<string, unknown>>
  ThemeProvider: React.ComponentType<{ theme?: string; children?: React.ReactNode }>
  AlternateScreen: React.ComponentType<{ children?: React.ReactNode }>
  useInput: typeof import('../../src/ui.js').useInput
}
const { MessageList } = listMod as unknown as { MessageList: React.ComponentType<Record<string, unknown>> }
const { applyCardStyles, cardBackgroundColor, normalizeCardStyleConfig, resolveCardStyles } =
  stylesMod as unknown as typeof import('../../src/cardStyles.js')
const { getTheme, isLightThemeActive, THEME_NAMES } = themeMod as unknown as typeof import('../../src/theme.js')
const { diffBodyAppearance } = diffMod as unknown as typeof import('../../src/components/diffAppearance.js')
const { JobsPanel } = jobsPanelMod as unknown as { JobsPanel: React.ComponentType<Record<string, unknown>> }
const { settled, viewportLines } = termTest as unknown as {
  settled(pred: () => boolean, opts?: { timeoutMs?: number }): Promise<boolean>
  viewportLines(term: InstanceType<typeof XTerm>, rows?: number): string[]
}

let failed = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  (' + extra + ')' : ''))
  if (!ok) failed += 1
}
const DUMP = process.env.DSH_TUI_DUMP_FRAMES === '1'
const NOW = Date.now()

// ---------------------------------------------------------------------------
// terminal harness
// ---------------------------------------------------------------------------
const ROWS = 40

class FakeStdout extends Writable {
  isTTY = true
  rows: number
  constructor(private term: InstanceType<typeof XTerm>, public columns: number) {
    super()
    this.rows = term.rows
  }
  _write(chunk: unknown, _encoding: unknown, callback: () => void): void {
    this.term.write(String(chunk), callback)
  }
}
class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}

/** A cell's paint, comparable across colour tiers: palette indices and RGB
 *  stay distinct, and the terminal default is its own value. */
type Paint = 'default' | `palette:${number}` | `rgb:${number}`

/** The conventional xterm 16-colour palette; palette cells below index 16
 *  resolve through this table (the same one `src/ink/screen.ts` uses). */
const XTERM_16 = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
]

type Cell = {
  isBgDefault(): boolean
  isBgPalette(): boolean
  getBgColor(): number
  isFgDefault(): boolean
  isFgPalette(): boolean
  getFgColor(): number
}

const paintOf = (cell: Cell | undefined): Paint => {
  if (cell === undefined || cell.isBgDefault()) return 'default'
  return cell.isBgPalette() ? `palette:${cell.getBgColor()}` : `rgb:${cell.getBgColor() & 0xffffff}`
}
const fgOf = (cell: Cell | undefined): Paint => {
  if (cell === undefined || cell.isFgDefault()) return 'default'
  return cell.isFgPalette() ? `palette:${cell.getFgColor()}` : `rgb:${cell.getFgColor() & 0xffffff}`
}

interface Frame {
  readonly cols: number
  lines(): string[]
  screen(): string
  rowOf(needle: string): number
  bg(x: number, y: number): Paint
  fg(x: number, y: number): Paint
  cell(x: number, y: number): Cell | undefined
  paintsInRow(y: number): Set<Paint>
  rerender(node: React.ReactNode): void
  /** SGR mode-1003 motion without buttons on the real stdin (0-based frame
   *  coordinates; the sequence itself is 1-indexed). Only a fullscreen
   *  (`AlternateScreen`) tree dispatches it as onMouseEnter/onMouseLeave. */
  mouseMove(x: number, y: number): void
}

/** The real Chat always mounts `useInput` consumers; without a subscriber the
 *  app never attaches its stdin parser, so mouse sequences die silently. */
function KeySink(): React.ReactNode {
  useInput(() => {})
  return null
}

async function withTerminal(
  cols: number,
  make: () => React.ReactNode,
  run: (frame: Frame) => Promise<void>,
  options: { readonly fullscreen?: boolean } = {},
): Promise<void> {
  const term = new XTerm({ cols, rows: ROWS, scrollback: 0, allowProposedApi: true })
  const stdout = new FakeStdout(term, cols) as unknown as NodeJS.WriteStream
  const stdin = new Input()
  const tree = options.fullscreen === true
    ? React.createElement(AlternateScreen, null, React.createElement(KeySink), make())
    : make()
  const instance = await render(tree, {
    stdout,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  const lines = (): string[] => viewportLines(term, ROWS)
  const cell = (x: number, y: number): Cell | undefined =>
    term.buffer.active.getLine(y)?.getCell(x) as unknown as Cell | undefined
  const frame: Frame = {
    cols,
    lines,
    screen: () => lines().join('\n'),
    rowOf: (needle: string) => lines().findIndex(line => line.includes(needle)),
    bg: (x, y) => paintOf(cell(x, y)),
    fg: (x, y) => fgOf(cell(x, y)),
    cell,
    paintsInRow: (y) => new Set(Array.from({ length: cols }, (_, x) => paintOf(cell(x, y)))),
    rerender: (node) => { instance.rerender(node) },
    mouseMove: (x, y) => { stdin.write(`\x1b[<35;${x + 1};${y + 1}M`) },
  }
  try {
    await run(frame)
    if (DUMP) console.log('--- frame ---\n' + frame.screen().replace(/\n+$/, '') + '\n-------------')
  } finally {
    await instance.unmount()
    term.dispose()
  }
}

/** The first paint lands asynchronously: wait for the needles before reading
 *  cells, else every sample reads the empty pre-frame buffer. */
async function ready(frame: Frame, ...needles: string[]): Promise<boolean> {
  return settled(() => needles.every(needle => frame.rowOf(needle) >= 0))
}

/**
 * Render one solid row per colour string and read the cell paint back: the
 * environment's colour tier decides how a colour reaches the screen, so every
 * assertion compares against what the SAME renderer paints for that colour.
 */
async function samplePaints(colors: readonly (string | undefined)[]): Promise<Map<string, Paint>> {
  const out = new Map<string, Paint>()
  await withTerminal(30, () => React.createElement(
    Box,
    { flexDirection: 'column' },
    ...colors.map((color, index) => React.createElement(
      Box,
      { key: index, height: 1, backgroundColor: color },
      React.createElement(Text, null, 'M'),
    )),
  ), async (frame) => {
    await ready(frame, 'M')
    for (const [index, color] of colors.entries()) {
      out.set(color ?? NONE, frame.bg(10, index))
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>
const userRow = (id: number, text: string): Row => ({ id, kind: 'user', text })
/** A team message is a `user` row whose label names a sender; the list renders
 *  it through `TeamMessageBubble` on the same `user` card face. */
const teamRow = (id: number, sender: string, text: string): Row => ({ id, kind: 'user', label: 'team-message', sender, text })
const assistantRow = (id: number, text: string, streaming = false): Row => ({ id, kind: 'assistant', text, streaming })
const reasoningRow = (id: number, text: string, streaming = true): Row => ({ id, kind: 'reasoning', text, streaming })
const noticeRow = (id: number, text: string): Row => ({ id, kind: 'notice', text })
const localRow = (id: number, text: string): Row => ({ id, kind: 'local', text })
const localOutputRow = (id: number, text: string): Row => ({ id, kind: 'local-output', text })
const compactRow = (id: number, text: string): Row => ({ id, kind: 'compact', text })
const interruptRow = (id: number): Row => ({ id, kind: 'interrupt' })

function toolRow(id: number, status: 'running' | 'ok' | 'error'): Row {
  return {
    id,
    kind: 'tool',
    text: 'bash',
    tool: {
      callId: `call-${id}`,
      name: 'bash',
      argsText: '{"command":"seq 6"}',
      status,
      startedAt: NOW - 1200,
      ...(status === 'running' ? {} : { durationMs: 1200 }),
      ...(status === 'error' ? { errorText: 'boom' } : {}),
      callView: { card: 'terminal', title: 'seq 6' },
      ...(status === 'ok'
        ? { resultView: { card: 'terminal', output: '1\n2\n3\n4\n5\n6', exitCode: 0 }, resultFull: '1\n2\n3\n4\n5\n6' }
        : {}),
    },
  }
}

function subagentRow(id: number, status: 'running' | 'starting' | 'completed' | 'failed' | 'cancelled' | 'unknown'): Row {
  const done = status !== 'running' && status !== 'starting'
  return {
    id,
    kind: 'subagent',
    text: '',
    subagent: {
      agentId: `agent-${id}`,
      description: 'Explore repository',
      status,
      startedAt: NOW - 5000,
      ...(done ? { completedAt: NOW - 1000, durationMs: 4000 } : {}),
      outputLines: ['reading files'],
      toolCalls: [],
      tokens: { total: 1200 },
      ...(status === 'failed' ? { error: 'tool failed' } : {}),
    },
  }
}

function jobRow(id: number, status: 'running' | 'stopping' | 'completed' | 'failed' | 'killed'): Row {
  const live = status === 'running' || status === 'stopping'
  return {
    id,
    kind: 'job',
    text: `job ${id}`,
    job: {
      id: `pwsh-${id}`,
      kind: 'pwsh',
      label: `run job ${id}`,
      status,
      startedAt: NOW - 4000,
      ...(live ? {} : { finishedAt: NOW - 1000, detail: 'exit code: 0' }),
      outputLines: [],
    },
  }
}

function listProps(rows: readonly Row[], opts: {
  expanded?: boolean
  expandedRows?: number[]
  jobGroupFold?: 'auto' | 'always' | 'never'
  selectedId?: number | null
} = {}): Record<string, unknown> {
  return {
    rows,
    expanded: opts.expanded === true,
    expandedRows: new Set(opts.expandedRows ?? []),
    selectedId: opts.selectedId ?? null,
    onToggleRow: (): void => {},
    model: 'deepseek-chat',
    showAll: true,
    onToggleAll(): void {},
    onLoadOlder(): void {},
    jobGroupFold: opts.jobGroupFold ?? 'auto',
  }
}
const listOf = (rows: readonly Row[], opts = {}) => (): React.ReactNode =>
  React.createElement(MessageList, listProps(rows, opts))

// ---------------------------------------------------------------------------
// reference paints (colour tier of THIS environment)
// ---------------------------------------------------------------------------
const NONE = '\u0000none'
const { stringWidth } = await import('../../src/ink/stringWidth.js')
const dark = getTheme('dark')
const piStyles = resolveCardStyles(normalizeCardStyleConfig({ preset: 'pi-like' }), { toolBackground: 'none' })
/**
 * These renders mount no ThemeProvider, so every card reads the default theme
 * context: the `dark` palette over a pure-black terminal (the OSC 11 fallback).
 * The default user face is a whisper of the palette's text colour over that
 * background, so its reference paint has to be resolved through the same
 * terminal background the components see — not from the hover token.
 */
const DEFAULT_TERMINAL = { theme: 'dark', background: '#000000' } as const
const userFaceColor = cardBackgroundColor(
  piStyles.kinds.user.background,
  dark,
  DEFAULT_TERMINAL.theme,
  DEFAULT_TERMINAL.background,
)
/** The same face for a light palette: with no OSC 11 answer the provider falls
 *  back to white for a light palette, which is what the T block renders. */
const lightUserFaceColor = cardBackgroundColor(
  piStyles.kinds.user.background,
  getTheme('light'),
  'light',
  '#ffffff',
)
const stateColors = {
  running: cardBackgroundColor(piStyles.kinds.tool.states?.running, dark, 'dark'),
  success: cardBackgroundColor(piStyles.kinds.tool.states?.success, dark, 'dark'),
  failure: cardBackgroundColor(piStyles.kinds.tool.states?.failure, dark, 'dark'),
} as const
/** The pi-like diff line tints and the theme slots the thin job line uses, all
 *  resolved through the same presentation functions the cards call. */
const darkDiffBody = diffBodyAppearance(
  { preset: 'pi-like', presetFace: true, terminalBackground: '#000000' },
  dark,
  { active: true },
)
const sampled = await samplePaints([
  userFaceColor,
  lightUserFaceColor,
  dark.userMessageBackgroundHover,
  dark.toolCardBackgroundDim,
  dark.toolCardBackground,
  dark.messageActionsBackground,
  dark.selectionBg,
  dark.diffAddedWord,
  dark.diffRemovedWord,
  dark.diffAddedDimmed,
  dark.diffRemovedDimmed,
  dark.accent,
  dark.ide,
  dark.success,
  dark.error,
  dark.inactive,
  dark.syntaxKeyword,
  dark.userPromptLabel,
  dark.warning,
  dark.subtle,
  darkDiffBody.addedLine,
  darkDiffBody.removedLine,
  '#000000',
  '#ffffff',
  '#112233',
  '#123456',
  '#19151f',
  'ansi256(235)',
  ...Object.values(stateColors),
] as string[])
const paintOfColor = (color: string | undefined): Paint => sampled.get(color ?? NONE) ?? 'default'
const face = {
  user: paintOfColor(userFaceColor),
  userLight: paintOfColor(lightUserFaceColor),
  userHover: paintOfColor(dark.userMessageBackgroundHover),
  block: paintOfColor(dark.toolCardBackgroundDim),
  hover: paintOfColor(dark.toolCardBackground),
  running: paintOfColor(stateColors.running),
  success: paintOfColor(stateColors.success),
  failure: paintOfColor(stateColors.failure),
  selection: paintOfColor(dark.messageActionsBackground),
}
const diffLine = {
  added: paintOfColor(darkDiffBody.addedLine),
  removed: paintOfColor(darkDiffBody.removedLine),
}
const jobLinePaint = {
  accent: paintOfColor(dark.accent),
  ide: paintOfColor(dark.ide),
  success: paintOfColor(dark.success),
  error: paintOfColor(dark.error),
}
const syntaxKeywordPaint = paintOfColor(dark.syntaxKeyword)
check('参考采样：三种执行状态在默认主题里两两不同且都不是「不涂底」',
  face.running !== face.success && face.success !== face.failure && face.running !== face.failure
  && ![face.running, face.success, face.failure].includes('default'),
  `${face.running} / ${face.success} / ${face.failure}`)
check('参考采样：用户卡面不是悬停/选中高亮',
  face.user !== face.userHover && face.user !== face.selection,
  `user=${face.user} hover=${face.userHover} selection=${face.selection}`)

console.log('--- T: the user face follows the provider\'s terminal background ---')
applyCardStyles({ preset: 'pi-like' })
{
  await withTerminal(80, () => React.createElement(
    ThemeProvider,
    { theme: 'light' },
    React.createElement(MessageList, listProps([userRow(1, 'hello there'), teamRow(2, 'Nova', 'team note')])),
  ), async (frame) => {
    // A light palette on a light terminal: the card takes the light-theme face
    // resolved from the provider's terminal background, not the dark one.
    check('T 卡片从 ThemeProvider 的终端底色取用户卡面',
      await settled(() => frame.rowOf('hello there') >= 0
        && frame.bg(0, frame.rowOf('hello there')) === face.userLight
        && frame.bg(79, frame.rowOf('hello there')) === face.userLight),
      `${frame.bg(0, frame.rowOf('hello there'))}/${frame.bg(79, frame.rowOf('hello there'))} want ${face.userLight}`)
    check('T 浅色终端不会是深色块（16 色档两侧都不填充）',
      chalk.level >= 2 ? face.userLight !== face.user : face.userLight === 'default' && face.user === 'default',
      `light=${face.userLight} dark=${face.user} chalk.level=${chalk.level}`)
    check('T 团队消息同样跟随', frame.rowOf('team note') >= 0 && frame.bg(0, frame.rowOf('team note')) === face.userLight,
      `${frame.bg(0, frame.rowOf('team note'))} want ${face.userLight}`)
  })
}

// ---------------------------------------------------------------------------
// L — legacy 默认：不增外框/留白，不涂底
// ---------------------------------------------------------------------------
console.log('--- L: legacy default adds nothing ---')
applyCardStyles(undefined)
{
  const rows = [
    userRow(1, 'hello there'),
    assistantRow(2, 'assistant reply'),
    reasoningRow(3, 'thinking line', false),
    toolRow(4, 'ok'),
    subagentRow(5, 'completed'),
    jobRow(6, 'completed'),
    noticeRow(7, 'a notice'),
    localRow(8, 'echo'),
    localOutputRow(9, 'output line'),
    compactRow(10, 'compacted summary body'),
  ]
  await withTerminal(80, listOf(rows), async (frame) => {
    check('L 全部行都在屏上', await ready(frame, 'hello there', 'compacted summary body', 'Bash(seq 6)'))
    const painted: string[] = []
    for (const needle of ['hello there', 'assistant reply', 'Thinking', 'Bash(seq 6)', 'agent-', 'job: pwsh-6', 'echo', 'output line', 'compacted summary body', 'a notice']) {
      const y = frame.rowOf(needle)
      if (y < 0) continue
      const rowPaints = [...frame.paintsInRow(y)].filter(paint => paint !== 'default')
      if (rowPaints.length > 0) painted.push(`${needle}@${y}:${rowPaints.join('/')}`)
    }
    check('L 没有任何卡片行涂底', painted.length === 0, painted.join(' '))
    check('L 没有卡片边框字形', !/[╭╮╰╯╎╌]/.test(frame.screen()))
    const promptY = frame.rowOf('hello there')
    check('L 用户气泡不做水平内缩（❯ 在第 0 列）', (frame.lines()[promptY] ?? '').startsWith('❯ '), JSON.stringify(frame.lines()[promptY]))
    const toolY = frame.rowOf('Bash(seq 6)')
    check('L 工具卡正文仍是「 ⎿ 」缩进', (frame.lines()[toolY + 1] ?? '').startsWith(' ⎿ '), JSON.stringify(frame.lines()[toolY + 1]))
  })
}

console.log('--- L2: legacy keeps the toolBackground tiers ---')
for (const [tier, expected] of [['subtle', paintOfColor(dark.toolCardBackgroundDim)], ['strong', paintOfColor(dark.toolCardBackground)]] as const) {
  await withTerminal(80, () => React.createElement(MessageList, {
    ...listProps([userRow(1, 'hello there'), toolRow(2, 'ok')]),
    toolBackground: tier,
  }), async (frame) => {
    check(`L2 legacy + toolBackground=${tier}：工具卡用旧底色`,
      await settled(() => frame.rowOf('Bash(seq 6)') >= 0 && frame.bg(0, frame.rowOf('Bash(seq 6)')) === expected),
      `got=${frame.bg(0, frame.rowOf('Bash(seq 6)'))} want=${expected}`)
    check(`L2 legacy + toolBackground=${tier}：其它卡片不涂底`, frame.paintsInRow(frame.rowOf('hello there')).size === 1)
    check(`L2 legacy + toolBackground=${tier}：不产生状态底色`, frame.bg(0, frame.rowOf('Bash(seq 6)')) !== face.success)
  })
}

// ---------------------------------------------------------------------------
// P — pi-like 基础方案
// ---------------------------------------------------------------------------
console.log('--- P: pi-like faces ---')
applyCardStyles({ preset: 'pi-like' })
{
  const rows = [
    userRow(1, 'hello there'),
    teamRow(2, 'Nova', 'team note'),
    assistantRow(3, 'assistant reply'),
    assistantRow(4, 'streaming reply now', true),
    reasoningRow(5, 'thinking preview'),
    compactRow(6, 'compacted summary body'),
    noticeRow(7, 'a notice'),
    localRow(8, 'echo'),
    localOutputRow(9, 'output line'),
  ]
  await withTerminal(80, listOf(rows), async (frame) => {
    check('P 用户气泡全宽涂底', await settled(() => frame.rowOf('hello there') >= 0
      && frame.bg(0, frame.rowOf('hello there')) === face.user
      && frame.bg(79, frame.rowOf('hello there')) === face.user),
    `${frame.bg(0, frame.rowOf('hello there'))}/${frame.bg(79, frame.rowOf('hello there'))}`)
    // The face follows the colour tier: a faint solid fill at truecolor/256, and
    // no fill at all at 16 colours (a pastel cannot be expressed there; see
    // src/cardStyles.ts). The sampling above resolved the same tier.
    check('P 用户卡面随色档：真彩/256 档是淡色实底，16 色档不填充',
      chalk.level >= 2 ? face.user !== 'default' : face.user === 'default',
      `chalk.level=${chalk.level} user=${face.user}`)
    check('P 用户卡面与悬停高亮可分辨（不再借 hover 色）', face.user !== face.userHover,
      `user=${face.user} hover=${face.userHover}`)
    const promptY = frame.rowOf('hello there')
    check('P 用户气泡不额外占上下空行（paddingY 0）',
      frame.bg(0, promptY - 1) === 'default' && frame.bg(0, promptY + 1) === 'default',
      `above=${frame.bg(0, promptY - 1)} below=${frame.bg(0, promptY + 1)}`)
    const teamHeadY = frame.rowOf('✉')
    check('P 相邻卡片之间有一行不着色的呼吸空间', teamHeadY - promptY === 2,
      `user=${promptY} teamHead=${teamHeadY}`)
    check('P 用户气泡与 legacy 前缀对齐（paddingX 0，❯ 在第 0 列）', (frame.lines()[promptY] ?? '').startsWith('❯ '), JSON.stringify(frame.lines()[promptY]))
    const userCell = frame.cell(2, promptY)
    check('P pi-like 用户文字保留主题橘红但不加粗', userCell !== undefined && !userCell.isBold()
      && frame.fg(2, promptY) === paintOfColor(dark.userPromptLabel))
    // Team messages ride the same `user` card face; only the sender line differs.
    const teamY = frame.rowOf('team note')
    check('P 团队消息与用户气泡用同一卡面',
      teamY >= 0 && frame.bg(0, teamY) === face.user && frame.bg(79, teamY) === face.user,
      `${frame.bg(0, teamY)}/${frame.bg(79, teamY)} want ${face.user}`)
    check('P 团队消息的发送者行也在卡面上', teamHeadY >= 0 && frame.bg(0, teamHeadY) === face.user,
      `${frame.bg(0, teamHeadY)} want ${face.user}`)
    for (const [label, needle] of [['助手', 'assistant reply'], ['流式助手', 'streaming reply now'], ['思考', 'Thinking'], ['摘要', 'compacted summary'], ['本地回显', 'echo'], ['本地输出', 'output line']] as const) {
      const y = frame.rowOf(needle)
      check(`P ${label}不涂底`, y >= 0 && frame.paintsInRow(y).size === 1, y < 0 ? 'row missing' : [...frame.paintsInRow(y)].join(','))
    }
    const noticeY = frame.rowOf('a notice')
    check('P notice 行不涂底（水平内缩只影响内容）', noticeY >= 0 && frame.paintsInRow(noticeY).size === 1)
  })
}

{
  const rows = [userRow(1, 'preset spacing switch')]
  await withTerminal(80, listOf(rows), async (frame) => {
    check('P 同一列表初始 pi-like 有一行外部呼吸空隙', await settled(() => frame.rowOf('preset spacing switch') === 1))
    applyCardStyles({ preset: 'legacy' })
    check('P 同一列表切 legacy 恢复首行原间距', await settled(() => frame.rowOf('preset spacing switch') === 0))
    applyCardStyles({ preset: 'pi-like' })
    check('P 同一列表切回 pi-like 恢复呼吸空隙', await settled(() => frame.rowOf('preset spacing switch') === 1))
  })
}

console.log('--- P0: pi-like aligns with the original prefix/gutter ---')
{
  const rows = [userRow(1, 'prefix align'), toolRow(2, 'ok'), subagentRow(3, 'completed')]
  const prefixes = async (config: unknown): Promise<{ prompt: number; gutter: number; subagent: number }> => {
    let measured = { prompt: -1, gutter: -1, subagent: -1 }
    applyCardStyles(config)
    await withTerminal(80, listOf(rows), async (frame) => {
      await ready(frame, 'prefix align', 'Explore repository')
      const lines = frame.lines()
      measured = {
        prompt: (lines[frame.rowOf('prefix align')] ?? '').indexOf('❯'),
        gutter: (lines.find(line => line.includes('⎿')) ?? '').indexOf('⎿'),
        subagent: (() => {
          const line = lines.find(entry => entry.includes('Subagent:')) ?? ''
          return line.length - line.trimStart().length
        })(),
      }
    })
    return measured
  }
  const legacyPrefixes = await prefixes(undefined)
  const piPrefixes = await prefixes({ preset: 'pi-like' })
  check('P0 默认 pi-like 的 ❯ / ⎿ / 子代理缩进与 legacy 同列',
    legacyPrefixes.prompt === 0 && piPrefixes.prompt === 0
    && legacyPrefixes.gutter === 1 && piPrefixes.gutter === 1
    && legacyPrefixes.subagent === 2 && piPrefixes.subagent === 2,
    `legacy=${JSON.stringify(legacyPrefixes)} pi=${JSON.stringify(piPrefixes)}`)
  const legacyBorder = await prefixes({ preset: 'legacy', common: { border: 'round' } })
  const piBorder = await prefixes({ preset: 'pi-like', common: { border: 'round' } })
  check('P0 描边下 pi-like 的前缀同样与 legacy 同列（边框 1 列 + 0 内边距）',
    legacyBorder.prompt === piBorder.prompt && legacyBorder.gutter === piBorder.gutter
    && legacyBorder.subagent === piBorder.subagent && legacyBorder.prompt > 0,
    `legacy=${JSON.stringify(legacyBorder)} pi=${JSON.stringify(piBorder)}`)
  applyCardStyles({ preset: 'pi-like', kinds: { user: { paddingX: 1 } } })
  await withTerminal(80, listOf([userRow(1, 'padded prompt')]), async (frame) => {
    await ready(frame, 'padded prompt')
    check('P0 用户显式 paddingX 仍优先于方案的 0',
      (frame.lines()[frame.rowOf('padded prompt')] ?? '').startsWith(' ❯ '),
      JSON.stringify(frame.lines()[frame.rowOf('padded prompt')]))
  })
  applyCardStyles({ preset: 'pi-like' })
}

console.log('--- P1: subagent compact header follows the preset, not padding ---')
{
  const rows = [subagentRow(1, 'completed')]
  applyCardStyles({ preset: 'pi-like' })
  await withTerminal(80, listOf(rows), async (frame) => {
    check('P1 pi-like 默认（无内边距）子代理头仍是紧凑单行', await ready(frame, 'Subagent: Explore'))
    const y = frame.lines().findIndex(line => line.includes('Subagent:'))
    const header = frame.lines()[y] ?? ''
    check('P1 紧凑头在同一行显示状态，不把元数据竖向散开',
      header.includes('completed') && !(frame.lines()[y + 1] ?? '').includes('repository')
      && !frame.screen().includes('1200 tok'),
      JSON.stringify(frame.lines().slice(y, y + 2)))
  })
  applyCardStyles(undefined)
  await withTerminal(80, listOf(rows), async (frame) => {
    check('P1 legacy 无覆盖仍是原来的多行树', await ready(frame, 'Subagent: Explore'))
    const y = frame.lines().findIndex(line => line.includes('Subagent:'))
    check('P1 legacy 保留原元数据与换行',
      frame.screen().includes('1200') && (frame.lines()[y + 1] ?? '').includes('repository'),
      JSON.stringify(frame.lines().slice(y, y + 2)))
  })
  applyCardStyles({ preset: 'pi-like' })
  await withTerminal(40, listOf(rows), async (frame) => {
    check('P1 窄屏 pi-like 仍是紧凑单行（状态词按预算隐藏）', await ready(frame, 'Subagent: Explore'))
    const y = frame.lines().findIndex(line => line.includes('Subagent:'))
    check('P1 窄屏紧凑头不折行、仍保留状态字形',
      !(frame.lines()[y + 1] ?? '').includes('repository') && frame.screen().includes('✓'),
      JSON.stringify(frame.lines().slice(y, y + 2)))
  })
  applyCardStyles({ preset: 'pi-like' })
}

console.log('--- P2: pi-like block faces ---')
{
  const rows = [toolRow(1, 'running'), toolRow(2, 'ok'), toolRow(3, 'error'), subagentRow(4, 'completed'), jobRow(5, 'completed')]
  await withTerminal(90, listOf(rows), async (frame) => {
    check('P2 五张卡片都在屏上', await ready(frame, 'job: pwsh-5'))
    const heads = frame.lines().map((line, y) => (line.includes('Bash(seq 6)') ? y : -1)).filter(y => y >= 0)
    check('P2 三张工具卡都在屏上', heads.length === 3, JSON.stringify(heads))
    const headFaces = heads.map(y => frame.bg(0, y))
    check('P2 三张工具卡底色两两不同', new Set(headFaces).size === 3, headFaces.join(' / '))
    check('P2 running=执行中面 / ok=成功面 / error=失败面',
      headFaces[0] === face.running && headFaces[1] === face.success && headFaces[2] === face.failure,
      `${headFaces[0]}/${headFaces[1]}/${headFaces[2]} 期望 ${face.running}/${face.success}/${face.failure}`)
    check('P2 状态底色只覆盖卡片行（paddingY 0，不再垫高）',
      frame.bg(0, heads[0]! - 1) === 'default', `above=${frame.bg(0, heads[0]! - 1)}`)
    check('P2 相邻背景卡之间只有一行不着色空隙',
      frame.paintsInRow(heads[1]! - 1).size === 1 && frame.paintsInRow(heads[2]! - 1).size === 1,
      `rows=${[heads[1]! - 1, heads[2]! - 1].map(y => [...frame.paintsInRow(y)].join(',')).join(' / ')}`)
    check('P2 子代理完成 → 成功面', frame.bg(0, frame.rowOf('Explore repository')) === face.success,
      `${frame.bg(0, frame.rowOf('Explore repository'))}`)
    check('P2 后台任务默认透明（普通面与状态面都不涂）',
      frame.bg(0, frame.rowOf('job: pwsh-5')) === 'default' && (frame.lines()[frame.rowOf('job: pwsh-5')] ?? '').includes('✓'),
      `${frame.bg(0, frame.rowOf('job: pwsh-5'))} ${JSON.stringify(frame.lines()[frame.rowOf('job: pwsh-5')])}`)
  })
}

console.log('--- P3: pi-like job group stays transparent (folded and expanded) ---')
{
  const rows = [jobRow(1, 'completed'), jobRow(2, 'completed'), jobRow(3, 'completed')]
  await withTerminal(100, listOf(rows, { jobGroupFold: 'never' }), async (frame) => {
    check('P3 展开的任务组：组头与成员卡都在屏上', await ready(frame, 'background jobs ×3', 'job: pwsh-3'))
    const heads = [1, 2, 3].map(id => frame.rowOf(`job: pwsh-${id}`))
    check('P3 成员卡默认不涂底、状态字形保留',
      heads.every(y => y >= 0 && frame.paintsInRow(y).size === 1)
      && (frame.lines()[heads[0]!] ?? '').includes('✓')
      && rows.length === 3,
      heads.map(y => `${y}:${[...frame.paintsInRow(y)].join(',')}`).join(' / '))
    check('P3 相邻成员之间没有额外空行（组内与 legacy 一样紧贴）',
      heads[1]! - heads[0]! === 2 && heads[2]! - heads[1]! === 2
      && (frame.lines()[heads[0]! + 2] ?? '').includes('job: pwsh-2')
      && (frame.lines()[heads[1]! + 2] ?? '').includes('job: pwsh-3'),
      `heads=${JSON.stringify(heads)}`)
    // legacy 的组内排版就是「卡高 2 行 + 0 间隔」；pi-like 必须与它一致。
    applyCardStyles(undefined)
    await withTerminal(100, listOf(rows, { jobGroupFold: 'never' }), async (legacyFrame) => {
      await ready(legacyFrame, 'job: pwsh-3')
      const legacyHeads = [1, 2, 3].map(id => legacyFrame.rowOf(`job: pwsh-${id}`))
      check('P3 组内紧贴与 legacy 逐行一致',
        JSON.stringify(legacyHeads.map((y, index) => y - legacyHeads[0]!))
          === JSON.stringify(heads.map((y, index) => y - heads[0]!)),
        `legacy=${JSON.stringify(legacyHeads)} pi=${JSON.stringify(heads)}`)
    })
    applyCardStyles({ preset: 'pi-like' })
  })
  await withTerminal(100, listOf(rows), async (frame) => {
    check('P3 折叠组只画组头，且组头也不涂底',
      await settled(() => frame.screen().includes('background jobs folded'))
      && frame.rowOf('job: pwsh-1') === -1
      && frame.paintsInRow(frame.rowOf('background jobs folded')).size === 1,
      frame.screen().split('\n').slice(0, 5).join('|'))
  })
  const painted = await samplePaints(['#123456'])
  applyCardStyles({ preset: 'pi-like', kinds: { job: { states: { success: '#123456' } } } })
  await withTerminal(90, listOf([jobRow(1, 'completed')]), async (frame) => {
    check('P3 个人显式 job 状态底色仍能启用',
      await settled(() => frame.rowOf('job: pwsh-1') >= 0 && frame.bg(0, frame.rowOf('job: pwsh-1')) === painted.get('#123456')),
      `got=${frame.bg(0, frame.rowOf('job: pwsh-1'))} want=${painted.get('#123456')}`)
  })
  applyCardStyles({ preset: 'pi-like' })
}

console.log('--- P4: bordered subagent clips inside its own indent ---')
{
  applyCardStyles({ preset: 'pi-like', common: { border: 'round' } })
  const longArgs = 'x'.repeat(300)
  const row: Row = {
    id: 1,
    kind: 'subagent',
    text: '',
    subagent: {
      agentId: 'running-long',
      description: 'Explore repository',
      status: 'running',
      startedAt: NOW - 1000,
      outputLines: ['y'.repeat(300)],
      toolCalls: [{ name: 'read', status: 'running', argsPreview: longArgs }],
      tokens: { total: 1 },
    },
  }
  await withTerminal(80, listOf([row]), async (frame) => {
    check('P4 运行中的描边子代理在屏上', await ready(frame, 'Explore', 'read ('))
    const lines = frame.lines()
    const top = lines.find(line => line.trimStart().startsWith('╭')) ?? ''
    const toolLine = lines.find(line => line.includes('read (')) ?? ''
    check('P4 子代理卡框按 80 列收边', top.length > 0 && top.trimEnd().length <= 80, `top=${top.length}`)
    check('P4 子代理工具行按自有缩进裁剪，省略号留在卡内',
      toolLine.includes('…') && toolLine.trimEnd().length <= 80,
      `len=${toolLine.trimEnd().length} ${JSON.stringify(toolLine)}`)
    const waterfall = lines.find(line => line.includes('│ yyyy')) ?? ''
    check('P4 运行中的水流行不超过卡内容宽', waterfall.trimEnd().length <= 80,
      `len=${waterfall.trimEnd().length} ${JSON.stringify(waterfall)}`)
  })
  for (const columns of [30, 40, 80]) {
    await withTerminal(columns, listOf([subagentRow(1, 'completed')]), async (frame) => {
      await ready(frame, '╰')
      const top = frame.lines().findIndex(line => line.includes('╭'))
      const bottom = frame.lines().findIndex(line => line.includes('╰'))
      check(`P4 ${columns}列落定子代理标题保持单行`, bottom - top === 2, `top=${top} bottom=${bottom}`)
      check(`P4 ${columns}列子代理标题仍显示任务描述`, frame.screen().includes('Explore'))
      check(`P4 ${columns}列子代理使用单列完成字形`, frame.screen().includes('✓') && !frame.screen().includes('🟢'))
    })
  }
  applyCardStyles({ preset: 'pi-like' })
}

// ---------------------------------------------------------------------------
// D — pi-like Edit diff body: code area follows the terminal, header keeps the face
// ---------------------------------------------------------------------------
console.log('--- D: diff body presentation ---')
const EDIT_DIFFS = [{ path: '/tmp/edit.ts', oldText: 'const a = 1\nkeep()', newText: 'const a = 2\nkeep()' }]
const PATCH_DIFFS = [{ path: '/tmp/edit.ts', patch: ['@@ -1,2 +1,2 @@', '-const a = 1', '+const a = 2', ' keep()'].join('\n') }]
function editRow(id: number, diffs: Row[] | Record<string, unknown>[], status: 'ok' | 'running' | 'error' = 'ok'): Row {
  return {
    id,
    kind: 'tool',
    text: 'edit',
    tool: {
      callId: `edit-${id}`,
      name: 'edit',
      argsText: '{}',
      status,
      startedAt: NOW - 100,
      ...(status === 'running' ? {} : { durationMs: 100 }),
      callView: { card: 'diff', title: 'Edit /tmp/edit.ts', diffs },
      ...(status === 'ok' ? { resultView: { card: 'diff', title: 'Edit /tmp/edit.ts', diffs }, resultFull: 'ok' } : {}),
    },
  }
}
const MIN_DIFF_CONTRAST = 4.5
/** Rec. 601 luma of a painted cell background, 0–255: the "near black" axis
 *  the faint line tints are judged on (WCAG relative luminance would call the
 *  256 slots dark enough but not "near black"). */
const paintLuma = (paint: Paint): number | undefined => {
  const rgb = paintColor(paint)
  return rgb === undefined ? undefined : 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
}
/** Actual cell contrast for a word: its fg against the cell's own bg (the
 *  terminal default stands in when the renderer left the cell unpainted). */
const DARK_DEFAULT_FG = { r: 255, g: 255, b: 255 }
const LIGHT_DEFAULT_FG = { r: 0, g: 0, b: 0 }
function wordContrast(frame: Frame, x: number, y: number, fallback = DARK_DEFAULT_FG): number {
  const fg = paintColor(frame.fg(x, y)) ?? fallback
  const bg = paintColor(frame.bg(x, y)) ?? fallback
  const first = luminance(fg)
  const second = luminance(bg)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}
/** The 16-colour red/green slots cannot reach AA on black (xterm red is
 *  #cd0000 ≈3.6:1); every richer tier must. */
const diffContrastFloor = (): number => (chalk.level >= 2 ? MIN_DIFF_CONTRAST : 3)
const bodyPaint = paintOfColor('#000000')
/** 120-column split geometry: a 3-cell card gutter, then a 57-cell old pane, a
 *  1-cell divider and a 57-cell new pane. These are the first cells inside each
 *  pane (the old row's x=0 belongs to the untinted card gutter). */
const SPLIT_LEFT_X = 3
const SPLIT_RIGHT_X = 117
const SPLIT_DIVIDER_X = 60
{
  const legacyWordPaints = { del: paintOfColor(dark.diffRemovedWord), add: paintOfColor(dark.diffAddedWord) }
  applyCardStyles({ preset: 'pi-like' })
  await withTerminal(80, listOf([editRow(1, EDIT_DIFFS)]), async (frame) => {
    check('D unified 80：Edit 卡与正文在屏上', await ready(frame, 'Edit /tmp/edit.ts', 'const a = 1', 'const a = 2'))
    const header = frame.rowOf('Edit /tmp/edit.ts')
    check('D unified 80：卡头保留成功状态面', frame.bg(0, header) === face.success, `${frame.bg(0, header)} want ${face.success}`)
    const delY = frame.rowOf('const a = 1')
    const addY = frame.rowOf('const a = 2')
    check('D unified 80：代码区贴终端底（不再被状态面压暗）',
      frame.bg(0, delY) === bodyPaint && frame.bg(79, delY) === bodyPaint
      && frame.bg(0, addY) === bodyPaint && frame.bg(79, addY) === bodyPaint,
      `del=${frame.bg(0, delY)}/${frame.bg(79, delY)} add=${frame.bg(0, addY)}/${frame.bg(79, addY)} want=${bodyPaint}`)
    const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
    const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
    check('D unified 80：增/删词仍是原主题语义色',
      frame.fg(delX, delY) === legacyWordPaints.del && frame.fg(addX, addY) === legacyWordPaints.add,
      `del=${frame.fg(delX, delY)} add=${frame.fg(addX, addY)}`)
    check(`D unified 80：增/删字实际对比 ≥ ${diffContrastFloor()}:1`,
      wordContrast(frame, delX, delY) >= diffContrastFloor() && wordContrast(frame, addX, addY) >= diffContrastFloor(),
      `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
    check('D unified 80：没有整片 palette59 中灰', !frame.paintsInRow(delY).has('palette:59'))
  })
  await withTerminal(80, listOf([editRow(2, PATCH_DIFFS)]), async (frame) => {
    check('D unified 80 patch：正文在屏上', await ready(frame, 'const a = 1', 'const a = 2'))
    const delY = frame.rowOf('const a = 1')
    const addY = frame.rowOf('const a = 2')
    const delX = (frame.lines()[delY] ?? '').lastIndexOf('1')
    const addX = (frame.lines()[addY] ?? '').lastIndexOf('2')
    check('D unified 80 patch：代码区贴终端底',
      frame.bg(0, delY) === bodyPaint && frame.bg(79, addY) === bodyPaint,
      `${frame.bg(0, delY)}/${frame.bg(79, addY)} want ${bodyPaint}`)
    check('D unified 80 patch：增/删词语义色 + 可读',
      frame.fg(delX, delY) === legacyWordPaints.del && frame.fg(addX, addY) === legacyWordPaints.add
      && wordContrast(frame, delX, delY) >= diffContrastFloor() && wordContrast(frame, addX, addY) >= diffContrastFloor(),
      `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
    check('D unified 80 patch：没有整片 palette59 中灰', !frame.paintsInRow(delY).has('palette:59'))
  })
  await withTerminal(120, listOf([editRow(3, EDIT_DIFFS)]), async (frame) => {
    check('D split 120：双栏正文在屏上', await ready(frame, 'const a = 1', 'const a = 2', 'keep()'))
    const header = frame.rowOf('Edit /tmp/edit.ts')
    check('D split 120：卡头保留成功状态面', frame.bg(0, header) === face.success, `${frame.bg(0, header)}`)
    const row = frame.rowOf('const a = 1')
    const line = frame.lines()[row] ?? ''
    // Changed rows keep a faint per-side substrate; context falls through to
    // the terminal. At 16 colours there is no faint step, so the two sides
    // share the terminal and only the word colours differentiate them.
    if (chalk.level >= 2) {
      check('D split 120：删除行是极淡豆沙衬底，新增行是极淡灰绿衬底',
        frame.bg(SPLIT_LEFT_X, row) === diffLine.removed && frame.bg(SPLIT_RIGHT_X, row) === diffLine.added,
        `old=${frame.bg(SPLIT_LEFT_X, row)} new=${frame.bg(SPLIT_RIGHT_X, row)} want ${diffLine.removed}/${diffLine.added}`)
      check('D split 120：增删行衬底彼此不同且都贴近黑底',
        diffLine.added !== diffLine.removed && diffLine.added !== bodyPaint && diffLine.removed !== bodyPaint
        && (paintLuma(diffLine.added) ?? 255) <= 80 && (paintLuma(diffLine.removed) ?? 255) <= 80,
        `old=${paintLuma(diffLine.removed)?.toFixed(1)} new=${paintLuma(diffLine.added)?.toFixed(1)}`)
    } else {
      check('D split 120（16 色）：没有可用的极淡增删衬底，正文仍贴终端底',
        frame.bg(SPLIT_LEFT_X, row) === bodyPaint && frame.bg(SPLIT_RIGHT_X, row) === bodyPaint,
        `${frame.bg(SPLIT_LEFT_X, row)}/${frame.bg(SPLIT_RIGHT_X, row)}`)
    }
    check('D split 120：卡片 gutter 与分栏线不跟着增删行染色',
      frame.bg(0, row) === bodyPaint && frame.bg(SPLIT_DIVIDER_X, row) === bodyPaint,
      `gutter=${frame.bg(0, row)} divider=${frame.bg(SPLIT_DIVIDER_X, row)}`)
    const legacyTints = [paintOfColor(dark.diffRemovedDimmed), paintOfColor(dark.diffAddedDimmed)]
    check('D split 120：增删行不再自涂量化中灰',
      !frame.paintsInRow(row).has('palette:59')
      // 16 色档的原衬底本身也量化成黑，与贴底色不可分；只在能区分的色档上
      // 断言「没有那块中灰」。
      && legacyTints.every(paint => paint === bodyPaint || !frame.paintsInRow(row).has(paint)),
      [...frame.paintsInRow(row)].join(','))
    const delX = line.indexOf('const a = 1') + 'const a = '.length
    const addX = line.indexOf('const a = 2') + 'const a = '.length
    const delCell = frame.cell(delX, row)
    const addCell = frame.cell(addX, row)
    check('D split 120：changed 词仍有语义色与 bold',
      frame.fg(delX, row) !== 'default' && frame.fg(addX, row) !== 'default'
      && frame.fg(delX, row) !== frame.fg(addX, row)
      && Boolean(delCell?.isBold()) && Boolean(addCell?.isBold()),
      `del=${frame.fg(delX, row)} add=${frame.fg(addX, row)} bold=${String(delCell?.isBold())}/${String(addCell?.isBold())}`)
    check(`D split 120：changed 词实际对比 ≥ ${diffContrastFloor()}:1（对各自行底）`,
      wordContrast(frame, delX, row) >= diffContrastFloor() && wordContrast(frame, addX, row) >= diffContrastFloor(),
      `del=${wordContrast(frame, delX, row).toFixed(2)} add=${wordContrast(frame, addX, row).toFixed(2)}`)
    // 语法/未改变量仍走原语法色：`const` 是 keyword，不属于 changed 片段。
    const keywordX = line.indexOf('const a = 1')
    check('D split 120：未改动的 keyword 语法色与 legacy 相同',
      frame.fg(keywordX, row) === syntaxKeywordPaint,
      `got=${frame.fg(keywordX, row)} want=${syntaxKeywordPaint}`)
    const contextY = frame.rowOf('keep()')
    const contextX = (frame.lines()[contextY] ?? '').indexOf('keep()')
    check('D split 120：上下文行安静（贴底、无增删衬底/词色）',
      frame.bg(SPLIT_LEFT_X, contextY) === bodyPaint && frame.bg(SPLIT_RIGHT_X, contextY) === bodyPaint
      && frame.fg(contextX, contextY) !== frame.fg(delX, row)
      && frame.fg(contextX, contextY) !== frame.fg(addX, row),
      `bg=${frame.bg(SPLIT_LEFT_X, contextY)}/${frame.bg(SPLIT_RIGHT_X, contextY)} fg=${frame.fg(contextX, contextY)}`)
    check('D split 120：上下文与增删有层次（词色不同）',
      frame.fg(contextX, contextY) !== frame.fg(delX, row) && frame.fg(contextX, contextY) !== frame.fg(addX, row),
      `ctx=${frame.fg(contextX, contextY)} del=${frame.fg(delX, row)} add=${frame.fg(addX, row)}`)
  })
  await withTerminal(120, listOf([editRow(4, PATCH_DIFFS)]), async (frame) => {
    check('D split 120 patch：正文在屏上', await ready(frame, 'const a = 1', 'const a = 2', 'keep()'))
    const row = frame.rowOf('const a = 1')
    const line = frame.lines()[row] ?? ''
    const delX = line.indexOf('const a = 1') + 'const a = '.length
    const addX = line.indexOf('const a = 2') + 'const a = '.length
    if (chalk.level >= 2) {
      check('D split 120 patch：增删行有极淡语义衬底且无 palette59',
        frame.bg(SPLIT_LEFT_X, row) === diffLine.removed && frame.bg(SPLIT_RIGHT_X, row) === diffLine.added
        && !frame.paintsInRow(row).has('palette:59'),
        `${frame.bg(SPLIT_LEFT_X, row)}/${frame.bg(SPLIT_RIGHT_X, row)}`)
    } else {
      check('D split 120 patch（16 色）：正文贴终端底且无 palette59',
        frame.bg(SPLIT_LEFT_X, row) === bodyPaint && frame.bg(SPLIT_RIGHT_X, row) === bodyPaint
        && !frame.paintsInRow(row).has('palette:59'),
        `${frame.bg(SPLIT_LEFT_X, row)}/${frame.bg(SPLIT_RIGHT_X, row)}`)
    }
    check('D split 120 patch：增/删词语义色 + 可读',
      frame.fg(delX, row) !== 'default' && frame.fg(addX, row) !== 'default'
      && wordContrast(frame, delX, row) >= diffContrastFloor() && wordContrast(frame, addX, row) >= diffContrastFloor(),
      `del=${wordContrast(frame, delX, row).toFixed(2)} add=${wordContrast(frame, addX, row).toFixed(2)}`)
  })

  // legacy：正文不铺底、分栏仍自涂原衬底——本轮一行不改。
  applyCardStyles(undefined)
  await withTerminal(80, listOf([editRow(5, EDIT_DIFFS)]), async (frame) => {
    await ready(frame, 'const a = 1')
    const delY = frame.rowOf('const a = 1')
    const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
    check('D legacy unified：正文不铺底、词色原样',
      frame.bg(0, delY) === 'default' && frame.fg(delX, delY) === legacyWordPaints.del,
      `bg=${frame.bg(0, delY)} fg=${frame.fg(delX, delY)}`)
  })
  await withTerminal(120, listOf([editRow(6, EDIT_DIFFS)]), async (frame) => {
    await ready(frame, 'const a = 1')
    const row = frame.rowOf('const a = 1')
    const line = frame.lines()[row] ?? ''
    const delX = line.indexOf('const a = 1')
    const addX = line.indexOf('const a = 2')
    check('D legacy split：增删行仍自涂原 diffAdded/RemovedDimmed',
      frame.bg(delX, row) === paintOfColor(dark.diffRemovedDimmed)
      && frame.bg(addX, row) === paintOfColor(dark.diffAddedDimmed),
      `old=${frame.bg(delX, row)} new=${frame.bg(addX, row)}`)
  })

  // 语法色真源：极淡行衬底只铺底，不把未改动的代码整行重染。对照 legacy 的
  // 同一条真实渲染（不是只读主题键采样），并等 cli-highlight 真正落色后再读，
  // 避免两边都还是 default 的空断言。
  {
    type SyntaxPaints = { readonly keyword: Paint; readonly variable: Paint }
    const readSyntaxPaints = async (frame: Frame, needle: string): Promise<SyntaxPaints | undefined> => {
      await ready(frame, needle)
      const y = frame.rowOf(needle)
      if (y < 0) return undefined
      const x = (frame.lines()[y] ?? '').indexOf(needle)
      const variableX = x + 'const '.length
      const landed = await settled(() => frame.fg(x, y) !== 'default' && frame.fg(variableX, y) !== 'default')
      return landed ? { keyword: frame.fg(x, y), variable: frame.fg(variableX, y) } : undefined
    }
    let piPaints: SyntaxPaints | undefined
    let legacyPaints: SyntaxPaints | undefined
    applyCardStyles({ preset: 'pi-like' })
    await withTerminal(120, listOf([editRow(13, EDIT_DIFFS)]), async (frame) => {
      piPaints = await readSyntaxPaints(frame, 'const a = 1')
    })
    applyCardStyles(undefined)
    await withTerminal(120, listOf([editRow(14, EDIT_DIFFS)]), async (frame) => {
      legacyPaints = await readSyntaxPaints(frame, 'const a = 1')
    })
    check('D split：未改动的 keyword/变量实际前景与 legacy 相同',
      piPaints !== undefined && legacyPaints !== undefined
      && piPaints.keyword === legacyPaints.keyword && piPaints.variable === legacyPaints.variable,
      `pi=${JSON.stringify(piPaints)} legacy=${JSON.stringify(legacyPaints)}`)
  }

  applyCardStyles(undefined)
  await withTerminal(120, () => React.createElement(MessageList, {
    ...listProps([editRow(60, EDIT_DIFFS)]), toolBackground: 'subtle',
  }), async (frame) => {
    await ready(frame, 'const a = 1', 'keep()')
    const headerY = frame.rowOf('Edit /tmp/edit.ts')
    const contextY = frame.rowOf('keep()')
    const contextX = (frame.lines()[contextY] ?? '').indexOf('keep()')
    frame.mouseMove(10, contextY)
    check('D legacy split：真实悬停触发指示', await settled(() => (frame.lines()[headerY] ?? '').includes('▾')))
    check('D legacy split：悬停时上下文仍保留原subtle面',
      await settled(() => frame.bg(contextX, contextY) === paintOfColor(dark.toolCardBackgroundDim)),
      `got=${frame.bg(contextX, contextY)} want=${paintOfColor(dark.toolCardBackgroundDim)}`)
  }, { fullscreen: true })

  applyCardStyles({ preset: 'legacy', kinds: { tool: { background: '#112233' } } })
  await withTerminal(120, () => React.createElement(MessageList, {
    ...listProps([editRow(61, EDIT_DIFFS)]), toolBackground: 'subtle',
  }), async (frame) => {
    await ready(frame, 'keep()')
    const y = frame.rowOf('keep()')
    const x = (frame.lines()[y] ?? '').indexOf('keep()')
    check('D legacy 显式背景不被subtle上下文面盖掉', frame.bg(x, y) === paintOfColor('#112233'),
      `got=${frame.bg(x, y)} want=${paintOfColor('#112233')}`)
  })

  // 显式覆盖与选中反馈优先：不能把用户的底/选中色换成终端黑。
  applyCardStyles({ preset: 'pi-like', kinds: { tool: { background: '#112233', states: { running: 'none', success: 'none', failure: 'none' } } } })
  await withTerminal(80, listOf([editRow(7, EDIT_DIFFS)]), async (frame) => {
    await ready(frame, 'const a = 1')
    const y = frame.rowOf('const a = 1')
    check('D 显式 background 优先：diff 正文仍用用户底色（低色档可能与黑同槽）',
      frame.bg(0, y) === paintOfColor('#112233') && frame.bg(79, y) === paintOfColor('#112233'),
      `${frame.bg(0, y)}/${frame.bg(79, y)} want ${paintOfColor('#112233')}`)
  })
  applyCardStyles({ preset: 'pi-like', kinds: { tool: { states: { success: '#123456' } } } })
  await withTerminal(80, listOf([editRow(8, EDIT_DIFFS)]), async (frame) => {
    await ready(frame, 'const a = 1')
    const header = frame.rowOf('Edit /tmp/edit.ts')
    const y = frame.rowOf('const a = 1')
    check('D 显式 states 优先：卡头与正文都用用户色',
      frame.bg(0, header) === paintOfColor('#123456') && frame.bg(0, y) === paintOfColor('#123456'),
      `header=${frame.bg(0, header)} body=${frame.bg(0, y)}`)
  })
  applyCardStyles({ preset: 'pi-like' })
  for (const columns of [80, 120]) {
    await withTerminal(columns, () => React.createElement(MessageList, { ...listProps([editRow(9, EDIT_DIFFS)], { selectedId: 9 }) }), async (frame) => {
      await ready(frame, 'const a = 1', 'const a = 2')
      const delY = frame.rowOf('const a = 1')
      const addY = frame.rowOf('const a = 2')
      check(`D ${columns}列选中反馈不被黑色子盒吞掉`, frame.bg(0, delY) === face.selection && frame.bg(columns - 1, delY) === face.selection,
        `${frame.bg(0, delY)}/${frame.bg(columns - 1, delY)} want ${face.selection}`)
      if (columns === 120 && chalk.level >= 2) {
        const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
        const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
        check('D split选中时仍保留增删行底色区别', frame.bg(delX, delY) !== frame.bg(addX, addY),
          `del=${frame.bg(delX, delY)} add=${frame.bg(addX, addY)}`)
        const contextY = frame.rowOf('keep()')
        const contextX = (frame.lines()[contextY] ?? '').indexOf('keep()')
        check('D split选中时上下文仍显示选择反馈', contextY >= 0 && frame.bg(contextX, contextY) === face.selection)
      } else {
        check(`D ${columns}列选中行内部保持高亮底`,
          frame.bg(3, delY) === face.selection && frame.bg(Math.floor(columns / 2), delY) === face.selection,
          `${frame.bg(3, delY)}/${frame.bg(Math.floor(columns / 2), delY)} want ${face.selection}`)
      }
      if (chalk.level >= 2) {
        const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
        const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
        check(`D ${columns}列选中时增删字仍可读（≥4.5:1）`,
          wordContrast(frame, delX, delY) >= MIN_DIFF_CONTRAST && wordContrast(frame, addX, addY) >= MIN_DIFF_CONTRAST,
          `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
      } else {
        // 16 色档没有可用的深/浅细阶：选中底与终端底都量化到 palette 0，只
        // 要求终端自己的绿/红仍能读（≥2:1），不虚假保证高亮对比。
        const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
        const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
        check(`D ${columns}列选中时增删字仍可读（16 色，≥2:1）`,
          wordContrast(frame, delX, delY) >= 2 && wordContrast(frame, addX, addY) >= 2,
          `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
      }
    })
  }

  // 悬停：全屏 + 真实 SGR mode-1003 指针移动，经 stdin → App → dispatchHover →
  // 卡片 onMouseEnter。不走任何内部 callback，也不只测纯函数（那条在
  // verify-card-styles 里）。悬停与选中走同一份 diff 呈现，只是真实高亮底不同。
  await withTerminal(80, listOf([editRow(11, EDIT_DIFFS)]), async (frame) => {
    check('D 悬停就绪：Edit 卡与正文在屏', await ready(frame, 'const a = 1', 'const a = 2'))
    const headerY = frame.rowOf('Edit /tmp/edit.ts')
    const delY = frame.rowOf('const a = 1')
    const addY = frame.rowOf('const a = 2')
    check('D 悬停前：代码区贴终端底',
      frame.bg(0, delY) === bodyPaint && frame.bg(0, addY) === bodyPaint,
      `${frame.bg(0, delY)}/${frame.bg(0, addY)} want ${bodyPaint}`)
    check('D 悬停前：卡头没有悬停指示', !(frame.lines()[headerY] ?? '').includes('▾'))
    frame.mouseMove(10, delY)
    // 这一条与颜色无关，证明 SGR 真的走完 stdin → App → dispatchHover 全链；
    // 16 色档的悬停底可能与终端底同槽，颜色断言在那里不具区分力。
    check('D 悬停：真实指针移动触发卡头 ▾ 指示',
      await settled(() => (frame.lines()[headerY] ?? '').includes('▾')),
      JSON.stringify(frame.lines()[headerY]))
    check('D 悬停：整行保留悬停高亮（不被黑色子盒吞掉）',
      await settled(() => frame.bg(0, delY) === face.hover && frame.bg(79, delY) === face.hover
        && frame.bg(0, addY) === face.hover && frame.bg(79, addY) === face.hover),
      `${frame.bg(0, delY)}/${frame.bg(79, delY)} want ${face.hover}`)
    const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
    const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
    check('D 悬停：增/删词仍带语义色且可区分',
      frame.fg(delX, delY) !== 'default' && frame.fg(addX, addY) !== 'default'
      && frame.fg(delX, delY) !== frame.fg(addX, addY),
      `del=${frame.fg(delX, delY)} add=${frame.fg(addX, addY)}`)
    if (chalk.level >= 2) {
      check('D 悬停：增删字对悬停底可读（≥4.5:1）',
        wordContrast(frame, delX, delY) >= MIN_DIFF_CONTRAST && wordContrast(frame, addX, addY) >= MIN_DIFF_CONTRAST,
        `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
    } else {
      // 16 色档的物理限制：高亮底与终端底都量化到 palette 0，只能断言前景仍有
      // 色相区分、能读（不虚假保证高亮可见性）。
      check('D 悬停（16 色）：增删字仍可读（≥2:1）',
        wordContrast(frame, delX, delY) >= 2 && wordContrast(frame, addX, addY) >= 2,
        `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
    }
    frame.mouseMove(1, 0)
    check('D 移开悬停：卡头悬停指示消失',
      await settled(() => !(frame.lines()[headerY] ?? '').includes('▾')))
    check('D 移开悬停：代码区回到终端底',
      await settled(() => frame.bg(0, delY) === bodyPaint && frame.bg(79, delY) === bodyPaint),
      `${frame.bg(0, delY)}/${frame.bg(79, delY)} want ${bodyPaint}`)
  }, { fullscreen: true })

  // 120 双栏悬停：同一套真实 SGR 指针移动。悬停的整行反馈由卡头、卡片粗
  // gutter 与上下文行承担；增删行仍铺各自的内容衬底，old/new 的区别不随指针
  // 移入消失、移出后也仍在。80 列 unified 的整行 hover 语义由上一块保持。
  await withTerminal(120, listOf([editRow(12, EDIT_DIFFS)]), async (frame) => {
    check('D split 悬停就绪：双栏正文在屏', await ready(frame, 'const a = 1', 'const a = 2', 'keep()'))
    const headerY = frame.rowOf('Edit /tmp/edit.ts')
    const delY = frame.rowOf('const a = 1')
    const addY = frame.rowOf('const a = 2')
    const contextY = frame.rowOf('keep()')
    const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
    const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
    const contextX = (frame.lines()[contextY] ?? '').indexOf('keep()')
    if (chalk.level >= 2) {
      check('D split 悬停前：增删行已各有内容衬底',
        frame.bg(SPLIT_LEFT_X, delY) === diffLine.removed && frame.bg(SPLIT_RIGHT_X, addY) === diffLine.added,
        `old=${frame.bg(SPLIT_LEFT_X, delY)} new=${frame.bg(SPLIT_RIGHT_X, addY)}`)
    }
    frame.mouseMove(10, delY)
    check('D split 悬停：真实指针移动触发卡头 ▾ 指示',
      await settled(() => (frame.lines()[headerY] ?? '').includes('▾')),
      JSON.stringify(frame.lines()[headerY]))
    check('D split 悬停：卡头/粗 gutter/上下文保留悬停反馈',
      await settled(() => frame.bg(0, headerY) === face.hover
        && frame.bg(0, delY) === face.hover
        && frame.bg(SPLIT_LEFT_X, contextY) === face.hover
        && frame.bg(SPLIT_RIGHT_X, contextY) === face.hover),
      `header=${frame.bg(0, headerY)} gutter=${frame.bg(0, delY)} ctx=${frame.bg(SPLIT_LEFT_X, contextY)}/${frame.bg(SPLIT_RIGHT_X, contextY)} want ${face.hover}`)
    if (chalk.level >= 2) {
      check('D split 悬停：old/new 行底始终是两种不同的内容衬底',
        frame.bg(SPLIT_LEFT_X, delY) === diffLine.removed && frame.bg(SPLIT_RIGHT_X, addY) === diffLine.added
        && frame.bg(SPLIT_LEFT_X, delY) !== frame.bg(SPLIT_RIGHT_X, addY),
        `old=${frame.bg(SPLIT_LEFT_X, delY)} new=${frame.bg(SPLIT_RIGHT_X, addY)}`)
      check('D split 悬停：changed 词对各自行底可读（≥4.5:1）',
        wordContrast(frame, delX, delY) >= MIN_DIFF_CONTRAST && wordContrast(frame, addX, addY) >= MIN_DIFF_CONTRAST,
        `del=${wordContrast(frame, delX, delY).toFixed(2)} add=${wordContrast(frame, addX, addY).toFixed(2)}`)
    } else {
      // 16 色档没有极淡衬底：增删行差异只剩词色，悬停底本身也可能与终端底同槽。
      check('D split 悬停（16 色）：增删词色仍可区分且可读（≥2:1）',
        frame.fg(delX, delY) !== frame.fg(addX, addY)
        && wordContrast(frame, delX, delY) >= 2 && wordContrast(frame, addX, addY) >= 2,
        `del=${frame.fg(delX, delY)} add=${frame.fg(addX, addY)}`)
    }
    frame.mouseMove(1, 0)
    check('D split 移出悬停：卡头悬停指示消失',
      await settled(() => !(frame.lines()[headerY] ?? '').includes('▾')))
    if (chalk.level >= 2) {
      check('D split 移出悬停：增删行内容衬底仍在且仍不相同',
        await settled(() => frame.bg(SPLIT_LEFT_X, delY) === diffLine.removed
          && frame.bg(SPLIT_RIGHT_X, addY) === diffLine.added),
        `old=${frame.bg(SPLIT_LEFT_X, delY)} new=${frame.bg(SPLIT_RIGHT_X, addY)}`)
    } else {
      check('D split 移出悬停（16 色）：增删行回到终端底',
        await settled(() => frame.bg(SPLIT_LEFT_X, delY) === bodyPaint
          && frame.bg(SPLIT_RIGHT_X, addY) === bodyPaint),
        `old=${frame.bg(SPLIT_LEFT_X, delY)} new=${frame.bg(SPLIT_RIGHT_X, addY)}`)
    }
  }, { fullscreen: true })

  // 浅色终端：终端底是亮的，词色得自适应压暗到可读。
  await withTerminal(80, () => React.createElement(
    ThemeProvider,
    { theme: 'light' },
    React.createElement(MessageList, listProps([editRow(10, EDIT_DIFFS)])),
  ), async (frame) => {
    check('D 浅色终端：diff 正文在屏上', await ready(frame, 'const a = 1', 'const a = 2'))
    const delY = frame.rowOf('const a = 1')
    const addY = frame.rowOf('const a = 2')
    const delX = (frame.lines()[delY] ?? '').indexOf('const a = 1') + 'const a = '.length
    const addX = (frame.lines()[addY] ?? '').indexOf('const a = 2') + 'const a = '.length
    check('D 浅色终端：代码区贴终端白底（卡头保留浅色状态面）',
      frame.bg(0, delY) === paintOfColor('#ffffff') && frame.bg(0, addY) === paintOfColor('#ffffff'),
      `${frame.bg(0, delY)}/${frame.bg(0, addY)} want ${paintOfColor('#ffffff')}`)
    if (chalk.level >= 2) {
      check(`D 浅色终端：可读深词色实际对比 ≥ ${MIN_DIFF_CONTRAST}:1`,
        wordContrast(frame, delX, delY, LIGHT_DEFAULT_FG) >= MIN_DIFF_CONTRAST
        && wordContrast(frame, addX, addY, LIGHT_DEFAULT_FG) >= MIN_DIFF_CONTRAST,
        `del=${wordContrast(frame, delX, delY, LIGHT_DEFAULT_FG).toFixed(2)} add=${wordContrast(frame, addX, addY, LIGHT_DEFAULT_FG).toFixed(2)}`)
    } else {
      // 16 色亮底：没有可读的深绿槽位，只能发终端自己的绿/红；对比度取决于
      // 用户重定义的 0-15 色槽（xterm 常用 bright green 在白底上并不可读），
      // 这里只断言色相仍能区分、词色不是默认前景。
      check('D 浅色终端（16 色）：增/删词仍有色相区分（对比度取决于终端调色板）',
        frame.fg(delX, delY) !== frame.fg(addX, addY)
        && frame.fg(delX, delY) !== 'default' && frame.fg(addX, addY) !== 'default',
        `del=${frame.fg(delX, delY)} add=${frame.fg(addX, addY)}`)
    }
    check('D 浅色终端：增/删词仍绿/玫瑰色相',
      frame.fg(delX, delY) !== frame.fg(addX, addY)
      && frame.fg(delX, delY) !== 'default' && frame.fg(addX, addY) !== 'default',
      `del=${frame.fg(delX, delY)} add=${frame.fg(addX, addY)}`)
  })
  // Light split: the row substrate follows the same derivation and must stay a
  // near-white pale tint, never a dark slab over a light terminal.
  {
    const lightTheme = getTheme('light')
    const lightDiff = diffBodyAppearance(
      { preset: 'pi-like', presetFace: true, terminalBackground: '#ffffff' },
      lightTheme,
      { active: true },
    )
    const lightPaints = await samplePaints([lightDiff.addedLine, lightDiff.removedLine])
    await withTerminal(120, () => React.createElement(
      ThemeProvider,
      { theme: 'light' },
      React.createElement(MessageList, listProps([editRow(12, EDIT_DIFFS)])),
    ), async (frame) => {
      check('D 浅色终端 split：正文在屏上', await ready(frame, 'const a = 1', 'const a = 2', 'keep()'))
      const row = frame.rowOf('const a = 1')
      const line = frame.lines()[row] ?? ''
      const delX = line.indexOf('const a = 1') + 'const a = '.length
      const addX = line.indexOf('const a = 2') + 'const a = '.length
      if (chalk.level >= 2) {
        const expected = {
          added: lightPaints.get(lightDiff.addedLine ?? NONE) ?? 'default',
          removed: lightPaints.get(lightDiff.removedLine ?? NONE) ?? 'default',
        }
        check('D 浅色终端 split：增删行是近白淡衬底、彼此不同',
          frame.bg(SPLIT_LEFT_X, row) === expected.removed && frame.bg(SPLIT_RIGHT_X, row) === expected.added
          && expected.added !== expected.removed
          && (paintLuma(expected.added) ?? 0) >= 180 && (paintLuma(expected.removed) ?? 0) >= 180,
          `old=${frame.bg(SPLIT_LEFT_X, row)}/${paintLuma(frame.bg(SPLIT_LEFT_X, row))?.toFixed(0)} new=${frame.bg(SPLIT_RIGHT_X, row)}/${paintLuma(frame.bg(SPLIT_RIGHT_X, row))?.toFixed(0)}`)
        check(`D 浅色终端 split：changed 词对各自行底可读 ≥ ${MIN_DIFF_CONTRAST}:1`,
          wordContrast(frame, delX, row, LIGHT_DEFAULT_FG) >= MIN_DIFF_CONTRAST
          && wordContrast(frame, addX, row, LIGHT_DEFAULT_FG) >= MIN_DIFF_CONTRAST,
          `del=${wordContrast(frame, delX, row, LIGHT_DEFAULT_FG).toFixed(2)} add=${wordContrast(frame, addX, row, LIGHT_DEFAULT_FG).toFixed(2)}`)
      } else {
        check('D 浅色终端 split（16 色）：没有极淡衬底，正文仍贴终端白底',
          frame.bg(SPLIT_LEFT_X, row) === paintOfColor('#ffffff') && frame.bg(SPLIT_RIGHT_X, row) === paintOfColor('#ffffff'))
      }
    })
  }
  applyCardStyles(undefined)
}

// ---------------------------------------------------------------------------
// J — job progress: pi-like thin line, legacy/JobsPanel bar
// ---------------------------------------------------------------------------
console.log('--- J: job progress presentation ---')
const BLOCK_GLYPHS = /[█▉▊▋▌▍▎▏]/u
const LINE_GLYPHS = /[━─]/u
function jobProgressRow(id: number, progress: string, status: 'running' | 'completed' = 'running'): Row {
  return {
    id,
    kind: 'job',
    text: `job ${id}`,
    job: {
      id: `pwsh-${id}`,
      kind: 'pwsh',
      label: `run job ${id}`,
      status,
      startedAt: NOW - 4000,
      ...(status === 'completed' ? { finishedAt: NOW - 1000, detail: 'exit code: 0' } : {}),
      progress,
      outputLines: [],
    },
  }
}
/** The fg paint of the first `needle` cell on a row. */
function fgOfNeedle(frame: Frame, y: number, needle: string): Paint {
  const x = (frame.lines()[y] ?? '').indexOf(needle)
  return x < 0 ? 'default' : frame.fg(x, y)
}
applyCardStyles({ preset: 'pi-like' })
{
  // 0 / low / middle / high / full / over-total: the thin line's colour is the
  // ratio stage (accent < 1/3, ide < 2/3, success otherwise), never the job's
  // status colour. 5 cells with a dim remainder, no block glyph, no fill.
  const stages = [
    ['0/4', 0, undefined],
    ['1/4', 1, jobLinePaint.accent],
    ['2/4', 3, jobLinePaint.ide],
    ['3/4', 4, jobLinePaint.success],
    ['4/4', 5, jobLinePaint.success],
    ['5/4', 5, jobLinePaint.success],
  ] as const
  for (const [progress, filled, color] of stages) {
    await withTerminal(80, listOf([jobProgressRow(1, progress)]), async (frame) => {
      check(`J line ${progress}：进度行在屏`, await ready(frame, progress))
      const y = frame.rowOf('pwsh-1')
      const line = frame.lines()[y] ?? ''
      check(`J line ${progress}：细线 + 弱化余段，无块字符`,
        LINE_GLYPHS.test(line) && !BLOCK_GLYPHS.test(line), JSON.stringify(line))
      check(`J line ${progress}：没有背景填充`,
        frame.paintsInRow(y).size === 1 && frame.paintsInRow(y).has('default'), [...frame.paintsInRow(y)].join(','))
      check(`J line ${progress}：原计数照旧（超总数不夹文字）`, line.includes(progress), JSON.stringify(line))
      check(`J line ${progress}：计数与当前进度色一致`, fgOfNeedle(frame, y, progress) === (color ?? jobLinePaint.accent),
        `got=${fgOfNeedle(frame, y, progress)} want=${color ?? jobLinePaint.accent}`)
      const drawn = (line.match(/━/gu) ?? []).length
      check(`J line ${progress}：细线填 ${filled} 格`, drawn === filled, `got=${drawn}`)
      if (color !== undefined) {
        check(`J line ${progress}：进度色随比例变化`,
          fgOfNeedle(frame, y, '━') === color, `got=${fgOfNeedle(frame, y, '━')} want=${color}`)
      }
      check(`J line ${progress}：header 仍是一行，命令不换行`,
        line.includes('●') && line.includes('pwsh-1') && (frame.lines()[y + 1] ?? '').includes('❯'),
        JSON.stringify([line, frame.lines()[y + 1]]))
    })
  }
  // Anything that is not a usable n/m keeps the producer's text verbatim: no
  // invented proportion, no line, no percentage.
  for (const progress of ['0/0', '1/0', 'warming up', '1/' + '9'.repeat(400)]) {
    await withTerminal(80, listOf([jobProgressRow(2, progress)]), async (frame) => {
      check(`J 非比例 ${progress.slice(0, 12)}…：原文透传`, await ready(frame, 'pwsh-2'))
      const y = frame.rowOf('pwsh-2')
      const line = frame.lines()[y] ?? ''
      check(`J 非比例 ${progress.slice(0, 12)}…：不编造细线/百分比`,
        !LINE_GLYPHS.test(line) && !line.includes('%') && !BLOCK_GLYPHS.test(line), JSON.stringify(line))
      check(`J 非比例 ${progress.slice(0, 12)}…：header 仍是一行`,
        (frame.lines()[y + 1] ?? '').includes('❯'), JSON.stringify([line, frame.lines()[y + 1]]))
    })
  }
  // A long counter may shorten the line (here to three cells) but never widen
  // the fixed 12-column header slot.
  await withTerminal(80, listOf([jobProgressRow(3, '617/1234')]), async (frame) => {
    await ready(frame, '617/1234')
    const y = frame.rowOf('pwsh-3')
    const line = frame.lines()[y] ?? ''
    check('J 长计数：细线缩短但保留', line.includes('617/1234') && (line.match(/[━─]/gu) ?? []).length === 3,
      JSON.stringify(line))
    check('J 长计数：header 单行', (frame.lines()[y + 1] ?? '').includes('❯'))
  })
  // A counter that leaves no room for the line keeps only the counter; the
  // original [12]-column box truncates it instead of pushing the header wider.
  const longProgress = '1234567890123/1234567890123'
  for (const columns of [80, 30] as const) {
    await withTerminal(columns, listOf([jobProgressRow(4, longProgress)]), async (frame) => {
      check(`J 长计数/${columns}列：任务头在屏`, await ready(frame, 'pwsh-4'))
      const y = frame.rowOf('pwsh-4')
      const line = frame.lines()[y] ?? ''
      check(`J 长计数/${columns}列：只留计数、细线让位`,
        !LINE_GLYPHS.test(line) && !BLOCK_GLYPHS.test(line), JSON.stringify(line))
      check(`J 长计数/${columns}列：原 glyph/标题不挤掉、header 单行`,
        line.includes('●') && line.includes('pwsh-4') && (frame.lines()[y + 1] ?? '').includes('❯'),
        JSON.stringify([line, frame.lines()[y + 1]]))
      // 细线让位后计数仍按可解析比例取阶段色（1234567890123/1234567890123 = 1）。
      check(`J 长计数/${columns}列：只剩计数时仍按比例取阶段色`,
        fgOfNeedle(frame, y, '12345') === jobLinePaint.success,
        `got=${fgOfNeedle(frame, y, '12345')} want=${jobLinePaint.success}`)
    })
  }
  // Same mounted grouped run: a progress-only change mutates the domain row in
  // place. The grouped cache copies row objects, so the fingerprint has to
  // carry progress for the card to see it (and the line colour to follow).
  {
    const rows: Row[] = [jobProgressRow(6, '1/4'), jobProgressRow(7, '1/4')]
    await withTerminal(80, listOf(rows, { jobGroupFold: 'never' }), async (frame) => {
      check('J group：两个分组任务卡在屏', await ready(frame, 'pwsh-6', 'pwsh-7'))
      check('J group：初始进度 1/4', (frame.lines()[frame.rowOf('pwsh-6')] ?? '').includes('1/4'))
      ;(rows[0] as { job?: unknown }).job = { ...(rows[0]!.job as Record<string, unknown>), progress: '4/4' }
      frame.rerender(React.createElement(MessageList, listProps(rows, { jobGroupFold: 'never' })))
      check('J group：同状态进度更新反映到已挂载卡（visibleCache 不再挡住）',
        await settled(() => (frame.lines()[frame.rowOf('pwsh-6')] ?? '').includes('4/4')),
        JSON.stringify((frame.lines()[frame.rowOf('pwsh-6')] ?? '')))
      const updated = frame.rowOf('pwsh-6')
      check('J group：进度比例变色（accent → success）',
        fgOfNeedle(frame, updated, '━') === jobLinePaint.success,
        `got=${fgOfNeedle(frame, updated, '━')} want=${jobLinePaint.success}`)
      const sibling = frame.rowOf('pwsh-7')
      check('J group：同组其它任务保持自己的进度与原色',
        (frame.lines()[sibling] ?? '').includes('1/4') && fgOfNeedle(frame, sibling, '━') === jobLinePaint.accent,
        JSON.stringify(frame.lines()[sibling]))
    })
  }
  // Live style switch: the file override can turn the same pi-like card back
  // into the original bar, and back again, without remounting the transcript.
  await withTerminal(80, listOf([jobProgressRow(8, '3/4')]), async (frame) => {
    await ready(frame, '3/4')
    check('J 动态：pi-like 默认细线', !BLOCK_GLYPHS.test(frame.screen()) && (frame.lines()[frame.rowOf('pwsh-8')] ?? '').includes('━'))
    applyCardStyles({ preset: 'pi-like', kinds: { job: { progressStyle: 'bar' } } })
    check('J 动态：显式 progressStyle=bar 切回原块状进度',
      await settled(() => BLOCK_GLYPHS.test(frame.screen()) && (frame.lines()[frame.rowOf('pwsh-8')] ?? '').includes('3/4')),
      JSON.stringify(frame.lines()[frame.rowOf('pwsh-8')]))
    applyCardStyles({ preset: 'pi-like' })
    check('J 动态：切回 line 又只画细线',
      await settled(() => !BLOCK_GLYPHS.test(frame.screen()) && (frame.lines()[frame.rowOf('pwsh-8')] ?? '').includes('━')),
      JSON.stringify(frame.lines()[frame.rowOf('pwsh-8')]))
  })
  // Legacy still uses the original bar; the shared /jobs panel does not receive
  // the card's style parameter under pi-like either.
  applyCardStyles(undefined)
  await withTerminal(80, listOf([jobProgressRow(9, '1/4')]), async (frame) => {
    check('J legacy：对话任务卡仍是原块状 bar', await ready(frame, '1/4')
      && BLOCK_GLYPHS.test(frame.screen()), JSON.stringify(frame.lines()[frame.rowOf('pwsh-9')]))
  })
  applyCardStyles({ preset: 'pi-like' })
  await withTerminal(80, () => React.createElement(JobsPanel, {
    jobs: [{
      id: 'pwsh-panel', kind: 'pwsh', label: 'run panel job', status: 'running', startedAt: NOW - 1000,
      progress: '1/4', outputLines: [],
    }],
    onClose: () => {},
    onKill: () => {},
  }), async (frame) => {
    check('J /jobs 面板不受卡片 style 影响：仍是块状 bar', await ready(frame, '1/4')
      && BLOCK_GLYPHS.test(frame.screen()),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
}

// ---------------------------------------------------------------------------
// O — 覆盖
// ---------------------------------------------------------------------------
console.log('--- O: overrides ---')
{
  applyCardStyles({ preset: 'legacy', kinds: { tool: { background: '#112233', border: 'round', paddingX: 2, paddingY: 1 } } })
  const custom = await samplePaints(['#112233'])
  const customFace = custom.get('#112233') ?? 'default'
  check('O 自定义色采样成功', customFace !== 'default', customFace)
  await withTerminal(80, listOf([toolRow(1, 'ok')]), async (frame) => {
    check('O 覆盖的底色画在工具卡上', await settled(() => frame.rowOf('Bash(seq 6)') >= 0
      && frame.bg(0, frame.rowOf('Bash(seq 6)')) === customFace),
    `got=${frame.bg(0, frame.rowOf('Bash(seq 6)'))} want=${customFace}`)
    const y = frame.rowOf('Bash(seq 6)')
    const top = frame.lines().findIndex(line => line.includes('╭'))
    const bottom = frame.lines().findIndex(line => line.includes('╰'))
    check('O 边框画成上下两条', top >= 0 && bottom > top && (frame.lines()[bottom] ?? '').includes('╯'),
      JSON.stringify([frame.lines()[top], frame.lines()[bottom]]))
    check('O 卡头行两侧有竖边框', (frame.lines()[y] ?? '').startsWith('│') && (frame.lines()[y] ?? '').trimEnd().endsWith('│'),
      JSON.stringify(frame.lines()[y]))
    check('O 卡头内容缩进 = 边框 1 + 水平内边距 2', (frame.lines()[y] ?? '').startsWith('│  •'), JSON.stringify(frame.lines()[y]))
    check('O 上内边距行也涂底', frame.bg(1, y - 1) === customFace, `${frame.bg(1, y - 1)}`)
  })
}
{
  applyCardStyles({ preset: 'legacy', common: { gap: 1 }, kinds: { user: { background: 'selectionBg' } } })
  const userFace = paintOfColor(dark.selectionBg)
  await withTerminal(60, listOf([userRow(1, 'first prompt'), userRow(2, 'second prompt')]), async (frame) => {
    check('O 公共/类型覆盖：用户底色生效', await settled(() => frame.rowOf('first prompt') >= 0
      && frame.bg(0, frame.rowOf('first prompt')) === userFace),
    `${frame.bg(0, frame.rowOf('first prompt'))} want ${userFace}`)
    const first = frame.rowOf('first prompt')
    const second = frame.rowOf('second prompt')
    check('O gap 在两张同类卡片之间多留 1 行空行', second - first === 3, `first=${first} second=${second}`)
    check('O gap 留出的空行不涂底', frame.paintsInRow(first + 2).size === 1)
  })
}

{
  applyCardStyles({ preset: 'legacy', kinds: { other: { gap: 1 } } })
  await withTerminal(60, listOf([localOutputRow(1, 'gap output 1'), localOutputRow(2, 'gap output 2')]), async (frame) => {
    await ready(frame, 'gap output 1', 'gap output 2')
    check('O other.gap 同样作用于本地输出', frame.rowOf('gap output 2') - frame.rowOf('gap output 1') === 2)
  })
}

// ---------------------------------------------------------------------------
// S — 状态 / 取消
// ---------------------------------------------------------------------------
for (const bold of [false, true]) {
  applyCardStyles({ preset: 'pi-like', common: { foreground: 'success', bold: !bold }, kinds: { user: { foreground: 'error', bold } } })
  await withTerminal(80, listOf([userRow(1, 'USER_STYLE_OVERRIDE')]), async (frame) => {
    await ready(frame, 'USER_STYLE_OVERRIDE')
    const y = frame.rowOf('USER_STYLE_OVERRIDE'), cell = frame.cell(2, y)
    check(`O 用户前景/加粗可配置，类型覆盖公共（bold=${bold}）`, cell !== undefined && Boolean(cell.isBold()) === bold
      && frame.fg(2, y) === paintOfColor(dark.error))
  })
}
console.log('--- S: status faces and cancelled runs ---')
applyCardStyles({ preset: 'pi-like' })
{
  await withTerminal(90, listOf([subagentRow(1, 'cancelled'), jobRow(2, 'killed'), jobRow(3, 'stopping'), subagentRow(4, 'unknown')]), async (frame) => {
    check('S 四行都在屏上', await ready(frame, 'job: pwsh-3', 'status unknown'))
    const cancelledY = frame.lines().findIndex(line => line.includes('Explore repository'))
    check('S 取消的子代理保持普通块底色', cancelledY >= 0 && frame.bg(0, cancelledY) === face.block, `${frame.bg(0, cancelledY)} want ${face.block}`)
    check('S 取消的子代理保留状态词', (frame.lines()[cancelledY] ?? '').includes('Cancelled'), JSON.stringify(frame.lines()[cancelledY]))
    const killedY = frame.rowOf('job: pwsh-2')
    const stoppingY = frame.rowOf('job: pwsh-3')
    check('S 被终止的后台任务保持透明卡面', killedY >= 0 && frame.bg(0, killedY) === 'default', `${frame.bg(0, killedY)}`)
    check('S 终止中的后台任务保持透明卡面', stoppingY >= 0 && frame.bg(0, stoppingY) === 'default', `${frame.bg(0, stoppingY)}`)
    check('S 终止的后台任务保留 ✗ 符号', (frame.lines()[killedY] ?? '').includes('✗'), JSON.stringify(frame.lines()[killedY]))
    const unknownY = frame.lines().findIndex((line, y) => y > killedY && line.includes('Explore repository'))
    check('S 状态未知的子代理保持普通块底色', unknownY >= 0 && frame.bg(0, unknownY) === face.block, `${frame.bg(0, unknownY)}`)
  })
}
{
  await withTerminal(80, listOf([toolRow(1, 'ok')]), async (frame) => {
    check('S 成功面上的卡头文字与底色不同色', await settled(() => {
      const y = frame.rowOf('Bash(seq 6)')
      return y >= 0 && frame.bg(4, y) === face.success && frame.fg(4, y) !== frame.bg(4, y)
    }), `fg=${frame.fg(4, frame.rowOf('Bash(seq 6)'))} bg=${frame.bg(4, frame.rowOf('Bash(seq 6)'))}`)
  })
}

// ---------------------------------------------------------------------------
// F — 折叠默认与预览行数
// ---------------------------------------------------------------------------
applyCardStyles({ preset: 'pi-like' })
let subagentLabelColumn: number | undefined
for (const state of ['running', 'starting', 'completed', 'failed', 'cancelled', 'unknown'] as const) {
  const row = subagentRow(800, state)
  await withTerminal(90, listOf([row]), async (frame) => {
    await ready(frame, 'Explore repository')
    const y = frame.rowOf('Explore repository'), line = frame.lines()[y] ?? ''
    const glyph = [...line.trimStart()][0] ?? ''
    subagentLabelColumn ??= line.indexOf('Explore repository')
    check(`S pi-like ${state}：运行与落定标题列位置一致`, line.indexOf('Explore repository') === subagentLabelColumn, line)
    check(`S pi-like ${state}：状态标识为单列非emoji`, stringWidth(glyph) === 1
      && !/[🟢🔴🟡⚪🔵🟣🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(line), line)
    const color = state === 'completed' ? dark.success : state === 'failed' ? dark.error
      : state === 'cancelled' || state === 'unknown' ? dark.subtle : dark.warning
    check(`S pi-like ${state}：状态色保持语义`, frame.fg(line.indexOf(glyph), y) === paintOfColor(color))
  })
}
const { SubagentDetailScene } = await import('../../src/components/SubagentDetailScene.js')
for (const preset of ['legacy', 'pi-like'] as const) {
  applyCardStyles({ preset })
  await withTerminal(90, () => React.createElement(SubagentDetailScene, {
    subagent: { agentId: 'detail-status', description: 'DETAIL_STATUS_MARKER', status: 'failed', startedAt: NOW - 1000,
      completedAt: NOW, output: [], outputEvents: [], toolCalls: [], error: 'fixture failure' },
    onBack() {},
  }), async (frame) => {
    await ready(frame, 'DETAIL_STATUS_MARKER')
    const y = frame.rowOf('DETAIL_STATUS_MARKER'), line = frame.lines()[y] ?? ''
    check(`S ${preset}：详情页状态字形遵循方案`, preset === 'pi-like' ? line.includes('×') && !line.includes('🔴') : line.includes('🔴'))
    if (preset === 'pi-like') check('S pi-like：详情页失败标识小而有色、不加粗',
      frame.fg(line.indexOf('×'), y) === paintOfColor(dark.error) && !frame.cell(line.indexOf('×'), y)?.isBold())
  })
}
applyCardStyles({ preset: 'pi-like' })
{
  const body = '<tool-jobs>\nMODEL_NOTICE_BODY\n</tool-jobs>'
  const row: Row = { id: 991, kind: 'context-notice', text: body,
    contextNotice: { messageId: 'notice-fixture', source: 'tool-jobs', summary: 'NOTICE_SUMMARY' } }
  await withTerminal(80, listOf([row]), async (frame) => {
    await ready(frame, 'tool-jobs', 'NOTICE_SUMMARY')
    const header = frame.rowOf('tool-jobs'), summary = frame.rowOf('NOTICE_SUMMARY')
    const expected = chalk.level >= 3 ? paintOfColor('#19151f') : chalk.level === 2 ? paintOfColor('ansi256(235)') : 'default'
    check('N 通知卡：紫灰底、左细线，无右墙', frame.bg(1, header) === expected && frame.bg(79, header) === expected
      && (frame.lines()[header] ?? '').startsWith('│') && !(frame.lines()[header] ?? '').trimEnd().endsWith('│'))
    check('N 通知卡：标题与折叠摘要分行，不泄露正文', summary === header + 1 && !frame.screen().includes('MODEL_NOTICE_BODY'))
    frame.rerender(React.createElement(MessageList, listProps([row], { expandedRows: [991] })))
    check('N 通知卡：展开仍是同一条消息的完整正文', await ready(frame, '<tool-jobs>', 'MODEL_NOTICE_BODY', '</tool-jobs>'))
    check('N 通知卡：展开不重复显示摘要', !frame.screen().includes('NOTICE_SUMMARY') && row.text === body)
  })
}
console.log('--- F: fold defaults and preview lines ---')
for (const preset of ['legacy', 'pi-like'] as const) {
  applyCardStyles({ preset })
  const empty = { ...reasoningRow(990, ''), reasoningTokens: 42 }
  const full = { ...empty, text: 'THINKING_TRANSITION_BODY' }
  await withTerminal(80, listOf([empty], { expanded: true }), async (frame) => {
    check(`F ${preset}：空思考先显示 token 计数`, await ready(frame, '~42'))
    frame.rerender(React.createElement(MessageList, listProps([full], { expanded: true })))
    check(`F ${preset}：同一思考行从空变文本不崩溃`, await ready(frame, 'THINKING_TRANSITION_BODY'))
    frame.rerender(React.createElement(MessageList, listProps([{ ...empty, streaming: false }], { expanded: true })))
    check(`F ${preset}：文本退回仅 token 计数不崩溃`, await ready(frame, '~42'))
    frame.rerender(React.createElement(MessageList, listProps([{ ...full, streaming: false }], { expanded: true })))
    check(`F ${preset}：思考结束后仍能显示正文`, await ready(frame, 'THINKING_TRANSITION_BODY'))
  })
}
{
  applyCardStyles({ preset: 'legacy', kinds: { tool: { defaultExpanded: true } } })
  await withTerminal(80, listOf([toolRow(1, 'ok')]), async (frame) => {
    check('F defaultExpanded=true：工具正文默认展开',
      await settled(() => frame.rowOf('Bash(seq 6)') >= 0 && frame.rowOf('6') >= 0 && !frame.screen().includes('ctrl+o to expand')),
      frame.screen().split('\n').slice(0, 8).join('|'))
    frame.rerender(React.createElement(MessageList, listProps([toolRow(1, 'ok')], { expandedRows: [1] })))
    check('F defaultExpanded=true：点一下（展开集合）＝收起', await settled(() => frame.screen().includes('ctrl+o to expand')))
    frame.rerender(React.createElement(MessageList, listProps([toolRow(1, 'ok')])))
    check('F defaultExpanded=true：再点回来', await settled(() => !frame.screen().includes('ctrl+o to expand')))
    frame.rerender(React.createElement(MessageList, listProps([toolRow(1, 'ok')], { expanded: true })))
    check('F Ctrl+O 仍强制展开', await settled(() => frame.rowOf('6') >= 0))
  })
}
{
  applyCardStyles({ preset: 'legacy', kinds: { tool: { previewLines: 1 } } })
  await withTerminal(80, listOf([toolRow(1, 'ok')]), async (frame) => {
    check('F previewLines=1：正文只留 1 行 + 折叠提示',
      await settled(() => frame.rowOf('⎿ 1') >= 0 && frame.rowOf(' 2') === -1 && frame.screen().includes('+5 lines')),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
  applyCardStyles({ preset: 'legacy', kinds: { tool: {} } })
  await withTerminal(80, listOf([toolRow(1, 'ok')]), async (frame) => {
    check('F 未配置时沿用既有 3 行预算', await settled(() => frame.rowOf('⎿ 1') >= 0 && frame.rowOf(' 3') >= 0 && frame.rowOf(' 4') === -1))
  })
  // diff 卡与文本卡共用同一个折叠预算（未配置时仍是 8 行）
  const editDiffs = [
    { path: '/tmp/a.ts', oldText: ['old1', 'old2', 'old3', 'old4', 'old5'].join('\n'), newText: ['new1', 'new2', 'new3', 'new4', 'new5'].join('\n') },
  ]
  const editRow = (id: number): Row => ({
    id,
    kind: 'tool',
    text: 'edit',
    tool: {
      callId: `edit-${id}`,
      name: 'edit',
      argsText: '{}',
      status: 'ok',
      startedAt: NOW - 100,
      durationMs: 100,
      callView: { card: 'diff', title: 'Edit /tmp/a.ts', diffs: editDiffs },
      resultView: { card: 'diff', title: 'Edit /tmp/a.ts', diffs: editDiffs },
      resultFull: 'ok',
    },
  })
  applyCardStyles({ preset: 'legacy', kinds: { tool: { previewLines: 2 } } })
  await withTerminal(80, listOf([editRow(1)]), async (frame) => {
    check('F previewLines 同样覆盖 diff 正文预算',
      await settled(() => frame.rowOf('⎿ -old1') >= 0 && frame.rowOf('+new1') === -1 && frame.screen().includes('+8 lines')),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
}
{
  const thinkingText = 'first thought\nsecond thought\nthird thought\nfourth thought'
  applyCardStyles({ preset: 'legacy', kinds: { thinking: { defaultExpanded: true } } })
  const settledThinking = [reasoningRow(1, thinkingText, false)]
  await withTerminal(80, listOf(settledThinking), async (frame) => {
    check('F 落定思考 defaultExpanded=true：显示全文', await ready(frame, 'first thought', 'fourth thought'))
    frame.rerender(React.createElement(MessageList, listProps(settledThinking, { expandedRows: [1] })))
    check('F 落定思考点击后仍能收起', await settled(() => frame.rowOf('first thought') === -1 && frame.rowOf('fourth thought') === -1))
  })
  applyCardStyles({ preset: 'legacy', kinds: { thinking: { previewLines: 2 } } })
  await withTerminal(80, listOf([reasoningRow(1, thinkingText)]), async (frame) => {
    check('F 思考 previewLines=2：流式 ticker 只留 2 行',
      await settled(() => frame.rowOf('fourth thought') >= 0 && frame.rowOf('third thought') >= 0 && frame.rowOf('second thought') === -1),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
  applyCardStyles({ preset: 'legacy', kinds: { thinking: { previewLines: 4 } } })
  await withTerminal(80, listOf([reasoningRow(1, thinkingText)]), async (frame) => {
    check('F 思考 previewLines=4：ticker 行数跟随配置', await settled(() => frame.rowOf('second thought') >= 0),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
  applyCardStyles({ preset: 'legacy' })
  await withTerminal(80, listOf([reasoningRow(1, thinkingText)]), async (frame) => {
    check('F 未配置：ticker 仍是既有 3 行', await settled(() => frame.rowOf('second thought') >= 0 && frame.rowOf('first thought') === -1),
      frame.screen().split('\n').slice(0, 6).join('|'))
  })
}
{
  applyCardStyles({ preset: 'legacy', kinds: { summary: { defaultExpanded: true } } })
  await withTerminal(80, listOf([compactRow(1, 'the compaction summary body')]), async (frame) => {
    check('F 摘要 defaultExpanded=true：默认显示全文',
      await settled(() => frame.rowOf('the compaction summary body') >= 0 && !frame.screen().includes('Summary folded')),
      frame.screen().split('\n').slice(0, 4).join('|'))
    frame.rerender(React.createElement(MessageList, listProps([compactRow(1, 'the compaction summary body')], { expandedRows: [1] })))
    check('F 摘要点击收起', await settled(() => frame.screen().includes('Summary folded')))
  })
  applyCardStyles({ preset: 'legacy' })
  await withTerminal(80, listOf([compactRow(1, 'the compaction summary body')]), async (frame) => {
    check('F 未配置：摘要仍默认折叠', await settled(() => frame.screen().includes('Summary folded')))
  })
}
{
  const rows = [jobRow(1, 'completed'), jobRow(2, 'completed'), jobRow(3, 'completed')]
  applyCardStyles({ preset: 'legacy' })
  await withTerminal(90, listOf(rows), async (frame) => {
    check('F 未配置：三张落定任务按 jobGroupFold 折成一行',
      await settled(() => frame.screen().includes('background jobs folded')), frame.screen().split('\n').slice(0, 4).join('|'))
  })
  applyCardStyles({ preset: 'legacy', kinds: { job: { defaultExpanded: true } } })
  await withTerminal(90, listOf(rows), async (frame) => {
    check('F job defaultExpanded=true：整组默认展开（分组仍在）',
      await settled(() => frame.rowOf('job: pwsh-1') >= 0 && frame.screen().includes('background jobs ×3')),
      frame.screen().split('\n').slice(0, 4).join('|'))
    frame.rerender(React.createElement(MessageList, listProps(rows, { expandedRows: [1] })))
    check('F job 组头点击仍可折叠', await settled(() => frame.screen().includes('background jobs folded')))
  })
  await withTerminal(90, listOf([jobRow(1, 'completed'), jobRow(2, 'running')]), async (frame) => {
    check('F job defaultExpanded 不改变成组与存活规则',
      await settled(() => frame.screen().includes('background jobs ×2') && !frame.screen().includes('background jobs folded')),
      frame.screen().split('\n').slice(0, 4).join('|'))
  })
}
{
  const grouped = [noticeRow(1, 'group gap anchor'), jobRow(2, 'completed'), jobRow(3, 'completed'), jobRow(4, 'completed')]
  applyCardStyles({ preset: 'legacy' })
  await withTerminal(90, listOf(grouped), async (frame) => {
    check('O 任务组间隔测试初始折叠头可见', await ready(frame, 'group gap anchor', 'background jobs folded'))
    const before = frame.rowOf('background jobs folded')
    applyCardStyles({ preset: 'legacy', kinds: { job: { gap: 2 } } })
    check('O job.gap 同样作用于折叠组头', await settled(() => frame.rowOf('background jobs folded') === before + 2))
  })
}
{
  const rows = [jobRow(1, 'completed'), jobRow(2, 'completed')]
  applyCardStyles({ preset: 'legacy', kinds: { job: { defaultExpanded: false } } })
  await withTerminal(90, listOf(rows, { jobGroupFold: 'always' }), async (frame) => {
    check('F 任务缓存变更前：always + 默认收起', await settled(() => frame.screen().includes('background jobs folded')))
    applyCardStyles({ preset: 'legacy', kinds: { job: { defaultExpanded: true } } })
    frame.rerender(React.createElement(MessageList, listProps(rows, { jobGroupFold: 'auto' })))
    check('F 同次修改分组与展开默认不会命中旧缓存', await settled(() => frame.rowOf('job: pwsh-1') >= 0 && !frame.screen().includes('background jobs folded')))
  })
}
{
  const longText = `fold me ${'x'.repeat(3000)}`
  const paintedChars = (screen: string): number => (screen.match(/x/gu) ?? []).length
  applyCardStyles({ preset: 'legacy', kinds: { user: { defaultExpanded: true } } })
  await withTerminal(80, listOf([userRow(1, longText)]), async (frame) => {
    check('F 用户长行 defaultExpanded=true：默认展开原文（无折叠标记）',
      await settled(() => paintedChars(frame.screen()) > 2000 && !frame.screen().includes('chars folded')),
      `chars=${paintedChars(frame.screen())}`)
  })
  applyCardStyles({ preset: 'legacy' })
  await withTerminal(80, listOf([userRow(1, longText)]), async (frame) => {
    check('F 未配置：长行仍按既有折叠（只画 1000 字符 + 折叠标记）',
      await settled(() => paintedChars(frame.screen()) <= 1200 && frame.screen().includes('chars folded')),
      `chars=${paintedChars(frame.screen())}`)
  })
}

// ---------------------------------------------------------------------------
// N — 窄屏 / CJK / emoji
// ---------------------------------------------------------------------------
console.log('--- N: narrow, CJK and emoji ---')
applyCardStyles({ preset: 'pi-like' })
{
  const cjk = '这是一个很长的中文提示，用来验证卡片内边距收窄之后的换行宽度是否正确处理宽字符'
  await withTerminal(40, listOf([userRow(1, `${cjk} 🙂`)]), async (frame) => {
    check('N 窄屏 CJK 用户气泡换行且内容完整',
      await settled(() => frame.screen().includes('这是一个很长的中文提示') && frame.screen().includes('🙂')),
      frame.screen().split('\n').slice(0, 8).join('|'))
    check('N 窄屏下每行都在终端宽度内', frame.lines().every(line => line.length <= 40))
    const promptY = frame.lines().findIndex(line => line.includes('这是一个'))
    check('N 卡面涂到最后一列（内容宽度收窄但底色仍满宽）', promptY >= 0 && frame.bg(39, promptY) === face.user, `${frame.bg(39, promptY)}`)
  })
  const emojiText = '🙂'.repeat(20)
  await withTerminal(30, listOf([userRow(1, emojiText)]), async (frame) => {
    check('N emoji 不被截半个（20 个完整码点）', await settled(() => (frame.lines().join('').match(/🙂/gu) ?? []).length === 20),
      `${(frame.lines().join('').match(/🙂/gu) ?? []).length}`)
  })
}
{
  applyCardStyles({ preset: 'legacy', kinds: { assistant: { paddingX: 3 } } })
  const table = '| aaaaaaaaaa | bbbbbbbbbb |\n| --- | --- |\n| 1 | 2 |'
  await withTerminal(40, listOf([assistantRow(1, table)]), async (frame) => {
    check('N 助手 markdown 表格按内缩后的宽度排版', await settled(() => frame.screen().includes('aaaaaaaaaa')),
      frame.screen().split('\n').slice(0, 10).join('|'))
    check('N 收窄后没有行超出终端宽度', frame.lines().every(line => line.length <= 40),
      `longest=${Math.max(...frame.lines().map(line => line.length))}`)
    const frameRow = frame.lines().findIndex(line => line.includes('┌'))
    check('N 表格边框留在卡片内容区（左内缩 3 + 圆点 2）', frameRow >= 0 && (frame.lines()[frameRow] ?? '').indexOf('┌') === 5,
      JSON.stringify(frame.lines()[frameRow]))
  })
}

// ---------------------------------------------------------------------------
// X — 选中仍可辨
// ---------------------------------------------------------------------------
console.log('--- X: selection stays readable on painted cards ---')
applyCardStyles({ preset: 'pi-like' })
{
  await withTerminal(80, () => React.createElement(MessageList, { ...listProps([userRow(1, 'hello there')], { selectedId: 1 }) }), async (frame) => {
    check('X 选中的用户气泡用选中色而非卡面', await settled(() => frame.rowOf('hello there') >= 0
      && frame.bg(0, frame.rowOf('hello there')) === face.selection),
    `${frame.bg(0, frame.rowOf('hello there'))} want ${face.selection}`)
    check('X 选中色与 pi-like 用户卡面可分辨', face.selection !== face.user, `${face.selection} vs ${face.user}`)
  })
  await withTerminal(80, () => React.createElement(MessageList, { ...listProps([toolRow(1, 'ok')], { selectedId: 1 }) }), async (frame) => {
    check('X 选中的工具卡用选中色而不是状态底色', await settled(() => frame.rowOf('Bash(seq 6)') >= 0
      && frame.bg(0, frame.rowOf('Bash(seq 6)')) === face.selection),
    `${frame.bg(0, frame.rowOf('Bash(seq 6)'))} want ${face.selection}`)
  })
  await withTerminal(80, () => React.createElement(MessageList, { ...listProps([teamRow(1, 'Nova', 'team note')], { selectedId: 1 }) }), async (frame) => {
    check('X 选中的团队消息用选中色而非卡面', await settled(() => frame.rowOf('team note') >= 0
      && frame.bg(0, frame.rowOf('team note')) === face.selection),
    `${frame.bg(0, frame.rowOf('team note'))} want ${face.selection}`)
  })
}

// ---------------------------------------------------------------------------
// A — 状态底色矩阵：每一档色深下三态两两可辨、正文对比达标
// ---------------------------------------------------------------------------
console.log('--- A: state faces (theme matrix) ---')
function hexRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (match === null) return undefined
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}
function luminance(color: { r: number; g: number; b: number }): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}
/**
 * The xterm 256-colour palette entry `index` as RGB (0–15 the conventional
 * defaults, 16–231 the 6×6×6 cube, 232–255 the grey ramp). A cell carrying a
 * palette colour only reports its index, so the contrast math resolves it
 * through this table (the same one `src/ink/screen.ts` uses internally).
 */
function ansi256Rgb(index: number): { r: number; g: number; b: number } | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 16) return hexRgb(XTERM_16[index]!)
  if (index >= 232) {
    const value = 8 + (index - 232) * 10
    return { r: value, g: value, b: value }
  }
  const levels = [0, 95, 135, 175, 215, 255]
  const cube = index - 16
  return {
    r: levels[Math.floor(cube / 36) % 6]!,
    g: levels[Math.floor(cube / 6) % 6]!,
    b: levels[cube % 6]!,
  }
}
function paintColor(paint: Paint): { r: number; g: number; b: number } | undefined {
  if (paint === 'default') return undefined
  if (paint.startsWith('rgb:')) return hexRgb('#' + (Number(paint.slice(4)) + 0x1000000).toString(16).slice(1))
  return ansi256Rgb(Number(paint.slice('palette:'.length)))
}
// The body text rides on the terminal's DEFAULT foreground; xterm reports the
// cell as "default", so the ratios assume the palette's conventional default
// fg (white on a dark palette, black on a light one — the assumption a
// 16-colour terminal starts from).
const TERMINAL_DEFAULT_FG = { dark: { r: 255, g: 255, b: 255 }, light: { r: 0, g: 0, b: 0 } } as const
/** WCAG AA for body text: a state face must not bury the card's own text. */
const MIN_BODY_CONTRAST = 4.5
/**
 * 低色档的有色槽位（与 `src/cardStyles.ts` 的 `TIER_STATE_FILLS` 同一契约）：
 * 256 档执行中是中性灰阶，成功/失败是有色相的低饱和槽位（暗盘深青绿 23 /
 * 豆沙玫瑰 95，亮盘 sage 151 / rose 181），不再退成相邻灰阶；16 色档没有
 * 柔和色可用，深色盘用黑 / 蓝 / 红、浅色盘用白 / 绿 / 亮红，只保证三态可辨
 * 与正文可读，呈现不了豆沙色盘。
 */
const SLOT_256 = {
  dark: { running: 'ansi256(236)', success: 'ansi256(23)', failure: 'ansi256(95)' },
  light: { running: 'ansi256(254)', success: 'ansi256(151)', failure: 'ansi256(181)' },
} as const
const SLOT_16 = {
  dark: { running: 'ansi:black', success: 'ansi:blue', failure: 'ansi:red' },
  light: { running: 'ansi:white', success: 'ansi:green', failure: 'ansi:redBright' },
} as const
const STATUSES = ['running', 'success', 'failure'] as const
type StateSlot = Readonly<Record<(typeof STATUSES)[number], string>>
/** 真彩档里 `ansi:` 盘没有可用的中性面通道：执行中走 256 槽位，成功/失败
 *  仍是固定豆沙色。 */
type StateExpectation = { readonly kind: 'slots'; readonly slots: StateSlot } | { readonly kind: 'running-slot' }
const slotPaints = await samplePaints([
  ...Object.values(SLOT_256.dark), ...Object.values(SLOT_256.light),
  ...Object.values(SLOT_16.dark), ...Object.values(SLOT_16.light),
])
const paintOfSlot = (color: string): Paint => slotPaints.get(color) ?? 'default'
const asAnsiPalette = (name: string): boolean => name.endsWith('-ansi')
const tier = chalk.level
console.log(`  色档 chalk.level=${tier}`)

/** 一个主题在指定色档下的三态卡面：两两不同、正文对比达标，低色档还必须落
 *  在预期的槽位上（真彩档只有缺中性面通道的 ANSI 调色板让执行中走槽位）。 */
async function checkStateFaces(themeName: string, tierLabel: string, expected: StateExpectation | undefined): Promise<void> {
  const palette = getTheme(themeName)
  const foreground = isLightThemeActive(themeName) ? TERMINAL_DEFAULT_FG.light : TERMINAL_DEFAULT_FG.dark
  const faces = STATUSES.map(status => cardBackgroundColor(piStyles.kinds.tool.states?.[status], palette, themeName) ?? '')
  await withTerminal(90, () => React.createElement(
    ThemeProvider,
    { theme: themeName },
    React.createElement(MessageList, listProps([toolRow(1, 'running'), toolRow(2, 'ok'), toolRow(3, 'error')])),
  ), async (frame) => {
    check(`${themeName} 三张工具卡都在屏上`, await ready(frame, 'Bash(seq 6)'))
    const heads = frame.lines().map((line, y) => (line.includes('Bash(seq 6)') ? y : -1)).filter(y => y >= 0)
    const headFaces = heads.map(y => frame.bg(0, y))
    const measured: string[] = []
    let worst = Number.POSITIVE_INFINITY
    for (const [index, label] of STATUSES.entries()) {
      const bg = frame.bg(4, heads[index]!)
      const bgColor = paintColor(bg) ?? foreground
      const first = luminance(foreground)
      const second = luminance(bgColor)
      const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      worst = Math.min(worst, ratio)
      measured.push(`${label}=${bg}(${ratio.toFixed(2)}:1)`)
    }
    console.log(`  ${themeName} [${tierLabel}]: ${faces.join(' | ')} -> ${measured.join(' ')}`)
    check(`${themeName} 三态卡面两两不同`, new Set(headFaces).size === 3, headFaces.join(' / '))
    check(`${themeName} 三态卡面上的默认正文读得清（≥ ${MIN_BODY_CONTRAST}:1）`, worst >= MIN_BODY_CONTRAST, `worst=${worst.toFixed(2)}:1`)
    if (tier >= 3 && expected === undefined && !isLightThemeActive(themeName)) {
      // 暗色真彩盘的默认状态面整体贴近终端黑底（只在真彩档可见）。
      const depths = headFaces.map(paint => {
        const color = paintColor(paint)
        return color === undefined ? undefined : luminance(color)
      })
      check(`${themeName} 暗色状态面贴近黑底（相对亮度 ≤ 0.02）`,
        depths.every(depth => depth !== undefined && depth <= 0.02),
        depths.map(depth => depth === undefined ? '?' : depth.toFixed(3)).join('/'))
    }
    if (expected === undefined) {
      check(`${themeName} 真彩档状态面是逐通道实色（渲染器量化后仍为 RGB）`,
        headFaces.every(face => face.startsWith('rgb:')), headFaces.join(' / '))
    } else if (expected.kind === 'running-slot') {
      const running = paintOfSlot(SLOT_256[isLightThemeActive(themeName) ? 'light' : 'dark'].running)
      check(`${themeName} ANSI 盘的执行中卡面走中性槽位`, headFaces[0] === running, `${headFaces[0]} want ${running}`)
      check(`${themeName} ANSI 盘的成/败卡面仍是逐通道豆沙色`,
        headFaces[1]?.startsWith('rgb:') === true && headFaces[2]?.startsWith('rgb:') === true
        && headFaces[1] !== headFaces[2], headFaces.slice(1).join(' / '))
    } else {
      const want = STATUSES.map(status => paintOfSlot(expected.slots[status]))
      check(`${themeName} 状态面走预期槽位（不依赖终端自己的 ANSI 盘）`,
        headFaces.every((face, index) => face === want[index]), `${headFaces.join(' / ')} want ${want.join(' / ')}`)
      if (STATUSES.every(status => expected.slots[status].startsWith('ansi256('))) {
        // 256 档：执行中是灰阶，成功偏绿/青绿、失败偏玫红，三者色相不同。
        const [running, success, failure] = want.map(paintColor)
        check(`${themeName} 执行中槽位是中性灰阶`,
          running !== undefined && running.r === running.g && running.g === running.b,
          running === undefined ? '?' : `${running.r},${running.g},${running.b}`)
        check(`${themeName} 成功槽位是绿/青绿、失败槽位是玫瑰色（色相不同，不是相邻灰阶）`,
          success !== undefined && failure !== undefined
          && success.g > success.r && success.g >= success.b
          && failure.r > failure.g && failure.r >= failure.b,
          `${success === undefined ? '?' : `${success.r},${success.g},${success.b}`} / ${failure === undefined ? '?' : `${failure.r},${failure.g},${failure.b}`}`)
      }
    }
    check(`${themeName} 状态符号保留`, frame.screen().includes('✗') && frame.screen().includes('●') && frame.screen().includes('•'))
  })
}

const totals = { themes: 0, ansiThemes: 0 }
for (const themeName of THEME_NAMES) {
  const light = isLightThemeActive(themeName)
  // 真彩档：普通主题用固定的豆沙色表（执行中跟随主题中性面）；ANSI 调色板
  // 的 exec 面仍走 256 中性槽位。256 / 16 色档无论主题都换成对应极性的槽位。
  const expected: StateExpectation | undefined = tier >= 3
    ? (asAnsiPalette(themeName) ? { kind: 'running-slot' } : undefined)
    : { kind: 'slots', slots: (tier === 2 ? SLOT_256 : SLOT_16)[light ? 'light' : 'dark'] }
  if (asAnsiPalette(themeName)) totals.ansiThemes += 1
  totals.themes += 1
  await checkStateFaces(themeName, tier >= 3 ? 'truecolor' : tier === 2 ? 'ansi256' : 'ansi16', expected)
}
check('主题矩阵覆盖了内置主题与两个 ANSI 盘', totals.themes === THEME_NAMES.length && totals.ansiThemes === 2, JSON.stringify(totals))

// ---------------------------------------------------------------------------
// 16 色档（chalk.level = 1）：整张内置矩阵走同一套可读槽位
// ---------------------------------------------------------------------------
console.log('--- 16 colours: the whole built-in matrix ---')
{
  // 与 `ink/colorize.ts` 一样直接改 chalk.level：它是模块级单例，改完下几帧
  // 就按这一档输出，正好用来量「只有 16 色时」的真实色块。对比度按 xterm 通常
  // 的 0–15 默认（`ansi256Rgb` 与 src/ink/screen.ts 同一张表）折算——这是测试
  // 假设，不是终端事实：深色盘的 black/blue/red 与浅色盘的 white/green/
  // redBright 在标准盘上都够读，自定义过 16 色的终端可能不同。
  const savedLevel = chalk.level
  chalk.level = 1
  try {
    for (const themeName of THEME_NAMES) {
      const light = isLightThemeActive(themeName)
      await checkStateFaces(themeName, 'ansi16', { kind: 'slots', slots: light ? SLOT_16.light : SLOT_16.dark })
    }
  } finally {
    chalk.level = savedLevel
  }
}

applyCardStyles(undefined)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURES`)
process.exit(failed === 0 ? 0 : 1)
