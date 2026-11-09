/**
 * 描边体验场景的布局回归（票 04）：在无头 xterm 里渲染入口同一份
 * `CardStylesScene`（`card-styles-demo.tsx` 的 Alt+3 预设），覆盖
 * 30/40/80/120 列 × inline/fullscreen。
 *
 * 断言的是用户实际能看到的东西，不是 helper：
 *   - 用户/助手/摘要/工具/子代理/任务正文真的出现在屏上（不是只有边框）；
 *   - 内容高度大于视口，从顶到底逐屏滚动都有正文，滚过的位置没有整屏
 *     空白带（没有真实 scrollHandle 时虚拟列表只画 sticky 占位）；
 *   - 每行按终端显示单元格计不超过列数（含子代理卡的自有缩进与边框）。
 *
 * 运行：node --import tsx/esm scripts/downstream/verify-card-demo.tsx
 * 预览：DSH_TUI_DUMP_FRAMES=1 打印每个场景的终屏。
 */
// Layout does not depend on the colour tier; pin truecolor so the card faces
// resolve deterministically. Emoji width is measured in terminal cells below.
process.env.FORCE_COLOR ??= '3'
process.env.DSH_TUI_TMUX_TRUECOLOR ??= '1'
process.env.DSH_TUI_LANG = 'zh'

const [{ Writable, PassThrough }, { mkdtempSync }, { tmpdir }, { join: joinPath }] = await Promise.all([
  import('node:stream'),
  import('node:fs'),
  import('node:os'),
  import('node:path'),
])
// 家目录隔离在任何 lib 导入之前（DATA_DIR 在模块加载时定死）。
const isolatedHome = mkdtempSync(joinPath(tmpdir(), 'dshtui-card-demo-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome

const [{ default: React }, { Terminal: XTerm }, uiMod, sceneMod, { stringWidth }] = await Promise.all([
  import('react'),
  import('@xterm/headless'),
  import('../../src/ui.js'),
  import('./card-styles-demo-scene.js'),
  import('../../src/ink/stringWidth.js'),
])
const termTest = await import('../lib/term-test.mjs')

const { render, AlternateScreen } = uiMod as unknown as {
  render: typeof import('../../src/ui.js').render
  AlternateScreen: React.ComponentType<{ children?: React.ReactNode }>
}
const { CardStylesScene } = sceneMod as unknown as typeof import('./card-styles-demo-scene.js')
const { settled } = termTest as unknown as {
  settled(pred: () => boolean, opts?: { timeoutMs?: number }): Promise<boolean>
}

const { viewportLines } = termTest as unknown as {
  viewportLines(term: InstanceType<typeof XTerm>, rows?: number): string[]
}

const ROWS = 30
const COLUMNS = [30, 40, 80, 120] as const
const DUMP = process.env.DSH_TUI_DUMP_FRAMES === '1'

let failed = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  (' + extra + ')' : ''))
  if (!ok) failed += 1
}

// Short needles: at 30 columns a longer phrase can wrap between two lines.
const TOP_NEEDLES = ['把卡片样式接进转录', '无边框'] as const
const BOTTOM_NEEDLES = ['pwsh-live', '摘要', 'echo hello', '已打断', 'Interrupted'] as const

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

type ScrollHandle = {
  scrollTo(y: number): void
  scrollToBottom(): void
  getScrollTop(): number
  getScrollHeight(): number
  getViewportHeight(): number
}

interface Frame {
  lines(): string[]
  rowOf(needle: string): number
  screen(): string
}

async function withScene(
  cols: number,
  inline: boolean,
  run: (frame: Frame, handle: () => ScrollHandle | null) => Promise<void>,
): Promise<void> {
  const term = new XTerm({ cols, rows: ROWS, scrollback: 0, allowProposedApi: true })
  const stdout = new FakeStdout(term, cols) as unknown as NodeJS.WriteStream
  const stdin = new Input()
  let handle: ScrollHandle | null = null
  const scene = React.createElement(CardStylesScene, {
    initialPresetIndex: 2,
    inline,
    theme: 'dark',
    onExit: () => {},
    onScrollHandle: (next: ScrollHandle) => { handle = next },
  })
  const instance = await render(
    inline ? scene : React.createElement(AlternateScreen, null, scene),
    { stdout, stdin: stdin as unknown as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false },
  )
  const lines = (): string[] => viewportLines(term, ROWS)
  const frame: Frame = {
    lines,
    rowOf: (needle) => lines().findIndex(line => line.includes(needle)),
    screen: () => lines().join('\n'),
  }
  try {
    await run(frame, () => handle)
    if (DUMP) console.log('--- frame ---\n' + frame.screen().replace(/\n+$/, '') + '\n-------------')
  } finally {
    await instance.unmount()
    term.dispose()
  }
}

/** A scroll position is "painted" when no run of blank rows looks like an
 *  unmounted band: the real card gaps are one row, two adjacent gaps are the
 *  most a painted transcript produces here. */
function maxBlankRun(lines: readonly string[]): number {
  let run = 0
  let max = 0
  for (const line of lines) {
    if (line.trim() === '') {
      run += 1
      max = Math.max(max, run)
    } else run = 0
  }
  return max
}

function hits(lines: readonly string[], needles: readonly string[]): string[] {
  return needles.filter(needle => lines.some(line => line.includes(needle)))
}

/**
 * 真实显示宽度断言：用仓库的 `stringWidth` 量每一行，超宽即溢出。emoji 行
 * 跳过——headless xterm 把多数 emoji 量成 1 格，而仓库的显示宽度按 2 格，
 * 直接比会把「终端自己量出的宽度」算成溢出（卡框仍是 emoji-free 的边框行，
 * 由同一个断言覆盖）。
 */
const EMOJI = /\p{Extended_Pictographic}/u
function displayOverflow(line: string, cols: number, top: number): string[] {
  if (EMOJI.test(line)) return []
  const width = stringWidth(line.trimEnd())
  return width > cols ? [`${width}@${top}:${JSON.stringify(line)}`] : []
}

const BODY_NEEDLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['用户', TOP_NEEDLES.slice(0, 1)],
  ['助手正文', ['无边框']],
  ['工具diff正文', ['const a']],
  ['工具实时输出', ['42 passed']],
  ['工具错误正文', ['exit code 1']],
  // Settled subagents are title-only; the description is clipped on narrow
  // terminals, while this prefix exists only in their actual card content.
  ['子代理', ['子代理']],
  ['摘要', ['摘要']],
  ['任务输出', ['working']],
  ['回显', ['echo hello']],
]

