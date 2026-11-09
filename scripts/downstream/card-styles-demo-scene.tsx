/**
 * 卡片样式体验入口的共享场景（票 04）：无凭据、无网络的对话 fixture，加上
 * 与入口完全相同的组装（`ThemeProvider` → 头部 → `ScrollBox` → `MessageList`）。
 *
 * 入口 `card-styles-demo.tsx` 只负责终端与文件配置，场景本身被它和布局回归
 * `verify-card-demo.tsx` 共同渲染——回归量的就是用户按 Alt+3 看到的那一套，
 * 不另写一份"测试用"的假场景。
 *
 * 滚动区遵循产品 `Chat.tsx` 的接法：根盒给出明确的 `rows` 高度，`ScrollBox`
 * 用 `flexGrow` 吃掉头部剩余的行（头部在窄屏会折行，不能按 `rows - 1` 估算；
 * `flexBasis={0}` 让“剩余”由布局算而不是由内容高度撑开），滚动内容的直接
 * 子节点 `flexShrink={0}`（`ScrollBox` 的包装盒不收缩，子节点默认收缩会把
 * 整棵 transcript 压进 viewport，正文归零），并把真实 `ScrollBoxHandle` 交给
 * `MessageList`（没有句柄时虚拟列表按 24 行 sticky 猜测，上滚只画占位空行）。
 */
import React from 'react'
import { Box, ScrollBox, Text, ThemeProvider, useInput, useTerminalSize, type ScrollBoxHandle } from '../../src/ui.js'
import { MessageList } from '../../src/components/MessageList.js'
import { applyCardStyles, type CardStyleConfig } from '../../src/cardStyles.js'

interface DemoPreset {
  readonly key: string
  readonly label: string
  readonly config: CardStyleConfig | undefined
}

/** 入口与回归共用的四套预设；`fileConfig` 存在时才有 Alt+4。 */
function demoPresets(fileConfig?: CardStyleConfig): readonly DemoPreset[] {
  return [
    { key: '1', label: 'legacy', config: undefined },
    { key: '2', label: 'pi-like', config: { preset: 'pi-like' } },
    {
      key: '3',
      label: 'pi-like + 描边',
      config: {
        preset: 'pi-like',
        common: { border: 'round', borderColor: 'promptBorder' },
      },
    },
    ...(fileConfig === undefined ? [] : [{ key: '4', label: '文件配置', config: fileConfig }]),
  ]
}

