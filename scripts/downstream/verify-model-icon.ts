/** Focused regression for the powerline model icon selector.
 * No provider calls, terminal or user state: pure config/selector seams.
 * node --import tsx/esm scripts/downstream/verify-model-icon.ts */
import assert from 'node:assert/strict'
import { normalizePowerlineOptions } from '../../src/powerline/config.js'
import { formatModelIconPrefix, selectModelIcon } from '../../src/powerline/modelIcon.js'
import { stringWidth } from '../../src/ink/stringWidth.js'

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

check('the raw selector stays unnormalized: the prefix formatter owns the slot', () => {
  assert.equal(selectModelIcon('claude-sonnet', rules([{ pattern: 'claude', icon: '✳' }])), '✳')
})

check('the prefix is the glyph plus one gap, and the default fallback is unchanged', () => {
  assert.equal(formatModelIconPrefix('deepseek-chat', options(undefined)), `${FALLBACK} `)
  assert.equal(stringWidth(formatModelIconPrefix('deepseek-chat', options(undefined))), 2)
})

check('prefix modes bypass the slot: none is empty, ascii is the word plus one gap', () => {
  const modelIcons = [{ pattern: 'deepseek', icon: '界' }]
  assert.equal(formatModelIconPrefix('deepseek-chat', options({ icons: 'none', modelIcons })), '')
  assert.equal(formatModelIconPrefix('deepseek-chat', options({ icons: 'ascii', modelIcons })), 'model ')
  assert.equal(formatModelIconPrefix('deepseek-chat', options({ icons: 'ascii' })), 'model ')
})

check('a bare text-default emoji symbol gains VS16 so its width is font-independent', () => {
  const claude = rules([{ pattern: 'claude', icon: '✳' }])
  assert.equal(formatModelIconPrefix('claude-sonnet', claude), '✳\ufe0f ')
  assert.equal(stringWidth(formatModelIconPrefix('claude-sonnet', claude)), 3)
})

check('explicit selectors, default-emoji and multi-codepoint glyphs are left alone', () => {
  const prefix = (icon: string) => formatModelIconPrefix('m', rules([{ pattern: 'm', icon }]))
  assert.equal(prefix('✳\ufe0f'), '✳\ufe0f ')
  assert.equal(prefix('✳\ufe0e'), '✳\ufe0e ')
  assert.equal(prefix('🐋'), '🐋 ')
  assert.equal(prefix('界界'), '界界 ')
})

check('keycap ASCII bases are not converted into emoji sequences', () => {
  assert.equal(formatModelIconPrefix('m', rules([{ pattern: 'm', icon: '1' }])), '1 ')
  assert.equal(formatModelIconPrefix('m', rules([{ pattern: 'm', icon: '#' }])), '# ')
})

check('each icon has exactly one gap without padding for other rules', () => {
  const shared = rules([{ pattern: 'claude', icon: '✳' }, { pattern: 'gpt', icon: 'G' }])
  assert.equal(formatModelIconPrefix('claude-sonnet', shared), '✳\ufe0f ')
  assert.equal(formatModelIconPrefix('gpt-5', shared), 'G ')
  assert.equal(formatModelIconPrefix('llama-4', shared), `${FALLBACK} `)
})

check('a configured wide glyph never widens other model prefixes', () => {
  const wide = rules([{ pattern: 'gpt', icon: '界界' }])
  assert.equal(formatModelIconPrefix('gpt-5', wide), '界界 ')
  assert.equal(formatModelIconPrefix('llama-4', wide), `${FALLBACK} `)
  assert.equal(stringWidth(formatModelIconPrefix('gpt-5', wide)), 5)
  assert.equal(stringWidth(formatModelIconPrefix('llama-4', wide)), 2)
})

check('demo icons retain their own width and exactly one separating space', () => {
  const demo = rules([{ pattern: '^deepseek', icon: '◆' }, { pattern: '^gpt', icon: '◉' }, { pattern: '^claude', icon: '✳' }])
  assert.equal(formatModelIconPrefix('deepseek-flash', demo), '◆ ')
  assert.equal(formatModelIconPrefix('gpt-5', demo), '◉ ')
  assert.equal(formatModelIconPrefix('claude-sonnet-4-5', demo), '✳\ufe0f ')
  assert.equal(formatModelIconPrefix('unknown', demo), `${FALLBACK} `)
  assert.deepEqual(['deepseek-flash', 'gpt-5', 'claude-sonnet-4-5', 'unknown'].map(model => stringWidth(formatModelIconPrefix(model, demo))), [2, 2, 3, 2])
})

console.log(`${checks} checks passed`)
