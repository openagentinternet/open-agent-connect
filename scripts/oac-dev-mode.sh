#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="codex"
RESTART_DAEMON=0
SKIP_BUILD=0

usage() {
  cat <<'USAGE'
Usage: scripts/oac-dev-mode.sh [--host <codex|claude-code|openclaw>] [--restart-daemon] [--skip-build]

Switch the local Open Agent Connect install to this source checkout for fast
acceptance testing from another host session.

Options:
  --host <host>       Host skill root to bind. Defaults to codex.
  --restart-daemon   Stop and start the local daemon after relinking.
  --skip-build       Reinstall/bind without running npm run build.
  --help, -h         Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      [ "$#" -ge 2 ] || {
        echo "Missing value for --host" >&2
        exit 2
      }
      HOST="$2"
      shift 2
      ;;
    --restart-daemon)
      RESTART_DAEMON=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$HOST" in
  codex|claude-code|openclaw)
    ;;
  *)
    echo "Unsupported host: $HOST. Use codex, claude-code, or openclaw." >&2
    exit 2
    ;;
esac

OAC_ENTRY="$ROOT_DIR/dist/oac/main.js"

echo "[oac-dev-mode] Workspace: $ROOT_DIR"
echo "[oac-dev-mode] Host: $HOST"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "[oac-dev-mode] Building core runtime and UI modules"
  (
    cd "$ROOT_DIR"
    npm run build
  )
else
  echo "[oac-dev-mode] Build skipped"
fi

[ -f "$OAC_ENTRY" ] || {
  echo "Missing $OAC_ENTRY. Run without --skip-build first." >&2
  exit 1
}

echo "[oac-dev-mode] Linking local install to this source checkout"
node "$OAC_ENTRY" install --host "$HOST"

export PATH="$HOME/.metabot/bin:$PATH"

echo "[oac-dev-mode] Verifying local development install"
node "$OAC_ENTRY" doctor --host "$HOST"
metabot --help >/dev/null

if [ "$RESTART_DAEMON" -eq 1 ]; then
  echo "[oac-dev-mode] Restarting daemon from the development runtime"
  metabot daemon stop >/dev/null || true
  metabot daemon start
  echo "[oac-dev-mode] Daemon restarted from the development runtime"
else
  echo "[oac-dev-mode] Daemon restart skipped"
fi

cat <<EOF

Open Agent Connect is now linked to this source checkout.
Host: $HOST
Runtime entry: $ROOT_DIR/dist/cli/main.js
Shared skills: $HOME/.metabot/skills

Start a fresh Codex session for natural language acceptance testing. Suggested prompt:

请检查当前 Open Agent Connect 是否运行在开发模式，并用自然语言测试我刚修改的功能。请优先验证核心逻辑、相关技能和本地 UI 行为是否来自当前源码仓库。
EOF
