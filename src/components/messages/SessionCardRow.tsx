/**
 * 会话事实卡、上下文提示卡与自定义卡片（下游 session-cards / input-completions /
 * custom-cards）在 transcript 中的行：MessageList 的 TranscriptRow 按行类型分派
 * 到这里，行高签名与 MemoRow 的扁平字段也由本模块提供。
 */
import React from 'react'
import { getLang } from '../../i18n.js'
import { Box } from '../../ui.js'
import type { ClickEvent } from '../../ink/events/click-event.js'
import type { DOMElement } from '../../ink/dom.js'
import type { ChatRow } from '../../adapter/ports/channel-view.js'
import type { TuiCardDensity, TuiCardView } from '../../agent/cards.js'
import type { ToolBackground } from '../../tuiDisplayPrefs.js'
import { skillCardView } from '../../channel/card-views.js'
import { cardRowDensity } from '../../channel/card-row.js'
import { cardMarginTop, type CardSurface } from '../cardSurface.js'
import { CommandCardRow } from './CommandCardRow.js'
import { ContextNoticeCardRow } from './ContextNoticeCardRow.js'
import { CustomCardRow, FoldedCardRow } from './CustomCardRow.js'

export type SessionCardKind = 'command' | 'skill' | 'card' | 'context-notice'

export function isSessionCardKind(kind: ChatRow['kind']): kind is SessionCardKind {
  return kind === 'command' || kind === 'skill' || kind === 'card' || kind === 'context-notice'
}

/**
 * MemoRow 的卡片行字段，与其余行字段一样逐项扁平传入：channel 原地改写行
 * 对象，只有扁平字段能让 memo 看到更新。
 */
export type SessionCardFields = {
  /** Command rows: the settled command's identity as the card headlines it. */
  commandName: string | undefined
  commandArgs: string | undefined
  commandStatus: 'success' | 'error' | undefined
  /** Skill rows: the loaded skill's name. */
  skillName: string | undefined
  /** Context-notice rows: durable producer identity, not a renderer selector. */
  contextSource: string | undefined
  /** Context-notice rows: the durable summary shown while folded. */
  contextSummary: string | undefined
  /** Custom Card rows (and a command row the shared host presents): the
   *  business type and the committed snapshot's presentation. The view object
   *  is replaced on update, never mutated, so its reference is the memo input. */
  cardType: string | undefined
  cardView: TuiCardView | undefined
  /** The row's presentation density (kept while `cardView` is folded away). */
  cardDensity: TuiCardDensity | undefined
}

export function sessionCardFields(row: ChatRow): SessionCardFields {
  return {
    commandName: row.kind === 'command' ? row.command?.name : undefined,
    commandArgs: row.kind === 'command' ? row.command?.args : undefined,
    commandStatus: row.kind === 'command' ? row.command?.status : undefined,
    skillName: row.kind === 'skill' ? row.skill?.name : undefined,
    contextSource: row.kind === 'context-notice' ? row.contextNotice?.source : undefined,
    contextSummary: row.kind === 'context-notice' ? row.contextNotice?.summary : undefined,
    cardType: row.card?.type,
    cardView: row.card?.view,
    cardDensity: cardRowDensity(row.card),
  }
}

/** 卡片行的行高输入，接在 MessageList `signatureParts` 的通用输入之后。 */
export function pushSessionCardSignature(
  scratch: Array<string | number | boolean>,
  row: ChatRow,
  expanded: boolean,
  rowExpanded: boolean,
): void {
  switch (row.kind) {
    case 'command':
      // Collapsed headline+summary vs the recorded body painted whole: both
      // expansion switches, the command line's own text and (only while
      // expanded) the body length decide the height. `displayTextLen` above is
      // the body length, which a window fold lowers to the preview. A command
      // a registered presenter owns adds the card snapshot's own height inputs.
      scratch.push(
        expanded,
        rowExpanded,
        row.command?.name ?? '',
        row.command?.args ?? '',
        row.command?.status ?? '',
        row.card?.latestSeq ?? -1,
      )
      break
    case 'skill':
      // One collapsed line vs the revealed saved body.
      scratch.push(expanded, rowExpanded, row.skill?.name ?? '')
      break
    case 'card':
      // The card's title/summary/blocks decide the collapsed line and the
      // expanded body; `latestSeq` is what changes them in place — an update
      // of the SAME length must still invalidate the cached height.
      scratch.push(
        expanded,
        rowExpanded,
        row.card?.type ?? '',
        row.card?.latestSeq ?? -1,
        row.card?.view?.title ?? '',
        row.card?.view?.summary ?? '',
        row.card?.view?.blocks.length ?? 0,
      )
      break
    case 'context-notice':
      // Collapsed summary vs the revealed saved body; the summary and both
      // expansion switches are height inputs (preset layout joins cardHeightKey).
      scratch.push(expanded, rowExpanded, row.contextNotice?.source ?? '', row.contextNotice?.summary ?? '')
      break
  }
}

