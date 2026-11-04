/** Subscription presentation contract, using backend view data only.
 * node --import tsx/esm scripts/downstream/verify-subscription-display.ts */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { formatPowerlineQuota } from '../../src/powerline/quota.js'

process.env.DSH_TUI_LANG = 'en'
const now = 1_800_000_000_000
const hour = 3_600_000, day = 24 * hour
let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }
const window = (name: string, utilization: number, resetsAt?: number) => ({ name, utilization, resetsAt })
const render = (backendId: string, windows: ReturnType<typeof window>[]) => formatPowerlineQuota({ windows }, backendId, now)

check('Codex shows only its weekly remaining allowance and a compact reset', () => {
  const result = render('codex', [window('five_hour', .2, now + 2 * hour), window('seven_day', .2, now + 6 * day)])!
  assert.equal(result.text, 'week:80% (6d)')
  assert.equal(result.parts.length, 1)
  assert.equal(result.parts[0]!.tone, 'success')
})
check('Claude subscription windows follow five-hour then weekly order', () => {
  assert.equal(render('claude', [window('seven_day', .76, now + 6 * day), window('five_hour', .2, now + 2 * hour)])?.text,
    '5h:80% (2h) week:24% (6d)')
})
check('other backends never show stale subscription windows', () => {
  assert.equal(render('fixture', [window('seven_day', .2, now + day)]), undefined)
  assert.equal(render('dsh', [window('seven_day', .2, now + day)]), undefined)
})
check('missing and unrecognised windows have no placeholder', () => {
  assert.equal(render('codex', []), undefined)
  assert.equal(render('codex', [window('five_hour', .1)]), undefined)
  assert.equal(render('claude', [window('other', .1)]), undefined)
  assert.equal(render('claude', [window('seven_day', .4)])?.text, 'week:60%')
})
check('remaining thresholds match the displayed whole percentage', () => {
  for (const [utilization, text, tone] of [[.9, 'week:10%', 'warning'], [.91, 'week:9%', 'error'], [.75, 'week:25%', 'success'], [.76, 'week:24%', 'warning']] as const) {
    const result = render('codex', [window('seven_day', utilization)])!
    assert.equal(result.text, text)
    assert.equal(result.parts[0]!.tone, tone)
  }
})
check('remaining display rounds the remaining value rather than rounded usage', () => {
  const result = render('codex', [window('seven_day', .625)])!
  assert.equal(result.text, 'week:38%')
  assert.ok(result.detail.includes('37.5% remaining (62.5% used)'))
})
check('reset rounds up by minute, hour or day and uses now below a minute', () => {
  for (const [delta, reset] of [[45_000, 'now'], [20 * 60_000, '20m'], [5 * hour, '5h'], [6 * day, '6d'], [hour + 1000, '2h'], [day + 1000, '2d']] as const) {
    assert.equal(render('codex', [window('seven_day', .2, now + delta)])?.text, `week:80% (${reset})`)
  }
})
check('expired resets never refill the backend-reported remaining quota', () => {
  assert.equal(render('codex', [window('seven_day', .91, now - 1000)])?.text, 'week:9% (now)')
})
console.log(`${checks} checks passed`)
