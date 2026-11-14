// Re-export shim: the Cordis-backed implementation lives behind the adapter
// boundary so UI consumers never import official @deepseek-ai/* packages.
// Plugin authors import the seam types from here and read `ctx.tuiInput`
// (the module also applies the `declare module '@deepseek-ai/cordis'` augmentation).
export { name, TuiInputRuntime } from './dsh-adapter/command-drafts.js'
export type { TuiCommandDraftMapper, TuiCommandDraftPacket } from './dsh-adapter/command-drafts.js'
export { default } from './dsh-adapter/command-drafts.js'
