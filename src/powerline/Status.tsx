import React from 'react'
import { Box, useTerminalSize } from '../ui.js'
import { PowerlineText as Text } from './Text.js'
import type { ChannelUi } from '../adapter/channel/ui-policy.js'
import type { TuiStatusFieldEntry } from '../dsh-adapter/status.js'
import { truncateToWidth } from '../ink/truncateToWidth.js'
import { stringWidth } from '../ink/stringWidth.js'
import type { StatusLinePresentation } from '../components/StatusLinePresentation.js'
import type { InputBorderLabel } from '../components/EffortInputBorder.js'
import { TooltipTarget } from '../components/Tooltip.js'
import { normalizePowerlineOptions } from './config.js'
import { layoutPowerlineFields } from './layout.js'
import { buildPowerlineFields, nodeText, type PowerlineField } from './fields.js'
import { formatPowerlineQuota } from './quota.js'
import { readPowerlineGit, type PowerlineGitStatus } from './git.js'

type HostHudField = StatusLinePresentation['fields'][number]

function useGit(cwd: string, enabled: boolean): PowerlineGitStatus | undefined {
  const [snapshot, setSnapshot] = React.useState<{ cwd: string; value: PowerlineGitStatus | undefined }>()
  React.useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = () => { void readPowerlineGit(cwd).then(value => { if (alive) setSnapshot({ cwd, value }) }) }
    refresh()
    const timer = setInterval(refresh, 1100)
    return () => { alive = false; clearInterval(timer) }
  }, [cwd, enabled])
  return snapshot?.cwd === cwd ? snapshot.value : undefined
}

function Field({ field }: { field: PowerlineField }): React.ReactNode {
  const body = <Box flexDirection="row" flexShrink={0} onClick={field.onClick}>{field.node}</Box>
  const detail = [field.detail, field.extraDetail].filter(Boolean).join('\n')
  return detail ? <TooltipTarget content={detail}>{body}</TooltipTarget> : body
}

