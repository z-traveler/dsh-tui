import React from 'react'
import { Text } from '../../ui.js'
import { POINTER } from '../../terminal-utils/figures.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { wrapWidth } from '../../sessions/format.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import { CardBox, useCardSurface } from '../cardSurface.js'

type Props = {
  text: string
  /** Adds the top margin between turns. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
  onClick?(event: ClickEvent): void
}

/**
 * User prompt bubble: `❯ text` in bold userPromptLabel tint with no background
 * fill (Kimi Code style: the user turn gets a distinct bold tint — the
 * kernel-rotated brand colour of the active theme — so it reads apart from
 * assistant text; only selection mode paints a highlight). Card styles may
 * restyle its face, colour and weight (`cardSurface.tsx`).
 */
export function UserPromptMessage({
  text,
  marginTopOnTurn,
  isSelected = false,
  onClick,
}: Props): React.ReactNode {
  // Card chrome is already deducted: this budgets only the pointer prefix.
  const card = useCardSurface('user')
  const { columns } = card
  const promptPrefix = `${POINTER} `
  const prefixWidth = stringWidth(promptPrefix)
  // Wrap here instead of letting Ink wrap the whole Text node. Ink starts an
  // automatic continuation at column zero, while a prompt needs a hanging
  // indent for both explicit newlines and width-based visual lines.
  // Leave a small safety margin for the ScrollBox edge/scrollbar. The Text
  // nodes below are explicitly wrapped, so they must never be wrapped again by
  // Ink; a second wrap would move the continuation back to column zero.
  const lines = wrapWidth(text, Math.max(1, columns - prefixWidth - 3))
  const continuationIndent = ' '.repeat(prefixWidth)
  // No hover tooltip here, deliberately: the message is pre-wrapped so every
  // visual line is already on screen — a float would only repeat visible
  // text, and worse, the card REPLACES the cells it covers, so a drag-copy
  // crossing it yields the tooltip fragment instead of the message.

  return (
    <CardBox surface={card}
      flexDirection="column"
      marginTop={marginTopOnTurn ? 1 : 0}
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      paddingRight={1}
      onClick={onClick}
    >
      {lines.map((line, index) => (
        <Text key={index} color={card.foregroundColor ?? 'userPromptLabel'} bold={card.style.bold} wrap="truncate-end">
          {index === 0 ? `${POINTER} ` : continuationIndent}
          {line}
        </Text>
      ))}
    </CardBox>
  )
}
