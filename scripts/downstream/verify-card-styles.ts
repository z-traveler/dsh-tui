/** Focused downstream regression for the conversation card styles (ticket 01:
 * the config + resolution contract; the cards themselves land in ticket 02).
 * Pure config/presentation seams plus one real `settings.json` document in a
 * throwaway HOME — no provider calls, no terminal, no user state.
 * node --import tsx/esm scripts/downstream/verify-card-styles.ts */
import '../lib/fake-home.mjs'
import assert from 'node:assert/strict'
import chalk from 'chalk'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fakeHome from '../lib/fake-home.mjs'
import { Config } from '../../src/dsh-adapter/index.js'
import { createTuiSettingsService } from '../../src/dsh-adapter/tui-settings.js'
import { THEME_NAMES, getTheme, isLightThemeActive } from '../../src/theme.js'
import {
  CARD_KINDS,
  CARD_PADDING_X_MAX,
  DEFAULT_CARD_STYLE_CONFIG,
  applyCardStyles,
  cardBackgroundColor,
  cardBackgroundOf,
  cardContentWidth,
  cardStatusOf,
  cardStyleConfigFrom,
  getCardStyleConfig,
  normalizeCardStyleConfig,
  resolveCardStyles,
  subscribeCardStyles,
  type ResolvedCardStyles,
} from '../../src/cardStyles.js'
import { diffBodyAppearance } from '../../src/components/diffAppearance.js'

let checks = 0
function check(label: string, test: () => void) { test(); console.log(`PASS ${++checks}: ${label}`) }

// The pure checks below pin the truecolor tier (the design tier). The render
// regression (`verify-card-rendering.tsx`) measures the 256- and 16-colour
// tiers through real cells; this file pins the resolved colour strings and the
// tier switch itself.
chalk.level = 3

const legacy = (toolBackground: 'none' | 'subtle' | 'strong' = 'none') => resolveCardStyles(DEFAULT_CARD_STYLE_CONFIG, { toolBackground })
const pi = (value: unknown = { preset: 'pi-like' }, toolBackground: 'none' | 'subtle' | 'strong' = 'none') =>
  resolveCardStyles(normalizeCardStyleConfig(value), { toolBackground })

interface Rgb { readonly r: number; readonly g: number; readonly b: number }

