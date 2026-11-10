import React from 'react'
import type { Tokens } from 'marked'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { cleanRenderText } from '../../channel/sanitize.js'
import { cleanCardBody } from '../../channel/card-body.js'
import { primaryComboString } from '../../utils/keymap.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { truncateToWidth } from '../../ink/truncateToWidth.js'
import type { ToolBackground } from '../../tuiDisplayPrefs.js'
import type { TuiCardBlock, TuiCardDensity, TuiCardView } from '../../agent/cards.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import { Markdown } from '../Markdown.js'
import { MarkdownTable } from '../MarkdownTable.js'
import { CardCompactTable, CardDistribution } from './CardMetrics.js'
import { CardContent, cardMarginTop, useCardSurface, type CardSurface } from '../cardSurface.js'

/** Legacy header budgets (cells); compact reading headers soft-wrap full paths. */
const CARD_TITLE_CELLS = 120
const CARD_SUMMARY_CELLS = 240
/** Full reading content soft-wraps; only legacy headers are bounded previews. */
const COMPACT_HEADER_CELLS = Number.POSITIVE_INFINITY
const CARD_TAG_CELLS = 60
/** The folded preview keeps its row's own sanitizer budget. */
const CARD_PREVIEW_CELLS = 240

/**
 * The shell every shared card row draws: the transcript indent plus the
 * configured card face (`cardStyles` kind `custom`: background, border, padding
 * and gap — legacy resolves all of them to the pre-card appearance). The
 * content is wrapped in `CardContent`, so a bordered/padded face narrows the
 * width its Markdown and tables lay out in instead of overflowing it.
 * A selected row's background still wins over the configured face, and a card
 * that declares `density: 'compact'` arrives here with that face already
 * resolved to nothing — this shell needs no density branch of its own.
 */
function CardShell({
  background,
  marginTopOnTurn,
  surface: card,
  onClick,
  children,
}: {
  surface: CardSurface
  background: 'messageActionsBackground' | undefined
  marginTopOnTurn: boolean
  onClick?: ((event: ClickEvent) => void) | undefined
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box
      flexDirection="column"
      marginTop={cardMarginTop(marginTopOnTurn, card.style)}
      paddingLeft={(card.preset === 'pi-like' ? 0 : 2) + card.box.paddingX}
      paddingRight={card.box.paddingX}
      paddingY={card.box.paddingY}
      backgroundColor={background ?? card.box.backgroundColor}
      borderStyle={card.box.borderStyle}
      borderColor={card.box.borderColor}
      onClick={onClick}
    >
      <CardContent surface={card}>{children}</CardContent>
    </Box>
  )
}

/**
 * One Custom Card in the transcript — a producer's own card record, drawn by
 * the host: the producer supplies title/summary/content blocks (and, when it
 * wants the lowest reading face, `density: 'compact'`) and nothing else. No
 * React, no buttons, no keys, no terminal control.
 *
 * Collapsed (the default) it is an inline header: the business tag, the title
 * and the optional summary. Compact headers soft-wrap complete reading text. The shared expansion — `Ctrl+O` globally, a click
 * on the row, or selection-Enter (`expandedRows`) — reveals the body blocks:
 * literal text, Markdown through the transcript's own renderer, and tables
 * whose cells are LITERAL content (a cell's `|`, newline or markup is text,
 * never Markdown structure). `\n` inside a cell keeps its content and reads as
 * a vertical block at narrow widths.
 *
 * Expansion is display-only: it never re-runs a producer, never fetches a URL
 * and never reaches the model.
 */
