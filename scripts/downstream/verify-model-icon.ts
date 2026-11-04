/** Focused regression for the powerline model icon selector.
 * No provider calls, terminal or user state: pure config/selector seams.
 * node --import tsx/esm scripts/downstream/verify-model-icon.ts */
import assert from 'node:assert/strict'
import { normalizePowerlineOptions } from '../../src/powerline/config.js'
import { selectModelIcon } from '../../src/powerline/modelIcon.js'

let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }

const FALLBACK = '\uec19'
const options = (overrides: Parameters<typeof normalizePowerlineOptions>[0]) => normalizePowerlineOptions(overrides)
const rules = (modelIcons: { pattern: string; icon: string }[]) => options({ modelIcons })

check('without rules every model falls back to the generic icon', () => {
  assert.equal(selectModelIcon('deepseek-chat', options(undefined)), FALLBACK)
  assert.equal(selectModelIcon('unknown-model', options(undefined)), FALLBACK)
  assert.deepEqual(options(undefined).modelIcons, [])
})

check('icon mode none and ascii override the configured rules', () => {
  const modelIcons = [{ pattern: 'deepseek', icon: 'D' }]
  assert.equal(selectModelIcon('deepseek-chat', options({ icons: 'none', modelIcons })), '')
  assert.equal(selectModelIcon('deepseek-chat', options({ icons: 'ascii', modelIcons })), 'model')
  assert.equal(selectModelIcon('deepseek-chat', options({ icons: 'ascii' })), 'model')
})

check('the first matching rule in configured order wins', () => {
  const model = 'claude-sonnet-4-5-20250929'
  assert.equal(selectModelIcon(model, rules([
    { pattern: 'claude', icon: 'C' },
    { pattern: 'sonnet', icon: 'S' },
  ])), 'C')
  assert.equal(selectModelIcon(model, rules([
    { pattern: 'sonnet', icon: 'S' },
    { pattern: 'claude', icon: 'C' },
  ])), 'S')
})

check('rules match the raw model id case-insensitively as regular expressions', () => {
  assert.equal(selectModelIcon('deepseek-v3.2', rules([{ pattern: 'DEEPSEEK', icon: 'D' }])), 'D')
  assert.equal(selectModelIcon('GPT-5', rules([{ pattern: '^gpt-5$', icon: 'G' }])), 'G')
  assert.equal(selectModelIcon('gpt-5-mini', rules([{ pattern: '^gpt-5$', icon: 'G' }])), FALLBACK)
})

check('a non-matching model id keeps the fallback instead of an empty field', () => {
  assert.equal(selectModelIcon('llama-4', rules([{ pattern: 'gpt', icon: 'G' }])), FALLBACK)
})

check('unsafe or malformed rules are skipped rather than rendered', () => {
  const skipped = normalizePowerlineOptions({
    modelIcons: [
      { pattern: '[', icon: 'X' },
      { pattern: 'deepseek', icon: '' },
      { pattern: 'deepseek', icon: '\u001b[31m' },
      { pattern: 'deepseek', icon: 'x\ny' },
      { pattern: 'deepseek', icon: 'x'.repeat(9) },
      { pattern: 'deepseek', icon: '界界界界界' },
    ],
  })
  assert.deepEqual(skipped.modelIcons, [])
  assert.equal(selectModelIcon('deepseek-chat', skipped), FALLBACK)
})

check('a valid CJK glyph is returned as configured, without a trailing space', () => {
  const icon = selectModelIcon('deepseek-chat', rules([{ pattern: 'deepseek', icon: '界界界' }]))
  assert.equal(icon, '界界界')
  assert.equal(selectModelIcon('deepseek-chat', rules([{ pattern: 'deepseek', icon: 'D' }])), 'D')
  assert.equal(selectModelIcon('deepseek-chat', options({ icons: 'ascii' })), 'model')
})

console.log(`${checks} checks passed`)
