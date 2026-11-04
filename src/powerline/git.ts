/**
 * Read-only git status for the powerline git segment.
 *
 * `git status` is the only cheap source that reports staged, unstaged and
 * untracked work in one call, so the counts come from git instead of being
 * re-derived from the index or from file system scans. `--no-optional-locks`
 * keeps the call read-only: without it git rewrites `.git/index` stat data as
 * a cache.
 *
 * This module owns no timer. The caller asks for current figures from whatever
 * refresh loop it already has; here the concurrent and repeated calls that loop
 * produces collapse into one child process per cwd per second.
 */
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

/** Counts are per path -- a rename is one entry, not one count per hunk. */
export interface PowerlineGitStatus {
  /** Checked-out branch. Empty on a detached HEAD: git names no branch there,
   *  and a short SHA would invent one the segment cannot report as a branch. */
  branch: string
  staged: number
  unstaged: number
  untracked: number
}

const STATUS_ARGS = ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--branch']
const CACHE_TTL_MS = 1_000
const CACHE_LIMIT = 32
const EXEC_TIMEOUT_MS = 3_000
/** Status output grows with the number of changed paths, not with the diff. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

interface CacheEntry {
  expiresAt: number
  read: Promise<PowerlineGitStatus | undefined>
}

/** Least-recently-read first, so eviction drops the workspace the user left. */
const cache = new Map<string, CacheEntry>()

export function readPowerlineGit(cwd: string): Promise<PowerlineGitStatus | undefined> {
  // An empty cwd would resolve to this process's own directory, which is not
  // the workspace the segment describes.
  if (cwd === '') return Promise.resolve(undefined)
  const key = resolve(cwd)
  const now = Date.now()
  const cached = cache.get(key)
  if (cached !== undefined && cached.expiresAt > now) return cached.read
  // Delete before insert so a re-read moves the key to the young end.
  cache.delete(key)
  const entry: CacheEntry = { expiresAt: now + CACHE_TTL_MS, read: readStatus(key) }
  cache.set(key, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
  return entry.read
}

async function readStatus(cwd: string): Promise<PowerlineGitStatus | undefined> {
  const stdout = await runStatus(cwd)
  return stdout === undefined ? undefined : parseStatus(stdout)
}

function runStatus(cwd: string): Promise<string | undefined> {
  return new Promise((done) => {
    execFile('git', STATUS_ARGS, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout) => {
      // A missing git binary, a non-repository cwd, an unreadable directory, a
      // timeout or truncated output all read as unknown. The segment shows
      // nothing for them rather than claiming a clean worktree.
      done(error === null ? stdout : undefined)
    })
  })
}

function parseStatus(stdout: string): PowerlineGitStatus | undefined {
  const fields = stdout.split('\0')
  const header = fields[0]
  // `--branch` always leads with `## `; anything else is not the format this
  // parser was written against, so the caller is told nothing.
  if (header === undefined || !header.startsWith('## ')) return undefined
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (let index = 1; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.length < 3) continue
    const x = field[0]
    const y = field[1]
    // `-z` writes a rename/copy pair as `XY <destination>` followed by the
    // source path in its own NUL-separated field: skip it instead of counting
    // one rename twice.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1
    if (x === '?') {
      untracked += 1
      continue
    }
    // `!` needs `--ignored` to appear at all; if it ever does, it is not work.
    if (x === '!') continue
    // An unmerged path sets both sides, and both sides really do need
    // attention, so it counts in both columns.
    if (x !== ' ') staged += 1
    if (y !== ' ') unstaged += 1
  }
  return { branch: branchFromHeader(header.slice(3)), staged, unstaged, untracked }
}

/** Prefixes git uses for a branch that has no commit yet. */
const UNBORN_PREFIXES = ['No commits yet on ', 'Initial commit on ']

function branchFromHeader(header: string): string {
  if (header.endsWith('(no branch)')) return ''
  const unborn = UNBORN_PREFIXES.find((prefix) => header.startsWith(prefix))
  const named = unborn === undefined ? header : header.slice(unborn.length)
  // An upstream is appended as `branch...upstream [ahead 1]`. A ref cannot
  // contain `..`, so the separator cannot occur inside the branch name.
  const upstream = named.indexOf('...')
  return upstream === -1 ? named : named.slice(0, upstream)
}
