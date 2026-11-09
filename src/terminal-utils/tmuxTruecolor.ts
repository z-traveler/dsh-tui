import { execFileSync } from 'node:child_process'

/** Keep RGB only when every attached client of this pane's session supports it.
 * Unknown formats, detached sessions and unavailable/unresponsive tmux retain
 * the renderer's conservative 256-colour fallback. Called once at startup.
 */
export function tmuxClientsSupportTruecolor(): boolean {
  const pane = process.env.TMUX_PANE
  if (!pane) return false
  try {
    const output = execFileSync('tmux', [
      'display-message', '-p', '-t', pane, '#{session_id}',
      ';', 'list-clients', '-F', '#{session_id}\t#{client_termfeatures}',
    ], { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] })
    const [session, ...clients] = output.trimEnd().split('\n')
    if (session === undefined || !/^\$\d+$/.test(session)) return false
    const features = clients.filter(line => line.startsWith(`${session}\t`))
      .map(line => line.slice(session.length + 1).split(','))
    return features.length > 0 && features.every(client => client.includes('RGB'))
  } catch {
    return false
  }
}