for (const inline of [false, true] as const) {
  for (const cols of COLUMNS) {
    const tag = `${cols}列/${inline ? 'inline' : 'fullscreen'}`
    await withScene(cols, inline, async (frame, getHandle) => {
      check(`${tag} 场景已挂载（有真实滚动句柄）`, await settled(() => {
        const handle = getHandle()
        return handle !== null && frame.lines().some(line => line.trim() !== '')
      }, { timeoutMs: 6000 }), `top=${JSON.stringify(frame.lines()[0])} handle=${getHandle() !== null}`)
      // 一个被压扁的 transcript 恰好等于视口高：先等它真的比视口高。
      check(`${tag} 滚动内容高于视口（没有被 ScrollBox 压扁）`,
        await settled(() => {
          const handle = getHandle()
          return handle !== null && handle.getScrollHeight() > handle.getViewportHeight() + 20
        }, { timeoutMs: 6000 }),
        `scrollHeight=${getHandle()?.getScrollHeight()} viewport=${getHandle()?.getViewportHeight()}`)
      const handle = getHandle()

      // 顶部：滚动到 0 后第一张卡（用户消息）的正文与上边框都在屏上——窄屏
      // 头部折成多行时，滚动区不能把内容顶出屏幕。
      handle?.scrollTo(0)
      const topBody = await settled(() => hits(frame.lines(), TOP_NEEDLES).length === TOP_NEEDLES.length, { timeoutMs: 4000 })
      check(`${tag} 顶部有用户/助手正文`, topBody, hits(frame.lines(), TOP_NEEDLES).join(','))
      const topScreen = frame.lines()
      const userRow = frame.rowOf('把卡片样式接进转录')
      const userTopBorder = userRow >= 0 && topScreen.slice(0, userRow).some(line => line.trimStart().startsWith('╭'))
      check(`${tag} 顶部用户卡上边框完整（窄屏 header 不吃掉内容）`, userTopBorder,
        `userRow=${userRow} head=${JSON.stringify(topScreen.slice(0, Math.max(0, userRow)).slice(-2))}`)

      const viewport = handle?.getViewportHeight() ?? ROWS
      const scrollHeight = handle?.getScrollHeight() ?? 0
      const max = Math.max(0, scrollHeight - viewport)
      const step = Math.max(1, Math.floor(viewport / 4))
      const seen = new Set<string>()
      const overflows: string[] = []
      let worstBlank = 0
      let worstAt = -1
      let changed = 0
      const sample = (lines: readonly string[], top: number): void => {
        for (const [label, needles] of BODY_NEEDLES) {
          if (needles.some(needle => lines.some(line => line.includes(needle)))) seen.add(label)
        }
        const blank = maxBlankRun(lines)
        if (blank > worstBlank) { worstBlank = blank; worstAt = top }
        for (const line of lines) overflows.push(...displayOverflow(line, cols, top))
      }
      sample(topScreen, 0)
      for (let top = step; top <= max + step; top += step) {
        const target = Math.min(top, max)
        const before = frame.screen()
        handle?.scrollTo(target)
        if (await settled(() => frame.screen() !== before, { timeoutMs: 2000 })) changed += 1
        sample(frame.lines(), target)
      }
      // 底部：sticky 回到尾屏，任务卡/摘要/回显正文可见。
      handle?.scrollToBottom()
      const bottomHits = await settled(() => hits(frame.lines(), BOTTOM_NEEDLES).length >= 2, { timeoutMs: 4000 })
      sample(frame.lines(), max)
      const missing = BODY_NEEDLES.map(([label]) => label).filter(label => !seen.has(label))
      check(`${tag} 滚动全程看得到用户/工具/摘要/任务正文`, missing.length === 0,
        `missing=${missing.join(',')} seen=${[...seen].join(',')}`)
      check(`${tag} 滚动全程没有未绘制空白带`, worstBlank < 4, `worst=${worstBlank}@${worstAt}`)
      check(`${tag} 滚动位置真实生效（视口跟着句柄换屏）`, changed >= 2, `changed=${changed}`)
      check(`${tag} 底部有摘要/回显/任务正文`, bottomHits, hits(frame.lines(), BOTTOM_NEEDLES).join(','))
      check(`${tag} 每行显示宽度不超过终端列数（emoji 行由边框行覆盖）`, overflows.length === 0,
        overflows.slice(0, 2).join(' '))
    })
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURES`)
process.exit(failed === 0 ? 0 : 1)
