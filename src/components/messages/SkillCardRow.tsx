import React from 'react'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { cleanCardBody, cleanRenderText } from '../../channel/sanitize.js'
import { primaryComboString } from '../../utils/keymap.js'
import type { ClickEvent } from '../../ink/events/click-event.js'

const SKILL_NAME_CELLS = 80

/**
 * One user-explicit skill load in the transcript — a `#skill:name` mention or
 * the shipped `/name` gesture (the same durable fact).
 *
 * Collapsed (the default) it is ONE line: the localized `[skill]` tag, the
 * skill's name and what the record proves — that its instructions were loaded.
 * The shared expansion — Ctrl+O globally, or a click / selection Enter on this
 * row (`expandedRows`) — reveals the canonical body the model was handed,
 * exactly as it was saved: the card never re-reads the skill file and never
 * parses the wrapper for the name. It is instructions, not a claim that the
 * work succeeded, and it is never a human bubble.
 */
export function SkillCardRow({
  name,
  body,
  expanded,
  background,
  onClick,
}: {
  /** Skill name as the user's gesture spelled it. */
  name: string
  /** The saved canonical body (the exact text the model received). */
  body: string
  /** Global Ctrl+O or this row's own expansion. */
  expanded: boolean
  background: 'messageActionsBackground' | undefined
  /** Row click (the shared per-row expansion): a click event, like every row. */
  onClick?: ((event: ClickEvent) => void) | undefined
}): React.ReactNode {
  const headline = React.useMemo(() => cleanRenderText(name, SKILL_NAME_CELLS), [name])
  const instructions = React.useMemo(() => cleanCardBody(body), [body])
  return (
    <Box flexDirection="column" paddingLeft={2} backgroundColor={background} onClick={onClick}>
      {/* One Text owns the line so a narrow terminal WRAPS it instead of
          clipping the name away. */}
      <Text>
        <Text color="suggestion">{`[${t('skill-card-label')}]`}</Text>
        {` ${headline}`}
        <Text dimColor>{` · ${t('skill-card-loaded')}`}</Text>
        {expanded ? null : <Text dimColor>{` ${t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}`}</Text>}
      </Text>
      {expanded ? <Text dimColor>{instructions}</Text> : null}
    </Box>
  )
}