export function CustomCardRow({
  view,
  type,
  expanded,
  background,
  marginTopOnTurn,
  toolBackground,
  onClick,
}: {
  /** The presented snapshot (immutable: one committed record). */
  view: TuiCardView
  /** Business type, shown as the tag when the view carries no label. */
  type: string
  /** Global Ctrl+O or this row's own expansion. */
  expanded: boolean
  background: 'messageActionsBackground' | undefined
  marginTopOnTurn: boolean
  /** Card face preference (same value the other transcript cards read). */
  toolBackground: ToolBackground
  /** Row click (the shared per-row expansion): a click event, like every row. */
  onClick?: ((event: ClickEvent) => void) | undefined
}): React.ReactNode {
  const card = useCardSurface('custom', { toolBackground, density: view.density })
  const piLike = card.preset === 'pi-like'
  const tag = React.useMemo(
    () => cleanRenderText(view.label ?? type, CARD_TAG_CELLS),
    [view.label, type],
  )
  const title = React.useMemo(
    () => cleanRenderText(view.title, view.density === 'compact' ? COMPACT_HEADER_CELLS : CARD_TITLE_CELLS),
    [view.title, view.density],
  )
  const summary = React.useMemo(
    () => (view.summary === undefined ? '' : cleanRenderText(view.summary, view.density === 'compact' ? COMPACT_HEADER_CELLS : CARD_SUMMARY_CELLS)),
    [view.summary, view.density],
  )
  const hasBody = view.blocks.length > 0
  // Normalized pure-data snapshots have canonical field order. Compare once per
  // snapshot, not on each input render, and do not advertise a no-op expansion.
  const previewHasMore = React.useMemo(() => view.preview !== undefined
    && JSON.stringify(view.preview) !== JSON.stringify(view.blocks), [view])
  const reading = expanded ? view.blocks : view.preview ?? []
  // CardSurface removes themed padding/borders; legacy also has a transcript gutter.
  const columns = Math.max(1, card.columns - (piLike ? 0 : 2))
  const hasHeader = title !== '' || tag !== ''
  const labelColumns = Math.min(Math.max(0, columns - 1), Math.max(0, ...reading.map(block => block.kind === 'text' && block.label !== undefined ? stringWidth(`[${cleanRenderText(block.label, CARD_TAG_CELLS)}] `) : 0)))
  const body = reading.map((block, index) => <CardBlockView key={index} block={block} piLike={piLike} columns={columns} labelColumns={labelColumns} />)
  const expandHint = t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })
  const hintFits = view.density !== 'compact'
    || stringWidth(`[${tag}] ${title}${summary === '' ? '' : ` · ${summary}`} ${expandHint}`) <= columns
  return (
    <CardShell background={background} marginTopOnTurn={marginTopOnTurn} surface={card} onClick={onClick}>
      {!hasHeader ? null : piLike && (expanded || view.preview !== undefined) ? <>
        <Text color="customMessageLabel" bold>{`[${tag}]`}</Text>
        <Text color="customMessageText">{title}</Text>
        {summary === '' ? null : <Text color="customMessageText">{summary}</Text>}
      </> : <Text>
        <Text color={piLike ? 'customMessageLabel' : 'suggestion'} bold={piLike}>{`[${tag}]`}</Text>
        <Text color={piLike ? 'customMessageText' : undefined}>{` ${title}`}</Text>
        {summary === '' ? null : <Text dimColor>{` · ${summary}`}</Text>}
        {expanded || !hasBody || view.preview !== undefined || !hintFits
          ? null
          : <Text dimColor={!piLike} color={piLike ? 'customMessageHint' : undefined}>{` ${expandHint}`}</Text>}
      </Text>}
      {reading.length > 0
        ? piLike || view.preview !== undefined
          ? <Box flexDirection="column" gap={view.density === 'compact' || view.preview === undefined ? 0 : 1} marginTop={piLike && hasHeader ? 1 : 0}>{body}</Box>
          : body
        : null}
      {hasHeader && !expanded && previewHasMore && hasBody
        ? <Text color="customMessageHint">{t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })}</Text>
        : null}
    </CardShell>
  )
}

/**
 * The same card shell for a row whose presentation the window folded: the log
 * restores the view on demand, so until then the row reads as its bounded
 * preview inside the card's own face (instead of losing the card's shape or
 * switching to a heavier one while it waits).
 */
