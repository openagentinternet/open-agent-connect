#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
SHARED_INSTALL="$SCRIPT_DIR/runtime/shared-install.sh"

[ -f "$SHARED_INSTALL" ] || {
  echo "Bundled shared installer not found at $SHARED_INSTALL" >&2
  exit 1
}

"$SHARED_INSTALL"

METABOT_BIN="$BIN_DIR/metabot"
[ -x "$METABOT_BIN" ] || {
  echo "Expected installed CLI shim at $METABOT_BIN" >&2
  exit 1
}

"$METABOT_BIN" host bind-skills --host openclaw

echo "Bound shared MetaBot skills into the openclaw host root"
