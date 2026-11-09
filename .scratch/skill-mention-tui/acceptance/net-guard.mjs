// Acceptance process only; never part of the application or plugin API.
const transport = globalThis.fetch
const local = new Set(['127.0.0.1', '[::1]', 'localhost'])
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!local.has(url.hostname)) return Promise.reject(new Error('External network disabled in isolated skill mention acceptance'))
  return transport(input, { ...init, redirect: 'error' })
}
