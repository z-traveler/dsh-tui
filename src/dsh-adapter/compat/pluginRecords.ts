import * as sessionApi from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

interface PluginRecord extends Pick<SessionEvent, 'seq' | 'time'> {
  readonly type: string
  readonly data: unknown
}
interface PluginRecordReader {
  pluginRecordOf(event: SessionEvent): PluginRecord | undefined
}
function hasPluginRecordReader(value: unknown): value is PluginRecordReader {
  return value !== null && typeof value === 'object'
    && 'pluginRecordOf' in value && typeof value.pluginRecordOf === 'function'
}

/** Legacy hosts have no plugin-record API; never decode a private envelope ourselves. */
export function pluginRecordOf(event: SessionEvent): PluginRecord | undefined {
  return hasPluginRecordReader(sessionApi) ? sessionApi.pluginRecordOf(event) : undefined
}
