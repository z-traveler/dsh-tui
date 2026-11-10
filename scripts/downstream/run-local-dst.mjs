#!/usr/bin/env node
/** Real-profile local acceptance: build, use one TUI copy, restore on exit.
 * No credential/configuration/session files are copied or replaced.
 */
import { accessSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { acquireLocalDstProfile } from '../lib/local-dst-profile.mjs'

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run local acceptance in a terminal')
  const repo = realpathSync(fileURLToPath(new URL('../../', import.meta.url)))
  const profile = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles/dsh-tui')
  const lease = acquireLocalDstProfile(profile, repo)
  // Children retain the kernel lease if this wrapper dies unexpectedly.
  const stdio = ['inherit', 'inherit', 'inherit', 'ignore', lease.fd]
  try {
    const build = spawnSync('pnpm', ['compile:src'], { cwd: repo, stdio })
    if (build.status !== 0) throw new Error('Local compilation failed; profile package was not changed')
    accessSync(join(repo, 'lib/types/dsh-adapter/host-entry.js'))
    const saved = lease.mount()
    process.stderr.write(`[local dst] TUI: ${repo}\n[local dst] Profile: ${profile}\n[local dst] Original package: ${saved}\n[local dst] Do not launch another TUI with this profile until acceptance exits.\n`)
    const child = spawn(process.execPath, [join(repo, 'bin/dsh-tui.js'), ...process.argv.slice(2)], {
      stdio,
      env: { ...process.env, DSH_TUI_NO_DELEGATE: '1', DSH_TUI_HOST_ENTRY: '1' },
    })
    // Ctrl+C already reaches the child through our shared process group.
    // Keep the wrapper alive for restoration without delivering it twice.
    const forwardInt = () => {}
    const forwardTerm = () => child.kill('SIGTERM')
    process.on('SIGINT', forwardInt)
    process.on('SIGTERM', forwardTerm)
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)))
      })
    } finally {
      process.off('SIGINT', forwardInt)
      process.off('SIGTERM', forwardTerm)
    }
  } finally {
    lease.close()
    process.stderr.write('[local dst] Original profile package restored.\n')
  }
}

await main().catch(error => {
  process.stderr.write(`[local dst] ${error.message}\n`)
  process.exitCode = 1
})
