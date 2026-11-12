import type { TuiModalOptions } from '../modal-options.js'

export interface ModalLayout {
  columns: number
  rows: number
  top: number
  left: number
  bottom: number
  paddingX: number
  paddingY: number
  compact: boolean
  contentSize: { columns: number; rows: number }
}

function cells(value: number | `${number}%` | undefined, total: number, fallback: number): number {
  return value === undefined ? fallback : Math.floor(typeof value === 'number' ? value : total * parseFloat(value) / 100)
}

/** Geometry uses the real visible chat frame, not a fabricated fullscreen
 * inline viewport. Percent row/col use the remaining travel range like Pi. */
export function resolveModalLayout(viewport: { columns: number; rows: number }, options: TuiModalOptions = {}, defaults = viewport): ModalLayout {
  const width = Math.max(1, viewport.columns)
  const height = Math.max(1, viewport.rows)
  const raw = typeof options.margin === 'number'
    ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin }
    : options.margin ?? {}
  // Impossible margins yield a one-cell viewport, never an off-screen owner.
  const leftMargin = Math.min(raw.left ?? 0, width - 1)
  const rightMargin = Math.min(raw.right ?? 0, width - leftMargin - 1)
  const topMargin = Math.min(raw.top ?? 0, height - 1)
  const bottomMargin = Math.min(raw.bottom ?? 0, height - topMargin - 1)
  const availableWidth = width - leftMargin - rightMargin
  const availableHeight = height - topMargin - bottomMargin
  const columns = Math.max(1, Math.min(availableWidth, Math.max(options.minWidth ?? 1,
    cells(options.width, width, Math.min(100, defaults.columns - (defaults.columns > 12 ? 4 : 0))))))
  const rows = Math.max(1, Math.min(availableHeight,
    cells(options.height, height, Math.min(26, defaults.rows - (defaults.rows >= 9 ? 4 : 2))),
    cells(options.maxHeight, height, availableHeight)))
  const anchor = options.anchor ?? 'center'
  const travelX = availableWidth - columns
  const travelY = availableHeight - rows
  const anchorX = anchor.endsWith('left') || anchor === 'left-center' ? 0
    : anchor.endsWith('right') || anchor === 'right-center' ? travelX : Math.floor(travelX / 2)
  const anchorY = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? travelY : Math.floor(travelY / 2)
  const requestedLeft = options.col === undefined ? leftMargin + anchorX
    : typeof options.col === 'number' ? options.col : leftMargin + cells(options.col, travelX, 0)
  const requestedTop = options.row === undefined ? topMargin + anchorY
    : typeof options.row === 'number' ? options.row : topMargin + cells(options.row, travelY, 0)
  const left = Math.max(leftMargin, Math.min(requestedLeft + (options.offsetX ?? 0), width - rightMargin - columns))
  const top = Math.max(topMargin, Math.min(requestedTop + (options.offsetY ?? 0), height - bottomMargin - rows))
  const border = options.style?.borderStyle === 'none' ? 0 : 2
  const chrome = options.style?.chrome === false ? 0 : 2
  const compact = columns < (chrome ? 12 : border + 1) || rows < border + chrome + 1
  const paddingX = compact ? 0 : Math.min(options.style?.paddingX ?? 1, Math.max(0, Math.floor((columns - border - 1) / 2)))
  const paddingY = compact ? 0 : Math.min(options.style?.paddingY ?? 0, Math.max(0, Math.floor((rows - border - chrome - 1) / 2)))
  return {
    columns, rows, top, left, bottom: height - top - rows, paddingX, paddingY, compact,
    contentSize: { columns: Math.max(1, columns - border - paddingX * 2), rows: Math.max(1, rows - border - chrome - paddingY * 2) },
  }
}
