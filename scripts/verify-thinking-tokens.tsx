/**
 * Count-only thinking rows (docs/agent-backend-design.md §4.5 state (b)): a
 * backend that streams an estimated thinking-token count but no thinking text
 * (Claude `thinking_tokens`) must show ONE header line — `Thinking · ~N
 * tokens` with the live spinner while streaming, `Thought · ~N tokens` with
 * the settled anchor afterwards — and never the empty three-row preview
 * ticker. Text, when it arrives, wins over the count. Both languages.
 *
 * The rows come from the real shared projector (`assistant.delta
 * {kind:'reasoning-tokens'}` → `ChatRow.reasoningTokens`), then render
 * through `AssistantThinkingMessage` in a headless xterm.
 *
 * Run: node --import tsx/esm scripts/verify-thinking-tokens.tsx
 */
import { settled } from './lib/term-test.mjs'

process.env.FORCE_COLOR = '3'

const [{ Writable }, React, { Terminal: XTerm }, { render, Box, Text }, { AssistantThinkingMessage }, { setLang, t }, { createProjectorHarness }] =
  await Promise.all([
    import('node:stream'),
    import('react'),
    import('@xterm/headless'),
    import('../src/ui.js'),
    import('../src/components/messages/AssistantThinkingMessage.js'),
    import('../src/i18n.js'),
    import('./lib/projector-harness.js'),
  ])

const { formatTokens } = await import('../src/terminal-utils/format.js')

const COLS = 48
const ROWS = 10
let passed = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) throw new Error(`${label}${detail ? `\n${detail}` : ''}`)
  passed += 1
  console.log(`PASS ${label}`)
}

type Props = Parameters<typeof AssistantThinkingMessage>[0]
type RowProps = Omit<Props, 'marginTopOnTurn' | 'verbose'> & { verbose?: boolean }
async function renderRow(props: RowProps, updates: readonly RowProps[] = []): Promise<string[]> {
  const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable {
    columns = COLS
    rows = ROWS
    isTTY = true
    _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void): void {
      term.write(String(chunk), callback)
    }
  }
  const tree = (row: RowProps) => (
    <Box flexDirection="column" width={COLS}>
      <AssistantThinkingMessage marginTopOnTurn={false} verbose={false} {...row} />
      <Box height={1}><Text>row-sentinel</Text></Box>
    </Box>
  )
  const app = await render(tree(props),
    { stdout: new FakeStdout() as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  )
  let renderError: unknown
  const exit = app.waitUntilExit().catch(error => { renderError = error })
  const lines = () => Array.from({ length: ROWS }, (_, y) => term.buffer.active.getLine(y)?.translateToString(true) ?? '')
  try {
    for (const [index, row] of [props, ...updates].entries()) {
      if (index > 0) app.rerender(tree(row))
      const expected = row.thinking
        ? row.verbose ? row.thinking : t('thinking-label')
        : row.reasoningTokens === undefined ? 'row-sentinel'
          : t(row.streaming ? 'thinking-tokens-live' : 'thinking-tokens-done', { n: formatTokens(row.reasoningTokens) })
      const visible = await settled(() => renderError !== undefined || (
        !row.thinking && row.reasoningTokens === undefined
          ? lines()[0]!.includes('row-sentinel')
          : lines().some(line => line.includes(expected))
      ))
      if (renderError !== undefined) throw renderError
      if (!visible) throw new Error(`thinking stage ${index} missing ${expected}\n${lines().join('\n')}`)
    }
    return lines()
  } finally {
    await app.unmount()
    await exit
    term.dispose()
  }
}

// The projector produces the row the transcript renders.
const harness = createProjectorHarness()
harness.apply([
  { type: 'turn.start', turn: 1, origin: 'user', time: 1 },
  { type: 'step.start', turn: 1, step: 1 },
  { type: 'assistant.attempt.start', attemptId: 'msg_1', turn: 1, step: 1 },
  { type: 'assistant.delta', attemptId: 'msg_1', index: 0, time: 2, delta: { kind: 'reasoning-tokens', estimated: 1234 } },
])
const live = harness.state.rows.find(row => row.kind === 'reasoning')
check('projector: reasoning-tokens opens a streaming count-only row', live?.text === '' && live.reasoningTokens === 1234 && live.streaming === true)
harness.apply([
  { type: 'assistant.message', seq: 1, anchor: 'u1', turn: 1, step: 1, attemptId: 'msg_1', time: 3, canonical: true, blocks: [{ type: 'reasoning', text: '' }, { type: 'text', text: 'done' }] },
  { type: 'turn.end', turn: 1, reason: { kind: 'completed' }, time: 4 },
])
const settledRow = harness.state.rows.find(row => row.kind === 'reasoning')
check('projector: the settled count-only row survives the empty canonical block', settledRow?.reasoningTokens === 1234 && settledRow.streaming !== true)

for (const lang of ['en', 'zh'] as const) {
  setLang(lang)
  const liveText = t('thinking-tokens-live', { n: '1.2k' })
  const doneText = t('thinking-tokens-done', { n: '1.2k' })

  const streaming = await renderRow({ thinking: '', reasoningTokens: 1234, streaming: true, preview: true })
  const header = streaming.findIndex(line => line.includes(liveText))
  const sentinel = streaming.findIndex(line => line.includes('row-sentinel'))
  check(`${lang}: streaming count-only row shows the live count`, header >= 0, streaming.join('\n'))
  check(`${lang}: streaming count-only row is one line (no empty ticker)`, sentinel - header === 1, streaming.join('\n'))

  const done = await renderRow({ thinking: '', reasoningTokens: 1234, streaming: false })
  const doneHeader = done.findIndex(line => line.includes(doneText))
  check(`${lang}: settled count-only row shows the summary`, doneHeader >= 0 && done.findIndex(line => line.includes('row-sentinel')) - doneHeader === 1, done.join('\n'))
  check(`${lang}: settled summary has no expand hint`, !done[doneHeader]!.includes('ctrl'), done[doneHeader])

  const withText = await renderRow({ thinking: 'actual reasoning text', reasoningTokens: 1234, streaming: false, verbose: true })
  check(`${lang}: text wins over the count`, withText.some(line => line.includes('actual reasoning text')) && !withText.some(line => line.includes(doneText)), withText.join('\n'))

  // Keep the SAME mounted component: isolated mounts miss hook-order crashes
  // when a model first emits empty reasoning, then streams actual text.
  for (const reasoningTokens of [undefined, 1234]) {
    const transitioned = await renderRow(
      { thinking: '', reasoningTokens, streaming: true },
      [
        { thinking: 'first reasoning', streaming: true, verbose: true },
        { thinking: '', reasoningTokens, streaming: true },
        { thinking: 'final reasoning', streaming: false, verbose: true },
      ],
    )
    check(`${lang}: empty (${reasoningTokens ?? 'no count'}) ↔ text preserves mounted hooks`, transitioned.some(line => line.includes('final reasoning')))
  }

  const none = await renderRow({ thinking: '', streaming: false })
  check(`${lang}: no text and no count renders nothing`, none.findIndex(line => line.includes('row-sentinel')) === 0, none.join('\n'))
}

console.log(`\nverify-thinking-tokens OK (${passed} checks)`)
process.exit(0)
