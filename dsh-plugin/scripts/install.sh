#!/usr/bin/env bash
# Install open-agent-connect-dsh through the official DSH plugin CLI.
#
#   bash scripts/install.sh [version] [--profile <name>] [--link] [--dry-run]
#
#   version     npm version or range (default: latest)
#   --link      add this directory as link:<abs-path> instead of the npm package
#   --profile   DSH profile name (default: web)
#   --dry-run   print the command without running it
#   -h/--help   show this help
#
# The package declares dsh.bundle.patch (cordis.patch.yml). `dsh plugin add`
# appends it to the profile bundle stack; no manual patch-row edits.
set -euo pipefail

for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    cat <<'EOF'
Install open-agent-connect-dsh into a DSH profile.

Usage:
  bash scripts/install.sh [version] [--profile <name>] [--link] [--dry-run]

  version      npm version or range (default latest). Example: 0.3.6
  --link       mount this checkout: dsh plugin add link:<abs-path>
  --profile    target profile (default web)
  --dry-run    print the command only

Environment: DSH_HOME (default ~/.dsh), DSH_CMD (default dsh)
EOF
    exit 0
  fi
done

PKG="open-agent-connect-dsh"
DSH_CMD="${DSH_CMD:-dsh}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY_RUN=false
LINK=false
VERSION_SPEC=""
PROFILE_NAME="web"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --link) LINK=true ;;
    --profile)
      [ $# -ge 2 ] || { echo "Missing value for --profile" >&2; exit 2; }
      PROFILE_NAME="$2"
      shift
      ;;
    -h|--help) ;;
    -*)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
    *)
      if [ -n "$VERSION_SPEC" ]; then
        echo "Unexpected extra argument: $1" >&2
        exit 2
      fi
      VERSION_SPEC="$1"
      ;;
  esac
  shift
done

if [ "$LINK" = true ]; then
  SPEC="link:${ROOT_DIR}"
elif [ -n "$VERSION_SPEC" ]; then
  SPEC="${PKG}@${VERSION_SPEC}"
else
  SPEC="$PKG"
fi

if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  echo "dsh not found on PATH (set DSH_CMD). Install DeepSeek Harness first." >&2
  exit 1
fi

CMD=("$DSH_CMD" plugin --profile "$PROFILE_NAME" add "$SPEC")
echo "+ ${CMD[*]}"
if [ "$DRY_RUN" = true ]; then
  exit 0
fi
"${CMD[@]}"
