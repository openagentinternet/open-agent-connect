#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${AGENT_CONNECT_SKILL_DEST:-${METABOT_SKILL_DEST:-${OPENCLAW_HOME:-$HOME/.openclaw}/skills}}"
BIN_DIR="${AGENT_CONNECT_BIN_DIR:-${METABOT_BIN_DIR:-$HOME/.agent-connect/bin}}"
SOURCE_ROOT="${AGENT_CONNECT_SOURCE_ROOT:-${METABOT_SOURCE_ROOT:-}}"
CLI_ENTRY="${AGENT_CONNECT_CLI_ENTRY:-${METABOT_CLI_ENTRY:-}}"

mkdir -p "$DEST_ROOT"
mkdir -p "$BIN_DIR"

resolve_cli_entry() {
  if [ -n "$CLI_ENTRY" ] && [ -f "$CLI_ENTRY" ]; then
    return 0
  fi

  if [ -n "$SOURCE_ROOT" ] && [ -f "$SOURCE_ROOT/dist/cli/main.js" ]; then
    CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
    return 0
  fi

  if [ -f "$SCRIPT_DIR/runtime/dist/cli/main.js" ]; then
    CLI_ENTRY="$SCRIPT_DIR/runtime/dist/cli/main.js"
    return 0
  fi

  if [ -z "$SOURCE_ROOT" ] && [ -f "$SCRIPT_DIR/../../package.json" ]; then
    SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    if [ -f "$SOURCE_ROOT/dist/cli/main.js" ]; then
      CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
      return 0
    fi
  fi

  return 1
}

build_cli_from_source() {
  if [ -z "$SOURCE_ROOT" ]; then
    return 1
  fi

  if [ -f "$SOURCE_ROOT/package.json" ] && [ -f "$SOURCE_ROOT/tsconfig.json" ]; then
    command -v npm >/dev/null 2>&1 || {
      echo "npm is required to build the MetaBot CLI from source." >&2
      exit 1
    }
    npm --prefix "$SOURCE_ROOT" run build >/dev/null
    [ -f "$SOURCE_ROOT/dist/cli/main.js" ] || return 1
    CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
    return 0
  fi

  return 1
}

command -v node >/dev/null 2>&1 || {
  echo "node is required to run the MetaBot CLI." >&2
  exit 1
}

if ! resolve_cli_entry; then
  build_cli_from_source || true
  resolve_cli_entry || {
    echo "MetaBot CLI entry not found. Set AGENT_CONNECT_SOURCE_ROOT or AGENT_CONNECT_CLI_ENTRY before running install.sh." >&2
    exit 1
  }
fi

for skill_dir in "$SCRIPT_DIR"/skills/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  target_dir="$DEST_ROOT/$skill_name"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "$skill_dir"/. "$target_dir"/
done

write_cli_shim() {
  local target_name="$1"
  printf '%s
'     '#!/usr/bin/env bash'     'set -euo pipefail'     "exec node "$CLI_ENTRY" "\$@""     > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}

write_cli_shim "metabot"
write_cli_shim "agent-connect"

echo "Installed Open Agent Connect skills to $DEST_ROOT"
echo "Installed primary CLI shim to $BIN_DIR/metabot"
echo "Installed compatibility CLI alias to $BIN_DIR/agent-connect"
echo "Primary CLI path: metabot"
echo "Compatibility CLI alias: agent-connect"
echo "Compatibility manifest: release/compatibility.json"
echo "Bundled compatibility copy: $SCRIPT_DIR/runtime/compatibility.json"
