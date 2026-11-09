// Configure only the disposable profile created by `dsh plugin --profile ... add`.
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url))
const workspace = join(here, 'state/workspace')
const profile = join(here, 'state/dsh/profiles/skill-mention-tui')
await mkdir(profile, { recursive: true })
// Stop ancestor skill discovery at this disposable workspace, not the real repo.
await mkdir(workspace, { recursive: true })
execFileSync('git', ['init', '-b', 'acceptance', workspace], { stdio: 'pipe' })
await copyFile(join(here, 'demo-provider.mjs'), join(profile, 'demo-provider.mjs'))
const config = fullscreen => `    backend: dsh\n    cwd: ${JSON.stringify(workspace)}\n    provider: skill-mention-local\n    model: deepseek-v4-flash\n    sessionCards: true\n    recapOnOpen: false\n    fullscreen: ${fullscreen}\n`
await writeFile(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek
  disabled: true
- id: llm-deepseek-account
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: session-log-deepseek
  disabled: true
- id: plugin-package-inventory-deepseek
  disabled: true
- id: session-telemetry-otel
  disabled: true
- id: session-title-llm
  disabled: true
- id: hmr
  disabled: true
- id: skill-filesystem
  disabled: false
  config:
    providerName: skill-mention-acceptance-files
    includeDefaultRoots: false
    customSkillDirs: [${JSON.stringify(join(workspace, '.agents/skills'))}]
    watch: false
- insert:
    - id: skill-mention-acceptance-model
      name: ./demo-provider.mjs
- id: dsh-tui
  inject: [workspaceRegistry, agents, tuiWorkspaces, tuiScenes, tuiPanels, tuiDialogs, tuiStatus, tuiShortcuts, tuiRenderers, tuiThemes, skillMentionAcceptanceReady]
  config:
${config(true)}`)
await writeFile(join(here, 'state/inline.yml'), `- id: dsh-tui\n  config:\n${config(false)}`)
if (process.argv[2] !== undefined) {
  for (const fullscreen of [true, false]) {
    const mode = fullscreen ? 'fullscreen' : 'inline'
    await writeFile(join(here, `state/resume-${mode}.yml`), `- id: dsh-tui\n  config:\n${config(fullscreen)}    sessionId: ${JSON.stringify(process.argv[2])}\n`)
  }
}
console.log(`Prepared disposable profile: ${profile}`)