export function PowerlineStatus({ channel, fields: native, pluginFields, used, capacity, surface, detail, label, supplemental, gapBefore = false, reserveLabel = surface !== 'row', statusText = '' }: {
  channel: ChannelUi
  fields: readonly HostHudField[]
  pluginFields: readonly TuiStatusFieldEntry[]
  used: number | undefined
  capacity: number | undefined
  surface?: 'header' | 'overflow' | 'row'
  label?: InputBorderLabel
  reserveLabel?: boolean
  gapBefore?: boolean
  supplemental?: React.ReactNode
  detail: (id: string) => React.ReactNode
  statusText?: string
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const options = normalizePowerlineOptions(channel.statusBar.powerline)
  const git = useGit(channel.cwd, channel.statusBar.gitBranch === true)
  const [, refreshClock] = React.useReducer((value: number) => value + 1, 0)
  const hasReset = channel.statusBar.model !== false && [...options.left, ...options.right].includes('model')
    && formatPowerlineQuota(channel.rateLimit, channel.sessionRef.backendId)?.parts.some(part => part.reset !== undefined) === true
  React.useEffect(() => {
    if (!hasReset) return
    const timer = setInterval(refreshClock, 60_000)
    return () => clearInterval(timer)
  }, [hasReset])
  const cost = native.find(field => field.key === 'cost')?.node
  const fields = buildPowerlineFields(channel, options, used, capacity, git, cost,
    native.find(field => field.key === 'model')?.onClick, native.find(field => field.key === 'effort')?.onClick)
  for (const field of fields) {
    const id = ({ context: 'ctx', model: 'model', cwd: 'cwd', git: 'git', cost: 'cost' } as Record<string, string>)[field.key]
    const extra = id === undefined ? '' : nodeText(detail(id))
    if (extra !== '') field.detail = extra
  }
  const tone: Record<string, string | undefined> = { dim: undefined, accent: 'professionalBlue', success: 'success', warning: 'warning', error: 'error' }
  const pluginLeft: string[] = [], pluginHead: string[] = [], pluginTail: string[] = []
  for (const entry of pluginFields) {
    const key = `plugins:${entry.key}`
    fields.push({ key, text: entry.text, width: stringWidth(entry.text), node: <Text color={tone[entry.tone]} dimColor={entry.tone === 'dim'}>{entry.text}</Text>,
      detail: entry.detail, onClick: entry.onClick, plugin: true })
    ;(entry.slot === 'left-tail' ? pluginLeft : entry.slot === 'right-head' ? pluginHead : pluginTail).push(key)
  }
  if (statusText !== '') {
    fields.push({ key: 'plugins:status', text: statusText, width: stringWidth(statusText), node: <Text color={options.colors.plugin}>{statusText}</Text>, plugin: true })
    pluginLeft.push('plugins:status')
  }
  // Reuse already formatted host fields for optional metrics. No cost or
  // context accounting is duplicated in the presentation layer.
  for (const field of native) {
    const key = ({ tokens: 'tokens', cache: 'cache', tps: 'tps', title: 'sessionTitle', sessionId: 'sessionId' } as Record<string, string>)[field.key]
    if (key !== undefined) {
      const text = nodeText(field.node)
      fields.push({ key, text, width: stringWidth(text), node: field.node, detail: field.tooltip ?? (field.id ? nodeText(detail(field.id)) : text), onClick: field.onClick })
    }
  }
  // The live job count rides the primary row: as a `signals` entry it added a
  // whole row to the (height-0 while idle) overflow surface whenever a
  // foreground command ran, shifting the viewport for the command's duration.
  const jobsPart = native.find(field => field.key === 'jobs')
  if (jobsPart !== undefined) {
    const text = nodeText(jobsPart.node)
    fields.push({ key: 'jobs', text, width: stringWidth(text), node: jobsPart.node, detail: jobsPart.tooltip ?? nodeText(detail('jobs')), onClick: jobsPart.onClick })
  }
  const expand = (ids: readonly string[]) => ids.flatMap(id => id === 'plugins' ? pluginLeft : [id])
  const leftIds = expand(options.left)
  // Right after the model, where the native footer keeps it.
  const modelAt = leftIds.indexOf('model')
  if (jobsPart !== undefined) leftIds.splice(modelAt === -1 ? leftIds.length : modelAt + 1, 0, 'jobs')
  const grouped = { ...options, left: leftIds, right: [...pluginHead, ...expand(options.right), ...pluginTail] }
  const edged = surface !== 'row'
  // Both presentation slots must use the same budget, even though the
  // prompt supplies the painted chip only to its header slot.
  const title = reserveLabel && channel.promptSessionLabel ? channel.sessionTitle ?? '' : ''
  const labelWidth = title === '' ? 0 : stringWidth(truncateToWidth(title, Math.max(8, Math.min(28, columns - 8)))) + 2
  const width = Math.max(0, columns - 4 - labelWidth)
  const layout = layoutPowerlineFields(fields, grouped, width)
  const rowWidth = (row: readonly PowerlineField[]) => row.length === 0 ? 0 : row.reduce((sum, field) => sum + field.width, 0) + options.padding * 2 + (row.length - 1) * (stringWidth(options.separator) + 2)
  const row = (items: readonly PowerlineField[]) => items.length === 0 ? null : <>
    <Text>{' '.repeat(options.padding)}</Text>
    {items.map((field, index) => <React.Fragment key={field.key}>
      {index > 0 && <Text color={options.colors.separator}>{` ${options.icons === 'ascii' && options.separator === '\ue0b1' ? '|' : options.separator} `}</Text>}
      <Field field={field} />
    </React.Fragment>)}
    <Text>{' '.repeat(options.padding)}</Text>
  </>
  const signals = native.filter(field => ['mode', 'goal', 'starting', 'ideSelection'].includes(field.key))
  if (surface === 'overflow') return <Box flexDirection="column" width="100%" flexShrink={0} marginTop={gapBefore ? 1 : 0}>
    {layout.secondary.map((items, index) => <Box key={index} flexDirection="row" height={1} overflow="hidden">{row(items)}</Box>)}
    {signals.length > 0 && <Box flexDirection="row" overflow="hidden">{signals.map(field => <Box key={field.key} marginRight={1} onClick={field.onClick}>{field.node}</Box>)}</Box>}
    {supplemental}
  </Box>
  const gap = Math.max(0, width - rowWidth(layout.left) - rowWidth(layout.right))
  return <Box flexDirection="row" width={columns} height={1} flexShrink={0} overflow="hidden" marginTop={gapBefore ? 1 : 0}>
    <Text color={options.colors.border}>{edged ? '╭─' : '  '}</Text>
    {row(layout.left)}
    <Text color={options.colors.border}>{(layout.right.length > 0 || !edged ? ' ' : '─').repeat(gap)}</Text>
    {row(layout.right)}
    {label !== undefined ? <><Text> </Text><Text color={label.ink} backgroundColor={label.color}>{label.text}</Text><Text> </Text></> : <Text>{' '.repeat(labelWidth)}</Text>}
    <Text color={options.colors.border}>{edged ? '─╮' : '  '}</Text>
  </Box>
}
