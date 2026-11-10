import React from 'react'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { cleanRenderText } from '../../channel/sanitize.js'
import { cleanCardBody } from '../../channel/card-body.js'
import { preview, RESULT_PREVIEW_LIMIT } from '../../channel/transcript.js'
import { primaryComboString } from '../../utils/keymap.js'
import type { ClickEvent } from '../../ink/events/click-event.js'

/** Header budgets for the command line's own parts (mirrors the tool cards). */
const COMMAND_NAME_CELLS = 80
const COMMAND_ARGS_CELLS = 160

/**
 * One settled command result in the transcript (a backend's command lifecycle
 * record — never a tool call, and never a model turn).
 *
 * Collapsed (the default) it is the command line plus one summary row: the
 * body's first non-empty line, clipped. `Ctrl+O` (global) or a click /
 * selection-Enter on the row (the shared per-row expansion) paints the recorded
 * body in full — there is no 200-line / 65536-code-unit / 4000-cell cut here,
 * and the expanded card scrolls with the transcript to its last line. The card
 * is display-only: expanding never executes the command, never reads a file and
 * never reaches the model.
 */
export function CommandCardRow({
  name,
  args,
  status,
  text,
  expanded,
  background,
  onClick,
}: {
  /** Command name without the leading slash. */
  name: string
  /** The invocation's own input after the name. */
  args?: string | undefined
  /** Whether the command settled as `success` or as `error`. */
  status: 'success' | 'error'
  /** The command's complete result text ('' when it reported none). */
  text: string
  /** Global Ctrl+O or this row's own expansion. */
  expanded: boolean
  background: 'messageActionsBackground' | undefined
  /** Row click (the shared per-row expansion): a click event, like every row. */
  onClick?: ((event: ClickEvent) => void) | undefined
}): React.ReactNode {
  const headline = React.useMemo(() => cleanRenderText(name, COMMAND_NAME_CELLS), [name])
  const argText = React.useMemo(
    () => (args === undefined ? '' : cleanRenderText(args.trim(), COMMAND_ARGS_CELLS)),
    [args],
  )
  // The body is sanitized ONCE per recorded text (ANSI/control strip, no caps)
  // and both views read that one value: the collapsed summary must never be a
  // cut of the raw string (it could slice an escape sequence in half).
  const body = React.useMemo(() => cleanCardBody(text), [text])
  const rows = React.useMemo(() => body.split('\n').length, [body])
  const summary = React.useMemo(() => preview(firstContentLine(body), RESULT_PREVIEW_LIMIT), [body])
  const failed = status === 'error'
  return (
    <Box flexDirection="column" paddingLeft={2} backgroundColor={background} onClick={onClick}>
      {/* One Text owns the line so a narrow terminal WRAPS it: a row of separate
          Text children would be clipped at the edge and the input would vanish. */}
      <Text>
        <Text color={failed ? 'error' : 'suggestion'}>{failed ? '✗' : '⏵'}</Text>
        {` /${headline}${argText === '' ? '' : ` ${argText}`}`}
      </Text>
      {expanded ? (
        <Text dimColor>{body}</Text>
      ) : summary === '' ? null : (
        <Text>
          <Text dimColor>{summary}</Text>
          <Text dimColor>{` · ${t('command-card-rows', { n: rows })}`}</Text>
          <Text dimColor>{` ${t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}`}</Text>
        </Text>
      )}
    </Box>
  )
}

/** The body's first line that carries text (reports often open with a blank). */
function firstContentLine(body: string): string {
  for (const line of body.split('\n')) {
    if (line.trim() !== '') return line
  }
  return ''
}
