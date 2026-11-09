/**
 * The plugin input-completion overlay: the same rounded `SuggestionCard`
 * language as the `/` and `@` menus, with the host-owned merged candidate
 * list.
 *
 * Selection, click and the focus-following window match the built-in menus.
 * The only addition is the per-row source label: a menu that mixes sources
 * names every row's source, so two sources returning the same text are never
 * silently merged or confused. A single-source menu stays label-free.
 */
import React from 'react'
import { Text } from '../ui.js'
import { stringWidth } from '../ink/stringWidth.js'
import { truncateToWidth } from '../ink/truncateToWidth.js'
import type { Color } from '../ink/styles.js'
import type { Theme } from '../theme.js'
import type { TuiInputCompletionItem } from '../dsh-adapter/input-completions.js'
import { t } from '../i18n.js'
import { POINTER } from '../terminal-utils/figures.js'
import { SuggestionCard, cardContentWidth } from './SuggestionCard.js'

const MAX_VISIBLE = 6
const SOURCE_CELLS = 22

function clipped(value: string, width: number): string {
  if (width <= 0) return ''
  return stringWidth(value) <= width ? value : truncateToWidth(value, Math.max(0, width - 1)) + '…'
}

export function InputCompletionSuggestions({
  items,
  multiSource,
  selectedIndex,
  columns,
  accent,
  onPick,
  onWheelStep,
}: {
  items: readonly TuiInputCompletionItem[]
  /** Show every row's source label once more than one source contributed. */
  multiSource: boolean
  selectedIndex: number
  columns: number
  accent?: keyof Theme | Color
  /** Click a row (fullscreen): absolute index in `items`, same as keyboard. */
  onPick?: (index: number) => void
  /** Wheel step (fullscreen): ±1 row. */
  onWheelStep?: (step: 1 | -1) => void
}): React.ReactNode {
  if (items.length === 0) return null

  const usable = cardContentWidth(columns)
  const safeIndex = Math.min(Math.max(0, selectedIndex), items.length - 1)
  const startIndex = Math.max(
    0,
    Math.min(
      safeIndex - Math.floor(MAX_VISIBLE / 2),
      Math.max(0, items.length - MAX_VISIBLE),
    ),
  )
  const visible = items.slice(startIndex, startIndex + MAX_VISIBLE)
  const above = startIndex
  const below = items.length - (startIndex + visible.length)

  const nameWidth = Math.min(
    Math.max(6, Math.max(...items.map(item => stringWidth(item.name))) + 1),
    Math.max(6, Math.floor(usable * 0.4)),
  )
  const sourceWidth = multiSource
    ? Math.min(
      Math.max(3, Math.max(...items.map(item => stringWidth(item.sourceLabel))) + 3),
      SOURCE_CELLS,
    )
    : 0
  const descriptionWidth = Math.max(0, usable - 3 - nameWidth - sourceWidth)

  const title = `${t('sugg-input-title')} · ${t('sugg-count', { n: items.length })}`
  const footer =
    above > 0 || below > 0
      ? [
          above > 0 ? t('sugg-more-above', { n: above }) : null,
          below > 0 ? t('sugg-more-below', { n: below }) : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
      : null

  return (
    <SuggestionCard
      title={title}
      columns={columns}
      accent={accent}
      footer={footer}
      onRowPick={onPick ? index => onPick(startIndex + index) : undefined}
      onWheelStep={onWheelStep}
      rows={visible.map((item, offset) => {
        const isSelected = startIndex + offset === safeIndex
        const name = clipped(item.name, nameWidth)
        const namePad = ' '.repeat(Math.max(1, nameWidth - stringWidth(name)))
        const source = multiSource
          ? `[${clipped(item.sourceLabel, Math.max(1, sourceWidth - 3))}]`
          : ''
        const sourcePad = multiSource
          ? ' '.repeat(Math.max(1, sourceWidth - stringWidth(source)))
          : ''
        const description = clipped(item.description ?? '', descriptionWidth)
        return (
          <Text key={item.key} wrap="truncate">
            {' '}
            {isSelected ? (
              <Text color="suggestion" bold>{`${POINTER} ${name}${namePad}`}</Text>
            ) : (
              <Text dimColor>{`  ${name}${namePad}`}</Text>
            )}
            {multiSource ? (
              <Text color={isSelected ? 'suggestion' : undefined} dimColor={!isSelected}>
                {`${source}${sourcePad}`}
              </Text>
            ) : null}
            <Text color={isSelected ? 'suggestion' : undefined} dimColor={!isSelected}>
              {description}
            </Text>
          </Text>
        )
      })}
    />
  )
}
