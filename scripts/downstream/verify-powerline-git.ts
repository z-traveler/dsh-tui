/** Focused downstream regression for the powerline git status reader. Builds
 * real repositories under one temporary root and reads them through the public
 * API; the repository running this script is not touched. No provider calls.
 * node --import tsx/esm scripts/downstream/verify-powerline-git.ts */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { readPowerlineGit } from '../../src/powerline/git.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-powerline-git-'))
// Every fixture runs against an empty git configuration and a data boundary at
// the temporary root: the runner's own identity and any parent repository must
// not leak into counts or into the "not a repository" case.
process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_TERMINAL_PROMPT = '0'
process.env.GIT_CEILING_DIRECTORIES = root
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Fixture'
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid'
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) delete process.env[name]

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile('git', args, { cwd, timeout: 20_000 }, (error, stdout) => {
      if (error === null) return done(stdout)
      fail(new Error(`git ${args.join(' ')} failed in ${cwd}: ${error.message}`))
    })
  })
}

let checks = 0
async function check(label: string, run: () => Promise<void>): Promise<void> {
  await run()
  console.log(`PASS ${++checks}: ${label}`)
}

async function initRepo(name: string, branch = 'main'): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await git(root, 'init', '-q', '-b', branch, name)
  return dir
}

/** Commit the given paths, leaving the worktree clean. */
async function commitFiles(dir: string, files: Record<string, string>, message = 'fixture'): Promise<void> {
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text)
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-qm', message)
}

/** Everything a read must not change, plus the file list of the worktree. */
async function signature(dir: string) {
  const index = await stat(join(dir, '.git/index'))
  return {
    head: await readFile(join(dir, '.git/HEAD'), 'utf8'),
    status: await git(dir, '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--branch'),
    indexMtimeMs: index.mtimeMs,
    indexSize: index.size,
    entries: (await readdir(dir)).sort(),
  }
}

