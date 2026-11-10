/**
 * Session fact cards (downstream): the render-path strip for collapsible card
 * bodies, used by the card rows.
 */

/**
 * Sanitize untrusted plugin text for a collapsible card body: the same
 * render-path strip as `cleanRenderText` in `sanitize.ts` (complete ANSI/OSC
 * sequences first, then every C0/C1 control char) but with NO line or cell cap.
 * Newlines, indentation and tabs stay: a card body is a block, and the whole
 * recorded text has to survive — the collapsed card previews one line and the
 * expanded card paints the rest, so rendering safety must never be bought by
 * permanently cutting the body.
 */
export function cleanCardBody(value: string): string {
  const withoutAnsi = value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
  // Carriage returns rewrite their own line (progress bars, overwritten
  // status lines): the last state is what the command reported.
  return withoutAnsi
    .split('\n')
    .map(row => {
      const line = row.endsWith('\r') ? row.slice(0, -1) : row
      const carriage = line.lastIndexOf('\r')
      return carriage === -1 ? line : line.slice(carriage + 1)
    })
    // eslint-disable-next-line no-control-regex -- deliberate: sanitize untrusted render-path text
    .join('\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ')
}
