import type { TuiModalProps } from '../../src/scenes.js'
import type { ScrollBoxHandle } from '../../src/ui.js'

/** A generic, host-themed report: no model, database or command-specific logic. */
export function PluginModalExample({ React, ui, close, contentSize, focused }: TuiModalProps) {
  const [refresh, setRefresh] = React.useState(0)
  const scroll = React.useRef<ScrollBoxHandle>(null)
  const actual = ui.useTerminalSize()
  ui.useInput((input, key) => {
    if (input === 'q') close()
    else if (input === 'r') setRefresh(value => value + 1)
    else if (key.upArrow) scroll.current?.scrollBy(-1)
    else if (key.downArrow) scroll.current?.scrollBy(1)
    else if (key.pageUp) scroll.current?.scrollBy(-contentSize.rows)
    else if (key.pageDown) scroll.current?.scrollBy(contentSize.rows)
  })
  if (contentSize.rows < 3) return React.createElement(ui.Text, null, `REFRESH_${refresh} · r refresh · q close`)
  return React.createElement(ui.Box, { flexDirection: 'column', height: contentSize.rows },
    React.createElement(ui.Text, { color: 'accent' }, `REFRESH_${refresh} ${focused ? 'FOCUSED' : 'BACKGROUND'} ${actual.columns}x${actual.rows}`),
    React.createElement(ui.ScrollBox, { ref: scroll, height: Math.max(1, contentSize.rows - 2), flexGrow: 1, flexDirection: 'column' },
      ...Array.from({ length: 80 }, (_, i) => React.createElement(ui.Text, { key: i, color: i % 3 === 0 ? 'success' : i % 3 === 1 ? 'warning' : 'text' },
        `REPORT_ROW_${String(i).padStart(2, '0')}  ${['Alpha', 'Beta', 'Gamma'][i % 3]}  ${String(i * 7 + refresh).padStart(4)}  中英 👋`))),
    React.createElement(ui.Text, { dimColor: true }, '↑↓ / PgUp PgDn scroll · r refresh · q close'))
}