export function FoldedCardRow({
  preview,
  density,
  background,
  marginTopOnTurn,
  toolBackground,
  onClick,
}: {
  /** The row's bounded plain-text preview. */
  preview: string
  /** The density its last snapshot declared; the fold keeps it for this row. */
  density?: TuiCardDensity | undefined
  background: 'messageActionsBackground' | undefined
  marginTopOnTurn: boolean
  toolBackground: ToolBackground
  onClick?: ((event: ClickEvent) => void) | undefined
}): React.ReactNode {
  const card = useCardSurface('custom', { toolBackground, density })
  const text = React.useMemo(() => cleanRenderText(preview, CARD_PREVIEW_CELLS), [preview])
  return (
    <CardShell background={background} marginTopOnTurn={marginTopOnTurn} surface={card} onClick={onClick}>
      <Text dimColor={card.preset !== 'pi-like'} color={card.preset === 'pi-like' ? 'customMessageText' : undefined}>{text}</Text>
    </CardShell>
  )
}

/** One body block: literal text, transcript Markdown, or a literal-cell table. */
function CardBlockView({ block, piLike, columns, labelColumns }: { block: TuiCardBlock; piLike: boolean; columns: number; labelColumns: number }): React.ReactNode {
  switch (block.kind) {
    case 'text': {
      if (block.label !== undefined || block.truncate === 'end') {
        const room = Math.max(1, columns - (block.label === undefined ? 0 : labelColumns))
        const full = block.truncate === 'end' ? cleanRenderText(block.text, Infinity) : cleanCardBody(block.text)
        const text = block.truncate === 'end' && stringWidth(full) > room
          ? `${truncateToWidth(full, Math.max(0, room - 3))}${'.'.repeat(Math.min(3, room))}` : full
        return <Box flexDirection="row">
          {block.label === undefined ? null : <Box width={labelColumns} flexShrink={0}><Text wrap="truncate-end" color={piLike ? 'customMessageLabel' : 'suggestion'}>{`[${cleanRenderText(block.label, CARD_TAG_CELLS)}]`}</Text></Box>}
          <Box flexDirection="column" width={room}><Text color={piLike ? 'customMessageText' : undefined}>{text}</Text></Box>
        </Box>
      }
      return <Text dimColor={!piLike} color={piLike ? 'customMessageText' : undefined}>{cleanCardBody(block.text)}</Text>
    }
    case 'markdown':
      // Recorded content is a fact, not chat prose: prompt tags are part of it,
      // inline math stays source text (an image would not be the record), and a
      // raw HTML wrapper (an instruction wrapper, say) renders as its literal
      // source so it cannot hide the text it encloses. HTML is painted as text.
      return (
        <Markdown dimColor={!piLike} color={piLike ? 'customMessageText' : undefined} stripPromptTags={false} inlineMathImages={false} preserveHtml>
          {cleanCardBody(block.text)}
        </Markdown>
      )
    case 'table':
      return block.layout === 'compact' ? <CardCompactTable block={block} columns={columns} /> : <MarkdownTable token={literalTableToken(block)} highlight={null} />
    case 'distribution':
      return <CardDistribution block={block} columns={columns} />
  }
}

/**
 * A table block as the renderer's token form, with every cell one literal text
 * token: joining raw cells into Markdown and re-lexing would turn a cell's `|`
 * into a column boundary and its newlines into row boundaries — corrupting the
 * producer's data. The formatter gets the literal string; only layout (width
 * allocation, narrow-width vertical fallback) is the renderer's business.
 */
function literalTableToken(block: Extract<TuiCardBlock, { kind: 'table' }>): Tokens.Table {
  const cell = (text: string, header: boolean): Tokens.TableCell => {
    const literal = cleanCardBody(text)
    return { text: literal, header, align: null, tokens: [{ type: 'text', raw: literal, text: literal }] }
  }
  return {
    type: 'table',
    raw: '',
    header: block.columns.map(column => cell(column, true)),
    align: block.columns.map(() => null),
    rows: block.rows.map(row => row.map(value => cell(value, false))),
  }
}
