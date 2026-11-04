import React from 'react'
import { Box } from '../ui.js'
import { PowerlineText as Text } from './Text.js'
import { stringWidth } from '../ink/stringWidth.js'
import { PowerlineSurface } from './surface.js'
import type { PromptFrameProps } from '../components/PromptChrome.js'

/** Presentation-only shell around the existing editor value and its event
 * handlers. Side rails share the editor's measured visual row count. */
export function PowerlineInputBorder({ columns, rows, topRightLabel: label, children }: PromptFrameProps): React.ReactNode {
  const surface = React.useContext(PowerlineSurface)
  if (surface === null) return children
  const count = Math.max(1, rows)
  const color = surface.options.colors.border
  const header = surface.header !== null
    ? surface.header(label)
    : <Box flexDirection="row"><Text color={color}>{`╭${'─'.repeat(Math.max(0, columns - 2 - (label ? stringWidth(label.text) + 2 : 0)))}`}</Text>
      {label !== undefined && <><Text> </Text><Text color={label.ink} backgroundColor={label.color}>{label.text}</Text><Text> </Text></>}
      <Text color={color}>╮</Text></Box>
  return <Box flexDirection="column" width="100%" flexShrink={0}>
    {header}
    <Box position="relative" width={columns} height={count} flexShrink={0}>
      <Box position="absolute" left={0} top={0} flexDirection="column">
        {Array.from({ length: count }, (_, index) => <Text key={index} color={color}>{index === count - 1 ? '╰─' : '│'}</Text>)}
      </Box>
      <Box paddingLeft={3} paddingRight={3} width="100%">{children}</Box>
      <Box position="absolute" right={0} top={0} flexDirection="column">
        {Array.from({ length: count }, (_, index) => <Text key={index} color={color}>{index === count - 1 ? '─╯' : ' │'}</Text>)}
      </Box>
    </Box>
  </Box>
}
