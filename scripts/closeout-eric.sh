#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTOR="eric"
CHAIN=""
COMMIT_MESSAGE=""
JOURNAL=""
VERIFY_CMD=""
STAGE_PATHS=()

usage() {
  cat <<'USAGE'
Usage: scripts/closeout-eric.sh --message <commit-message> --journal <journal-text> --verify <command> --stage <path> [--stage <path> ...] [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>]

Default closeout flow for this repo:
  1. Run the scoped verification command you provide.
  2. Stage only the named files.
  3. Run git diff --cached --check on the staged set.
  4. Create one commit.
  5. Post the eric development-journal buzz.

Required options:
  --message <text>   Commit message for this round.
  --journal <text>   Human summary for the development journal.
  --verify <cmd>     Scoped verification command. Runs through bash -lc.
  --stage <path>     File to include in the commit. Repeat for each file.

Optional:
  --from <bot-slug>  Buzz actor. Defaults to eric.
  --chain <chain>    Override the buzz write chain.
  --help, -h         Show this help.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --message)
      [ "$#" -ge 2 ] || { echo "Missing value for --message" >&2; exit 2; }
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --journal)
      [ "$#" -ge 2 ] || { echo "Missing value for --journal" >&2; exit 2; }
      JOURNAL="$2"
      shift 2
      ;;
    --verify)
      [ "$#" -ge 2 ] || { echo "Missing value for --verify" >&2; exit 2; }
      VERIFY_CMD="$2"
      shift 2
      ;;
    --stage)
      [ "$#" -ge 2 ] || { echo "Missing value for --stage" >&2; exit 2; }
      STAGE_PATHS+=("$2")
      shift 2
      ;;
    --from)
      [ "$#" -ge 2 ] || { echo "Missing value for --from" >&2; exit 2; }
      ACTOR="$2"
      shift 2
      ;;
    --chain)
      [ "$#" -ge 2 ] || { echo "Missing value for --chain" >&2; exit 2; }
      CHAIN="$2"
      shift 2
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

[ -n "$COMMIT_MESSAGE" ] || { echo "--message is required" >&2; exit 2; }
[ -n "$JOURNAL" ] || { echo "--journal is required" >&2; exit 2; }
[ -n "$VERIFY_CMD" ] || { echo "--verify is required" >&2; exit 2; }
[ "${#STAGE_PATHS[@]}" -gt 0 ] || { echo "At least one --stage path is required" >&2; exit 2; }

cd "$ROOT_DIR"

if ! git diff --cached --quiet; then
  echo "Refusing to run with pre-existing staged changes. Clear the index first." >&2
  git diff --cached --name-only >&2
  exit 1
fi

echo "[closeout] workspace: $ROOT_DIR"
echo "[closeout] actor: $ACTOR"
git status --short --branch

echo "[closeout] running verification"
bash -lc "$VERIFY_CMD"

echo "[closeout] staging scoped files"
git add -- "${STAGE_PATHS[@]}"

if git diff --cached --quiet; then
  echo "No staged changes were produced by the requested --stage paths." >&2
  exit 1
fi

echo "[closeout] checking staged diff"
git diff --cached --check -- "${STAGE_PATHS[@]}"
git diff --cached --stat

echo "[closeout] creating commit"
git commit -m "$COMMIT_MESSAGE"

COMMIT_HASH="$(git rev-parse --short HEAD)"
COMMIT_SUBJECT="$(git log -1 --format=%s)"
STAGED_FILES="$(git show --pretty='' --name-only HEAD)"
REQUEST_FILE="$(mktemp /tmp/oac-closeout-request-XXXXXX.json)"
OUTPUT_FILE="$(mktemp /tmp/oac-closeout-output-XXXXXX.json)"
trap 'rm -f "$REQUEST_FILE" "$OUTPUT_FILE"' EXIT

BUZZ_CONTENT="$(cat <<EOF
Development journal for commit $COMMIT_HASH ($COMMIT_SUBJECT).

$JOURNAL

Verification:
$VERIFY_CMD

Files:
$STAGED_FILES
EOF
)"

BUZZ_CONTENT="$BUZZ_CONTENT" node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ content: process.env.BUZZ_CONTENT }, null, 2));' "$REQUEST_FILE"

CMD=("$HOME/.metabot/bin/metabot" "buzz" "post" "--from" "$ACTOR" "--request-file" "$REQUEST_FILE")
if [ -n "$CHAIN" ]; then
  CMD+=("--chain" "$CHAIN")
fi

echo "[closeout] posting development journal"
"${CMD[@]}" >"$OUTPUT_FILE"

PIN_ID="$(node -e 'const fs = require("fs"); const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!payload.ok || payload.state !== "success") { process.stderr.write(JSON.stringify(payload, null, 2) + "\n"); process.exit(1); } process.stdout.write(payload.data.pinId || "");' "$OUTPUT_FILE")"
LOCAL_UI_URL="$(node -e 'const fs = require("fs"); const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (!payload.ok || payload.state !== "success") { process.stderr.write(JSON.stringify(payload, null, 2) + "\n"); process.exit(1); } process.stdout.write(payload.data.localUiUrl || "");' "$OUTPUT_FILE")"

echo "[closeout] commit: $COMMIT_HASH"
echo "[closeout] buzz pinId: $PIN_ID"
if [ -n "$LOCAL_UI_URL" ]; then
  echo "[closeout] buzz view: $LOCAL_UI_URL"
fi