const NOW = Date.now()
const row = (value: Record<string, unknown>): Record<string, unknown> => value
const DEMO_ROWS = [
  row({ id: 1, kind: 'user', text: '把卡片样式接进转录：中文换行、emoji 🙂 和很宽的字符都要对齐。' }),
  row({
    id: 2,
    kind: 'assistant',
    text: [
      '**pi-like 方案**：无边框、水平/上下内边距均为 0（与原组件的 `❯`/`⎿` 缩进对齐）；用户/工具/子代理整块底色，普通卡片之间留一行呼吸空间，后台任务组内紧贴。',
      '',
      '| 类型 | 底色 |',
      '| --- | --- |',
      '| tool | 状态色 |',
      '| assistant | 无填充 |',
    ].join('\n'),
  }),
  row({ id: 3, kind: 'reasoning', text: 'thinking ticker line one\nline two\nline three', streaming: true }),
  row({ id: 4, kind: 'assistant', text: '流式助手行：没有卡片背景，靠圆点与正文排版。', streaming: true }),
  row({
    id: 5,
    kind: 'tool',
    text: 'bash',
    tool: {
      callId: 'demo-edit',
      name: 'edit',
      argsText: '{"file_path":"/tmp/demo.ts"}',
      status: 'ok',
      startedAt: NOW - 2400,
      durationMs: 2400,
      callView: { card: 'diff', title: 'Edit /tmp/demo.ts', diffs: [{ path: '/tmp/demo.ts', oldText: 'const a = 1', newText: 'const a = 2' }] },
      resultView: { card: 'diff', title: 'Edit /tmp/demo.ts', diffs: [{ path: '/tmp/demo.ts', oldText: 'const a = 1', newText: 'const a = 2' }] },
      resultFull: 'ok',
    },
  }),
  row({
    id: 51,
    kind: 'tool',
    text: 'bash',
    tool: {
      callId: 'demo-patch',
      name: 'edit',
      argsText: '{"file_path":"/tmp/patch.ts"}',
      status: 'ok',
      startedAt: NOW - 2000,
      durationMs: 1200,
      callView: {
        card: 'diff',
        title: 'Edit /tmp/patch.ts',
        diffs: [{ path: '/tmp/patch.ts', patch: ['@@ -7,3 +7,3 @@', ' const keep = true', '-const a = 1', '+const a = 2'].join('\n') }],
      },
      resultView: {
        card: 'diff',
        title: 'Edit /tmp/patch.ts',
        diffs: [{ path: '/tmp/patch.ts', patch: ['@@ -7,3 +7,3 @@', ' const keep = true', '-const a = 1', '+const a = 2'].join('\n') }],
      },
      resultFull: 'ok',
    },
  }),
  row({
    id: 6,
    kind: 'tool',
    text: 'bash',
    tool: {
      callId: 'demo-run',
      name: 'bash',
      argsText: '{"command":"npm test"}',
      status: 'running',
      startedAt: NOW - 8000,
      callView: { card: 'terminal', title: 'npm test' },
      liveOutput: 'running suite\n42 passed',
      liveOutputDropped: 0,
    },
  }),
  row({
    id: 7,
    kind: 'tool',
    text: 'bash',
    tool: {
      callId: 'demo-fail',
      name: 'bash',
      argsText: '{"command":"false"}',
      status: 'error',
      startedAt: NOW - 5000,
      durationMs: 500,
      errorText: 'exit code 1',
      callView: { card: 'terminal', title: 'false' },
    },
  }),
  row({
    id: 8,
    kind: 'subagent',
    text: '',
    subagent: {
      agentId: 'demo-subagent',
      description: 'Explore repository',
      status: 'completed',
      startedAt: NOW - 40_000,
      completedAt: NOW - 10_000,
      durationMs: 30_000,
      outputLines: ['reading src/index.ts', 'reading src/theme.ts'],
      toolCalls: [],
      tokens: { total: 12_400 },
    },
  }),
  row({
    id: 9,
    kind: 'subagent',
    text: '',
    subagent: {
      agentId: 'demo-cancelled',
      description: 'Cancelled run keeps the plain face',
      status: 'cancelled',
      startedAt: NOW - 40_000,
      completedAt: NOW - 20_000,
      durationMs: 20_000,
      outputLines: [],
      toolCalls: [],
    },
  }),
  ...['completed', 'failed', 'killed'].map((status, index) => row({
    id: 10 + index,
    kind: 'job',
    text: `job ${index}`,
    job: {
      id: `pwsh-${index + 1}`,
      kind: 'pwsh',
      label: `run job ${index + 1}`,
      status,
      startedAt: NOW - 12_000,
      finishedAt: NOW - 4000,
      detail: status === 'completed' ? 'exit code: 0' : undefined,
      outputLines: [{ text: `output line for job ${index + 1}` }],
    },
  })),
  row({ id: 20, kind: 'job', text: 'live job', job: { id: 'pwsh-live', kind: 'pwsh', label: 'run live job', status: 'running', startedAt: NOW - 3000, progress: '3/10', outputLines: [{ text: 'working' }] } }),
  row({ id: 21, kind: 'compact', text: '压缩摘要正文：这一段在折叠态只显示一行预览，Ctrl+O 或点击展开。' }),
  row({ id: 22, kind: 'notice', text: '后台任务已启动' }),
  row({ id: 23, kind: 'local', text: '!echo hello' }),
  row({ id: 24, kind: 'local-output', text: 'hello' }),
  row({ id: 25, kind: 'interrupt', text: '' }),
] as const

