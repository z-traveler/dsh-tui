/** Fast model-tail presentation; no credentials or provider calls.
 * Run: node --import tsx/esm scripts/downstream/verify-fast-mode.tsx */
import '../lib/default-lang-zh.mjs'
import assert from 'node:assert/strict'
import type { ChannelUi } from '../../src/adapter/channel/ui-policy.js'
import { buildPowerlineFields, nodeText } from '../../src/powerline/fields.js'
import { normalizePowerlineOptions } from '../../src/powerline/config.js'

const channel = {
  provider: 'offline', model: 'gpt-fixture', sessionRef: { backendId: 'dsh', sessionId: 'one' },
  statusBar: { model: true, thinking: false, contextUsage: false, cost: false, cwd: false, gitBranch: false },
  fastMode: { enabled: true, applicable: true, provider: 'offline', model: 'gpt-fixture' },
}
const options = normalizePowerlineOptions({ icons: 'none', marker: '' })
function model() {
  return buildPowerlineFields(channel as ChannelUi, options, undefined, undefined, undefined, null).find(field => field.key === 'model')!
}
assert.equal(model().text, 'gpt-fixture ⚡︎')
assert.equal(nodeText(model().node), 'gpt-fixture ⚡︎')
channel.fastMode.applicable = false
assert.equal(model().text, 'gpt-fixture')
channel.fastMode.applicable = true
channel.fastMode.model = 'background-model'
assert.equal(model().text, 'gpt-fixture')
channel.fastMode.model = channel.model
channel.fastMode.enabled = false
assert.equal(model().text, 'gpt-fixture')
console.log('PASS: Fast marker follows only the applicable current route')
