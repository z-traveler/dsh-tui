import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import { getLang, t } from '../i18n.js'

export interface ModelQuotaPart {
  tone: 'success' | 'warning' | 'error'
  text: string
  reset?: string
}

function resetCountdown(deadline: number, now: number): string {
  const seconds = Math.max(0, (deadline - now) / 1000)
  if (seconds < 60) return t('powerline-quota-now')
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}h`
  return `${Math.ceil(seconds / 86400)}d`
}

/** Model-attached subscription presentation. Native backend identity, not a
 * guessed model brand, selects applicable windows. Deadlines are epoch ms as
 * normalised by native adapters; rendering never resets the reported usage locally. */
export function formatPowerlineQuota(rateLimit: ChannelUi['rateLimit'], backendId: string, now = Date.now()): { text: string; detail: string; parts: ModelQuotaPart[] } | undefined {
  const names = backendId === 'codex' ? ['seven_day'] : backendId === 'claude' ? ['five_hour', 'seven_day'] : []
  const parts: ModelQuotaPart[] = [], details: string[] = []
  for (const key of names) {
    const window = rateLimit?.windows.find(item => item.name === key)
    if (window === undefined) continue
    const name = t(key === 'five_hour' ? 'powerline-quota-five-hour' : 'powerline-quota-week')
    const used = window.utilization * 100
    const rawRemaining = Math.max(0, Math.min(100, 100 - used))
    const remaining = Math.round(rawRemaining)
    const reset = window.resetsAt === undefined ? undefined : resetCountdown(window.resetsAt, now)
    parts.push({ tone: remaining < 10 ? 'error' : remaining < 25 ? 'warning' : 'success', text: `${name}:${remaining}%`, reset })
    let detail = t('powerline-quota-detail', { name, remaining: Number(rawRemaining.toFixed(1)), used: Number(used.toFixed(1)) })
    if (window.resetsAt !== undefined) {
      detail += t('powerline-quota-reset-detail', { time: new Date(window.resetsAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US') })
      if (window.resetsAt <= now) detail += t('powerline-quota-awaiting')
    }
    details.push(detail)
  }
  if (parts.length === 0) return undefined
  return { text: parts.map(part => `${part.text}${part.reset === undefined ? '' : ` (${part.reset})`}`).join(' '), detail: details.join('\n'), parts }
}
