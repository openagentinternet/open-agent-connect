#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_SKILL_DEST="${METABOT_SHARED_SKILL_DEST:-$HOME/.metabot/skills}"
BIN_DIR="${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
SOURCE_ROOT="${METABOT_SOURCE_ROOT:-}"
CLI_ENTRY="${METABOT_CLI_ENTRY:-}"
SOURCE_SKILLS_ROOT="$SCRIPT_DIR/skills"
BUNDLED_CLI_ENTRY="$SCRIPT_DIR/runtime/dist/cli/main.js"
BUNDLED_COMPATIBILITY_COPY="$SCRIPT_DIR/runtime/compatibility.json"

mkdir -p "$SHARED_SKILL_DEST"
mkdir -p "$BIN_DIR"

resolve_cli_entry() {
  if [ -n "$CLI_ENTRY" ] && [ -f "$CLI_ENTRY" ]; then
    return 0
  fi

  if [ -n "$SOURCE_ROOT" ] && [ -f "$SOURCE_ROOT/dist/cli/main.js" ]; then
    CLI_ENTRY="$SOURCE_ROOT/dist/cli/main.js"
    return 0
  fi

  if [ -f "$BUNDLED_CLI_ENTRY" ]; then
    CLI_ENTRY="$BUNDLED_CLI_ENTRY"
    return 0
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

resolve_node_bin() {
  if [ -n "${METABOT_NODE:-}" ]; then
    if [ -x "$METABOT_NODE" ]; then
      printf '%s\n' "$METABOT_NODE"
      return 0
    fi
    echo "METABOT_NODE is set but is not executable: $METABOT_NODE" >&2
    return 1
  fi

  for candidate in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node /opt/homebrew/bin/node22 /usr/local/bin/node22; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
    major="$("$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
    if [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null && [ "$major" -lt 25 ] 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
    version="$("$candidate" -v 2>/dev/null || printf unknown)"
    echo "Unsupported Node.js version at $candidate ($version). Open Agent Connect requires Node.js >=20 <25. Install node@22 or set METABOT_NODE." >&2
    return 1
  fi

  echo "Node.js >=20 <25 is required. Install node@22 or set METABOT_NODE." >&2
  return 1
}

NODE_BIN="$(resolve_node_bin)"

[ -d "$SOURCE_SKILLS_ROOT" ] || {
  echo "Shared MetaBot skills not found at $SOURCE_SKILLS_ROOT" >&2
  exit 1
}

if ! resolve_cli_entry; then
  build_cli_from_source || true
  resolve_cli_entry || {
    echo "MetaBot CLI entry not found. Set METABOT_SOURCE_ROOT or METABOT_CLI_ENTRY before running install.sh." >&2
    exit 1
  }
fi

for skill_dir in "$SOURCE_SKILLS_ROOT"/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  target_dir="$SHARED_SKILL_DEST/$skill_name"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "$skill_dir"/. "$target_dir"/
done

write_cli_shim() {
  local target_name="$1"
  {
    printf '%s
' '#!/usr/bin/env bash'
    printf '%s
' 'set -euo pipefail'
    printf 'PREFERRED_CLI_ENTRY="%s"
' "$CLI_ENTRY"
    printf '%s
' 'CLI_ENTRY="${METABOT_CLI_ENTRY:-}"'
    printf '%s
' 'if [ -n "$CLI_ENTRY" ] && [ ! -f "$CLI_ENTRY" ]; then'
    printf '%s
' '  CLI_ENTRY=""'
    printf '%s
' 'fi'
    printf '%s
' 'if [ -z "$CLI_ENTRY" ] && [ -n "$PREFERRED_CLI_ENTRY" ] && [ -f "$PREFERRED_CLI_ENTRY" ]; then'
    printf '%s
' '  CLI_ENTRY="$PREFERRED_CLI_ENTRY"'
    printf '%s
' 'fi'
    printf '%s
' 'if [ -z "$CLI_ENTRY" ]; then'
    printf '%s
' '  for _f in "$HOME/.metabot/installpacks"/*/runtime/dist/cli/main.js; do'
    printf '%s
' '    [ -f "$_f" ] && CLI_ENTRY="$_f" && break'
    printf '%s
' '  done'
    printf '%s
' 'fi'
    printf '%s
' '[ -f "$CLI_ENTRY" ] || {'
    printf '%s
' '  echo "MetaBot CLI not found. Please reinstall: https://github.com/openagentinternet/open-agent-connect/releases/latest" >&2'
    printf '%s
' '  exit 1'
    printf '%s
' '}'
    printf '%s\n' 'resolve_node_bin() {'
    printf '%s\n' '  if [ -n "${METABOT_NODE:-}" ]; then'
    printf '%s\n' '    if [ -x "$METABOT_NODE" ]; then'
    printf '%s\n' '      printf '\''%s\n'\'' "$METABOT_NODE"'
    printf '%s\n' '      return 0'
    printf '%s\n' '    fi'
    printf '%s\n' '    echo "METABOT_NODE is set but is not executable: $METABOT_NODE" >&2'
    printf '%s\n' '    return 1'
    printf '%s\n' '  fi'
    printf '%s\n' ''
    printf '%s\n' '  for candidate in /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@22/bin/node /opt/homebrew/bin/node22 /usr/local/bin/node22; do'
    printf '%s\n' '    if [ -x "$candidate" ]; then'
    printf '%s\n' '      printf '\''%s\n'\'' "$candidate"'
    printf '%s\n' '      return 0'
    printf '%s\n' '    fi'
    printf '%s\n' '  done'
    printf '%s\n' ''
    printf '%s\n' '  if command -v node >/dev/null 2>&1; then'
    printf '%s\n' '    candidate="$(command -v node)"'
    printf '%s\n' '    major="$("$candidate" -p '\''Number(process.versions.node.split(".")[0])'\'' 2>/dev/null || true)"'
    printf '%s\n' '    if [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null && [ "$major" -lt 25 ] 2>/dev/null; then'
    printf '%s\n' '      printf '\''%s\n'\'' "$candidate"'
    printf '%s\n' '      return 0'
    printf '%s\n' '    fi'
    printf '%s\n' '    version="$("$candidate" -v 2>/dev/null || printf unknown)"'
    printf '%s\n' '    echo "Unsupported Node.js version at $candidate ($version). Open Agent Connect requires Node.js >=20 <25. Install node@22 or set METABOT_NODE." >&2'
    printf '%s\n' '    return 1'
    printf '%s\n' '  fi'
    printf '%s\n' ''
    printf '%s\n' '  echo "Node.js >=20 <25 is required. Install node@22 or set METABOT_NODE." >&2'
    printf '%s\n' '  return 1'
    printf '%s\n' '}'
    printf '%s
' 'NODE_BIN="$(resolve_node_bin)"'
    printf '%s
' 'exec "$NODE_BIN" "$CLI_ENTRY" "$@"'
  } > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}

write_cli_shim "metabot"

echo "Installed shared MetaBot skills to $SHARED_SKILL_DEST"
echo "Installed primary CLI shim to $BIN_DIR/metabot"
echo "Primary CLI path: metabot"
echo "Compatibility manifest: release/compatibility.json"
echo "Bundled compatibility copy: $BUNDLED_COMPATIBILITY_COPY"
