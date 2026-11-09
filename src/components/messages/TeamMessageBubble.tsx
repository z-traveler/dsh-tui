import React from 'react'
import { Box, Text } from '../../ui.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { t } from '../../i18n.js'
import { CardContent, cardMarginTop, useCardSurface } from '../cardSurface.js'

type Props = {
  /** The sending team member's name. */
  sender: string
  text: string
  /** Adds the top margin between turns. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
}

const MARK = '✉ '

/**
 * An Agent Teams peer message delivered to this session: a `✉ <sender>` line
 * in the agent tint, then the body in plain text with a hanging indent — it
 * reads apart from the human's bold `❯` prompt it shares a log role with.
 * The body wraps in its own flex column, so it fits whatever column hosts it
 * (the main list, a child scene's padded page, a split with the workbench).
 */
export function TeamMessageBubble({ sender, text, marginTopOnTurn, isSelected = false }: Props): React.ReactNode {
  const card = useCardSurface('user')
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
    >
      <CardContent surface={card}>
        <Text color="toolDotTask" wrap="truncate-end">
          {MARK}<Text bold>{sender}</Text><Text dimColor>{` · ${t('team-message-label')}`}</Text>
        </Text>
        <Box flexDirection="row">
          <Box width={stringWidth(MARK)} flexShrink={0} />
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">{text}</Text>
          </Box>
        </Box>
      </CardContent>
    </Box>
  )
}
