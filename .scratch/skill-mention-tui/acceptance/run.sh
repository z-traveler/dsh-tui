#!/usr/bin/env bash
# Isolated acceptance. No inherited model credentials; local synthetic model only.
set -eu
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-fullscreen}"
if test "$#" -gt 0; then shift; fi
case "$mode" in
  fullscreen) ;;
  inline) set -- --patch "$here/state/inline.yml" "$@" ;;
  *) printf 'Usage: bash %s [fullscreen|inline] [dsh options...]\n' "$0" >&2; exit 2 ;;
esac
host=/home/liyihang/projects/dsh-src/dsh-context/.acceptance/host/node_modules/@deepseek-ai/dsh/lib/bin.js
if ! test -f "$host"; then printf 'Pinned rc.5 acceptance host is unavailable: %s\n' "$host" >&2; exit 1; fi
if ! test -f "$here/state/dsh/profiles/skill-mention-tui/cordis.patch.yml"; then printf 'Acceptance profile has not been prepared.\n' >&2; exit 1; fi
mkdir -p "$here/state/ui-$mode"
cd "$here/state/workspace"
exec env -i PATH="$PATH" HOME="$here/state/ui-$mode" DSH_HOME="$here/state/dsh" TERM="${TERM:-xterm-256color}" COLORTERM=truecolor DSH_TUI_LANG=zh DSH_TUI_BACKEND=dsh node --import "$here/net-guard.mjs" "$host" --profile skill-mention-tui "$@"
