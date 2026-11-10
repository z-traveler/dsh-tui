/**
 * Pi-like custom cards: actual terminal-cell paint and geometry, not a preset name.
 * Reference: installed Pi 1.4.0 SkillInvocationMessageComponent + dark/light themes.
 * Run: node --import tsx/esm scripts/downstream/verify-custom-card-visual.tsx
 * Captures are synthetic, under .tmp/custom-card-visual (ignored).
 */
import '../lib/fake-home.mjs'
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_TMUX_TRUECOLOR = '1'
process.env.DSH_TUI_LANG = 'en'

import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { mkdir, writeFile } from 'node:fs/promises'
const [React, { Terminal }, { render, Box, Text, ThemeProvider, AlternateScreen }, { CustomCardRow }, { applyCardStyles }] = await Promise.all([
  import('react'), import('@xterm/headless'), import('../../src/ui.js'),
  import('../../src/components/messages/CustomCardRow.js'), import('../../src/cardStyles.js'),
])
import { settled } from '../lib/term-test.mjs'

const reference = {
  dark: { bg: 0x3a3055, label: 0xa798d7, text: 0x9da5a9 },
  light: { bg: 0xe6e4ee, label: 0x7459b4, text: 0x677176 },
}
const out = '.tmp/custom-card-visual'
await mkdir(out, { recursive: true })
let failures = 0

for (const theme of ['dark', 'light'] as const) {
  for (const columns of [40, 100]) {
    for (const fullscreen of [false, true]) {
      for (const expanded of [false, true]) {
        for (const preset of ['legacy', 'pi-like'] as const) for (const empty of [false, true]) {
          const name = `${theme}-${columns}-${fullscreen ? 'fullscreen' : 'inline'}-${expanded ? 'expanded' : 'collapsed'}-${preset}${empty ? '-empty' : ''}`
          const terminal = new Terminal({ cols: columns, rows: 24, allowProposedApi: true })
          class Output extends Writable {
            isTTY = true
            columns = columns
            rows = 24
            _write(chunk: unknown, _encoding: BufferEncoding, done: () => void) { terminal.write(String(chunk), done) }
          }
          class Input extends PassThrough {
            isTTY = true
            setRawMode(): this { return this }
            ref(): this { return this }
            unref(): this { return this }
          }
          applyCardStyles({ preset })
          const input = new Input()
          const stdout = new Output()
          const card = <ThemeProvider theme={theme}><Box flexDirection="column">
            <CustomCardRow view={{ title: 'pdf-tools', label: 'skill', blocks: empty ? [] : [{ kind: 'text', text: 'Use the pdf tools.' }] }}
              type="skill" expanded={expanded} marginTopOnTurn={false} toolBackground="none" background={undefined} />
            <Text>AFTER_CARD</Text>
          </Box></ThemeProvider>
          const instance = await render(fullscreen ? <AlternateScreen>{card}</AlternateScreen> : card, {
            stdout: stdout as never, stdin: input as never, stderr: stdout as never,
            patchConsole: false, exitOnCtrlC: false,
          })
          const line = (y: number) => terminal.buffer.active.getLine(y)!.translateToString(true)
          try {
            assert.ok(await settled(() => Array.from({ length: 24 }, (_, y) => line(y)).some(text => text.includes('AFTER_CARD'))))
            const y = Array.from({ length: 24 }, (_, i) => i).find(i => line(i).includes('[skill]'))!
            const x = line(y).indexOf('[skill]')
            const label = terminal.buffer.active.getLine(y)!.getCell(x)!
            if (preset === 'legacy') {
              assert.equal(x, 2, 'legacy transcript indent stays unchanged')
              assert.ok(label.isBgDefault(), 'legacy has no new card face')
              assert.equal(Boolean(label.isBold()), false, 'legacy label stays unchanged')
            } else {
              assert.equal(x, 1, 'Pi outputPad=1, without the extra legacy gutter')
              assert.equal(label.getBgColor(), reference[theme].bg, 'Pi custom purple, not the tool face')
              assert.equal(label.getFgColor(), reference[theme].label, 'Pi violet label')
              assert.ok(label.isBold(), 'Pi label is bold')
              assert.equal(terminal.buffer.active.getLine(y)!.getCell(0)!.getBgColor(), reference[theme].bg)
              assert.equal(terminal.buffer.active.getLine(y)!.getCell(columns - 1)!.getBgColor(), reference[theme].bg)
              assert.equal(line(y - 1).trim(), '', 'one painted top padding row')
              assert.equal(terminal.buffer.active.getLine(y - 1)!.getCell(0)!.getBgColor(), reference[theme].bg)
              if (expanded) {
                assert.equal(line(y).trim(), '[skill]', 'expanded label has its own row')
                assert.equal(line(y + 1).trim(), 'pdf-tools', 'expanded title is separate')
                const title = terminal.buffer.active.getLine(y + 1)!.getCell(1)!
                assert.equal(Boolean(title.isBold()), false, 'Pi 1.4.0 rendered name is normal weight')
                assert.equal(title.getFgColor(), reference[theme].text)
                if (!empty) {
                  assert.equal(line(y + 2).trim(), '', 'body is separated by an in-card blank line')
                  assert.equal(line(y + 3).trim(), 'Use the pdf tools.')
                  assert.equal(terminal.buffer.active.getLine(y + 3)!.getCell(1)!.getFgColor(), reference[theme].text)
                }
              } else {
                assert.ok(line(y).includes('pdf-tools'), 'collapsed title shares label row')
              }
            }
            const after = Array.from({ length: 24 }, (_, i) => i).find(i => line(i).includes('AFTER_CARD'))!
            if (preset === 'pi-like') {
              if (empty && expanded) assert.equal(after, y + 3, 'empty expanded card has no body spacer')
              assert.equal(line(after - 1).trim(), '', 'one painted bottom padding row')
              assert.equal(terminal.buffer.active.getLine(after - 1)!.getCell(0)!.getBgColor(), reference[theme].bg)
              assert.ok(terminal.buffer.active.getLine(after)!.getCell(0)!.isBgDefault(), 'background does not leak')
            }
            const cells = Array.from({ length: after }, (_, row) => Array.from({ length: columns }, (_, col) => {
              const c = terminal.buffer.active.getLine(row)!.getCell(col)!
              return { text: c.getChars(), width: c.getWidth(), bold: Boolean(c.isBold()), fg: c.isFgRGB() ? c.getFgColor() : null, bg: c.isBgRGB() ? c.getBgColor() : null }
            }))
            await writeFile(`${out}/dsh-${name}.json`, JSON.stringify({ columns, cells }) + '\n')
            console.log(`PASS ${name}`)
          } catch (error) {
            failures++
            console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
          } finally {
            await instance.unmount()
            terminal.dispose()
            input.destroy()
          }
        }
      }
    }
  }
}
applyCardStyles(undefined)
assert.equal(failures, 0, `${failures} visual contract failures`)
console.log('custom card visual contract passed (64 scenes)')