export interface CardStylesSceneProps {
  /** 已归一的 `values.cardStyles`；提供时追加「文件配置」预设（Alt+4）。 */
  readonly settingsConfig?: CardStyleConfig
  /** 初始预设索引（0 legacy / 1 pi-like / 2 描边 / 3 文件配置）。 */
  readonly initialPresetIndex?: number
  /** `MessageList` 的 inline/fullscreen 口径（入口的 `--inline`）。 */
  readonly inline?: boolean
  /** 终端主题；体验入口按 `auto`，回归用固定主题避免 OSC 11 探测。 */
  readonly theme?: string
  readonly onExit(): void
  /** 测试接缝：真实滚动句柄，用来按内容坐标验证滚到中段不是空白。 */
  readonly onScrollHandle?(handle: ScrollBoxHandle): void
}

export function CardStylesScene({
  settingsConfig,
  initialPresetIndex,
  inline = false,
  theme = 'auto',
  onExit,
  onScrollHandle,
}: CardStylesSceneProps): React.ReactNode {
  const presets = React.useMemo(() => demoPresets(settingsConfig), [settingsConfig])
  const [presetIndex, setPresetIndex] = React.useState(initialPresetIndex ?? (settingsConfig === undefined ? 1 : 3))
  const [expanded, setExpanded] = React.useState(false)
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<number>>(() => new Set())
  const [scrollHandle, setScrollHandle] = React.useState<ScrollBoxHandle | null>(null)
  const size = useTerminalSize()
  const preset = presets[Math.min(presetIndex, presets.length - 1)]!

  React.useEffect(() => {
    applyCardStyles(preset.config)
  }, [preset])

  React.useEffect(() => {
    if (scrollHandle !== null) onScrollHandle?.(scrollHandle)
  }, [scrollHandle, onScrollHandle])

  const toggleRow = React.useCallback((rowId: number): void => {
    setExpandedRows(previous => {
      const next = new Set(previous)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])

  useInput((input, key, event) => {
    if (key.ctrl && input === 'c') {
      event.stopImmediatePropagation()
      onExit()
      return
    }
    if (key.meta && presets.some(entry => entry.key === input)) {
      event.stopImmediatePropagation()
      setPresetIndex(presets.findIndex(entry => entry.key === input))
      return
    }
    if (key.meta && input === 'o') {
      event.stopImmediatePropagation()
      setExpanded(value => !value)
      return
    }
    const page = Math.max(1, size.rows - 4)
    if (input === 'k' || key.upArrow) scrollHandle?.scrollBy(-1)
    else if (input === 'j' || key.downArrow) scrollHandle?.scrollBy(1)
    else if (key.pageUp) scrollHandle?.scrollBy(-page)
    else if (key.pageDown) scrollHandle?.scrollBy(page)
    else if (input === 'g' && !key.ctrl) scrollHandle?.scrollTo(0)
    else if (input === 'G') scrollHandle?.scrollToBottom()
  }, { prepend: true })

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column" width={size.columns} height={size.rows}>
        <Box paddingX={1}>
          <Text dimColor>
            {`cards: ${preset.label} · Alt+1 legacy / Alt+2 pi-like / Alt+3 描边${settingsConfig === undefined ? '' : ' / Alt+4 文件配置'} · Alt+o 全部展开（${expanded ? 'on' : 'off'}）· ↑↓/jk 滚动 · Ctrl+C 退出`}
          </Text>
        </Box>
        <ScrollBox ref={setScrollHandle} flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} stickyScroll>
          <Box flexDirection="column" flexShrink={0}>
            <MessageList
              rows={DEMO_ROWS}
              expanded={expanded}
              expandedRows={expandedRows}
              selectedId={null}
              onToggleRow={toggleRow}
              model="deepseek-chat"
              showAll
              onToggleAll={() => {}}
              onLoadOlder={() => {}}
              toolBackground={preset.label === 'legacy' ? 'subtle' : 'none'}
              fullscreen={!inline}
              scrollHandle={scrollHandle}
            />
          </Box>
        </ScrollBox>
      </Box>
    </ThemeProvider>
  )
}
