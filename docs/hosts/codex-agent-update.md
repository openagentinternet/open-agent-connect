# Codex Agent Update Runbook

Use this document when you want Codex to check for `Open Agent Connect` updates and apply them safely.

The shared install truth lives in `docs/install/open-agent-connect.md`.
This runbook keeps the Codex-specific update policy and reuses the unified shared install plus bind flow.

## Agent Goal

- detect whether a newer upstream version exists on GitHub
- report the version delta clearly
- apply update only after explicit user confirmation
- refresh the shared runtime and re-bind Codex exposure after update

Preferred apply command:

```bash
metabot system update --host codex
```

## Update Policy

- default mode: `check-only`
- recommended schedule: run `check-only` once per day
- apply mode requires human confirmation in the current session
- if local repo is dirty, do not update automatically

## Upstream Source Of Truth

- GitHub repository: `metaid-developers/Open Agent Connect`
- local version contract: `release/compatibility.json`
- package version: `package.json`

## Preconditions

Before running update steps, verify:

- repository root contains `.git`, `package.json`, `release/compatibility.json`
- repository root contains `docs/install/open-agent-connect.md`
- `git`, `node`, `npm`, and `curl` are available
- local branch has no uncommitted changes for apply mode

If a precondition fails, stop and return a concise failure report with the exact missing requirement.

## Check-Only Procedure

Run from repository root:

```bash
REMOTE_COMPAT_URL="https://raw.githubusercontent.com/metaid-developers/Open Agent Connect/main/release/compatibility.json"
LOCAL_COMPAT_FILE="release/compatibility.json"
LOCAL_PKG_FILE="package.json"

TMP_REMOTE_COMPAT="$(mktemp)"
curl -fsSL "$REMOTE_COMPAT_URL" -o "$TMP_REMOTE_COMPAT"

node - <<'NODE' "$LOCAL_COMPAT_FILE" "$LOCAL_PKG_FILE" "$TMP_REMOTE_COMPAT"
const fs = require('fs');
const [localCompatPath, localPkgPath, remoteCompatPath] = process.argv.slice(2);
const localCompat = JSON.parse(fs.readFileSync(localCompatPath, 'utf8'));
const localPkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf8'));
const remoteCompat = JSON.parse(fs.readFileSync(remoteCompatPath, 'utf8'));

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

const localCli = parse(localCompat.cli);
const remoteCli = parse(remoteCompat.cli);
const result = {
  local: {
    packageVersion: localPkg.version,
    compatibility: localCompat
  },
  remote: {
    compatibility: remoteCompat
  },
  updateAvailable: false,
  reason: 'same_or_older'
};

if (!localCli || !remoteCli) {
  result.reason = 'invalid_semver';
} else {
  const delta = cmp(remoteCli, localCli);
  if (delta > 0) {
    result.updateAvailable = true;
    result.reason = 'remote_newer';
  } else if (delta < 0) {
    result.reason = 'local_newer_than_main';
  }
}

console.log(JSON.stringify(result, null, 2));
NODE

rm -f "$TMP_REMOTE_COMPAT"
```

Expected output:

- one JSON report with `updateAvailable: true|false`
- includes local and remote compatibility versions

## Apply-Update Procedure (Run Only After User Confirmation)

Preferred:

```bash
metabot system update --host codex
```

Manual fallback (repository mode) from repository root:

```bash
git status --porcelain
git fetch origin --tags
git pull --ff-only origin main
npm install
npm run build
npm run build:skillpacks
cd skillpacks/shared
./install.sh
export PATH="$HOME/.metabot/bin:$PATH"
metabot host bind-skills --host codex
metabot doctor
```

Apply mode acceptance criteria:

- `git pull --ff-only` succeeds
- build and skillpack generation succeed
- shared install succeeds
- Codex bind succeeds
- `metabot doctor` exits `0` and returns machine-readable JSON

## Shared Install Reference

For the full shared install, multi-host bind flow, and shared skill verification rules, refer back to `docs/install/open-agent-connect.md`.

## Daily Agent Cron Pattern

For agent-platform cron jobs, use `check-only` once per day and return:

- whether update is available
- local vs remote version summary
- recommended next action (`apply` or `no action`)

Do not auto-run apply mode unless the user has explicitly opted in.

## Expected Final Report Format

At the end of each check or apply run, return:

- mode: `check-only` or `apply`
- result: `success`, `failed`, or `blocked`
- local version summary
- remote version summary
- update decision made
- follow-up action required (if any)
