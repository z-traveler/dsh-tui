/** Actual footer terminal rendering, both styles, inline/fullscreen and narrow width.
 * Run: node --import tsx/esm scripts/downstream/verify-fast-mode-render.tsx */
import '../lib/default-lang-zh.mjs'
import assert from 'node:assert/strict'
process.env.FORCE_COLOR = '3'
const [React, { PassThrough, Writable }, { Terminal }, ui, { StatusLine }, { PowerlineStatus }, { settled, viewportLines }] = await Promise.all([
  import('react'), import('node:stream'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/screens/StatusLine.js'), import('../../src/powerline/Status.js'), import('../lib/term-test.mjs'),
])
import type { ChannelUi } from '../../src/adapter/channel/ui-policy.js'
class Input extends PassThrough { isTTY = true; setRawMode() { return this }; ref() { return this }; unref() { return this } }
for (const style of ['native', 'powerline']) for (const fullscreen of [false, true]) for (const columns of [40, 100]) {
  const term = new Terminal({ cols: columns, rows: 12, scrollback: 30, allowProposedApi: true })
  class Output extends Writable {
    isTTY = true; columns = columns; rows = 12
    _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { term.write(String(chunk), done) }
  }
  const channel = {
    model: 'gpt-fixture', provider: 'offline', cwd: '/offline', displayCwd: '/offline',
    sessionRef: { backendId: 'dsh', sessionId: 'fixture' }, agentId: 'fixture',
    tokens: { input: 0, output: 0 }, tpsSamples: [], backgroundJobs: [], contextSegments: {}, activityFrames: [],
    mode: { plan: false, sandbox: 'workspace-write', approval: 'on-request' }, modeIndex: 0,
    statusBar: { compact: true, model: true, thinking: false, cwd: false, contextUsage: false, cache: false,
      tokens: false, cost: false, tps: false, gitBranch: false, sessionTitle: false, sessionId: false,
      goal: false, mode: false, contextBar: false, activity: false, trajectory: false, shortcutHint: false },
    fastMode: { enabled: true, applicable: true, provider: 'offline', model: 'gpt-fixture' },
  }
  const node = () => React.createElement(fullscreen ? ui.AlternateScreen : React.Fragment, null,
    React.createElement(StatusLine, { channel: channel as ChannelUi,
      ...style !== 'powerline' ? {} : { render: view => React.createElement(PowerlineStatus, { ...view, channel: channel as ChannelUi, surface: 'row' }) },
    }))
  const stdout = new Output()
  const screen = () => viewportLines(term).join('\n')
  const instance = await ui.render(node(), { stdout: stdout as NodeJS.WriteStream, stdin: new Input() as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false })
  try {
    await settled(() => screen().includes('gpt-fixture ⚡'))
    assert.ok(!screen().includes('fast'), 'model segment uses a glyph, not Fast text')
    channel.fastMode.enabled = false
    instance.rerender(node())
    await settled(() => screen().includes('gpt-fixture') && !screen().includes('⚡'))
  } finally {
    instance.unmount()
    await new Promise<void>(resolve => { term.write('', resolve) })
    term.dispose()
  }
}
console.log('PASS: real classic/powerline Fast glyph in inline/fullscreen at 40/100 columns')
