# Conversation card styles (downstream)

[中文](card-styles.md)

`cardStyles` affects transcript content only, not the composer, completions, approvals, questions, overlays, or side panels. With no configuration, the current appearance remains unchanged. “Transparent” here means either no fill or a very pale solid fill; it is not alpha transparency.

## Configuration

Merge this into the existing `values` of `~/.dsh-tui/settings.json`, preserving other settings:

```json
{
  "version": 1,
  "values": {
    "cardStyles": {
      "preset": "pi-like",
      "kinds": {
        "tool": { "previewLines": 6 },
        "summary": { "defaultExpanded": true }
      }
    }
  }
}
```

The same object can be declared as `config.cardStyles` on the Cordis/profile `dsh-tui` row. The **entire user object replaces the deployment object**, without a deep merge. A user object containing only `kinds` does not inherit the deployment `preset`. Deployment changes require a restart; the existing user-settings watcher may apply changes live, but restarting is a reliable way to apply them. There are no new `/settings` controls, and Agent `/preset` is unrelated.

Within an object, precedence is **preset → `common` → `kinds.<kind>`**, including per-status merging. Switching `preset` does not erase overrides.

| Preset | Defaults |
| --- | --- |
| `legacy` (default) | Existing appearance and folding; `toolBackground` still controls tool backgrounds |
| `pi-like` | No border; horizontal and vertical padding 0 (the original `❯`/`⎿` prefixes and the subagent card's own indent line up with legacy); a near-transparent user face, soft state faces for tool/subagent cards, and transparent jobs by default with groups sitting flush like legacy; at least one uncoloured breathing row between other cards (an existing transition row is not stacked); assistant/thinking/summary/other unfilled |

Neither preset changes folding defaults. `pi-like` takes over tool backgrounds instead of using `toolBackground`. Overrides still win. It does not switch themes: dark palettes use a small fixed near-black table (neutral running, very faint grey-green success, very faint dusty-rose failure), while light palettes keep the theme's neutral running surface with pale sage/rose success/failure; lower colour tiers fall back to distinguishable slots so body text stays readable — see below. The user face and Edit code area follow the **terminal background** instead; see below.

## Kinds and properties

| Kind | Content | Existing folding overrides |
| --- | --- | --- |
| `user` | User/team messages | `defaultExpanded` for existing long-single-line clipping |
| `assistant` | Settled and streaming text | `defaultExpanded` for existing long-single-line clipping |
| `thinking` | Reasoning | `defaultExpanded`; `previewLines` only for the streaming ticker, not settled folded bodies |
| `tool` | Tool calls/results | `defaultExpanded`, `previewLines` |
| `subagent` | Subagent messages | None; existing detail entry unchanged |
| `job` | Background tasks | `defaultExpanded` for initial group expansion; grouping conditions unchanged; `progressStyle` controls the conversation card's progress form (see below) |
| `summary` | Compaction summary | `defaultExpanded`; folded text preview has no line-count control |
| `other` | Notices, interruptions, local echoes/output, turn usage | None |

Each kind and `common` accept:

| Property | Value |
| --- | --- |
| `background` | `none`, theme colour key, or an existing valid explicit colour |
| `border` | `none`, `single`, `double`, `round`, `bold`, `singleDouble`, `doubleSingle`, `classic`, `arrow`, `dashed` |
| `borderColor` | Theme key or explicit colour; defaults to `promptBorder` when a border is enabled |
| `paddingX` | 0–8 columns on each side |
| `paddingY` | 0–4 rows above and below |
| `gap` | 0–4 extra rows in addition to existing spacing; `pi-like` already reserves one breathing row for ordinary cards (not inside a job group), and an explicit `gap` restores the add-only meaning and replaces that minimum instead of stacking with it |
| `defaultExpanded` | Boolean, only where supported above; unset inherits existing behaviour |
| `previewLines` | 1–40, tool and streaming thinking only; explicit tool values apply to both text and diff, otherwise text stays 3 lines and diff 8 |
| `states` | Tool/subagent/job only; see below |
| `progressStyle` | `line` or `bar`; `common` may carry it but only `job` consumes it — see “Job progress line” |

Counts are floored and clamped. Invalid fields and unknown kinds are dropped, falling back to preset defaults. Colours accept theme keys, `#rgb`/`#rrggbb`, `rgb()`, `ansi256()`, `ansi:` and the existing theme formats. Eight-digit hex does not provide alpha compositing.

Initial expansion does not replace click or `Ctrl+O` behaviour: clicking an initially expanded row can collapse it. `thinkingFold`, `jobGroupFold`, and `foldTerminalCommand` retain their existing mechanisms; no new folding interactions are introduced.

## State backgrounds

`pi-like` distinguishes running, success, and failure on tool/subagent cards by default; job cards stay transparent unless the user opts into `states`, while the existing glyphs and labels keep showing. Only existing domain states are mapped; no session events or persistence semantics change. Cancelled/stopping/killed/unknown states use the ordinary face rather than pretending to succeed or fail.

```json
{
  "preset": "pi-like",
  "common": { "border": "round", "borderColor": "promptBorder" },
  "kinds": {
    "tool": {
      "states": {
        "running": "toolCardBackgroundDim",
        "success": "#183321",
        "failure": "#3a2028"
      }
    }
  }
}
```

`background` and `states` are independent. Setting `states.success` to `none` uses the ordinary face; complete no-fill requires `background: "none"` and all three states set to `none`.

The default state surfaces are low-contrast and close to the terminal floor: on dark truecolor palettes all three sit near black — running `#0d1013` (neutral), success `#0e1b14` (very faint grey-green), failure `#21161d` (very faint dusty rose) — still distinguishable by hue; on light palettes running keeps the theme's own neutral surface. Success and failure are neither all-grey nor saturated red/green. Real rendering regressions require pairwise-distinct state backgrounds and default-body contrast of at least 4.5:1 on built-in themes. Existing state glyphs and labels remain. The fine near-black steps exist only with truecolour output; see the tier limits below.

| Tier | Dark themes | Light themes |
| --- | --- | --- |
| Truecolor | running `#0d1013` (neutral near-black); success `#0e1b14` (very faint grey-green); failure `#21161d` (very faint dusty rose) | running = theme neutral surface; success `#e8efe9` (sage); failure `#f3e6ea` (rose) |
| 256 colours | grey 236 (running) / teal 23 (success) / dusty rose 95 (failure) | grey 254 / sage 151 / rose 181 |
| 16 colours | Black / blue / red | White / green / bright red |

Truecolor uses the small table above according to theme polarity. The 256-colour tier selects coloured slots explicitly so quantization cannot collapse success and failure to one colour, but it **cannot express the near-black truecolour steps**: on dark palettes running stays neutral grey `#303030` (236), success is teal 23, and failure is dusty rose 95, so the differences are stronger than at truecolor. The 16-colour tier uses distinguishable, readable fallback slots and **cannot render the soft palette or guarantee a green success fill**. These are tier capability limits, not three identical looks. Dark truecolor states use the fixed near-black table; ANSI-name-only dark themes still fall back to a neutral slot for running. Light running uses the theme's neutral surface, falling back to the tier slot when that colour is unavailable. Contrast tests assume conventional terminal palettes; redefining slots 0–15 can change results. Explicit `states` overrides paint as given at every tier; their contrast and distinctness are the user's responsibility. With colour disabled, existing state glyphs remain without background distinctions.

Truecolour also depends on a terminal-capability limit: the repository's `src/ink/colorize.ts` clamps colours to the 256-colour tier inside tmux by default (so tmux clients that cannot advertise RGB do not drop truecolour SGR). When the client is known to support RGB, the **existing** environment variable `DSH_TUI_TMUX_TRUECOLOR=1` skips that clamp; the isolated demo entry (`card-styles-demo.tsx`) already defaults it with `??=` before dynamically importing the UI, which is how the demo shows the near-black steps. The production app never sets it for you — export it explicitly. An explicit `FORCE_COLOR=2/1` still degrades as requested and is not overridden by the demo.

## Edit / diff body

Under the `pi-like` preset face, an Edit-style diff card renders differently from `legacy`: the header keeps its light execution-state fill while the code area (unified body and split panes) returns to the **actual terminal background** reported by `useTerminalBackground()` (a selected/hovered row paints the real highlight fill underneath, see below), so the state fill no longer darkens the code. Split add/del rows paint their own very faint substrate instead — grey-green for additions, dusty rose for deletions — while context rows keep the terminal background. That substrate stays in every state: plain, selected and hovered, so moving the pointer onto the card never erases the add/del distinction. Syntax highlighting, diff parsing, alignment, and the word-level algorithm are untouched: unchanged code is never painted red/green as a whole line, and split changed words remain bold with semantic colours. Unified and split share one small presentation module (`src/components/diffAppearance.ts`); unified and the 16-colour tier have no line substrate and keep the previous text behaviour (the 16-colour tier degrades honestly to word colours only).

It is enabled only for `pi-like` when the effective face comes from the preset: `legacy` and effective personal `background`/`states` faces keep their original appearance. A selected/hovered row still paints the real highlight fill underneath the diff body (selection = `messageActionsBackground`, hover = `toolCardBackground`): the header, the card's thick gutter and context rows keep the selection/hover cue there, so it is never swallowed by a black sub-box. Split changed rows keep their own content-layer substrate (the same layering as `legacy`), so the add/del distinction survives; changed words are always re-picked against their own row fill and never cleared by the highlight, while context and other unchanged text keep their syntax colours exactly as when unselected.

The line substrate derives from the theme's own diff word colour mixed faintly into the actual terminal background, with no new palette: on a dark truecolor terminal it lands around `#101b13` (add) / `#201214` (del), on a light terminal on a near-white pale green/rose. The 256-colour tier names explicit slots instead of letting 6×6×6 quantization lift the near-black mix into a palette-59 grey — 22/52 (`#005f00` / `#5f0000`) on dark, 151/181 (sage / rose) on light; ANSI-name-only themes have no channels to mix and fall back to the same explicit slots even at truecolor. The 16-colour tier has no faint step, so the substrate falls back to the terminal and only the word colours distinguish additions from deletions. Word colours are picked against their own actual background: unified keeps the theme's `diffAddedWord`/`diffRemovedWord` (about 5.03:1 / 5.92:1 on black); a split changed word that falls below 4.5:1 on its line tint is adjusted only on that word — hue-preserving lightening/darkening at truecolor, explicit pale slots 194/224 on dark 256 line tints and slots 22/52 on light ones. A highlight fill gets its own pass (for unified changed words and for the 16-colour split, which has no line tint): at the 256-colour tier a dark highlight quantizes to a mid grey such as palette 59, where the theme words only reach about 2.6/2.0:1 (add/del), so the card emits explicit slots 194/224 (pale green/rose, about 5.8/4.8:1 on palette 59); a light highlight keeps 22/52; truecolor keeps lifting/darkening the words against the real highlight until 4.5:1. The 16-colour tier has no such steps and can only name the terminal's own green/red slots: selected/hovered contrast then depends on the user's palette (the regression only asserts ≥2:1 on the default dark palette, and the highlight may share the terminal-black slot). Real rendering regressions read actual cells for unified/split, oldText-newText and patch, context and changed words: the two changed-row substrates must be different and near black/white, unchanged keywords/variables must match `legacy`'s actual rendering cell for cell (compared only after cli-highlight has landed), changed words must pass against their own row fill, context must stay unpainted, selection/hover must remain visible, and the 120-column split selection and real-hover regressions additionally require the old/new row fills to stay different, the header/thick gutter/context to keep the cue, and the content substrate to survive the pointer leaving; legacy colours and explicit overrides stay intact.

## Job progress line

`kinds.job.progressStyle` controls only the **background-job card in the conversation**: `pi-like` defaults to `line`, `legacy` defaults to `bar`, an explicit value wins, and junk falls back to the preset default. `line` draws a thin line, a dimmed remainder, and the producer's raw `n/m` counter: no background fill, no block glyphs, no extra percentage. Its colour only expresses the ratio (first third theme `accent`, middle `ide`, last `success`); the line and the counter share that stage colour, and it never recolours the job as failed at low progress and changes no status glyph or domain fact. A value that is not an `n/m` ratio (free text, `0/0`, an overflowing number) passes through verbatim with no invented progress; values above the total clamp only the visual ratio while the counter stays as reported. The header keeps its original fixed narrow slot: a long counter first shortens the line, and when even two cells do not fit only the counter remains — still coloured by the parseable ratio stage — truncated to that slot width without pushing the title or base fields onto another row.

```json
{
  "preset": "pi-like",
  "kinds": {
    "job": { "progressStyle": "bar" }
  }
}
```

`line` belongs to conversation job cards only; the shared `/jobs` panel passes no style and keeps the original block `bar` under every preset, as does the `legacy` conversation card. Switching presets does not clear this override.

## User card and terminal background

The `pi-like` user card (user messages and team messages share one configuration) follows the **actual terminal background**: by default it blends the active theme's text colour into the terminal background at roughly 3.5%, so the background shows through and the card reads as an almost transparent surface (terminals have no real alpha; this is a very pale solid colour, not translucency). A dark theme's text colour is lighter, so the face lifts very slightly; a light theme's is darker, so it darkens very slightly. The background comes from the existing `useTerminalBackground()` (the OSC 11 answer, or black/white by palette lightness when there is none), so a detected, palette-compatible background receives only a slight change. A forced or hand-picked theme, an unavailable background, or a detected background discarded for a polarity mismatch can activate the existing black/white fallback, which cannot guarantee a near-transparent appearance.

It does not use the hover or selection highlight (`userMessageBackgroundHover` is the saturated #3B5BDB blue on `dark`, `messageActionsBackground` is the selection cue): selection still wins, so a selected card keeps its own selection colour and stays distinguishable from the face.

Lower colour tiers cannot render such a pale fill and degrade the same “distinguishable and readable” way:

| Tier | Default user face |
| --- | --- |
| Truecolor | ~3.5% of the text colour over the terminal background (measured channel distance to that background ~11–14, body contrast ≥ 9.7:1) |
| 256 colours | The nearest neutral grey-ramp slot (232–255); near-white lands on 255 (#eeeeee), near-black on 232 |
| 16 colours / colour off | No fill |

At 256 colours the face never goes through 6×6×6 quantization, which lifts a near-black or near-white solid into a whole `#5f5f5f`-class grey block (`rgb(30,30,34)` lands on palette 59); it names the terminal's own grey ramp instead, which carries no hue. The 16-colour tier has no pale fill to offer and a saturated block is further from the near-transparent look, so the default user face is unfilled there while the layout (the inter-card breathing row and the original indent) stays. ANSI-name-only themes (`dark-ansi`, `pink-ansi`) have no channels to blend and use the 256-colour slot even at truecolor. An explicit `background` is not a preset face: it paints as given at every tier.

## Recovery and maintenance

Remove `cardStyles` from both user and deployment layers, or set the effective object to `{ "preset": "legacy" }` without `common`/`kinds` overrides, to recover the old appearance. No session-data migration is needed.

Downstream logic lives in `src/cardStyles.ts`, `src/components/cardSurface.tsx`, `src/components/diffAppearance.ts`, and `src/components/Chat/JobLineProgress.tsx`. Existing cards only receive surface, content-width, diff-presentation, progress-style, and folding integration points. Projection, diff parsing/algorithms, and interactive panels are untouched. After upstream updates, run:

```sh
node --import tsx/esm scripts/downstream/verify-card-styles.ts
node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
FORCE_COLOR=2 node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
FORCE_COLOR=1 node --import tsx/esm scripts/downstream/verify-card-rendering.tsx
node --import tsx/esm scripts/downstream/verify-card-demo.tsx
```

Rendering tests exercise the real `MessageList` and the same scene the demo entry renders (`verify-card-demo.tsx` checks that bodies are visible and scrolling leaves no blank band); colour matrices inspect terminal cells, not just configuration strings. Credential-free development demo:

```sh
node --import tsx/esm scripts/downstream/card-styles-demo.tsx --width 40
node --import tsx/esm scripts/downstream/card-styles-demo.tsx --inline --settings .scratch/card-styles/settings.example.json
```

The demo isolates HOME and uses the `auto` theme to follow the terminal background, falling back to dark if the terminal does not answer detection. It also sets `DSH_TUI_TMUX_TRUECOLOR ??= '1'` before dynamically importing the UI so the truecolour near-black steps are visible past tmux's default 256-colour clamp; an explicit `FORCE_COLOR=2/1` still degrades as requested, and the production app never sets the variable automatically. It makes no backend calls and leaves the stable installation untouched. `Alt+1/2/3` selects legacy/pi-like/border overrides; `Alt+4` restores the supplied file preset when `--settings` is used. `Alt+o` toggles global expansion; arrows or `j/k` scroll; `Ctrl+C` exits. A real TTY is required. Delivery evidence and personal acceptance steps live in the feature directory's `delivery.md`.
