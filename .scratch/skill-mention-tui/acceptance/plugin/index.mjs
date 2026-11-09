// Installable acceptance consumer of the NORMAL completion API. Not shipped code.
// Skill matching is reused from its domain owner, not implemented in production TUI.
import { completionAt, matchSkillNames } from '/home/liyihang/projects/dsh-src/dsh-skill-mention/src/mentions.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'

export const name = 'skill-mention-completion-fixture'
export const inject = ['tuiInputCompletions', 'commands', 'agents', 'skills']

export async function apply(ctx) {
  for (let i = 1; i <= 20; i += 1) {
    const name = `sample-${String(i).padStart(2, '0')}`
    ctx.skills.register({ name, description: `合成用户技能 ${i}`, source: 'runtime', content: `${name}: synthetic instructions only.`, invocation: { userInvocable: true, modelInvocable: false } })
  }
  ctx.skills.register({ name: 'model-only', description: '不应进入用户候选', source: 'runtime', content: 'Synthetic model-only skill.', invocation: { userInvocable: false, modelInvocable: true } })
  const mount = () => ctx.plugin({
    name: 'acceptance-completion-sources',
    inject: ['tuiInputCompletions'],
    apply(scope) {
      scope.tuiInputCompletions.register({
        id: 'acceptance-skills', label: '技能候选', priority: 30,
        trigger: token => completionAt(token.text, token.cursor) ?? undefined,
        async query({ query, context }, signal) {
          if (context.backendId !== 'dsh') return []
          const agent = ctx.agents.get(SessionId(context.sessionId))
          if (!agent) return []
          const registry = ctx.get('agentPresets')?.serviceFor(agent, 'skills') ?? ctx.skills
          const snapshot = await registry.snapshot({ scope: agent, cwd: context.cwd, signal })
          const skills = snapshot.skills.filter(isUserInvocable)
          const byName = new Map(skills.map(skill => [skill.name, skill]))
          return matchSkillNames(skills.map(skill => skill.name), query).map(name => ({
            id: name, name, description: byName.get(name).description,
            replacement: `#skill:${name} `,
          }))
        },
      })
      scope.tuiInputCompletions.register({
        id: 'acceptance-tickets', label: '工单候选', priority: 10,
        trigger: token => token.text.startsWith('#') ? { query: token.text.slice(1, token.cursor) } : undefined,
        query: ({ query }) => query === '' ? [{ id: 'ticket-42', name: 'synthetic-ticket', description: '低优先级第二来源', replacement: '#ticket:42 ' }] : [],
      })
    },
  })
  let fiber = mount()
  await fiber.await()
  ctx.commands.register({
    name: 'demo-completions', description: '启用/禁用两个演示补全源（加载核心保持不变）',
    handler: async () => {
      if (fiber !== undefined) { await fiber.dispose(); fiber = undefined; return { kind: 'success', text: 'COMPLETIONS=disabled' } }
      fiber = mount()
      await fiber.await()
      return { kind: 'success', text: 'COMPLETIONS=enabled' }
    },
  })
  ctx.provide('completionAcceptanceReady', true)
}
