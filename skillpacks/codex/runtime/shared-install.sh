#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_SKILL_DEST="${METABOT_SHARED_SKILL_DEST:-$HOME/.metabot/skills}"
BIN_DIR="${METABOT_BIN_DIR:-$HOME/.metabot/bin}"
LEGACY_BIN_DIR="${METABOT_LEGACY_BIN_DIR:-$HOME/.agent-connect/bin}"
SOURCE_ROOT="${METABOT_SOURCE_ROOT:-}"
CLI_ENTRY="${METABOT_CLI_ENTRY:-}"
SOURCE_SKILLS_ROOT="$SCRIPT_DIR/shared-skills"
BUNDLED_CLI_ENTRY="$SCRIPT_DIR/dist/cli/main.js"
BUNDLED_COMPATIBILITY_COPY="$SCRIPT_DIR/compatibility.json"

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

command -v node >/dev/null 2>&1 || {
  echo "node is required to run the MetaBot CLI." >&2
  exit 1
}

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
  printf '%s
'     '#!/usr/bin/env bash'     'set -euo pipefail'     "exec node "$CLI_ENTRY" "'"$@"'     > "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"
}

path_contains_entry() {
  local target_dir="$1"
  local normalized_target="${target_dir%/}"
  local path_entry=""
  IFS=':' read -r -a path_entries <<< "${PATH:-}"
  for path_entry in "${path_entries[@]}"; do
    [ "${path_entry%/}" = "$normalized_target" ] && return 0
  done
  return 1
}

write_legacy_forwarder_shim() {
  [ "$LEGACY_BIN_DIR" = "$BIN_DIR" ] && return 0
  mkdir -p "$LEGACY_BIN_DIR"
  cat > "$LEGACY_BIN_DIR/metabot" <<EOF
#!/usr/bin/env bash
set -euo pipefail
CANONICAL_METABOT_BIN="$BIN_DIR/metabot"
  [ -x "\$CANONICAL_METABOT_BIN" ] || {
  echo "Canonical MetaBot CLI shim not found at \$CANONICAL_METABOT_BIN" >&2
  exit 1
}
exec "\$CANONICAL_METABOT_BIN" "\$@"
EOF
  chmod +x "$LEGACY_BIN_DIR/metabot"
}

write_cli_shim "metabot"

if [ -d "$LEGACY_BIN_DIR" ] || [ -f "$LEGACY_BIN_DIR/metabot" ] || path_contains_entry "$LEGACY_BIN_DIR"; then
  write_legacy_forwarder_shim
  echo "Refreshed legacy compatibility shim at $LEGACY_BIN_DIR/metabot"
fi

echo "Installed shared MetaBot skills to $SHARED_SKILL_DEST"
echo "Installed primary CLI shim to $BIN_DIR/metabot"
echo "Primary CLI path: metabot"
echo "Compatibility manifest: release/compatibility.json"
echo "Bundled compatibility copy: $BUNDLED_COMPATIBILITY_COPY"
