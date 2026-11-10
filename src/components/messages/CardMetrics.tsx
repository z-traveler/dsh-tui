import React from 'react'
import wrapAnsi from 'wrap-ansi'
import { Box, Text } from '../../ui.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { cleanCardBody } from '../../channel/card-body.js'
import type { TuiCardBlock } from '../../agent/cards.js'

/** A capacity distribution, not a model-specific statistic. No values are inferred. */
export function CardDistribution({ block, columns }: { block: Extract<TuiCardBlock, { kind: 'distribution' }>; columns: number }): React.ReactNode {
  const count = Math.max(1, Math.floor(columns / 2))
  const cells = count * 8
  let value = 0
  const boundaries = block.segments.map(segment => {
    value += segment.value
    return Math.min(cells, Math.max(0, Math.round(value / block.total * cells)))
  })
  return <Box flexDirection="column">
    {Array.from({ length: 8 }, (_, row) => <Text key={row}>
      {Array.from({ length: count }, (_, col) => {
        const index = row * count + col
        const kind = block.segments[boundaries.findIndex(end => index < end)]?.kind
        return <Text key={col} color={kind === 'reserved' ? 'warning' : kind === 'empty' ? 'customMessageHint' : 'customMessageText'}>
          {`${col === 0 ? '' : ' '}${kind === 'filled' ? '⛁' : kind === 'reserved' ? '⛝' : kind === 'empty' ? '⛶' : ' '}`}
        </Text>
      })}
    </Text>)}
  </Box>
}

/** First column left, remaining columns right. Literal cells keep their content,
 * wrapping rather than turning a narrow report into bordered vertical tables. */
export function CardCompactTable({ block, columns }: { block: Extract<TuiCardBlock, { kind: 'table' }>; columns: number }): React.ReactNode {
  const rows = block.rows.map(row => row.map(cleanCardBody))
  const widths = block.columns.map((_, col) => Math.max(1, ...rows.flatMap(row => row[col]!.split('\n').map(stringWidth))))
  const gaps = Math.max(0, widths.length - 1) * 2
  // Keep numeric columns readable; if they cannot fit, the explicit narrow
  // fallback prints one literal row at a time without dropping any cell.
  const valueWidth = widths.slice(1).reduce((sum, width) => sum + width, 0)
  const labelWidth = Math.min(widths[0] ?? 0, Math.max(1, columns - valueWidth - gaps))
  const aligned = valueWidth + gaps < columns
  const lines: string[] = []
  for (const row of rows) {
    if (!aligned) {
      lines.push(...wrapAnsi(row.join('  '), Math.max(1, columns), { hard: true, trim: false }).split('\n'))
      continue
    }
    const cells = row.map((cell, col) => wrapAnsi(cell, col === 0 ? labelWidth : widths[col]!, { hard: true, trim: false }).split('\n'))
    const height = Math.max(1, ...cells.map(cell => cell.length))
    for (let line = 0; line < height; line++) {
      lines.push(cells.map((cell, col) => {
        const text = cell[line] ?? ''
        const padding = ' '.repeat(Math.max(0, (col === 0 ? labelWidth : widths[col]!) - stringWidth(text)))
        return col === 0 ? text + padding : padding + text
      }).join('  '))
    }
  }
  return <Text color="customMessageText">{lines.join('\n')}</Text>
}
