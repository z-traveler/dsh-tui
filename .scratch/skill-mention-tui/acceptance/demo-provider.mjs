// Acceptance-only local LLM + skill source. No external requests or credentials.
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createUserMessage, boundContextSummary } from '@deepseek-ai/dsh-llm'
import { registerDeepSeekProvider, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'

export const name = 'skill-mention-tui-acceptance'
export const inject = ['llm', 'commands', 'skills']

export async function apply(ctx) {
  let requests = 0
  let delayMs = 0
  let lastRequest = ''
  const timers = new Set()
  const server = createServer((request, response) => {
    void (async () => {
      let body = ''
      for await (const chunk of request) body += chunk
      if (request.method !== 'POST' || !request.url?.endsWith('/messages')) {
        response.writeHead(404).end()
        return
      }
      requests += 1
      // Only synthetic messages are used. Keep an in-memory observation, never a body log.
      lastRequest = JSON.stringify(JSON.parse(body).messages)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      send('message_start', { message: { id: `fixture-${requests}`, type: 'message', role: 'assistant', model: 'deepseek-v4-flash', content: [], usage: { input_tokens: 12, output_tokens: 1 } } })
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '本地合成响应，没有调用外部模型。' } })
      const finish = () => {
        if (response.destroyed) return
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })
        send('message_stop', {})
        response.end()
      }
      if (delayMs === 0) finish()
      else {
        const timer = setTimeout(() => { timers.delete(timer); finish() }, delayMs)
        timers.add(timer)
        response.once('close', () => { clearTimeout(timer); timers.delete(timer) })
      }
    })().catch(() => response.destroy())
  })
  ctx.effect(() => () => new Promise((resolve, reject) => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Acceptance loopback listener unavailable')
  const options = resolveAdapterOptions({ baseURL: `http://127.0.0.1:${address.port}`, thinking: 'disabled' })
  registerDeepSeekProvider(ctx, 'skill-mention-local', {
    options: () => options,
    providerName: 'Local synthetic skill mention fixture',
    resolveAuth: async () => ({ headers: { 'x-api-key': 'SYNTHETIC_ACCEPTANCE_KEY' } }),
  })

  // A real provider advertises an unreadable skill so partial failure is reproducible,
  // independent of filesystem permissions or which user launches the demo.
  ctx.skills.registerProvider(() => ({
    name: 'acceptance-unreadable-skill',
    list: async () => [{ name: 'unreadable', description: '合成读取失败，其他技能继续', invocation: { userInvocable: true, modelInvocable: false }, source: 'custom', provider: 'acceptance-unreadable-skill', rank: 0, locator: 'unreadable' }],
    get: async () => { throw new Error('EACCES: synthetic acceptance failure') },
  }))

  ctx.commands.register({
    name: 'demo-count', description: '查看本地替身请求计数（不请求模型）',
    handler: () => ({ kind: 'success', text: `LOCAL_REQUESTS=${requests}` }),
  })
  ctx.commands.register({
    name: 'demo-evidence', description: '查看最后一轮加载正文和失败说明的观测',
    handler: () => ({ kind: 'success', text: [
      `LOCAL_REQUESTS=${requests}`,
      `ALPHA_BODY_PRESENT=${lastRequest.includes('ALPHA_INSTRUCTIONS_END')}`,
      `BETA_BODY_PRESENT=${lastRequest.includes('BETA_INSTRUCTIONS_END')}`,
      `FAILURE_CONTEXT_PRESENT=${lastRequest.includes('unreadable') && lastRequest.includes('could not be loaded')}`,
    ].join('\n') }),
  })
  ctx.commands.register({
    name: 'demo-slow', description: '切换下一轮本地响应为 8 秒或立即结束',
    handler: () => { delayMs = delayMs === 0 ? 8000 : 0; return { kind: 'success', text: `LOCAL_DELAY_MS=${delayMs}` } },
  })
  ctx.commands.register({
    name: 'demo-notice', description: '创建不依赖 skill-mention 的合法长通知',
    handler: ({ agent }) => {
      const summary = '独立来源的通用上下文通知：摘要不是完整正文'
      const text = ['NOTICE_BODY_START', ...Array.from({ length: 220 }, (_, i) => `通知正文 ${i + 1} 中文🧪 ${'片段'.repeat(10)}`), 'NOTICE_BODY_END'].join('\n')
      agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'acceptance-ledger', form: 'notice', summary: boundContextSummary(summary) } }), { surfaceOp: 'append' })
      return { kind: 'success' }
    },
  })
  ctx.provide('skillMentionAcceptanceReady', true)
}
