import { constants, closeSync, ftruncateSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Kernel lease + recovery record for a temporary, single-copy TUI profile. */
export function acquireLocalDstProfile(profile, repo) {
  const installed = join(profile, 'node_modules/@deepseek-harness-tui/dsh-tui')
  const lock = join(profile, '.local-dst.lock')
  const fd = openSync(lock, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
  const result = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
  if (result.status !== 0) {
    closeSync(fd)
    throw new Error(result.error ? `Cannot acquire local acceptance lock: ${result.error.message}` : 'Another local acceptance or compiler is running; wait for compilation or exit the earlier acceptance before retrying')
  }
  const stat = path => lstatSync(path, { throwIfNoEntry: false })
  const pointsTo = (path, target) => stat(path)?.isSymbolicLink()
    && resolve(dirname(path), readlinkSync(path)) === resolve(target)
  const record = state => {
    ftruncateSync(fd, 0)
    writeSync(fd, state === undefined ? '' : JSON.stringify(state) + '\n', 0, 'utf8')
  }
  const recover = state => {
    if (state === undefined) return
    if (state === null || typeof state !== 'object' || state.installed !== installed || typeof state.repo !== 'string') {
      throw new Error(`Invalid recovery record; profile left unchanged: ${lock}`)
    }
    if (state.version === undefined && Number.isInteger(state.pid)) {
      try { process.kill(state.pid, 0); throw new Error(`An older local acceptance is still running (PID ${state.pid})`) }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    if (state.saved !== undefined) {
      const saved = resolve(state.saved), folder = dirname(saved)
      if (dirname(folder) !== profile || !basename(folder).startsWith('.local-dst-') || basename(saved) !== 'installed-package') {
        throw new Error(`Unexpected backup path; profile left unchanged: ${lock}`)
      }
      if (stat(saved)) {
        if (stat(installed)) {
          if (!pointsTo(installed, state.repo)) throw new Error(`Profile changed externally; original backup preserved: ${saved}`)
          unlinkSync(installed)
        }
        renameSync(saved, installed)
      } else if (!stat(installed) || pointsTo(installed, state.repo)) {
        throw new Error(`Original package backup is missing; profile left unchanged: ${lock}`)
      }
      if (stat(folder) && readdirSync(folder).length === 0) rmdirSync(folder)
    } else if (!stat(installed) || pointsTo(installed, state.repo)) {
      throw new Error(`Cannot safely recover profile without a backup: ${lock}`)
    }
  }
  let state
  try {
    const text = readFileSync(lock, 'utf8').trim()
    recover(text === '' ? undefined : JSON.parse(text))
    lstatSync(installed)
    if (realpathSync(installed) === repo) throw new Error('Profile already points to this worktree without a recoverable backup')
    state = { version: 2, pid: process.pid, repo, installed }
    record(state)
  } catch (error) {
    closeSync(fd)
    throw error
  }
  let closed = false
  return {
    fd,
    mount() {
      state.saved = join(mkdtempSync(join(profile, '.local-dst-')), 'installed-package')
      record(state)
      renameSync(installed, state.saved)
      symlinkSync(repo, installed, 'dir')
      return state.saved
    },
    close() {
      if (closed) return
      closed = true
      try { recover(state); record(undefined) }
      finally { closeSync(fd) }
    },
  }
}
