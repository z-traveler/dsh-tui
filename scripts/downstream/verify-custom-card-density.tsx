/**
 * 单卡片密度（`TuiCardView.density: 'compact'`）的真实单元格回归。
 *
 * 观察面是终端单元格，不是配置字符串：一张声明了紧凑密度的自定义卡片只丢掉
 * 配置出来的卡面（底色、边框、内边距、间隔），主题标签/正文色、选中高亮、
 * 折叠表头、展开后的完整正文与紧凑表格都保持；同一屏里没有声明密度的卡片
 * 逐格不变（紧凑卡片的高度从基线里扣掉后，其余单元格与基线完全相同）。
 *
 * 矩阵：深/浅主题 × 40/80 列 × inline/fullscreen × legacy/pi-like × 折叠/展开。
 * 运行：node --import tsx/esm scripts/downstream/verify-custom-card-density.tsx
 */
import '../lib/fake-home.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_TMUX_TRUECOLOR = '1'
process.env.DSH_TUI_LANG = 'en'

import { PassThrough, Writable } from 'node:stream'

const [React, { Terminal }, { render, Box, Text, ThemeProvider, AlternateScreen }, { CustomCardRow, FoldedCardRow }, { applyCardStyles }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/components/messages/CustomCardRow.js'), import('../../src/cardStyles.js'),
])
import { settled } from '../lib/term-test.mjs'

/** pi-like 自定义卡面/标签/正文的参考色（与 verify-custom-card-visual 同一参考）。 */
const reference = {
  dark: { bg: 0x3a3055, label: 0xa798d7, text: 0x9da5a9 },
  light: { bg: 0xe6e4ee, label: 0x7459b4, text: 0x677176 },
}
/** 卡面可能画的框线：紧凑密度下不应出现任何一个。 */
const BORDER_GLYPHS = /[│┃║┌┍┎┏╭╮┐┑┒┓└┕┖┗╰╯┘┙┚┛─━]/u
const AFTER = 'AFTER_CARD'
const LONG_PATH = 'packages/很长的模块名称/AGENTS.md'
const TAIL = 'TAIL-MARKER 导入 shared/deep/nested/response-contract.md'

/** 一张卡的内容：紧凑表 + 长 CJK 路径 + 正文末尾标记。 */
const cardContent = {
  label: 'ctx',
  title: '2条 · 导入2',
  blocks: [
    { kind: 'table', layout: 'compact', columns: ['来源', '作用域'], rows: [['AGENTS.md', 'packages/**'], ['rules/api.md', 'pkg/api/**']] },
    { kind: 'text', text: `导入 ${LONG_PATH}\n${TAIL}` },
  ],
} as const
/** 声明了紧凑密度的同一张卡。 */
const compactView = { ...cardContent, density: 'compact' } as const
/** 没有声明密度的普通自定义卡片：证明密度只作用声明它的那一张。 */
const defaultView = { label: 'skill', title: 'pdf-tools', blocks: [{ kind: 'text', text: 'Use the pdf tools.' }] } as const

class Input extends PassThrough {
  isTTY = true
  setRawMode(): this { return this }
  ref(): this { return this }
  unref(): this { return this }
}

type Scene = {
  theme: 'dark' | 'light'
  columns: number
  fullscreen: boolean
  preset: 'legacy' | 'pi-like'
  expanded: boolean
  /** 显式 `cardStyles` 覆盖（用户给 `kinds.custom` 加边框/内边距时用它）。 */
  config?: object
}

