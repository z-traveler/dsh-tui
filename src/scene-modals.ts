// Plugin-facing modal window types (downstream plugin-modals feature),
// re-exported by the `./scenes` shim. The host-only controls (`TuiModalHost`)
// intentionally stay out.
export type {
  TuiModalContentSize,
  TuiModalDescriptor,
  TuiModalFailureCode,
  TuiModalInstance,
  TuiModalOpenResult,
  TuiModalProps,
  TuiModalRejectionCode,
} from './dsh-adapter/modal-stack.js'
// Window options (geometry, appearance, visibility) and the rect the host
// reports back. A plugin must check `tuiScenes.modalOptionsVersion` before
// relying on them: an older host ignores the second `openModal` argument.
export type {
  TuiModalAnchor,
  TuiModalBorderStyle,
  TuiModalBounds,
  TuiModalColor,
  TuiModalEdges,
  TuiModalLength,
  TuiModalOptions,
  TuiModalStyle,
} from './modal-options.js'
