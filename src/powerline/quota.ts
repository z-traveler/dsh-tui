import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import { getLang, t } from '../i18n.js'
import { formatDuration } from '../terminal-utils/format.js'
import type { PowerlineIcons } from './config.js'

/** Present backend subscription windows, not money/token balances. Passing a
 * reset deadline never resets the reported usage locally. Deadlines are epoch
 * milliseconds, matching the Codex translator and its existing usage command. */
export function formatPowerlineQuota(rateLimit: ChannelUi['rateLimit'], icons: PowerlineIcons, now = Date.now()): { text: string; detail: string } | undefined {
  if (!rateLimit?.windows.length) return undefined
  const text: string[] = [], detail: string[] = []
  for (const window of rateLimit.windows) {
    const name = window.name === 'five_hour' ? t('status-rate-limit-five-hour') : window.name === 'seven_day' ? t('status-rate-limit-seven-day') : window.name
    const used = Math.round(window.utilization * 100)
    const remaining = Math.max(0, Math.min(100, 100 - used))
    let summary = t('powerline-quota-remaining', { name, remaining })
    let description = t('powerline-quota-detail', { name, remaining, used })
    if (window.resetsAt !== undefined) {
      const due = window.resetsAt <= now
      const duration = due ? t('powerline-quota-due') : formatDuration(Math.ceil((window.resetsAt - now) / 60_000) * 60_000)
      summary += ` ${icons === 'nerd' ? '↻' : t('powerline-quota-reset')}${duration}`
      description += t('powerline-quota-reset-detail', { time: new Date(window.resetsAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US') })
      if (due) description += t('powerline-quota-awaiting')
    }
    text.push(summary)
    detail.push(description)
  }
  return { text: text.join(' · '), detail: detail.join('\n') }
}
