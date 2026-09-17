#!/usr/bin/env bash
# Prune merged git worktrees.
#
# Lists every worktree (excluding the main checkout) whose branch is fully
# merged into the main branch, then — after an explicit confirmation —
# removes each worktree and deletes its branch. This is the regular
# maintenance entry point required by AGENTS.md ("Worktree Closeout"):
# merged worktrees must not linger, because each one holds a full
# dependency checkout.
#
# Usage:
#   scripts/prune-worktrees.sh             list + confirm + remove
#   scripts/prune-worktrees.sh --dry-run   list only, remove nothing
#   scripts/prune-worktrees.sh --force     also remove worktrees with
#                                          uncommitted changes (still only
#                                          merged branches)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_BRANCH="${OAC_MAIN_BRANCH:-main}"
DRY_RUN=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (supported: --dry-run, --force)" >&2
      exit 2
      ;;
  esac
done

# Collect merged worktrees: "<path>|<branch>[ dirty]" per line. Worktrees on
# a detached HEAD are skipped (their branch cannot be checked).
candidates=()
current_path=""
while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      current_path="${line#worktree }"
      ;;
    branch\ refs/heads/*)
      branch="${line#branch refs/heads/}"
      # Never prune the main branch or the primary checkout (the worktree
      # that owns the .git directory); only task worktrees are candidates.
      if [ "$branch" = "$MAIN_BRANCH" ] || [ "$current_path" = "$ROOT_DIR" ] || [ -d "$current_path/.git" ]; then
        continue
      fi
      if git -C "$ROOT_DIR" merge-base --is-ancestor "$branch" "$MAIN_BRANCH" 2>/dev/null; then
        state=""
        if [ -n "$(git -C "$current_path" status --porcelain 2>/dev/null)" ]; then
          state=" dirty"
        fi
        candidates+=("${current_path}|${branch}${state}")
      fi
      ;;
  esac
done < <(git -C "$ROOT_DIR" worktree list --porcelain)

if [ "${#candidates[@]}" -eq 0 ]; then
  echo "No worktrees merged into $MAIN_BRANCH to prune."
  exit 0
fi

echo "Worktrees whose branch is fully merged into $MAIN_BRANCH:"
echo
for entry in "${candidates[@]}"; do
  echo "  ${entry%%|*}  (${entry#*|})"
done
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run: nothing removed."
  exit 0
fi

blocked=()
removable=()
for entry in "${candidates[@]}"; do
  case "$entry" in
    *" dirty") blocked+=("$entry") ;;
    *) removable+=("$entry") ;;
  esac
done

if [ "${#blocked[@]}" -gt 0 ]; then
  if [ "$FORCE" -eq 0 ]; then
    echo "Refusing to remove dirty worktrees without --force:"
    for entry in "${blocked[@]}"; do
      echo "  ${entry%%|*}  (${entry#*|})"
    done
    echo
  fi
fi

if [ "${#removable[@]}" -eq 0 ] && { [ "$FORCE" -eq 0 ] || [ "${#blocked[@]}" -eq 0 ]; }; then
  echo "Nothing removable."
  exit 0
fi

echo -n "Remove the worktrees listed above and delete their branches? [y/N] "
read -r reply
case "$reply" in
  y|Y|yes|YES) ;;
  *)
    echo "Aborted; nothing removed."
    exit 0
    ;;
esac

remove_entry() {
  local entry="$1"
  local path="${entry%%|*}"
  local info="${entry#*|}"
  local branch="${info%% *}"
  local force_flag=""
  if [ "${info#* }" = "dirty" ]; then
    force_flag="--force"
  fi
  if [ -n "$force_flag" ]; then
    git -C "$ROOT_DIR" worktree remove --force "$path"
  else
    git -C "$ROOT_DIR" worktree remove "$path"
  fi
  git -C "$ROOT_DIR" branch -d "$branch"
  echo "Removed $path (branch $branch)."
}

for entry in "${removable[@]}"; do
  remove_entry "$entry"
done
if [ "$FORCE" -eq 1 ]; then
  for entry in "${blocked[@]}"; do
    remove_entry "$entry"
  done
fi

git -C "$ROOT_DIR" worktree prune
echo "Done."