async function mount(scene: Scene, nodes: readonly React.ReactNode[]) {
  const rows = 24
  const terminal = new Terminal({ cols: scene.columns, rows, allowProposedApi: true })
  class Output extends Writable {
    columns = scene.columns
    rows = rows
    isTTY = true
    _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
  }
  const stdout = new Output()
  const input = new Input()
  applyCardStyles((scene.config ?? { preset: scene.preset }) as never)
  const content = (
    <ThemeProvider theme={scene.theme}>
      <Box flexDirection="column">
        {nodes}
        <Text>{AFTER}</Text>
      </Box>
    </ThemeProvider>
  )
  const instance = await render(scene.fullscreen ? <AlternateScreen>{content}</AlternateScreen> : content, {
    stdout: stdout as never, stdin: input as never, stderr: stdout as never, patchConsole: false, exitOnCtrlC: false,
  })
  const line = (y: number): string => terminal.buffer.active.getLine(y)?.translateToString(true) ?? ''
  const lines = () => Array.from({ length: rows }, (_, y) => line(y))
  return {
    lines,
    /** "default" | "palette:N" | "rgb:N" for one cell's background. */
    bgAt: (x: number, y: number): string => {
      const cell = terminal.buffer.active.getLine(y)?.getCell(x)
      if (cell === undefined || cell.isBgDefault()) return 'default'
      return cell.isBgPalette() ? `palette:${cell.getBgColor()}` : `rgb:${cell.getBgColor() & 0xffffff}`
    },
    fgAt: (x: number, y: number): string => {
      const cell = terminal.buffer.active.getLine(y)?.getCell(x)
      if (cell === undefined || cell.isFgDefault()) return 'default'
      return cell.isFgPalette() ? `palette:${cell.getFgColor()}` : `rgb:${cell.getFgColor() & 0xffffff}`
    },
    boldAt: (x: number, y: number): boolean => Boolean(terminal.buffer.active.getLine(y)?.getCell(x)?.isBold()),
    /** Whole-cell snapshot of a row range: the "unchanged" comparison unit. */
    cells: (from: number, to: number): string => JSON.stringify(Array.from({ length: to - from }, (_, row) => Array.from({ length: scene.columns }, (_, col) => {
      const cell = terminal.buffer.active.getLine(from + row)?.getCell(col)
      return [cell?.getChars() ?? '', cell === undefined || cell.isFgDefault() ? 'd' : cell.getFgColor(), cell === undefined || cell.isBgDefault() ? 'd' : cell.getBgColor(), Boolean(cell?.isBold())]
    }))),
    rowOf: (needle: string): number => lines().findIndex(text => text.includes(needle)),
    async close() { await instance.unmount(); terminal.dispose(); input.destroy() },
  }
}

/** 一张卡片节点：同一份内容，密度由视图自己声明。 */
function cardNode(view: object, type: string, scene: Scene, background?: 'messageActionsBackground'): React.ReactNode {
  return <CustomCardRow key={type} view={view as never} type={type} expanded={scene.expanded}
    marginTopOnTurn={false} toolBackground="none" background={background} />
}

/** 折叠行：窗口折起来后只剩有界预览，仍是同一个卡面壳。 */
function foldedNode(preview: string, density?: 'compact'): React.ReactNode {
  return <FoldedCardRow key="folded" preview={preview} density={density} marginTopOnTurn={false}
    toolBackground="none" background={undefined} />
}

/** 显示宽度：不依赖渲染器的最小实现（CJK/emoji 宽 2），屏幕文本已去 ANSI。 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += (code >= 0x1100 && (
      code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)
    )) ? 2 : 1
  }
  return width
}

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    console.log(`PASS ${name}`)
    return
  }
  failures += 1
  console.error(`FAIL ${name}${extra ? `  (${extra})` : ''}`)
}

/**
 * 主题角色参考：同一份内容不声明密度时的标签色/字重。密度只去掉卡面，这两项
 * （以及正文色）必须逐项相同；宽度无关，所以每种主题与方案只取一次。
 */
const roleReference = new Map<string, { label: string; bold: boolean; text: string }>()
async function referenceRoles(theme: Scene['theme'], preset: Scene['preset']) {
  const key = `${theme}-${preset}`
  const cached = roleReference.get(key)
  if (cached !== undefined) return cached
  const scene: Scene = { theme, columns: 80, fullscreen: false, preset, expanded: true }
  const view = await mount(scene, [cardNode(cardContent, 'acme/context', scene)])
  try {
    await settled(() => view.rowOf('[ctx]') >= 0)
    const labelRow = view.rowOf('[ctx]')
    const x = view.lines()[labelRow].indexOf('[ctx]')
    const titleRow = preset === 'legacy' ? labelRow : labelRow + 1
    const titleX = view.lines()[titleRow].indexOf('2条')
    const roles = { label: view.fgAt(x, labelRow), bold: view.boldAt(x, labelRow), text: view.fgAt(titleX, titleRow) }
    roleReference.set(key, roles)
    return roles
  } finally {
    await view.close()
  }
}

