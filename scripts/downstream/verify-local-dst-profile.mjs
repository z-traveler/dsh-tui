/** node --test scripts/downstream/verify-local-dst-profile.mjs
 * Real filesystem/kernel-lock tests; only disposable profiles, no credentials.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireLocalDstProfile } from '../lib/local-dst-profile.mjs'

if (process.argv[2] === 'fixture-child') {
  const [, , , profile, repo, mode] = process.argv
  const lease = acquireLocalDstProfile(profile, repo)
  if (mode === 'mounted') lease.mount()
  let descendant
  if (mode === 'inherited') descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ignore', lease.fd],
  })
  process.stdout.write(JSON.stringify({ descendant: descendant?.pid }) + '\n')
  setInterval(() => {}, 1000) // fixture owns the lease until explicitly killed
} else {
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'dst-lease-test-'))
    const profile = join(root, 'profile'), repo = join(root, 'repo')
    const installed = join(profile, 'node_modules/@deepseek-harness-tui/dsh-tui')
    mkdirSync(installed, { recursive: true }); mkdirSync(repo)
    writeFileSync(join(installed, 'identity'), 'CI package')
    return { root, profile, repo, installed, lock: join(profile, '.local-dst.lock') }
  }
  const original = f => assert.equal(readFileSync(join(f.installed, 'identity'), 'utf8'), 'CI package')
  const start = async (f, mode) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'fixture-child', f.profile, f.repo, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
    const data = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => reject(new Error(`Fixture exited before acquiring its lease (${code})`)))
      child.stdout.once('data', resolve)
    })
    return { child, ...JSON.parse(String(data)) }
  }
  const stop = async (child, signal = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit'); child.kill(signal); await exited
  }
  test('normal mount/exit restores the exact original and allows another launch', () => {
    const f = fixture()
    try {
      const lease = acquireLocalDstProfile(f.profile, f.repo)
      lease.mount(); assert.equal(realpathSync(f.installed), f.repo)
      lease.close(); original(f)
      assert.equal(readFileSync(f.lock, 'utf8'), '')
      acquireLocalDstProfile(f.profile, f.repo).close(); original(f)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  })
  test('the reported legacy compile-phase orphan lock is recovered', () => {
    const f = fixture()
    try {
      const dead = spawnSync(process.execPath, ['-e', ''])
      writeFileSync(f.lock, JSON.stringify({ pid: dead.pid, repo: f.repo, installed: f.installed }))
      acquireLocalDstProfile(f.profile, f.repo).close(); original(f)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  })
  for (const mode of ['compile', 'mounted']) test(`SIGKILL during ${mode} cannot strand the next launch`, async () => {
    const f = fixture(); let child
    try {
      ;({ child } = await start(f, mode))
      await stop(child, 'SIGKILL')
      const lease = acquireLocalDstProfile(f.profile, f.repo)
      original(f); lease.mount(); lease.close(); original(f)
    } finally {
      if (child) await stop(child)
      rmSync(f.root, { recursive: true, force: true })
    }
  })
  test('an active lease blocks a second launch without touching the profile', async () => {
    const f = fixture(); let child
    try {
      ;({ child } = await start(f, 'compile'))
      assert.throws(() => acquireLocalDstProfile(f.profile, f.repo), /Another local acceptance/)
      original(f)
    } finally {
      if (child) await stop(child)
      rmSync(f.root, { recursive: true, force: true })
    }
  })
  test('a compiler/launcher child retains the lease if its wrapper dies', async () => {
    const f = fixture(); let child, descendant
    try {
      ;({ child, descendant } = await start(f, 'inherited'))
      await stop(child, 'SIGKILL')
      assert.throws(() => acquireLocalDstProfile(f.profile, f.repo), /Another local acceptance/)
      process.kill(descendant, 'SIGTERM'); descendant = undefined
      let lease
      const deadline = Date.now() + 3000
      while (!lease) {
        try { lease = acquireLocalDstProfile(f.profile, f.repo) }
        catch (error) {
          if (!/Another local acceptance/.test(error.message) || Date.now() > deadline) throw error
          await delay(20) // wait for the killed fixture child to release its descriptor
        }
      }
      lease.close(); original(f)
    } finally {
      if (descendant) { try { process.kill(descendant, 'SIGTERM') } catch {} }
      if (child) await stop(child)
      rmSync(f.root, { recursive: true, force: true })
    }
  })
  test('external package changes preserve both that package and the CI backup', async () => {
    const f = fixture(); let child
    try {
      ;({ child } = await start(f, 'mounted'))
      await stop(child, 'SIGKILL')
      const saved = JSON.parse(readFileSync(f.lock, 'utf8')).saved
      unlinkSync(f.installed); mkdirSync(f.installed)
      writeFileSync(join(f.installed, 'identity'), 'external change')
      assert.throws(() => acquireLocalDstProfile(f.profile, f.repo), /changed externally/)
      assert.equal(readFileSync(join(f.installed, 'identity'), 'utf8'), 'external change')
      assert.equal(readFileSync(join(saved, 'identity'), 'utf8'), 'CI package')
    } finally {
      if (child) await stop(child)
      rmSync(f.root, { recursive: true, force: true })
    }
  })
}
