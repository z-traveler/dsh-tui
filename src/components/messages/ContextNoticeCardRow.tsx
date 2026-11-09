import React from 'react'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { cleanCardBody, cleanRenderText } from '../../channel/sanitize.js'
import { primaryComboString } from '../../utils/keymap.js'
import type { ClickEvent } from '../../ink/events/click-event.js'

/** The collapsed summary follows the command card's render budget. */
const CONTEXT_NOTICE_SUMMARY_CELLS = 240

/**
 * One generic context notice in the transcript — a durable message whose
 * producer declared `source.form: 'notice'`, whatever its kind.
 *
 * Collapsed (the default) it is ONE line: a neutral `[notice]` tag and the
 * producer's summary. It deliberately reads no severity from the tag, the
 * summary or the body: a `notice` is a one-off account, not an error class.
 * The shared expansion — Ctrl+O globally, or a click / selection Enter on
 * this row (`expandedRows`) — reveals the complete saved body. That body is
 * the durable message content; the card never asks the producer again and
 * never re-derives it from the summary.
 */
export function ContextNoticeCardRow({
  source,
  summary,
  body,
  expanded,
  background,
  onClick,
}: {
  /** Producer identity, shown as provenance without inferring severity. */
  source: string
  /** The producer's one-line account (untrusted render-path text). */
  summary: string
  /** The complete saved message body (the exact text the model received). */
  body: string
  /** Global Ctrl+O or this row's own expansion. */
  expanded: boolean
  background: 'messageActionsBackground' | undefined
  /** Row click (the shared per-row expansion): a click event, like every row. */
  onClick?: ((event: ClickEvent) => void) | undefined
}): React.ReactNode {
  const headline = React.useMemo(() => cleanRenderText(summary, CONTEXT_NOTICE_SUMMARY_CELLS), [summary])
  // Sanitized once per saved body (ANSI/control strip, no caps): the folded
  // summary is never a cut of the raw string and the expanded body keeps
  // every line, CJK/emoji included.
  const content = React.useMemo(() => cleanCardBody(body), [body])
  return (
    <Box flexDirection="column" paddingLeft={2} backgroundColor={background} onClick={onClick}>
      {/* One Text owns the line so a narrow terminal WRAPS it instead of
          clipping the summary away. */}
      <Text>
        <Text color="suggestion">{`[${t('context-notice-label')}]`}</Text>
        {source !== '' ? <Text dimColor>{` ${cleanRenderText(source, 60)} ·`}</Text> : null}
        {` ${headline}`}
        {expanded || content === ''
          ? null
          : <Text dimColor>{` ${t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}`}</Text>}
      </Text>
      {expanded ? <Text dimColor>{content}</Text> : null}
    </Box>
  )
}
