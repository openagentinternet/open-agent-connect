#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${METABOT_DAEMON_PORT:-24885}"

echo "[dev-daemon] workspace: $ROOT_DIR"
echo "[dev-daemon] target port: $PORT"

EXISTING_PID="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [ -n "${EXISTING_PID:-}" ]; then
  echo "[dev-daemon] stopping existing daemon pid=$EXISTING_PID"
  kill "$EXISTING_PID" || true
  sleep 0.2
fi

echo "[dev-daemon] building current worktree"
(
  cd "$ROOT_DIR"
  npm run build
)

echo "[dev-daemon] starting daemon from current worktree dist entry"
START_OUTPUT="$(
  cd "$ROOT_DIR"
  node dist/cli/main.js daemon start
)"
echo "$START_OUTPUT"

LISTEN_PID="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [ -n "${LISTEN_PID:-}" ]; then
  echo "[dev-daemon] active daemon pid=$LISTEN_PID url=http://127.0.0.1:$PORT"
else
  echo "[dev-daemon] warning: no process is listening on port $PORT" >&2
  exit 1
fi