// ── 矩阵：紧凑密度只去掉卡面 ────────────────────────────────────────────────
for (const theme of ['dark', 'light'] as const) {
  for (const columns of [40, 80]) {
    for (const fullscreen of [false, true]) {
      for (const preset of ['legacy', 'pi-like'] as const) {
        for (const expanded of [false, true]) {
          const name = `${theme}-${columns}-${fullscreen ? 'fullscreen' : 'inline'}-${preset}-${expanded ? 'expanded' : 'collapsed'}`
          const scene: Scene = { theme, columns, fullscreen, preset, expanded }
          const roles = await referenceRoles(theme, preset)
          const view = await mount(scene, [cardNode(compactView, 'acme/context', scene)])
          try {
            const ready = await settled(() => view.rowOf(AFTER) >= 0 && view.rowOf('[ctx]') >= 0)
            const after = view.rowOf(AFTER)
            const row = view.rowOf('[ctx]')
            const lines = view.lines().slice(0, after)
            const labelX = lines[row]?.indexOf('[ctx]') ?? -1
            // pi-like's expanded layout puts the title on its own row; collapsed
            // and legacy keep it on the header row.
            const titleRow = expanded && preset === 'pi-like' ? row + 1 : row
            const titleX = lines[titleRow]?.indexOf('2条') ?? -1
            check(`${name}: 紧凑卡片渲染完成`, ready && after > 0, JSON.stringify(lines.slice(0, 6)))
            check(`${name}: 卡片顶行没有间隔空行（没有 minimumGap/额外 gap）`, row === 0, `label row ${row}`)
            check(`${name}: 标签与正文保留主题角色与字重`,
              view.fgAt(labelX, row) === roles.label && view.boldAt(labelX, row) === roles.bold
                && view.fgAt(titleX, titleRow) === roles.text,
              JSON.stringify({ label: view.fgAt(labelX, row), title: view.fgAt(titleX, titleRow), expected: roles, row: lines[row] }))
            check(`${name}: 只剩转录缩进（内核缩进不变，卡面内边距消失）`,
              labelX === (preset === 'legacy' ? 2 : 0), `label x ${labelX}`)
            check(`${name}: 没有卡面底色（含末列）`,
              lines.every((_, y) => view.bgAt(0, y) === 'default' && view.bgAt(columns - 1, y) === 'default'),
              JSON.stringify(lines.map((_, y) => view.bgAt(columns - 1, y))))
            check(`${name}: 没有边框与内边距`,
              lines.every(text => !BORDER_GLYPHS.test(text)) && view.bgAt(0, after - 1) === 'default', JSON.stringify(lines))
            check(`${name}: 卡片末行不是填充空行、卡面不向下一行泄漏`,
              view.lines()[after - 1].trim() !== '' && view.bgAt(0, after) === 'default')
            const compacted = lines.join('').replace(/\s+/gu, '')
            check(`${name}: 折叠表头与展开正文都在（长 CJK 路径与表格单元完整）`,
              expanded
                ? compacted.includes(LONG_PATH) && compacted.includes('TAIL-MARKER') && compacted.includes('rules/api.md') && compacted.includes('pkg/api/**')
                : compacted.includes('2条·导入2'),
              compacted.slice(0, 160))
            check(`${name}: 折叠时仍提示展开手势`, expanded || /expand/i.test(view.lines()[row] ?? ''))
            // 展开后的紧凑几何：标签、标题各占一行，正文前只有方案自己的那一个
            // 分隔空行（B 的读法）；卡面的上下内边距与间隔都不在了。
            check(`${name}: 展开几何没有卡面留白`,
              !expanded || preset === 'legacy'
                || (lines[1]?.trim() === '2条 · 导入2' && lines[2]?.trim() === '' && (lines[3]?.trim() ?? '') !== ''),
              JSON.stringify(lines.slice(0, 5)))
            check(`${name}: 每一行都在终端宽度内`,
              lines.every(text => displayWidth(text) <= columns),
              JSON.stringify(lines.filter(text => displayWidth(text) > columns).slice(0, 3)))
          } finally {
            await view.close()
          }
        }
      }
    }
  }
}

// ── 窄屏中的真实标题形状：提示不能把轻量折叠条挤成两行 ────────────────────
for (const preset of ['legacy', 'pi-like'] as const) {
  const scene: Scene = { theme: 'dark', columns: 40, fullscreen: false, preset, expanded: false }
  const view = await mount(scene, [cardNode({ ...compactView, label: '上下文', title: '2 条 · 导入 2' }, 'acme/context', scene)])
  try {
    await settled(() => view.rowOf(AFTER) >= 0)
    check(`${preset}: 40 列中的紧凑折叠条只占一行`, view.rowOf(AFTER) === 1, JSON.stringify(view.lines().slice(0, view.rowOf(AFTER))))
  } finally { await view.close() }
}

