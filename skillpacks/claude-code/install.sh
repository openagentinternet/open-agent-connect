#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
SHARED_INSTALL="$SCRIPT_DIR/runtime/shared-install.sh"
HOST_SKILLS_SOURCE="$SCRIPT_DIR/runtime/host-skills"
HOST_SKILLS_DEST="${METABOT_HOST_SKILL_DEST:-$HOME/.metabot/host-skills/claude-code}"

[ -f "$SHARED_INSTALL" ] || {
  echo "Bundled shared installer not found at $SHARED_INSTALL" >&2
  exit 1
}

"$SHARED_INSTALL"

[ -d "$HOST_SKILLS_SOURCE" ] || {
  echo "Host-specific MetaBot skills not found at $HOST_SKILLS_SOURCE" >&2
  exit 1
}

mkdir -p "$HOST_SKILLS_DEST"
for skill_dir in "$HOST_SKILLS_SOURCE"/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  target_dir="$HOST_SKILLS_DEST/$skill_name"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "$skill_dir"/. "$target_dir"/
done

METABOT_BIN="$BIN_DIR/metabot"
[ -x "$METABOT_BIN" ] || {
  echo "Expected installed CLI shim at $METABOT_BIN" >&2
  exit 1
}

"$METABOT_BIN" host bind-skills --host claude-code

echo "Bound host-specific MetaBot skills into the claude-code host root"
