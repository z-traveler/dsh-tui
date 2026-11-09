/**
 * colorize chalk-level detection: a 256-color TERM is boosted to truecolor
 * inside VS Code (TERM_PROGRAM=vscode) and Windows Terminal (WT_SESSION,
 * forwarded into WSL); tmux retains truecolor when this session's attached
 * clients all report RGB, otherwise clamps to 256. The explicit escape hatch
 * is preserved. Levels are fixed at module load, so each
 * case runs in a fresh child process.
 *
 * Run: `node --import tsx/esm scripts/verify-chalk-truecolor-boost.ts`
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Absolute file URL: the child resolves our module against this checkout, not
 *  the caller's cwd. */
const colorizeModule = new URL('../src/ink/colorize.ts', import.meta.url).href

const probe = (colorize: boolean): string => `
const { default: chalk } = await import('chalk')
${colorize ? `await import(${JSON.stringify(colorizeModule)})` : ''}
process.stdout.write(String(chalk.level))
`

/** The level a child process settles on. `colorize: false` skips our module, so
 *  the same environment reports chalk's own detection — the baseline every
 *  boost is measured against. */
function levelWith(extra: Record<string, string>, colorize = true): number {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of ['TERM_PROGRAM', 'WT_SESSION', 'TMUX', 'TMUX_PANE', 'COLORTERM', 'DSH_TUI_TMUX_TRUECOLOR', 'FORCE_COLOR', 'NO_COLOR', 'CI', 'TF_BUILD', 'AGENT_NAME', 'TEAMCITY_VERSION']) delete env[key]
  // Enable color for the pipe without forcing a numeric level; chalk still
  // detects 256 colors from TERM, just as it does on a real TTY.
  Object.assign(env, { TERM: 'xterm-256color', FORCE_COLOR: 'true' }, extra)
  const out = execFileSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', probe(colorize)], { env, encoding: 'utf8' })
  return Number(out.trim())
}

let failed = 0
const check = (name: string, got: number, want: number) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : `  (level=${got}, want ${want})`}`)
  if (!ok) failed++
}

// Negative control: with no host marker our module must not move the level.
// Measured against chalk's own detection rather than a hard-coded 2 — native
// Windows sets truecolor from the OS build alone (supports-color), so a fixed
// 2 would be a Windows-only red while the boost is correctly a no-op there.
check('plain 256-color TERM keeps chalk\'s own level', levelWith({}), levelWith({}, false))
check('VS Code boosts to truecolor', levelWith({ TERM_PROGRAM: 'vscode' }), 3)
check('Windows Terminal (WT_SESSION) boosts to truecolor', levelWith({ WT_SESSION: 'wt' }), 3)
check('tmux inside Windows Terminal clamps to 256', levelWith({ WT_SESSION: 'wt', TMUX: '/tmp/tmux' }), 2)
check('DSH_TUI_TMUX_TRUECOLOR keeps truecolor in tmux', levelWith({ WT_SESSION: 'wt', TMUX: '/tmp/tmux', DSH_TUI_TMUX_TRUECOLOR: '1' }), 3)
check('Windows Terminal respects FORCE_COLOR=2', levelWith({ WT_SESSION: 'wt', FORCE_COLOR: '2' }), 2)
check('VS Code respects FORCE_COLOR=2', levelWith({ TERM_PROGRAM: 'vscode', FORCE_COLOR: '2' }), 2)
check('FORCE_COLOR=0 is never boosted', levelWith({ WT_SESSION: 'wt', FORCE_COLOR: '0' }), 0)

if (process.platform !== 'win32') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tmux-color-'))
  try {
    writeFileSync(join(dir, 'tmux'), `#!${process.execPath}\nif (process.env.TMUX_TEST_HANG) setTimeout(() => {}, 2000)\nelse if (process.env.TMUX_TEST_FAIL) process.exit(1)\nelse process.stdout.write(process.env.TMUX_TEST_REPLY ?? '')\n`, { mode: 0o755 })
    const env = { WT_SESSION: 'wt', TMUX: '/fixture/socket,123,0', TMUX_PANE: '%1', PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` }
    const rgb = '$7\n$7\tRGB,focus\n$8\tfocus\n'
    check('RGB clients of this session retain truecolor (unrelated clients ignored)', levelWith({ ...env, TMUX_TEST_REPLY: rgb }), 3)
    check('one non-RGB client of this session keeps the safe downgrade', levelWith({ ...env, TMUX_TEST_REPLY: '$7\n$7\tRGB\n$7\tfocus\n' }), 2)
    check('no attached client keeps the safe downgrade', levelWith({ ...env, TMUX_TEST_REPLY: '$7\n$8\tRGB\n' }), 2)
    check('unknown tmux format keeps the safe downgrade', levelWith({ ...env, TMUX_TEST_REPLY: '\n' }), 2)
    check('failed tmux query keeps the safe downgrade', levelWith({ ...env, TMUX_TEST_FAIL: '1' }), 2)
    check('hung tmux query is bounded and keeps the safe downgrade', levelWith({ ...env, TMUX_TEST_HANG: '1' }), 2)
    check('RGB detection never overrides explicit FORCE_COLOR=2', levelWith({ ...env, TMUX_TEST_REPLY: rgb, FORCE_COLOR: '2' }), 2)
    check('RGB detection never overrides explicit FORCE_COLOR=0', levelWith({ ...env, TMUX_TEST_REPLY: rgb, FORCE_COLOR: '0' }), 0)
    check('RGB detection never overrides explicit FORCE_COLOR=1', levelWith({ ...env, TMUX_TEST_REPLY: rgb, FORCE_COLOR: '1' }), 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(failed === 0 ? 'verify-chalk-truecolor-boost: all assertions passed' : `verify-chalk-truecolor-boost: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