// ── 方案 1：标题/内容分色，短内容一行，长 import 路径续行但不丢失 ───────────
const IMPORT_PATH = `/work/${'很长的共享目录/'.repeat(8)}context.md`
for (const theme of ['dark', 'light'] as const) {
  for (const preset of ['legacy', 'pi-like'] as const) {
    for (const columns of [40, 80]) {
      for (const fullscreen of [false, true]) {
        const scene: Scene = { theme, columns, fullscreen, preset, expanded: false }
        const view = await mount(scene, [cardNode({ ...compactView, label: 'context', title: `pkg/AGENTS.md · import ${IMPORT_PATH} · import /work/shared/style.md` }, 'acme/context', scene)])
        try {
          await settled(() => view.rowOf(AFTER) >= 0)
          const lines = view.lines().slice(0, view.rowOf(AFTER))
          const content = lines.join('').replace(/\s+/gu, '')
          const row = view.rowOf('[context]')
          const header = view.lines()[row] ?? ''
          const name = `${theme}-${preset}-${columns}-${fullscreen ? 'fullscreen' : 'inline'}`
          check(`${name}: 收起时完整展示文件及 import 路径，不用计数或省略号替代`,
            content.includes('pkg/AGENTS.md') && content.includes(IMPORT_PATH) && content.includes('/work/shared/style.md') && !content.includes('TAIL-MARKER'), content)
          check(`${name}: context 标题与路径内容分色`, view.fgAt(header.indexOf('[context]'), row) !== view.fgAt(header.indexOf('pkg/'), row), header)
          check(`${name}: 长路径自动续行且不撑宽`, lines.length > 1 && lines.every(line => displayWidth(line) <= columns))
        } finally { await view.close() }
      }
    }
  }
}

// ── 用户显式覆盖的卡面（圆角边框 + 内边距）：紧凑密度只去掉自己那张卡 ─────────
{
  const scene: Scene = {
    theme: 'dark', columns: 80, fullscreen: false, preset: 'pi-like', expanded: false,
    config: { preset: 'pi-like', kinds: { custom: { border: 'round', paddingX: 2, paddingY: 1 } } },
  }
  const plain = await mount(scene, [cardNode(cardContent, 'acme/context', scene)])
  const compact = await mount(scene, [cardNode(compactView, 'acme/context', scene)])
  try {
    await settled(() => plain.rowOf('[ctx]') >= 0 && compact.rowOf('[ctx]') >= 0)
    const plainRow = plain.rowOf('[ctx]')
    const compactRow = compact.rowOf('[ctx]')
    check('显式卡面：普通卡片真的画出圆角框、内边距与底色',
      plainRow > 1 && plain.lines().slice(0, plainRow).some(text => BORDER_GLYPHS.test(text))
        && plain.lines()[plainRow]!.indexOf('[ctx]') === 3
        && plain.bgAt(0, plainRow) !== 'default',
      JSON.stringify({ label: plain.lines()[plainRow], top: plain.lines().slice(0, 3) }))
    check('显式卡面：声明密度的卡片没有框、没有内边距、没有底色',
      compactRow === 0 && compact.lines().every(text => !BORDER_GLYPHS.test(text))
        && compact.lines()[0]!.indexOf('[ctx]') === 0
        && compact.bgAt(0, compactRow) === 'default',
      JSON.stringify({ label: compact.lines()[0], top: compact.lines().slice(0, 3) }))
  } finally {
    await plain.close()
    await compact.close()
  }
}

