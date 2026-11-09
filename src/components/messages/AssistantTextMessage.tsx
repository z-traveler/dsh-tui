import React from 'react'
import { Box, NoSelect, Text } from '../../ui.js'
import { BLACK_CIRCLE } from '../../terminal-utils/figures.js'
import { Markdown } from '../Markdown.js'
import { CardContent, cardMarginTop, useCardSurface } from '../cardSurface.js'

type Props = {
  text: string
  /** Adds the top margin between messages. */
  marginTopOnTurn: boolean
  /** Message-selection mode highlight. */
  isSelected?: boolean
  /** Row expanded on its own (persistent hover-grey background). */
  isExpanded?: boolean
}

/**
 * Assistant text message: bullet + markdown body.
 *
 * Deliberately not clickable: the transcript is reading material and the
 * mouse's job there is text selection (user feedback — row hover tints and
 * fold toggling were noise, not affordance).
 */
export function AssistantTextMessage({
  text,
  marginTopOnTurn,
  isSelected = false,
  isExpanded = false,
}: Props): React.ReactNode {
  const card = useCardSurface('assistant')
  return (
    <Box
      alignItems="flex-start"
      flexDirection="row"
      justifyContent="space-between"
      marginTop={cardMarginTop(marginTopOnTurn, card.style)}
      width="100%"
      backgroundColor={
        isSelected
          ? 'messageActionsBackground'
          : isExpanded
            ? 'userMessageBackgroundHover'
            : card.box.backgroundColor
      }
      borderStyle={card.box.borderStyle}
      borderColor={card.box.borderColor}
      paddingX={card.box.paddingX}
      paddingY={card.box.paddingY}
    >
      <CardContent surface={card}>
        <Box flexDirection="row">
          <NoSelect fromLeftEdge minWidth={2}>
            <Text color={isSelected ? 'suggestion' : 'text'}>{BLACK_CIRCLE}</Text>
          </NoSelect>
          <Box flexDirection="column">
            <Markdown>{text}</Markdown>
          </Box>
        </Box>
      </CardContent>
    </Box>
  )
}
