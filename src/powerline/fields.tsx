import React from 'react'
import { Box } from '../ui.js'
import { PowerlineText as Text } from './Text.js'
import { stringWidth } from '../ink/stringWidth.js'
import { formatTokens } from '../terminal-utils/format.js'
import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import type { PowerlineOptions } from './config.js'
import { formatPowerlineQuota } from './quota.js'
import { formatModelIconPrefix } from './modelIcon.js'
import type { PowerlineGitStatus } from './git.js'

export interface PowerlineField {
  key: string
  text: string
  width: number
  node: React.ReactNode
  detail?: string
  extraDetail?: string
  onClick?: () => void
  plugin?: boolean
}

/** Read presentation text only; callers still own the source values, price
 * formatting and semantic meaning of their nodes. */
export function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? nodeText(node.props.children) : ''
}

const RAINBOW = ['#b281d6', '#d787af', '#febc38', '#e4c00f', '#89d281', '#00afaf', '#178fb9']
function thinking(text: string, level: string | undefined, color: string): React.ReactNode {
  return color === 'subtle' && ['high', 'xhigh', 'max'].includes(level ?? '')
    ? <>{Array.from(text).map((char, index) => <Text key={index} color={RAINBOW[index % RAINBOW.length]}>{char}</Text>)}</>
    : <Text color={color === 'subtle' ? ({ low: '#729bc5', medium: '#a277d6' }[level ?? ''] ?? color) : color}>{text}</Text>
}

export function buildPowerlineFields(channel: ChannelUi, options: PowerlineOptions, used: number | undefined, capacity: number | undefined,
  git: PowerlineGitStatus | undefined, cost: React.ReactNode, modelClick?: () => void, effortClick?: () => void): PowerlineField[] {
  const fields: PowerlineField[] = []
  const icon = (nerd: string, ascii: string) => options.icons === 'none' ? '' : `${options.icons === 'ascii' ? ascii : nerd} `
  const add = (key: string, text: string, node: React.ReactNode, detail?: string, onClick?: () => void, extraDetail?: string) => {
    if (text !== '') fields.push({ key, text, width: stringWidth(text), node, detail, onClick, extraDetail })
  }
  const flags = channel.statusBar ?? {}
  const colors = options.colors
  add('marker', options.marker, <Text color={colors.marker}>{options.marker}</Text>)
  if (flags.model !== false) {
    const name = channel.modelDisplay ?? channel.model
    const prefix = formatModelIconPrefix(channel.model, options)
    const quota = formatPowerlineQuota(channel.rateLimit, channel.sessionRef.backendId)
    const suffix = flags.thinking !== false && channel.reasoningEffort && channel.reasoningEffort !== 'off' ? `:${channel.reasoningEffort}` : ''
    const color = options.modelColors.find(rule => new RegExp(rule.pattern, 'i').test(name))?.color ?? colors.model
    const effort = thinking(suffix, channel.reasoningEffort, colors.thinking)
    const node = <Box flexDirection="row">
      <Text color={color}>{prefix}{name}</Text>
      {suffix !== '' && effortClick !== undefined
        ? <Box onClick={event => { event.stopImmediatePropagation(); effortClick() }}>{effort}</Box> : effort}
      {quota !== undefined && <Box flexDirection="row" onClick={event => event.stopImmediatePropagation()}>
        {quota.parts.map((part, index) => <React.Fragment key={index}>
          <Text color={part.tone === 'success' ? colors.quota : colors[part.tone]}>{` ${part.text}`}</Text>
          {part.reset !== undefined && <Text dimColor>{` (${part.reset})`}</Text>}
        </React.Fragment>)}
      </Box>}
    </Box>
    // Name, effort and applicable subscription windows share one width budget.
    add('model', `${prefix}${name}${suffix}${quota === undefined ? '' : ` ${quota.text}`}`, node, `${name}${suffix}`, modelClick, quota?.detail)
  }
  if (flags.contextUsage !== false && used !== undefined && capacity !== undefined && capacity > 0) {
    const percent = 100 * used / capacity
    const value = options.context === 'percent' ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%/${formatTokens(capacity)}`
    const text = `${icon('◫', 'ctx')}${value}`
    const color = percent > options.errorPercent ? colors.error : percent > options.warnPercent ? colors.warning : colors.context
    add('context', text, <Text color={color}>{text}</Text>, `${used} / ${capacity}`)
  }
  if (flags.cost !== false) {
    const text = nodeText(cost)
    add('cost', text, <Text color={colors.cost}>{text}</Text>, text)
  }
  if (flags.cwd !== false) {
    const raw = channel.displayCwd ?? channel.cwd
    const path = options.path === 'basename' ? raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || raw
      : options.path === 'abbreviated' && stringWidth(raw) > 40 ? `…/${raw.split(/[\\/]/).slice(-2).join('/')}` : raw
    const text = `${icon('\uf07b', 'dir')}${path}`
    add('cwd', text, <Text color={colors.path}>{text}</Text>, raw)
  }
  if (flags.gitBranch && git !== undefined && (git.branch !== '' || git.staged + git.unstaged + git.untracked > 0)) {
    const dirty = git.staged + git.unstaged + git.untracked > 0
    const counts = `${git.unstaged ? ` *${git.unstaged}` : ''}${git.staged ? ` +${git.staged}` : ''}${git.untracked ? ` ?${git.untracked}` : ''}`
    const text = `${icon('\ue0a0', 'git')}${git.branch}${counts}`
    add('git', text, <Text color={dirty ? colors.gitDirty : colors.gitClean}>{text}</Text>, text)
  }
  if (channel.agentPreset) add('agent', channel.agentPreset, <Text color={colors.agent}>{channel.agentPreset}</Text>, channel.agentPreset)
  return fields
}
