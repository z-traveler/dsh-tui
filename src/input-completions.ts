// Re-export shim: the Cordis-backed implementation lives behind the adapter
// boundary so UI consumers never import official @deepseek-ai/* packages.
// Plugin authors import the seam types from here and read `ctx.tuiInputCompletions`
// (the module also applies the `declare module '@deepseek-ai/cordis'` augmentation).
export { name, TuiInputCompletionRuntime } from './dsh-adapter/input-completions.js'
export type {
  TuiInputCompletionCandidate,
  TuiInputCompletionContext,
  TuiInputCompletionProvider,
  TuiInputCompletionQuery,
  TuiInputCompletionToken,
  TuiInputCompletionTrigger,
} from './dsh-adapter/input-completions.js'
export { default } from './dsh-adapter/input-completions.js'