/** sRGB channels of a rendered colour; `ansi:` names have no channels to read. */
function channelsOf(color: string | undefined): Rgb | undefined {
  const rgb = /^rgb\((\d+),(\d+),(\d+)\)$/u.exec(color ?? '')
  if (rgb !== null) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  const hex = /^#([0-9a-f]{6})$/iu.exec(color ?? '')
  if (hex === null) return undefined
  const value = Number.parseInt(hex[1]!, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

function channelDistance(from: Rgb, to: Rgb): number {
  return Math.hypot(from.r - to.r, from.g - to.g, from.b - to.b)
}

/** xterm 256-colour cube slot (16–231) as RGB; the line tints name those slots
 *  at the 256-colour tier, so their contrast has to be measured on the real
 *  cube value, not on the unquantized mix. */
function ansi256Channels(color: string | undefined): Rgb | undefined {
  const index = Number(/^ansi256\((\d+)\)$/u.exec(color ?? '')?.[1])
  if (!Number.isInteger(index) || index < 16 || index > 231) return undefined
  const levels = [0, 95, 135, 175, 215, 255] as const
  const cube = index - 16
  return { r: levels[Math.floor(cube / 36) % 6]!, g: levels[Math.floor(cube / 6) % 6]!, b: levels[cube % 6]! }
}

/** Rec. 601 luma: the axis the terminal's 232–255 grey ramp runs along, and the
 *  weighting `ThemeProvider` uses for the background it hands out. */
function luma(color: Rgb): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

/** WCAG contrast ratio between two sRGB colours. */
function contrastOf(from: Rgb, to: Rgb): number {
  const first = relativeLuminance(from)
  const second = relativeLuminance(to)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** WCAG relative luminance — the body-text contrast every state face has to keep. */
function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * The terminal backgrounds the default user face has to follow. OSC 11 answers
 * with whatever the terminal shows, not necessarily pure black or white: a
 * tinted dark background (the common #1e1e2e family), a warm off-white, and the
 * black/white fallbacks ThemeProvider uses when no answer arrives.
 */
const TERMINAL_BACKGROUNDS = [
  ['dark', '#000000'],
  ['dark', '#1e1e2e'],
  ['claude-dark', '#101418'],
  ['light', '#ffffff'],
  ['light', '#f6f0e8'],
  ['codex-paper', '#fdfcf9'],
] as const

check('the default config is legacy with no fill, border, padding or gap', () => {
  const styles = legacy()
  assert.equal(styles.preset, 'legacy')
  for (const kind of CARD_KINDS) {
    const style = styles.kinds[kind]
    assert.equal(style.background, undefined, `${kind} keeps no fill`)
    assert.equal(style.border, undefined, `${kind} keeps no border`)
    assert.equal(style.paddingX, 0, `${kind} keeps no horizontal padding`)
    assert.equal(style.paddingY, 0, `${kind} keeps no vertical padding`)
    assert.equal(style.gap, 0, `${kind} keeps no extra gap`)
    assert.equal(style.minimumGap, 0, `${kind} keeps no breathing gap`)
  }
})

check('legacy keeps toolBackground for the tool card and for no other kind', () => {
  assert.deepEqual(legacy('subtle').kinds.tool.background, { fill: 'toolCardBackgroundDim' })
  assert.deepEqual(legacy('strong').kinds.tool.background, { fill: 'toolCardBackground' })
  assert.equal(legacy('none').kinds.tool.background, undefined)
  for (const toolBackground of ['none', 'subtle', 'strong'] as const) {
    const styles = legacy(toolBackground)
    assert.equal(styles.kinds.tool.states, undefined, 'legacy adds no execution-state fills')
    for (const kind of CARD_KINDS) {
      if (kind === 'tool') continue
      assert.equal(styles.kinds[kind].background, undefined, `${kind} stays unfilled under ${toolBackground}`)
    }
  }
})

check('user foreground and weight inherit overrides without changing legacy defaults', () => {
  assert.equal(pi().kinds.user.bold, false)
  assert.equal(legacy().kinds.user.bold, true)
  const config = normalizeCardStyleConfig({ preset: 'pi-like', common: { foreground: 'error', bold: true }, kinds: { user: { foreground: 'success', bold: false } } })
  const style = pi(config).kinds.user
  assert.equal(style.foreground, 'success')
  assert.equal(style.bold, false)
  const common = pi(normalizeCardStyleConfig({ preset: 'pi-like', common: { foreground: '#abcdef', bold: true } })).kinds.user
  assert.equal(common.foreground, '#abcdef')
  assert.equal(common.bold, true)
  const bad = pi(normalizeCardStyleConfig({ preset: 'pi-like', kinds: { user: { foreground: 'not-a-color', bold: 'yes' } } })).kinds.user
  assert.equal(bad.foreground, undefined)
  assert.equal(bad.bold, false)
})

check('the default user face is distinct but subdued over the real terminal background', () => {
  // The old default was the hover/expand highlight — a saturated block (dark's
  // `rgb(59,91,219)`), i.e. an interaction cue, not a near-transparent face.
  const face = pi().kinds.user.background
  assert.deepEqual(face, { fill: 'text', presetUser: true }, 'the preset user face, not the hover highlight')
  assert.notDeepEqual(face, { fill: 'userMessageBackgroundHover' }, 'the hover token no longer supplies the card face')
  // A user override is not a preset face: it carries no marker and paints as given.
  const custom = pi({ preset: 'pi-like', kinds: { user: { background: '#123456' } } })
  assert.deepEqual(custom.kinds.user.background, { fill: '#123456' })
  assert.equal(legacy().kinds.user.background, undefined, 'legacy keeps no user fill at all')

  for (const [name, terminal] of TERMINAL_BACKGROUNDS) {
    const theme = getTheme(name)
    const color = cardBackgroundColor(face, theme, name, terminal)
    const got = channelsOf(color)
    const base = channelsOf(terminal)
    const text = channelsOf(theme.text)
    assert.ok(got !== undefined && base !== undefined && text !== undefined, `${name}/${terminal}: a real RGB mix (${color})`)
    const drift = channelDistance(got, base)
    assert.ok(drift >= 18, `${name}/${terminal}: user messages have a visible substrate (${drift.toFixed(1)} away)`)
    assert.ok(drift <= 64, `${name}/${terminal}: the substrate stays subdued (${drift.toFixed(1)})`)
    assert.ok(contrastOf(got, text) >= 4.5, `${name}/${terminal}: body text stays readable on it (${contrastOf(got, text).toFixed(1)}:1)`)
    // The pale light-theme highlights are near-white themselves, so this bound
    // only pins "clearly not the highlight surface"; the shape assertions above
    // and the resolved-colour mix are what keep the token out.
    for (const token of ['userMessageBackgroundHover', 'messageActionsBackground', 'selectionBg'] as const) {
      const highlight = channelsOf(cardBackgroundColor({ fill: token }, theme, name, terminal))
      if (highlight === undefined) continue
      assert.ok(channelDistance(got, highlight) >= 8, `${name}/${terminal}: the face does not borrow ${token}`)
    }
  }
  // Without a reported terminal background the face falls back to the same
  // black/white ThemeProvider uses, so it never paints a slab of the wrong polarity.
  assert.equal(cardBackgroundColor(face, getTheme('dark'), 'dark'), cardBackgroundColor(face, getTheme('dark'), 'dark', '#000000'))
  assert.equal(cardBackgroundColor(face, getTheme('light'), 'light'), cardBackgroundColor(face, getTheme('light'), 'light', '#ffffff'))
})

check('notice has its own neutral face and one-cell rail, with explicit overrides preserved', () => {
  const style = pi().kinds.notice
  assert.equal(cardContentWidth(80, style), 79)
  assert.equal(cardBackgroundColor(style.background, getTheme('dark'), 'dark'), '#19151f')
  assert.equal(cardBackgroundColor(style.background, getTheme('light'), 'light'), '#f3eef7')
  assert.equal(style.states, undefined, 'notice text does not infer an execution state')
  const custom = pi(normalizeCardStyleConfig({ preset: 'pi-like', kinds: { notice: { background: '#123456', border: 'round', borderColor: 'error' } } })).kinds.notice
  assert.deepEqual(custom.background, { fill: '#123456' })
  assert.deepEqual(custom.border, { style: 'round', color: 'error' })
  const off = pi(normalizeCardStyleConfig({ preset: 'pi-like', kinds: { notice: { background: 'none', border: 'none' } } })).kinds.notice
  assert.equal(off.background, undefined)
  assert.equal(off.border, undefined)
})

check('pi-like distinguishes custom messages from tool and reading surfaces', () => {
  const styles = pi()
  for (const kind of CARD_KINDS) {
    assert.equal(styles.kinds[kind].paddingX, kind === 'custom' ? 1 : 0, `${kind} takes its own message padding`)
    assert.equal(styles.kinds[kind].paddingY, kind === 'custom' ? 1 : 0, `${kind} takes its own vertical padding`)
    assert.equal(styles.kinds[kind].minimumGap, kind === 'job' ? 0 : 1, `${kind} gets its preset breathing rows`)
    if (kind === 'notice') assert.deepEqual(styles.kinds[kind].border, { style: 'single', color: 'merged', leftOnly: true })
    else assert.equal(styles.kinds[kind].border, undefined, `${kind} has no border under pi-like`)
  }
  assert.deepEqual(styles.kinds.user.background, { fill: 'text', presetUser: true })
  for (const kind of ['tool', 'subagent'] as const) {
    assert.deepEqual(styles.kinds[kind].background, { fill: 'toolCardBackgroundDim', presetFace: true }, `${kind} takes the block face`)
  }
  // Job cards default to no surface at all — ordinary and execution states alike;
  // the original glyph/label stays and a user override can still paint one.
  assert.equal(styles.kinds.job.background, undefined, 'job is transparent by default')
  assert.equal(styles.kinds.job.states, undefined, 'job has no preset execution faces')
  for (const kind of ['assistant', 'thinking', 'summary', 'other'] as const) {
    assert.equal(styles.kinds[kind].background, undefined, `${kind} stays unfilled`)
  }
  assert.deepEqual(styles.kinds.custom.background, { fill: 'customMessageBackground', presetFace: true })
})

check('pi-like owns the legacy tool background for the tool and subagent states', () => {
  // The `toolBackground` setting must not leak into a pi-like card face.
  for (const toolBackground of ['none', 'subtle', 'strong'] as const) {
    assert.deepEqual(pi(undefined, toolBackground).kinds.tool.states?.success, { fill: 'bashMessageBackgroundColor', presetState: 'success' })
  }
  const states = pi().kinds.tool.states
  assert.deepEqual(states?.running, { fill: 'bashMessageBackgroundColor', presetState: 'running' })
  assert.deepEqual(states?.success, { fill: 'bashMessageBackgroundColor', presetState: 'success' })
  assert.deepEqual(states?.failure, { fill: 'bashMessageBackgroundColor', presetState: 'failure' })
  assert.deepEqual(pi().kinds.subagent.states, states)
  for (const kind of ['user', 'assistant', 'thinking', 'summary', 'other', 'job'] as const) {
    assert.equal(pi().kinds[kind].states, undefined, `${kind} carries no preset execution state`)
  }
  // Explicit user states still enable them on the transparent job card.
  const jobStates = pi({ preset: 'pi-like', kinds: { job: { states: { running: 'selectionBg' } } } }).kinds.job.states
  assert.deepEqual(jobStates, { running: { fill: 'selectionBg' }, success: undefined, failure: undefined })
})

check('pi-like tells the three execution states apart in every built-in theme', () => {
  const states = pi().kinds.tool.states!
  for (const name of THEME_NAMES) {
    const theme = getTheme(name)
    const painted = (['running', 'success', 'failure'] as const).map(status => cardBackgroundColor(states[status], theme, name))
    for (const [index, color] of painted.entries()) {
      assert.equal(typeof color === 'string' && color !== '', true, `${name} paints the ${index} state`)
    }
    assert.equal(new Set(painted).size, 3, `${name} keeps the three states apart (${painted.join(' / ')})`)
  }
})

check('the default state faces sit close to a dark terminal and keep distinct hues', () => {
  // The design contract: on dark palettes the fixed truecolor table is close to
  // black (running neutral, success a faint grey-green, failure a faint dusty
  // rose) while staying distinguishable; on light palettes running keeps the
  // theme's own neutral surface and success/failure are the pale sage/rose
  // pair. The old 12% theme tint read as grey, and the 256 quantisation of a
  // mid-dark face put a lighter slab over the terminal — so the dark faces are
  // now near the terminal's own black instead of one depth step above it.
  const states = pi().kinds.tool.states!
  const facesOn = (name: (typeof THEME_NAMES)[number]): (Rgb | undefined)[] =>
    (['running', 'success', 'failure'] as const).map(status => channelsOf(cardBackgroundColor(states[status], getTheme(name), name)))
  let measured = 0
  for (const name of THEME_NAMES) {
    const [running, success, failure] = facesOn(name)
    // An `ansi:` palette has no channels for the running surface: it takes the
    // 256 slot below. Success/failure are fixed hex, so they still have channels.
    if (running === undefined || success === undefined || failure === undefined) continue
    measured += 1
    for (const [label, face] of [['success', success], ['failure', failure]] as const) {
      const delta = channelDistance(running, face)
      assert.ok(delta >= 8, `${name}: ${label} still reads as its own surface (${delta.toFixed(1)} away)`)
      assert.ok(delta <= 64, `${name}: ${label} stays a muted face, not a saturated block (${delta.toFixed(1)} away)`)
    }
    // Hue, not just depth: success leans green (g above r), failure leans rose
    // (r above g). This is the assertion the old grey-ramp tier could not meet.
    assert.ok(success.g > success.r && success.g >= success.b, `${name}: success is green-leaning (${success.r},${success.g},${success.b})`)
    assert.ok(failure.r > failure.g && failure.r > failure.b, `${name}: failure is rose-leaning (${failure.r},${failure.g},${failure.b})`)
    const depths = [running, success, failure].map(relativeLuminance)
    const step = (Math.max(...depths) + 0.05) / (Math.min(...depths) + 0.05)
    assert.ok(step <= 1.6, `${name}: the three surfaces stay within one depth step (${step.toFixed(2)}:1)`)
    if (!isLightThemeActive(name)) {
      // Dark palettes: every face is near-black, and the running face is no
      // longer the theme's #2c3038 message slab.
      assert.ok(Math.max(...depths) <= 0.02, `${name}: the dark faces sit close to black (${depths.map(depth => depth.toFixed(3)).join('/')})`)
      assert.notEqual(cardBackgroundColor(states.running, getTheme(name), name), getTheme(name).bashMessageBackgroundColor,
        `${name}: running does not reuse the theme's message surface`)
    }
  }
  assert.equal(measured, THEME_NAMES.length - 2, 'the two ANSI palettes keep a slot-only running surface')
})

check('the 256-colour state slots carry distinct hues, not adjacent grey steps', () => {
  const states = pi().kinds.tool.states!
  const expected = {
    // 6×6×6 precision allows a dark teal (success 23), a dusty rose (failure
    // 95) and a neutral running slot; light themes use soft sage/rose.
    // Contrast against the tier's default foreground is measured in
    // verify-card-rendering.tsx; here we pin the resolved slots and their hue.
    dark: { running: 'ansi256(236)', success: 'ansi256(23)', failure: 'ansi256(95)' },
    light: { running: 'ansi256(254)', success: 'ansi256(151)', failure: 'ansi256(181)' },
  } as const
  // xterm 256-colour cube channels (16–231): levels [0,95,135,175,215,255].
  const CUBE = [0, 95, 135, 175, 215, 255] as const
  const slotRgb = (face: string): Rgb => {
    const index = Number(/^ansi256\((\d+)\)$/u.exec(face)?.[1])
    assert.ok(Number.isInteger(index) && index >= 16 && index <= 231, `${face} is a 256-colour cube slot (not a grey step)`)
    const cube = index - 16
    return { r: CUBE[Math.floor(cube / 36) % 6]!, g: CUBE[Math.floor(cube / 6) % 6]!, b: CUBE[cube % 6]! }
  }
  const savedLevel = chalk.level
  try {
    chalk.level = 2
    for (const polarity of ['dark', 'light'] as const) {
      const faces = (['running', 'success', 'failure'] as const)
        .map(status => cardBackgroundColor(states[status], getTheme(polarity), polarity))
      assert.deepEqual(faces, (['running', 'success', 'failure'] as const).map(status => expected[polarity][status]))
      assert.equal(new Set(faces).size, 3, `${polarity} keeps the three states apart`)
      const runningIndex = Number(/^ansi256\((\d+)\)$/u.exec(faces[0]!)?.[1])
      assert.ok(runningIndex >= 232 && runningIndex <= 255, `${polarity}: running stays a neutral grey slot (${faces[0]})`)
      const success = slotRgb(faces[1]!)
      const failure = slotRgb(faces[2]!)
      assert.ok(success.g > success.r && success.g >= success.b, `${polarity}: success slot ${faces[1]} is green/teal (${success.r},${success.g},${success.b})`)
      assert.ok(failure.r > failure.g && failure.r >= failure.b, `${polarity}: failure slot ${faces[2]} is rose (${failure.r},${failure.g},${failure.b})`)
    }
  } finally {
    chalk.level = savedLevel
  }
})

check('the 256-colour user face takes the nearest neutral grey step, not a quantized cube block', () => {
  // A near-black mix such as rgb(30,30,34) lands on palette 59 (#5f5f5f) under
  // chalk's 6×6×6 quantization — a light grey slab over a dark terminal. The
  // face therefore names a grey-ramp slot itself (232–255 carry no hue).
  const face = pi().kinds.user.background
  const savedLevel = chalk.level
  try {
    chalk.level = 3
    const truecolor = TERMINAL_BACKGROUNDS.map(([name, terminal]) =>
      [name, terminal, channelsOf(cardBackgroundColor(face, getTheme(name), name, terminal))] as const)
    chalk.level = 2
    for (const [name, terminal, mixed] of truecolor) {
      const color = cardBackgroundColor(face, getTheme(name), name, terminal)
      const index = Number(/^ansi256\((\d+)\)$/u.exec(color ?? '')?.[1])
      assert.ok(Number.isInteger(index) && index >= 232 && index <= 255, `${name}/${terminal}: ${color} is a grey-ramp slot`)
      assert.ok(mixed !== undefined, `${name}/${terminal}: the truecolor mix exists to compare against`)
      // The ramp is 10 apart; both ends clamp (a near-white mix cannot reach
      // #ffffff — 255 is #eeeeee — and a near-black one cannot go below 232).
      const step = 8 + (index - 232) * 10
      const gap = Math.abs(step - luma(mixed))
      assert.ok(gap <= 12, `${name}/${terminal}: ${color} sits on the nearest grey step (${gap.toFixed(1)} off)`)
    }
    // An ANSI-named palette has no channels to blend; its truecolor tier falls
    // back to the 256 slots exactly like the preset state faces do.
    assert.equal(cardBackgroundColor(face, getTheme('dark-ansi'), 'dark-ansi', '#000000'), 'ansi256(232)')
  } finally {
    chalk.level = savedLevel
  }
})

check('a pi-like preset face keeps the diff body on the terminal background and the split line tints under the row highlight', () => {
  const dark = getTheme('dark')
  const surface = { preset: 'pi-like' as const, presetFace: true, terminalBackground: '#000000' as const }
  const active = diffBodyAppearance(surface, dark, { active: true })
  assert.equal(active.background, '#000000')
  assert.equal(active.quietTints, true)
  const contrast = (color: string | undefined, behind: Rgb): number => {
    const channels = channelsOf(color)
    assert.ok(channels !== undefined, `${color} has channels`)
    return contrastOf(channels, behind)
  }
  // Changed rows get their own very faint line substrate: green-leaning add,
  // rose-leaning delete, both near the terminal black and clearly apart.
  assert.notEqual(active.addedLine, undefined, 'add rows get a faint line tint')
  assert.notEqual(active.removedLine, undefined, 'del rows get a faint line tint')
  assert.notEqual(active.addedLine, active.removedLine, 'the two sides are distinguishable')
  const addedLine = channelsOf(active.addedLine as string)
  const removedLine = channelsOf(active.removedLine as string)
  assert.ok(addedLine !== undefined && removedLine !== undefined, 'the truecolor line tints are RGB colours')
  assert.ok(channelDistance(addedLine, removedLine) >= 8, `the two line tints stay visually apart (${channelDistance(addedLine, removedLine).toFixed(1)})`)
  for (const [label, tint] of [['added', addedLine], ['removed', removedLine]] as const) {
    assert.ok(luma(tint) <= 48, `${label} line tint is near black (${luma(tint).toFixed(1)} luma)`)
    assert.ok(channelDistance(tint, { r: 0, g: 0, b: 0 }) >= 8, `${label} line tint is visible over black`)
  }
  assert.ok(addedLine.g > addedLine.r && addedLine.g >= addedLine.b, `add tint leans green (${addedLine.r},${addedLine.g},${addedLine.b})`)
  assert.ok(removedLine.r > removedLine.g && removedLine.r > removedLine.b, `del tint leans rose (${removedLine.r},${removedLine.g},${removedLine.b})`)
  // The added theme word already reads on its tint, so it stays byte-identical;
  // the removed word only gets lifted when the tint drops it below AA.
  assert.equal(active.addedWord, dark.diffAddedWord, 'the unified/base add word is still the theme token')
  assert.equal(active.removedWord, dark.diffRemovedWord, 'the unified/base delete word is still the theme token')
  assert.equal(active.addedLineWord, dark.diffAddedWord, 'the readable add word on its tint is the theme token')
  assert.ok(contrast(active.removedLineWord as string, removedLine) >= 4.5,
    `removed line word ${String(active.removedLineWord)} reads on its own line tint`)
  assert.ok(contrast(active.addedLineWord as string, addedLine) >= 4.5,
    `added line word ${String(active.addedLineWord)} reads on its own line tint`)
  assert.notEqual(active.removedLineWord, dark.diffRemovedWord,
    'the removed word is lifted only because the line tint drops it below AA')
  const removedLineWord = channelsOf(active.removedLineWord as string)
  assert.ok(removedLineWord !== undefined && removedLineWord.r > removedLineWord.g && removedLineWord.r > removedLineWord.b,
    'the adjusted removed line word keeps the rose hue')
  // Selection/hover keeps the pi-like diff body's outer backdrop on the row's
  // real highlight instead of a flat sub-box, and the split changed rows keep
  // their own faint substrate: the add/del distinction must not vanish when the
  // pointer arrives. Changed words stay picked against their own line tint.
  const selection = channelsOf(dark.messageActionsBackground)
  assert.ok(selection !== undefined)
  const highlighted = diffBodyAppearance(surface, dark, { active: true, highlight: dark.messageActionsBackground })
  assert.equal(highlighted.background, dark.messageActionsBackground)
  assert.equal(highlighted.quietTints, true)
  assert.equal(highlighted.addedLine, active.addedLine, 'the split add tint survives selection')
  assert.equal(highlighted.removedLine, active.removedLine, 'the split del tint survives selection')
  assert.equal(highlighted.addedLineWord, active.addedLineWord, 'the add word is picked against its own line tint')
  assert.equal(highlighted.removedLineWord, active.removedLineWord, 'the del word is picked against its own line tint')
  assert.ok(contrast(highlighted.addedWord as string, selection) >= 4.5,
    `added word ${String(highlighted.addedWord)} reads on the selection (${contrast(highlighted.addedWord as string, selection).toFixed(2)}:1)`)
  assert.ok(contrast(highlighted.removedWord as string, selection) >= 4.5,
    `removed word ${String(highlighted.removedWord)} reads on the selection (${contrast(highlighted.removedWord as string, selection).toFixed(2)}:1)`)
  // A light highlight keeps the deep green/rose words: truecolor names the
  // channel colours, the 256-colour tier names slots 22/52 explicitly.
  const light = getTheme('light')
  const lightSurface = { preset: 'pi-like' as const, presetFace: true, terminalBackground: '#ffffff' as const }
  const lightHighlight = diffBodyAppearance(lightSurface, light, { active: true, highlight: light.messageActionsBackground })
  assert.equal(lightHighlight.addedWord, 'rgb(0,95,0)')
  assert.equal(lightHighlight.removedWord, 'rgb(95,0,0)')
  const savedLevel = chalk.level
  try {
    chalk.level = 2
    const lightSlots = diffBodyAppearance(lightSurface, light, { active: true, highlight: light.messageActionsBackground })
    assert.equal(lightSlots.addedWord, 'ansi256(22)')
    assert.equal(lightSlots.removedWord, 'ansi256(52)')
    const darkSlots = diffBodyAppearance(surface, dark, { active: true, highlight: dark.messageActionsBackground })
    assert.equal(darkSlots.addedWord, 'ansi256(194)')
    assert.equal(darkSlots.removedWord, 'ansi256(224)')
  } finally {
    chalk.level = savedLevel
  }
  // Legacy and an explicit user face keep the original diff presentation (no
  // body backdrop, split tints unchanged) even while selected.
  const legacyAppearance = diffBodyAppearance({ ...surface, preset: 'legacy' }, dark, { active: true, highlight: dark.messageActionsBackground })
  assert.equal(legacyAppearance.background, undefined)
  assert.equal(legacyAppearance.quietTints, false)
  assert.equal(legacyAppearance.addedWord, 'diffAddedWord')
  assert.equal(legacyAppearance.addedLine, undefined, 'legacy keeps its own diff tints')
  assert.equal(legacyAppearance.removedLine, undefined, 'legacy keeps its own diff tints')
  const userFace = diffBodyAppearance({ ...surface, presetFace: false }, dark, { active: true, highlight: dark.messageActionsBackground })
  assert.equal(userFace.background, undefined)
  assert.equal(userFace.addedLine, undefined)
  assert.equal(userFace.removedLine, undefined)
  const notADiff = diffBodyAppearance(surface, dark, { active: false })
  assert.equal(notADiff.background, undefined)
  assert.equal(notADiff.addedLine, undefined)
  assert.equal(notADiff.removedLine, undefined)
})

check('a light terminal darkens the diff words until they read on that background', () => {
  const light = getTheme('light')
  for (const terminal of ['#ffffff', '#f6f0e8'] as const) {
    const appearance = diffBodyAppearance(
      { preset: 'pi-like', presetFace: true, terminalBackground: terminal },
      light,
      { active: true },
    )
    assert.equal(appearance.background, terminal)
    const behind = channelsOf(terminal)
    assert.ok(behind !== undefined)
    // On a light terminal the same derivation lands on a near-white tint: a
    // pale green/rose row substrate instead of a dark block.
    const addedLine = channelsOf(appearance.addedLine as string)
    const removedLine = channelsOf(appearance.removedLine as string)
    assert.ok(addedLine !== undefined && removedLine !== undefined, `${terminal}: light line tints are RGB`)
    for (const [label, tint] of [['added', addedLine], ['removed', removedLine]] as const) {
      assert.ok(relativeLuminance(tint) >= 0.8, `${terminal}: ${label} line tint stays near white (${relativeLuminance(tint).toFixed(2)})`)
      assert.ok(channelDistance(tint, behind) >= 3, `${terminal}: ${label} line tint remains visible over the terminal`)
    }
    assert.notEqual(appearance.addedLine, appearance.removedLine, `${terminal}: the two light tints stay apart`)
    for (const [label, color, lineWord, tint] of [
      ['added', appearance.addedWord, appearance.addedLineWord, addedLine],
      ['removed', appearance.removedWord, appearance.removedLineWord, removedLine],
    ] as const) {
      const channels = channelsOf(color as string)
      assert.ok(channels !== undefined, `${label} word ${String(color)} keeps channels`)
      assert.ok(contrastOf(channels, behind) >= 4.5,
        `${label} word on ${terminal} reads (${contrastOf(channels, behind).toFixed(2)}:1)`)
      const lineChannels = channelsOf(lineWord as string)
      assert.ok(lineChannels !== undefined, `${label} line word ${String(lineWord)} keeps channels`)
      assert.ok(contrastOf(lineChannels, tint) >= 4.5,
        `${label} line word reads on its line tint (${contrastOf(lineChannels, tint).toFixed(2)}:1)`)
      // Same hue family as the theme token: green-leaning add, rose-leaning remove.
      if (label === 'added') assert.ok(channels.g > channels.r && channels.g >= channels.b)
      else assert.ok(channels.r > channels.g && channels.r > channels.b)
    }
  }
})

check('the 256-colour tier names explicit line-tint slots and readable words on them', () => {
  const dark = getTheme('dark')
  const light = getTheme('light')
  const surface = { preset: 'pi-like' as const, presetFace: true, terminalBackground: '#000000' as const }
  const lightSurface = { preset: 'pi-like' as const, presetFace: true, terminalBackground: '#ffffff' as const }
  const savedLevel = chalk.level
  try {
    chalk.level = 2
    const darkTier = diffBodyAppearance(surface, dark, { active: true })
    // Not the palette-59 slab the old dimmed fills quantized to: explicit dark
    // green/rose cube slots carry the semantic difference.
    assert.equal(darkTier.addedLine, 'ansi256(22)')
    assert.equal(darkTier.removedLine, 'ansi256(52)')
    // Explicit pale green/rose words keep the hue instead of lifting the theme
    // token toward white and collapsing it into the same cell as the syntax grey.
    assert.equal(darkTier.addedLineWord, 'ansi256(194)')
    assert.equal(darkTier.removedLineWord, 'ansi256(224)')
    for (const [label, word, line] of [
      ['added', darkTier.addedLineWord, ansi256Channels('ansi256(22)')],
      ['removed', darkTier.removedLineWord, ansi256Channels('ansi256(52)')],
    ] as const) {
      const wordRgb = channelsOf(word as string) ?? ansi256Channels(word as string)
      assert.ok(wordRgb !== undefined && line !== undefined)
      assert.ok(contrastOf(wordRgb, line) >= 4.5, `${label} word reads on its 256 line slot (${contrastOf(wordRgb, line).toFixed(2)}:1)`)
    }
    const lightTier = diffBodyAppearance(lightSurface, light, { active: true })
    assert.equal(lightTier.addedLine, 'ansi256(151)')
    assert.equal(lightTier.removedLine, 'ansi256(181)')
    assert.equal(lightTier.addedLineWord, 'ansi256(22)')
    assert.equal(lightTier.removedLineWord, 'ansi256(52)')
    for (const [label, word, line] of [
      ['added', lightTier.addedLineWord, ansi256Channels('ansi256(151)')],
      ['removed', lightTier.removedLineWord, ansi256Channels('ansi256(181)')],
    ] as const) {
      const wordRgb = ansi256Channels(word as string) ?? channelsOf(word as string)
      assert.ok(wordRgb !== undefined && line !== undefined)
      assert.ok(contrastOf(wordRgb, line) >= 4.5, `${label} word reads on its light 256 line slot (${contrastOf(wordRgb, line).toFixed(2)}:1)`)
    }
    // 16 colours have no faint step: the line substrate disappears, the words
    // keep the tier's ansi names (readability depends on the user's palette).
    chalk.level = 1
    const sixteen = diffBodyAppearance(surface, dark, { active: true })
    assert.equal(sixteen.addedLine, undefined)
    assert.equal(sixteen.removedLine, undefined)
    assert.equal(sixteen.addedLineWord, undefined)
    assert.equal(sixteen.removedLineWord, undefined)
  } finally {
    chalk.level = savedLevel
  }
})

check('an ANSI-name palette still gets explicit line tints and readable words at truecolor', () => {
  const ansi = getTheme('dark-ansi')
  const appearance = diffBodyAppearance(
    { preset: 'pi-like', presetFace: true, terminalBackground: '#000000' },
    ansi,
    { active: true },
  )
  assert.equal(appearance.addedLine, 'ansi256(22)')
  assert.equal(appearance.removedLine, 'ansi256(52)')
  assert.equal(appearance.addedLineWord, 'ansi256(194)')
  assert.equal(appearance.removedLineWord, 'ansi256(224)')
  for (const [label, word, line] of [
    ['added', appearance.addedLineWord, ansi256Channels('ansi256(22)')],
    ['removed', appearance.removedLineWord, ansi256Channels('ansi256(52)')],
  ] as const) {
    const wordRgb = ansi256Channels(word as string)
    assert.ok(wordRgb !== undefined && line !== undefined)
    assert.ok(contrastOf(wordRgb, line) >= 4.5, `${label} word reads on the ANSI-palette line tint (${contrastOf(wordRgb, line).toFixed(2)}:1)`)
  }
})

check('job progress style: pi-like line, legacy bar, explicit overrides win', () => {
  assert.equal(pi().kinds.job.progressStyle, 'line', 'pi-like conversation job cards default to the thin line')
  assert.equal(legacy().kinds.job.progressStyle, 'bar', 'legacy keeps the original bar')
  assert.equal(resolveCardStyles(DEFAULT_CARD_STYLE_CONFIG, { toolBackground: 'none' }).preset, 'legacy')
  assert.equal(pi({ preset: 'pi-like', kinds: { job: { progressStyle: 'bar' } } }).kinds.job.progressStyle, 'bar',
    'a file override can switch the pi-like card back to the bar')
  assert.equal(pi({ preset: 'legacy', kinds: { job: { progressStyle: 'line' } } }).kinds.job.progressStyle, 'line',
    'an explicit value is honoured under legacy too')
  // `common` is the shared layer and the kind layer wins over it for the one
  // kind that consumes the knob.
  assert.equal(pi({ preset: 'pi-like', common: { progressStyle: 'bar' } }).kinds.job.progressStyle, 'bar')
  assert.equal(pi({ preset: 'pi-like', common: { progressStyle: 'bar' }, kinds: { job: { progressStyle: 'line' } } }).kinds.job.progressStyle, 'line')
  // Junk falls back to the preset default instead of failing the boot.
  assert.equal(pi({ preset: 'pi-like', kinds: { job: { progressStyle: 'blocks' } } }).kinds.job.progressStyle, 'line')
  assert.deepEqual(normalizeCardStyleConfig({ kinds: { job: { progressStyle: 'line' } } }).kinds, { job: { progressStyle: 'line' } })
  assert.equal(normalizeCardStyleConfig({ kinds: { job: { progressStyle: 'blocks' } } }).kinds, undefined)
  // Only the job card carries the resolved field; every other kind ignores it.
  for (const kind of CARD_KINDS) {
    assert.equal(pi().kinds[kind].progressStyle, kind === 'job' ? 'line' : undefined, `${kind} only exposes its own knobs`)
  }
})

check('the 16-colour tier leaves the default user face unfilled and keeps explicit colours', () => {
  // 16 colours have no pastel to offer: a filled default face would be a vivid
  // block, which is further from the near-transparent look than no fill at all.
  const face = pi().kinds.user.background
  const explicit = pi({ preset: 'pi-like', kinds: { user: { background: '#123456' } } }).kinds.user.background
  const savedLevel = chalk.level
  try {
    for (const level of [1, 0] as const) {
      chalk.level = level
      for (const [name, terminal] of TERMINAL_BACKGROUNDS) {
        assert.equal(cardBackgroundColor(face, getTheme(name), name, terminal), undefined, `${name}: no pale fill at chalk.level ${level}`)
        // A user colour is never rewritten by the tier.
        assert.equal(cardBackgroundColor(explicit, getTheme(name), name, terminal), '#123456', `${name}: the explicit colour paints at ${level}`)
      }
    }
    // Legacy's user row stays unfilled at every tier and needs no terminal background.
    chalk.level = 3
    assert.equal(cardBackgroundColor(legacy().kinds.user.background, getTheme('dark'), 'dark', '#1e1e2e'), undefined)
  } finally {
    chalk.level = savedLevel
  }
})

check('the existing domain statuses map to the three configurable fills', () => {
  assert.equal(cardStatusOf('running'), 'running')
  assert.equal(cardStatusOf('starting'), 'running')
  assert.equal(cardStatusOf('ok'), 'success')
  assert.equal(cardStatusOf('completed'), 'success')
  assert.equal(cardStatusOf('error'), 'failure')
  assert.equal(cardStatusOf('failed'), 'failure')
  // A cancel/stop keeps the ordinary face and the state glyph the card already shows.
  for (const ordinary of ['cancelled', 'killed', 'stopping', 'unknown', 'pending', '', undefined]) {
    assert.equal(cardStatusOf(ordinary), undefined, `${ordinary} keeps the ordinary face`)
  }
  const styles = pi()
  assert.deepEqual(cardBackgroundOf(styles, 'tool', 'failure'), { fill: 'bashMessageBackgroundColor', presetState: 'failure' })
  assert.deepEqual(cardBackgroundOf(styles, 'tool', undefined), { fill: 'toolCardBackgroundDim', presetFace: true })
  // Job is transparent by default, so an execution state adds no face either.
  assert.equal(cardBackgroundOf(styles, 'job', 'success'), undefined)
  assert.equal(cardBackgroundOf(styles, 'job', undefined), undefined)
  // Legacy has no execution-state fills: every state keeps the old tool face.
  assert.deepEqual(cardBackgroundOf(legacy('subtle'), 'tool', 'success'), { fill: 'toolCardBackgroundDim' })
  assert.equal(cardBackgroundOf(legacy('none'), 'subagent', 'failure'), undefined)
})

check('common overrides apply to every kind, kind overrides win over common', () => {
  const styles = pi({ preset: 'pi-like', common: { paddingX: 2, gap: 1 } })
  for (const kind of CARD_KINDS) {
    assert.equal(styles.kinds[kind].paddingX, 2)
    assert.equal(styles.kinds[kind].gap, 1)
  }
  const overridden = pi({
    preset: 'pi-like',
    common: { paddingX: 2 },
    kinds: { tool: { paddingX: 0, border: 'round', borderColor: 'promptBorder' } },
  })
  assert.equal(overridden.kinds.tool.paddingX, 0)
  assert.deepEqual(overridden.kinds.tool.border, { style: 'round', color: 'promptBorder' })
  assert.equal(overridden.kinds.user.paddingX, 2)
  // A border without a colour takes the theme's border key, never a fixed hue.
  assert.deepEqual(pi({ kinds: { user: { border: 'single' } } }).kinds.user.border, { style: 'single', color: 'promptBorder' })
})

check('an ordinary background override leaves the state fills alone', () => {
  const cleared = pi({ preset: 'pi-like', kinds: { tool: { background: 'none' } } })
  assert.equal(cleared.kinds.tool.background, undefined)
  for (const status of ['running', 'success', 'failure'] as const) {
    assert.notEqual(cardBackgroundOf(cleared, 'tool', status), undefined, `${status} keeps its own fill`)
  }
  const custom = pi({ preset: 'pi-like', kinds: { tool: { background: '#123456' } } })
  assert.deepEqual(custom.kinds.tool.background, { fill: '#123456' })
  assert.deepEqual(cardBackgroundOf(custom, 'tool', 'success'), { fill: 'bashMessageBackgroundColor', presetState: 'success' })
  assert.deepEqual(cardBackgroundOf(custom, 'tool', undefined), { fill: '#123456' })
})

check('state fills are overridable per status, common first and kind last', () => {
  const tuned = pi({
    preset: 'pi-like',
    common: { states: { failure: 'error' } },
    kinds: { tool: { states: { failure: 'none', running: '#101010' } } },
  })
  assert.deepEqual(tuned.kinds.tool.states, {
    running: { fill: '#101010' },
    success: { fill: 'bashMessageBackgroundColor', presetState: 'success' },
    failure: undefined,
  })
  // `none` removes the state fill, so that status falls back to the card face.
  assert.deepEqual(cardBackgroundOf(tuned, 'tool', 'failure'), { fill: 'toolCardBackgroundDim', presetFace: true })
  // Job has no preset faces, so the common layer is the only source there.
  assert.deepEqual(tuned.kinds.job.states, {
    running: undefined,
    success: undefined,
    failure: { fill: 'error' },
  })
  // Legacy ships no state fills of its own; one can still be added, and the
  // reading kinds never carry any.
  const legacyStates = pi({ preset: 'legacy', kinds: { subagent: { states: { running: 'warning' } } } })
  assert.deepEqual(legacyStates.kinds.subagent.states, { running: { fill: 'warning' }, success: undefined, failure: undefined })
  assert.equal(legacyStates.kinds.tool.states, undefined)
  for (const kind of ['user', 'assistant', 'thinking', 'summary', 'other'] as const) {
    assert.equal(pi({ kinds: { [kind]: { states: { failure: 'error' } } } }).kinds[kind].states, undefined, `${kind} carries no execution state`)
  }
})

check('switching the base preset keeps every personal override', () => {
  const kinds = { user: { background: 'selectionBg' }, tool: { paddingX: 3, gap: 2 } }
  const asLegacy = pi({ preset: 'legacy', kinds })
  const asPi = pi({ preset: 'pi-like', kinds })
  for (const styles of [asLegacy, asPi]) {
    assert.deepEqual(styles.kinds.user.background, { fill: 'selectionBg' })
    assert.equal(styles.kinds.tool.paddingX, 3)
    assert.equal(styles.kinds.tool.gap, 2)
  }
  // Removing the overrides and choosing legacy restores the old look exactly.
  const cleared = pi({ preset: 'legacy' })
  assert.equal(cleared.kinds.user.background, undefined)
  assert.equal(cleared.kinds.tool.paddingX, 0)
  assert.deepEqual(cleared, legacy())
})

check('pi-like keeps cards one uncoloured row apart without stacking the transition', () => {
  for (const kind of CARD_KINDS) {
    assert.equal(pi().kinds[kind].gap, 0, `${kind} adds no explicit gap by default`)
    assert.equal(pi().kinds[kind].minimumGap, kind === 'job' ? 0 : 1, `${kind} reserves its preset breathing rows`)
    assert.equal(legacy().kinds[kind].minimumGap, 0, `legacy ${kind} adds nothing`)
  }
  // pi-like job cards sit flush like legacy: no preset breathing row inside a
  // job group (the transition row between runs still comes from the list).
  const tuned = pi({ preset: 'pi-like', kinds: { tool: { gap: 2 }, user: { gap: 0 } } })
  assert.equal(tuned.kinds.tool.gap, 2)
  assert.equal(tuned.kinds.tool.minimumGap, 0)
  assert.equal(tuned.kinds.user.gap, 0)
  assert.equal(tuned.kinds.user.minimumGap, 0)
})

check('a user background/states override still paints the transparent job card', () => {
  const painted = pi({ preset: 'pi-like', kinds: { job: { background: 'selectionBg', states: { running: 'warning' } } } })
  assert.deepEqual(cardBackgroundOf(painted, 'job', undefined), { fill: 'selectionBg' })
  assert.deepEqual(cardBackgroundOf(painted, 'job', 'running'), { fill: 'warning' })
  assert.deepEqual(cardBackgroundOf(painted, 'job', 'success'), { fill: 'selectionBg' }, 'an unpainted state falls back to the card face')
  const bgOnly = pi({ preset: 'pi-like', kinds: { job: { background: 'selectionBg' } } })
  assert.deepEqual(bgOnly.kinds.job.states, undefined)
})

check('every fold knob defaults to unset, so each kind keeps its own mechanism', () => {
  for (const styles of [legacy(), pi()]) {
    for (const kind of ['user', 'assistant', 'thinking', 'tool', 'job', 'summary'] as const) {
      assert.deepEqual(
        styles.kinds[kind].fold,
        { defaultExpanded: undefined, previewLines: undefined },
        `${kind} exposes the knobs without touching today's fold`,
      )
    }
    for (const kind of ['subagent', 'other'] as const) {
      assert.equal(styles.kinds[kind].fold, undefined, `${kind} has no fold to configure`)
    }
  }
  const tuned = pi({
    kinds: {
      thinking: { defaultExpanded: true, previewLines: 7 },
      tool: { previewLines: 1 },
      user: { defaultExpanded: true, previewLines: 4 },
      assistant: { defaultExpanded: false },
      job: { defaultExpanded: true },
      summary: { defaultExpanded: true, previewLines: 9 },
    },
  })
  assert.deepEqual(tuned.kinds.thinking.fold, { defaultExpanded: true, previewLines: 7 })
  // Only the set knob changes; the rest still follows the view's own budget.
  assert.deepEqual(tuned.kinds.tool.fold, { defaultExpanded: undefined, previewLines: 1 })
  assert.deepEqual(tuned.kinds.user.fold, { defaultExpanded: true, previewLines: undefined })
  assert.deepEqual(tuned.kinds.assistant.fold, { defaultExpanded: false, previewLines: undefined })
  assert.deepEqual(tuned.kinds.job.fold, { defaultExpanded: true, previewLines: undefined })
  // A long line folds by characters and the summary folds to a text preview:
  // neither takes a row budget, so a configured line count is dropped.
  assert.deepEqual(tuned.kinds.summary.fold, { defaultExpanded: true, previewLines: undefined })
  const commonFold = pi({ common: { defaultExpanded: true }, kinds: { tool: { defaultExpanded: false } } })
  assert.equal(commonFold.kinds.thinking.fold?.defaultExpanded, true)
  assert.equal(commonFold.kinds.tool.fold?.defaultExpanded, false)
})

check('broken config falls back per field instead of breaking the transcript', () => {
  assert.deepEqual(normalizeCardStyleConfig('nope'), DEFAULT_CARD_STYLE_CONFIG)
  assert.deepEqual(normalizeCardStyleConfig(undefined), DEFAULT_CARD_STYLE_CONFIG)
  assert.deepEqual(normalizeCardStyleConfig([]), DEFAULT_CARD_STYLE_CONFIG)
  assert.equal(pi({ preset: 'pi-lite' }).preset, 'legacy')
  const junk = pi({
    preset: 'pi-like',
    common: { paddingX: 99, paddingY: -2, gap: 'wide' },
    kinds: {
      user: { background: 'hotpink', border: 'wavy', borderColor: 'not-a-color', previewLines: 0, defaultExpanded: 'yes' },
      bubble: { background: 'selectionBg' },
    },
  })
  // An unusable value is dropped, so the layer below (here: the preset face) stays.
  assert.deepEqual(junk.kinds.user.background, { fill: 'text', presetUser: true }, 'an invalid colour falls back to the preset face')
  assert.equal(junk.kinds.user.border, undefined)
  assert.deepEqual(junk.kinds.user.fold, { defaultExpanded: undefined, previewLines: undefined }, 'junk fold values are dropped, not defaulted')
  assert.equal(junk.kinds.subagent.fold, undefined, 'a kind without a fold keeps none')
  assert.equal(junk.kinds.user.paddingX, CARD_PADDING_X_MAX, 'an over-wide padding clamps to the documented bound')
  assert.equal(junk.kinds.user.paddingY, 0)
  assert.equal(junk.kinds.tool.gap, 0)
  assert.equal('bubble' in junk.kinds, false)
  assert.deepEqual(normalizeCardStyleConfig({ kinds: { tool: { paddingX: 1.7, gap: 2 } } }).kinds, { tool: { paddingX: 1, gap: 2 } })
})

check('card content width narrows by border and padding and never goes below one column', () => {
  assert.equal(cardContentWidth(80, legacy().kinds.tool), 80)
  assert.equal(cardContentWidth(80, pi().kinds.tool), 80)
  assert.equal(cardContentWidth(80, pi({ preset: 'pi-like', kinds: { tool: { border: 'round' } } }).kinds.tool), 78)
  assert.equal(cardContentWidth(1, pi().kinds.tool), 1)
  assert.equal(cardContentWidth(0, pi().kinds.tool), 1)
})

check('a background resolves against the active theme: theme key and explicit colour', () => {
  const dark = getTheme('dark')
  const ansi = getTheme('dark-ansi')
  assert.equal(cardBackgroundColor(undefined, dark, 'dark'), undefined)
  assert.equal(cardBackgroundColor({ fill: 'toolCardBackground' }, dark, 'dark'), dark.toolCardBackground)
  // A theme key that is deliberately empty paints nothing.
  assert.equal(dark.userMessageBackground, '')
  assert.equal(cardBackgroundColor({ fill: 'userMessageBackground' }, dark, 'dark'), undefined)
  assert.equal(cardBackgroundColor({ fill: '#123456' }, dark, 'dark'), '#123456')
  // The ANSI palette carries `ansi:` names instead of channels for the running
  // surface, so that one goes out as the 256 slot; success/failure are fixed
  // near-black faces and paint regardless of the palette's own names.
  const ansiStates = pi().kinds.tool.states!
  const ansiFaces = (['running', 'success', 'failure'] as const).map(status => cardBackgroundColor(ansiStates[status], ansi, 'dark-ansi'))
  assert.deepEqual(ansiFaces, ['ansi256(236)', '#0e1b14', '#21161d'])
  assert.equal(new Set(ansiFaces).size, 3, 'the three states stay apart on an ANSI palette')
  assert.equal(ansiFaces.some(face => face?.startsWith('ansi:') ?? false), false, 'no state face goes out as an ANSI name')
  assert.equal(ansiFaces.every(face => face !== undefined && face !== ''), true, 'every state paints on an ANSI palette')
  // Ordinary (non-state) faces keep following the palette, ANSI names included.
  assert.equal(cardBackgroundColor({ fill: 'toolCardBackground' }, ansi, 'dark-ansi'), 'ansi:blackBright')
  // A fixed-channel custom palette is not a palette-only ANSI theme: the
  // truecolor tier keeps the theme's own state colours instead of a low-tier
  // slot (the slot is only for `ansi:` names, whose real RGB the terminal owns).
  const hexPalette = {
    ...getTheme('dark'),
    bashMessageBackgroundColor: '#2c3038',
    success: '#00aa00',
    error: '#aa0000',
  }
  const hexStates = pi().kinds.tool.states!
  const hexFaces = (['running', 'success', 'failure'] as const).map(status => cardBackgroundColor(hexStates[status], hexPalette, 'dark'))
  // A custom palette's own success/error colours no longer drive the preset
  // faces: all three dark states are the fixed near-black table (a custom
  // theme cannot turn them back into grey mixes).
  assert.deepEqual(hexFaces, ['#0d1013', '#0e1b14', '#21161d'])
  const mixedPalette = { ...ansi, bashMessageBackgroundColor: '#2c3038' }
  assert.deepEqual(
    (['running', 'success', 'failure'] as const).map(status => cardBackgroundColor(hexStates[status], mixedPalette, 'dark-ansi')),
    ['#0d1013', '#0e1b14', '#21161d'],
  )
  assert.equal(cardBackgroundColor(hexStates.success, { ...hexPalette, success: 'ansi256(34)' }, 'dark'), '#0e1b14')
  const explicitSlot = resolveCardStyles(normalizeCardStyleConfig({
    preset: 'pi-like', kinds: { tool: { states: { success: 'ansi256(34)' } } },
  }), { toolBackground: 'none' }).kinds.tool.states!.success
  assert.equal(cardBackgroundColor(explicitSlot, hexPalette, 'dark'), 'ansi256(34)')
})

check('the lower colour tiers use readable state slots and never rewrite a user colour', () => {
  const dark = getTheme('dark')
  const ansi = getTheme('dark-ansi')
  const states = pi().kinds.tool.states!
  const facesOn = (name: string): (string | undefined)[] =>
    (['running', 'success', 'failure'] as const).map(status => cardBackgroundColor(states[status], getTheme(name), name))
  const savedLevel = chalk.level
  try {
    chalk.level = 2
    assert.deepEqual(facesOn('dark'), ['ansi256(236)', 'ansi256(23)', 'ansi256(95)'])
    assert.deepEqual(facesOn('pink-night'), ['ansi256(236)', 'ansi256(23)', 'ansi256(95)'])
    assert.deepEqual(facesOn('codex-lavender'), ['ansi256(236)', 'ansi256(23)', 'ansi256(95)'])
    assert.deepEqual(facesOn('light'), ['ansi256(254)', 'ansi256(151)', 'ansi256(181)'])
    assert.deepEqual(facesOn('pink-day'), ['ansi256(254)', 'ansi256(151)', 'ansi256(181)'])
    assert.deepEqual(facesOn('dark-ansi'), ['ansi256(236)', 'ansi256(23)', 'ansi256(95)'])
    chalk.level = 1
    assert.deepEqual(facesOn('dark'), ['ansi:black', 'ansi:blue', 'ansi:red'])
    assert.deepEqual(facesOn('claude-dark'), ['ansi:black', 'ansi:blue', 'ansi:red'])
    assert.deepEqual(facesOn('pink-day'), ['ansi:white', 'ansi:green', 'ansi:redBright'])
    assert.deepEqual(facesOn('dark-ansi'), ['ansi:black', 'ansi:blue', 'ansi:red'])
    // A user-chosen state fill is not a preset face: every tier paints it as given.
    const overridden = pi({ preset: 'pi-like', kinds: { tool: { states: { success: '#123456', failure: 'error' } } } })
    for (const level of [2, 1]) {
      chalk.level = level
      assert.equal(cardBackgroundColor(overridden.kinds.tool.states?.success, dark, 'dark'), '#123456')
      assert.equal(cardBackgroundColor(overridden.kinds.tool.states?.failure, dark, 'dark'), dark.error)
    }
    assert.equal(cardBackgroundColor({ fill: 'toolCardBackground' }, ansi, 'dark-ansi'), 'ansi:blackBright')
  } finally {
    chalk.level = savedLevel
  }
})

check('the plugin keeps the runtime schema and the single apply site', () => {
  const source = readFileSync(new URL('../../src/dsh-adapter/plugin.ts', import.meta.url), 'utf8')
  assert.match(source, /^\s*cardStyles: Schema\.any\(\),$/mu, 'the runtime settings schema still accepts the block')
  assert.match(
    source,
    /applyCardStyles\(cardStyleConfigFrom\(value\.cardStyles, config\.cardStyles\)\)/u,
    'applyDisplay forwards the user layer over the deployment block',
  )
  assert.equal(source.match(/applyCardStyles\(/gu)?.length, 1, 'exactly one apply site')
})

// ── the real settings.json chain ────────────────────────────────────────
const file = join(fakeHome, 'card-styles-settings.json')
mkdirSync(join(fakeHome, '.dsh'), { recursive: true })
writeFileSync(file, `${JSON.stringify({
  version: 1,
  values: { cardStyles: { preset: 'pi-like', kinds: { tool: { paddingX: 3 } } } },
}, null, 2)}\n`)

check('a real settings.json user layer reaches the resolved styles and outranks cordis.yml', () => {
  const service = createTuiSettingsService({ ns: 'dsh-tui', file, profile: 'verify-card-styles', keys: [] })
  const scope = service.register('dsh-tui', Config)
  const value = scope.get() as { cardStyles?: unknown }
  const deployment = normalizeCardStyleConfig({ preset: 'legacy', common: { gap: 1 } })
  // The settings user layer wins whole, exactly like every sibling display preference.
  const resolved = resolveCardStyles(cardStyleConfigFrom(value.cardStyles, deployment), { toolBackground: 'none' })
  assert.equal(resolved.preset, 'pi-like')
  assert.equal(resolved.kinds.tool.paddingX, 3)
  assert.equal(resolved.kinds.user.gap, 0, 'the deployment block does not leak through the user layer')
  // Deployment config alone still applies, and no layer at all is legacy.
  assert.equal(resolveCardStyles(cardStyleConfigFrom(undefined, deployment), { toolBackground: 'none' }).preset, 'legacy')
  assert.deepEqual(cardStyleConfigFrom(undefined, undefined), DEFAULT_CARD_STYLE_CONFIG)
})

check('the live store applies, keeps identity on a no-op and notifies subscribers', () => {
  const seen: number[] = []
  const unsubscribe = subscribeCardStyles(() => { seen.push(1) })
  applyCardStyles(undefined)
  assert.equal(seen.length, 0, 'the boot value is already the legacy default')
  applyCardStyles({ preset: 'pi-like', kinds: { user: { paddingY: 2 } } })
  assert.equal(seen.length, 1)
  applyCardStyles({ preset: 'pi-like', kinds: { user: { paddingY: 2 } } })
  assert.equal(seen.length, 1, 'an unchanged config does not re-render the transcript')
  const config = getCardStyleConfig()
  assert.deepEqual(config.kinds?.user, { paddingY: 2 })
  applyCardStyles(undefined)
  unsubscribe()
  const styles: ResolvedCardStyles = resolveCardStyles(getCardStyleConfig(), { toolBackground: 'none' })
  assert.equal(styles.preset, 'legacy')
  assert.equal(styles.kinds.user.paddingY, 0)
})

console.log(`card styles: ${checks} checks passed`)
