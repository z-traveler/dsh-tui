// Only changes this acceptance workspace's two synthetic skills, never real skills.
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), 'state/workspace/.agents/skills')
const action = process.argv[2] ?? 'reset'
if (!['reset', 'change-alpha', 'delete-alpha'].includes(action)) throw new Error('Usage: node fixtures.mjs [reset|change-alpha|delete-alpha]')
const alpha = join(root, 'alpha/SKILL.md')
if (action === 'delete-alpha') {
  await unlink(alpha).catch(error => { if (error.code !== 'ENOENT') throw error })
} else {
  await mkdir(join(root, 'alpha'), { recursive: true })
  await mkdir(join(root, 'beta'), { recursive: true })
  const header = name => `---\nname: ${name}\ndescription: Synthetic ${name} skill for isolated TUI acceptance\nuser-invocable: true\ndisable-model-invocation: true\n---\n`
  await writeFile(alpha, header('alpha') + (action === 'change-alpha'
    ? 'ALPHA_CURRENT_FILE_CHANGED: this is not the original loaded snapshot.\n'
    : ['# Alpha synthetic instructions', ...Array.from({ length: 90 }, (_, i) => `ALPHA-${i + 1} 中文🧪 ${'保持当时正文'.repeat(4)}`), 'ALPHA_INSTRUCTIONS_END'].join('\n') + '\n'))
  if (action === 'reset') await writeFile(join(root, 'beta/SKILL.md'), header('beta') + '# Beta synthetic instructions\nBETA_INSTRUCTIONS_END\n')
}
console.log(`Synthetic fixtures: ${action}`)
