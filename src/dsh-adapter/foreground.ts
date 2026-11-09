import { sessionWorkingDirectory } from '../channel/working-directory.js'
import type { ChannelHost } from './channel/channel-host.js'
import type { ChannelOwner } from './channel/owner.js'
import type { ChannelState } from './channel/types.js'
import type { TuiIntegrationHost } from './integration.js'

/** Publish the one live channel's binding without putting plugin bookkeeping
 * in the channel core. Adoption writes cwd and identity in one synchronous
 * tail, with emits between them: the microtask publishes only the settled pair.
 * The owner fence drops queued work after release; late service mounts rebind.
 */
export function startForegroundPublication(
  host: { readonly integration: TuiIntegrationHost | undefined },
  owner: Pick<ChannelOwner, 'own' | 'current'>,
  state: Pick<ChannelState, 'agentId' | 'cwd' | 'workingDirectory' | 'subscribe'>,
  services?: Pick<ChannelHost, 'watchServices'>,
): void {
  let integration: TuiIntegrationHost | undefined
  let scheduled = false
  const publish = (): void => {
    if (integration === undefined || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!owner.current()) return
      integration?.publishForeground(state.agentId === '' ? undefined : {
        sessionId: state.agentId,
        cwd: sessionWorkingDirectory(state),
      })
    })
  }
  const bind = (): void => {
    if (!owner.current()) return
    const next = host.integration
    if (next === integration) return
    integration?.publishForeground(undefined)
    integration = next
    publish()
  }
  owner.own(state.subscribe(publish))
  bind()
  const unwatch = services?.watchServices?.(name => { if (name === 'tuiIntegration') bind() })
  if (unwatch !== undefined) owner.own(unwatch)
  owner.own(() => { integration?.publishForeground(undefined); integration = undefined })
}
