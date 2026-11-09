/**
 * 对话卡片样式的隔离体验入口（无凭据、无网络、不碰真实 HOME/会话）。
 *
 * 入口只负责终端与文件配置；场景（fixture、预设、滚动区组装）在
 * `card-styles-demo-scene.tsx`，与布局回归 `verify-card-demo.tsx` 共用同一份，
 * 所以这里看到的观感就是回归量的那一套。
 *
 *   node --import tsx/esm scripts/downstream/card-styles-demo.tsx [--inline] [--width N] [--settings FILE]
 *
 *   Alt+1  legacy（无覆盖时与升级前一致）         Alt+2  pi-like（体验默认）
 *   Alt+3  pi-like + 描边                         Alt+o  Ctrl+O 等价（全部展开）
 *   ↑/↓ k/j 滚动   PgUp/PgDn 翻页   点工具卡/摘要行 = 折叠切换   Ctrl+C 退出
 *
 * `--width N` 把内容按 N 列排版（终端更宽时右侧留白），用于窄屏演练；
 * 与 profile 的配置文件同一个解析/归一化入口（`src/cardStyles.ts`），
 * 所以这里看到的观感就是 `settings.json` 的 `values.cardStyles` 会得到的东西。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离家目录：主题偏好、会话元数据、图像缓存都落在临时目录，读完即弃。
const home = mkdtempSync(join(tmpdir(), 'dsh-tui-card-styles-demo-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.DSH_TUI_DISABLE_TERMINAL_IMAGES = '1'
// 体验入口用已有的 tmux 真彩开关（`src/ink/colorize.ts`）跳过默认的 256 色
// clamp，否则真彩暗面的细微色相看不到。只在本隔离 demo 进程里设，且用 ??=
// 保留调用方显式 FORCE_COLOR=2/1 的降级验证；不改生产颜色能力、tmux 配置
// 或用户的全局安装。
process.env.DSH_TUI_TMUX_TRUECOLOR ??= '1'

const [React, ui, { normalizeCardStyleConfig }, { readTuiSettings }, { TerminalSizeContext }] = await Promise.all([
  import('react'),
  import('../../src/ui.js'),
  import('../../src/cardStyles.js'),
  import('../../src/tuiSettingsFile.js'),
  import('../../src/ink/components/TerminalSizeContext.js'),
])
// 场景模块 import 了 src/ 的运行时，必须在 HOME 隔离之后加载。
const { CardStylesScene } = await import('./card-styles-demo-scene.js')

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this demo in a terminal')

const args = process.argv.slice(2)
const inline = args.includes('--inline')
const widthIndex = args.indexOf('--width')
const forcedWidth = widthIndex >= 0 ? Number(args[widthIndex + 1]) : undefined
if (forcedWidth !== undefined && (!Number.isFinite(forcedWidth) || forcedWidth < 20)) {
  throw new Error('--width expects a column count of at least 20')
}

const settingsIndex = args.indexOf('--settings')
const settingsFile = settingsIndex >= 0 ? args[settingsIndex + 1] : undefined
if (settingsIndex >= 0 && settingsFile === undefined) throw new Error('--settings expects a file path')
const settings = settingsFile === undefined ? undefined : readTuiSettings(settingsFile)
if (settingsFile !== undefined && settings === undefined) throw new Error(`Cannot read settings: ${settingsFile}`)
const settingsConfig = settings === undefined ? undefined : normalizeCardStyleConfig(settings.values.cardStyles)

let finish!: () => void
const done = new Promise<void>(resolve => { finish = resolve })

const scene = React.createElement(CardStylesScene, { settingsConfig, onExit: finish })
// `--width` 只替换终端列数，行数仍取真实终端（与入口原来的窄屏演练一致）。
const content = forcedWidth === undefined
  ? scene
  : React.createElement(
    TerminalSizeContext.Provider,
    { value: { columns: forcedWidth, rows: Math.max(10, process.stdout.rows ?? 30) } },
    scene,
  )
const instance = await ui.render(
  inline ? content : React.createElement(ui.AlternateScreen, null, content),
  { exitOnCtrlC: false, patchConsole: false },
)
process.once('SIGINT', () => finish())
process.once('SIGTERM', () => finish())
try {
  await done
} finally {
  await instance.unmount()
  rmSync(home, { recursive: true, force: true })
}
