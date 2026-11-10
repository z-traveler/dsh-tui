// Type-checked companion to docs/downstream/custom-cards.md; not installed.
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-harness-tui/dsh-tui/extensions'
import { appendTuiCard } from '@deepseek-harness-tui/dsh-tui/cards/dsh'

export function recordReport(session: Session, runId: string, message: string) {
  return appendTuiCard(session, {
    version: 1,
    type: 'acme/report',
    id: runId,
    data: { message },
    fallback: { title: '检查报告', body: message },
  })
}

export const name = 'acme-cards-tui'
export const inject = ['tuiRenderers']

export function apply(ctx: Context) {
  ctx.tuiRenderers.registerCard('acme/report', data => {
    if (data === null || typeof data !== 'object'
      || !('message' in data) || typeof data.message !== 'string') return undefined
    return {
      title: '检查报告',
      blocks: [{ kind: 'text', text: data.message }],
    }
  })
}
