/**
 * Built-in Card View adapters: the TUI's own transcript cards expressed as the
 * same pure presentation a Custom Card presenter returns, so the shared card
 * host (`components/messages/CustomCardRow.tsx`) draws them with the plugin
 * cards' shell.
 *
 * They read only facts the durable record already owns — never a file, a
 * command or a model call — and resolve their wording at render time, so a
 * language switch reaches them like every other transcript row.
 */
import type { TuiCardView } from '../agent/cards.js'
import { t } from '../i18n.js'

/**
 * One user-explicit skill load. The line reports what the record proves — that
 * the skill's instructions were loaded — and the body is the canonical text the
 * model was handed, verbatim. It is never a claim that the work succeeded.
 */
export function skillCardView(name: string, body: string, format: 'text' | 'markdown' = 'text'): TuiCardView {
  return {
    title: name,
    label: t('skill-card-label'),
    summary: t('skill-card-loaded'),
    blocks: [{ kind: format, text: body }],
  }
}