// ── 折叠行（只有有界预览，没有完整快照）：同一个卡面壳按同一份密度画 ──────────
const FOLDED_PREVIEW = '2条 · 导入2 · 导入 packages/很长的模块名称/AGENTS.md'
for (const theme of ['dark', 'light'] as const) {
  for (const columns of [40, 80]) {
    for (const preset of ['legacy', 'pi-like'] as const) {
      const name = `折叠预览 ${theme}-${columns}-${preset}`
      const scene: Scene = { theme, columns, fullscreen: false, preset, expanded: false }
      const compact = await mount(scene, [foldedNode(FOLDED_PREVIEW, 'compact')])
      const plain = await mount(scene, [foldedNode(FOLDED_PREVIEW)])
      try {
        await settled(() => compact.rowOf('导入2') >= 0 && plain.rowOf('导入2') >= 0)
        const compactRow = compact.rowOf('导入2')
        const plainRow = plain.rowOf('导入2')
        check(`${name}: 折叠预览按声明的密度画（无底色、无内边距、无间隔行）`,
          compactRow === 0 && compact.bgAt(0, compactRow) === 'default'
            && compact.bgAt(columns - 1, compactRow) === 'default'
            && compact.lines()[compactRow]!.indexOf('2条') === (preset === 'legacy' ? 2 : 0),
          JSON.stringify({ row: compactRow, line: compact.lines()[compactRow], bg: compact.bgAt(columns - 1, compactRow) }))
        check(`${name}: 不声明密度的折叠预览保持既有卡面`,
          preset === 'legacy'
            ? plainRow === 0 && plain.bgAt(0, plainRow) === 'default'
            : plainRow === 2 && plain.bgAt(0, plainRow) === `rgb:${reference[theme].bg}`,
          JSON.stringify({ row: plainRow, bg: plain.bgAt(0, plainRow) }))
      } finally {
        await compact.close()
        await plain.close()
      }
    }
  }
}

// ── 选中高亮优先于卡面，也优先于「没有卡面」 ────────────────────────────────
for (const preset of ['legacy', 'pi-like'] as const) {
  const scene: Scene = { theme: 'dark', columns: 80, fullscreen: false, preset, expanded: false }
  const view = await mount(scene, [cardNode(compactView, 'acme/context', scene, 'messageActionsBackground')])
  try {
    await settled(() => view.rowOf('[ctx]') >= 0)
    const row = view.rowOf('[ctx]')
    check(`${preset}: 紧凑密度下选中高亮仍然生效`,
      view.bgAt(0, row) !== 'default' && view.bgAt(0, row) === view.bgAt(79, row),
      JSON.stringify({ left: view.bgAt(0, row), right: view.bgAt(79, row) }))
  } finally {
    await view.close()
  }
}

// ── 同一屏里没有声明密度的卡片逐格不变 ──────────────────────────────────────
for (const theme of ['dark', 'light'] as const) {
  for (const preset of ['legacy', 'pi-like'] as const) {
    const name = `${theme} ${preset}`
    const scene: Scene = { theme, columns: 80, fullscreen: false, preset, expanded: false }
    const baseline = await mount(scene, [cardNode(defaultView, 'skill', scene)])
    const compactOnly = await mount(scene, [cardNode(compactView, 'acme/context', scene)])
    const composed = await mount(scene, [cardNode(compactView, 'acme/context', scene), cardNode(defaultView, 'skill', scene)])
    try {
      await settled(() => baseline.rowOf(AFTER) >= 0 && compactOnly.rowOf(AFTER) >= 0 && composed.rowOf('[skill]') >= 0)
      const baseEnd = baseline.rowOf(AFTER)
      const compactHeight = compactOnly.rowOf(AFTER)
      const composedEnd = composed.rowOf(AFTER)
      const skillRow = baseline.rowOf('[skill]')
      check(`${name}: 普通自定义卡片顶行仍是配置出来的卡面（密度不全局生效）`,
        preset === 'legacy'
          ? skillRow === 0 && baseline.lines()[0].indexOf('[skill]') === 2 && baseline.bgAt(0, skillRow) === 'default'
          : skillRow === 2 && baseline.lines()[2].indexOf('[skill]') === 1
            && baseline.bgAt(0, skillRow) === `rgb:${reference[theme].bg}` && baseline.bgAt(0, skillRow - 1) === `rgb:${reference[theme].bg}`,
        JSON.stringify({ top: baseline.bgAt(0, 0), skillRow, label: baseline.lines()[skillRow] }))
      check(`${name}: 紧凑卡片只占自己的行数，普通卡片仍从下一行按原高度接续`,
        composedEnd === compactHeight + baseEnd,
        JSON.stringify({ composedEnd, compactHeight, baseEnd }))
      check(`${name}: 同屏普通卡片的单元格与基线逐格相同`,
        composed.cells(compactHeight, composedEnd) === baseline.cells(0, baseEnd),
        JSON.stringify({ base: baseline.lines().slice(0, baseEnd), composed: composed.lines().slice(compactHeight, composedEnd) }))
    } finally {
      await baseline.close()
      await compactOnly.close()
      await composed.close()
    }
  }
}

applyCardStyles(undefined)
check('整体：没有失败场景', failures === 0)
console.log(failures === 0 ? 'custom card density contract passed' : `custom card density: ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