try {
  await check('a clean repository reports its branch and zero counts', async () => {
    const dir = await initRepo('clean')
    await commitFiles(dir, { 'a.txt': 'one\n', 'b.txt': 'two\n' })
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 0, unstaged: 0, untracked: 0 })
  })

  await check('staged, unstaged and untracked work are counted separately', async () => {
    const dir = await initRepo('mixed')
    await commitFiles(dir, { 'tracked.txt': 'one\n', 'edited.txt': 'one\n' })
    // Staged: one modification plus one addition.
    await writeFile(join(dir, 'tracked.txt'), 'changed\n')
    await writeFile(join(dir, 'added.txt'), 'new\n')
    await git(dir, 'add', 'tracked.txt', 'added.txt')
    // Unstaged: a tracked file modified without staging.
    await writeFile(join(dir, 'edited.txt'), 'changed\n')
    // Untracked: files git knows nothing about, including one in a new
    // directory -- `git status` collapses that directory into one entry, which
    // is the count a user sees, not one entry per contained file.
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    await mkdir(join(dir, 'nested'))
    await writeFile(join(dir, 'nested', 'deep.txt'), 'x\n')
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 2, unstaged: 1, untracked: 2 })
  })

  await check('a rename is one path, parsed through its -z source field', async () => {
    const dir = await initRepo('renames')
    await commitFiles(dir, { 'a.txt': 'one\n', 'b.txt': 'two\n', 'c.txt': 'three\n', 'd.txt': 'four\n' })
    // Rename detection keeps the source path in a second NUL-separated field;
    // names with spaces, a newline and CJK are passed through unquoted in -z.
    await git(dir, 'mv', 'a.txt', 'new name.txt')
    await git(dir, 'mv', 'b.txt', 'line\nbreak.txt')
    await git(dir, 'mv', 'c.txt', '中文.txt')
    // Entries after the renames still have to parse: unstaged edit + untracked.
    await writeFile(join(dir, 'd.txt'), 'changed\n')
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 3, unstaged: 1, untracked: 1 })
  })

  await check('a detached HEAD keeps the counts and invents no branch', async () => {
    const dir = await initRepo('detached')
    await commitFiles(dir, { 'a.txt': 'one\n' })
    await git(dir, 'checkout', '-q', '--detach')
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    assert.deepEqual(await readPowerlineGit(dir), { branch: '', staged: 0, unstaged: 0, untracked: 1 })
  })

  await check('an unborn branch keeps the name git reports', async () => {
    const dir = await initRepo('unborn', 'trunk')
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'trunk', staged: 0, unstaged: 0, untracked: 0 })
  })

  await check('an upstream suffix is not part of the branch name', async () => {
    const dir = await initRepo('upstream')
    await commitFiles(dir, { 'a.txt': 'one\n' })
    await git(root, 'init', '-q', '--bare', 'upstream.git')
    await git(dir, 'remote', 'add', 'origin', '../upstream.git')
    await git(dir, 'push', '-q', '-u', 'origin', 'main')
    await writeFile(join(dir, 'a.txt'), 'two\n')
    await git(dir, 'commit', '-qam', 'second')
    assert.match(await git(dir, 'status', '--porcelain=v1', '--branch'), /^## main\.\.\.origin\/main \[ahead 1\]/)
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 0, unstaged: 0, untracked: 0 })
  })

  await check('a directory outside any repository reads as unknown', async () => {
    const dir = join(root, 'plain')
    await mkdir(dir)
    assert.equal(await readPowerlineGit(dir), undefined)
  })

  await check('a path that does not exist reads as unknown', async () => {
    assert.equal(await readPowerlineGit(join(root, 'missing', 'deeper')), undefined)
    assert.equal(await readPowerlineGit(''), undefined)
  })

  await check('reading leaves the repository byte-for-byte unchanged', async () => {
    const dir = await initRepo('readonly')
    await commitFiles(dir, { 'a.txt': 'one\n', 'b.txt': 'two\n' })
    await writeFile(join(dir, 'b.txt'), 'changed\n')
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    const before = await signature(dir)
    // First read runs git, second one is served from the cache: neither may
    // take a lock, refresh `.git/index` or create a file.
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 0, unstaged: 1, untracked: 1 })
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 0, unstaged: 1, untracked: 1 })
    await sleep(1_050)
    assert.deepEqual(await readPowerlineGit(dir), { branch: 'main', staged: 0, unstaged: 1, untracked: 1 })
    assert.deepEqual(await signature(dir), before)
  })

  await check('concurrent reads of one cwd share a single result', async () => {
    const dir = await initRepo('shared')
    await commitFiles(dir, { 'a.txt': 'one\n' })
    const [first, second, third] = await Promise.all([readPowerlineGit(dir), readPowerlineGit(dir), readPowerlineGit(dir)])
    assert.equal(second, first)
    assert.equal(third, first)
    assert.deepEqual(first, { branch: 'main', staged: 0, unstaged: 0, untracked: 0 })
  })

  await check('a cached read is reused for one second, then refreshed', async () => {
    const dir = await initRepo('ttl')
    await commitFiles(dir, { 'a.txt': 'one\n' })
    const first = await readPowerlineGit(dir)
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    const cached = await readPowerlineGit(dir)
    assert.equal(cached, first)
    assert.deepEqual(cached, { branch: 'main', staged: 0, unstaged: 0, untracked: 0 })
    await sleep(1_050)
    const refreshed = await readPowerlineGit(dir)
    assert.notEqual(refreshed, first)
    assert.deepEqual(refreshed, { branch: 'main', staged: 0, unstaged: 0, untracked: 1 })
  })

  await check('the cache holds a bounded number of cwds', async () => {
    // 33 unborn repositories: one `git init` each, and every read yields a
    // fresh object, so identity is the observable proof of a cache hit.
    const dirs = await Promise.all(Array.from({ length: 33 }, (_, index) => initRepo(`bound-${index}`)))
    const firstReads = []
    for (const dir of dirs) firstReads.push(await readPowerlineGit(dir))
    const oldest = await readPowerlineGit(dirs[0]!)
    const newest = await readPowerlineGit(dirs[32]!)
    assert.deepEqual(oldest, firstReads[0])
    // The newest entry is still cached, so the bound did not grow past 33...
    assert.equal(newest, firstReads[32])
    // ...while the first one was evicted, so it cannot accumulate without limit.
    assert.notEqual(oldest, firstReads[0])
  })

  await check('untracked counts do not silently become clean under user git config', async () => {
    const dir = await initRepo('hidden-untracked')
    await git(dir, 'config', 'status.showUntrackedFiles', 'no')
    await writeFile(join(dir, 'loose.txt'), 'x\n')
    assert.equal((await readPowerlineGit(dir))?.untracked, 1)
  })

  if (process.platform !== 'win32') await check('a slow in-flight read stays shared beyond the result cache TTL', async () => {
    const bin = join(root, 'slow-bin'), cwd = join(root, 'slow-cwd')
    await mkdir(bin); await mkdir(cwd)
    const shim = join(bin, 'git')
    await writeFile(shim, `#!${process.execPath}\nsetTimeout(() => process.stdout.write('## main\\0'), 1300)\n`)
    await chmod(shim, 0o755)
    const oldPath = process.env.PATH
    try {
      process.env.PATH = `${bin}:${oldPath}`
      const first = readPowerlineGit(cwd)
      await sleep(1050)
      const second = readPowerlineGit(cwd)
      await Promise.all([first, second])
      assert.equal(first, second)
    } finally { process.env.PATH = oldPath }
  })

  await check('the module schedules no timer of its own', async () => {
    // The caller owns the refresh cadence; a timer here would keep a workspace
    // alive behind the channel's back.
    const source = await readFile(new URL('../../src/powerline/git.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\bset(?:Interval|Timeout|Immediate)\s*\(/)
  })

  console.log(`powerline git: ${checks} checks passed`)
} finally {
  await rm(root, { recursive: true, force: true })
}