export function SessionCardRow({
  kind,
  text,
  expanded,
  background,
  marginTopOnTurn,
  toolBackground,
  surface,
  boxRef,
  onClick,
  commandName,
  commandArgs,
  commandStatus,
  skillName,
  contextSource,
  contextSummary,
  cardType,
  cardView,
  cardDensity,
}: SessionCardFields & {
  kind: SessionCardKind
  text: string
  /** Ctrl+O 或本行展开。 */
  expanded: boolean
  background: 'messageActionsBackground' | undefined
  marginTopOnTurn: boolean
  toolBackground: ToolBackground
  /** TranscriptRow 按本行类型解析的卡面。 */
  surface: CardSurface
  boxRef: (el: DOMElement | null) => void
  onClick: (event: ClickEvent) => void
}): React.ReactNode {
  // The skill card's wording is localized at render time: a row that
  // re-renders unchanged after /lang must not keep the previous language.
  const lang = getLang()
  // Skill rows draw through the shared card host: the built-in pure adapter
  // turns this row's own saved name/body into a view (nothing is re-read), and
  // the memo keeps the view identity stable for the memoized row.
  const skillView = React.useMemo(
    () => (kind === 'skill' && skillName !== undefined ? skillCardView(skillName, text, surface.preset === 'pi-like' ? 'markdown' : 'text') : undefined),
    [kind, skillName, text, lang, surface.preset],
  )
  switch (kind) {
    case 'command':
      if (commandName === undefined || commandStatus === undefined) return null
      // A settled command result: a registered `command/<name>` presenter's
      // card when there is one, otherwise the command's own card — collapsed
      // headline + one summary row, expanded the recorded body. The row itself
      // is the disclosure (click), the same gesture Ctrl+O and selection-Enter
      // drive. The shared card shell owns its own card face and margin.
      return (
        <Box flexDirection="column" ref={boxRef} marginTop={cardView === undefined && marginTopOnTurn ? 1 : 0}>
          {cardView === undefined ? (
            <CommandCardRow
              name={commandName}
              args={commandArgs}
              status={commandStatus}
              text={text}
              expanded={expanded}
              background={background}
              onClick={onClick}
            />
          ) : (
            <CustomCardRow
              view={cardView}
              type={cardType ?? `command/${commandName}`}
              expanded={expanded}
              background={background}
              marginTopOnTurn={marginTopOnTurn}
              toolBackground={toolBackground}
              onClick={onClick}
            />
          )}
        </Box>
      )
    case 'skill': {
      if (skillView === undefined || skillName === undefined) return null
      // A user-explicit skill load, drawn by the same shared host: one line
      // while it stays folded, the saved canonical body once expanded. The
      // adapter is pure row data — nothing is re-read and nothing re-runs.
      return (
        <Box flexDirection="column" ref={boxRef}>
          <CustomCardRow
            view={skillView}
            type={skillName}
            expanded={expanded}
            background={background}
            marginTopOnTurn={marginTopOnTurn}
            toolBackground={toolBackground}
            onClick={onClick}
          />
        </Box>
      )
    }
    case 'card':
      // A producer's Custom Card: the host draws the presented snapshot. A row
      // the window folded has no view (the log restores it), so it reads as its
      // bounded preview inside the same card face.
      return (
        <Box flexDirection="column" ref={boxRef}>
          {cardView === undefined || cardType === undefined ? (
            <FoldedCardRow
              preview={text}
              density={cardDensity}
              background={background}
              marginTopOnTurn={marginTopOnTurn}
              toolBackground={toolBackground}
              onClick={onClick}
            />
          ) : (
            <CustomCardRow
              view={cardView}
              type={cardType}
              expanded={expanded}
              background={background}
              marginTopOnTurn={marginTopOnTurn}
              toolBackground={toolBackground}
              onClick={onClick}
            />
          )}
        </Box>
      )
    case 'context-notice':
      if (contextSummary === undefined) return null
      // A generic context notice: a folded summary or the saved complete body.
      // Its neutral notice face never infers severity from the message text.
      return (
        <Box flexDirection="column" ref={boxRef} marginTop={cardMarginTop(marginTopOnTurn, surface.style)}>
          <ContextNoticeCardRow
            source={contextSource ?? ''}
            summary={contextSummary}
            body={text}
            expanded={expanded}
            background={background}
            onClick={onClick}
          />
        </Box>
      )
  }
}
