import React from 'react'
import { Box, Text } from '../../ui.js'
import { POINTER } from '../../terminal-utils/figures.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { wrapWidth } from '../../sessions/format.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import { CardContent, cardMarginTop, useCardSurface } from '../cardSurface.js'

type Props = {
  text: string
  /** Adds the top margin between turns. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
  onClick?(event: ClickEvent): void
}

/**
 * User prompt bubble: `❯ text` keeps the theme's userPromptLabel tint.
 * Legacy remains bold and unfilled; pi-like uses regular weight and a visible,
 * subdued card face. User foreground/weight overrides come from card styles.
 */
export function UserPromptMessage({
  text,
  marginTopOnTurn,
  isSelected = false,
  onClick,
}: Props): React.ReactNode {
  const card = useCardSurface('user')
  // The card's own border/padding is chrome: the terminal width it reports is
  // already deducted, so this pre-wrap math only budgets the pointer prefix.
  const columns = card.columns
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
    <Box
      flexDirection="column"
      marginTop={cardMarginTop(marginTopOnTurn, card.style)}
      backgroundColor={isSelected ? 'messageActionsBackground' : card.box.backgroundColor}
      borderStyle={card.box.borderStyle}
      borderColor={card.box.borderColor}
      paddingX={card.box.paddingX}
      paddingY={card.box.paddingY}
      paddingRight={1}
      onClick={onClick}
    >
      <CardContent surface={card}>
        {lines.map((line, index) => (
          <Text key={index} color={card.foregroundColor ?? 'userPromptLabel'} bold={card.style.bold} wrap="truncate-end">
            {index === 0 ? `${POINTER} ` : continuationIndent}
            {line}
          </Text>
        ))}
      </CardContent>
    </Box>
  )
}
