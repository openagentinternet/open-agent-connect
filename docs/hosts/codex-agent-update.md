# Codex Agent Update Runbook

Use this document when you want Codex to check for `Open Agent Connect` updates
and apply them safely for an installed local environment.

The shared install truth lives in `docs/install/open-agent-connect.md`.
This runbook keeps the Codex-specific update policy, reporting shape, and human
confirmation rules while reusing the registry-driven install flow.

## Agent Goal

- detect whether a newer npm package version exists
- report the local and latest versions clearly
- apply an update only after explicit user confirmation
- refresh the shared runtime and re-bind all detected platform roots after update

Preferred apply command:

```bash
metabot system update
```

This is the no-`--host` npm-first update path. It reinstalls the npm package and
then runs `oac install`, so shared skills and every registry-detected platform
root are refreshed together.

## Update Policy

- default mode: `check-only`
- recommended schedule: run `check-only` once per day
- apply mode requires human confirmation in the current session
- use `metabot system update --dry-run` before apply when the user wants a plan
- do not use `--host` for normal Codex updates; `--host` is legacy release-pack
  mode for the `codex`, `claude-code`, and `openclaw` compatibility packs only

## Upstream Source Of Truth

- npm package: `open-agent-connect`
- GitHub repository: `openagentinternet/open-agent-connect`
- local CLI version: `metabot --version` or `oac --version`
- install guide: `docs/install/open-agent-connect.md`

## Preconditions

Before running update steps, verify:

- `node` exists and version is `>=20 <25`
- `npm` exists
- `metabot` is runnable, or `oac` is runnable for the manual npm fallback
- `$HOME/.metabot/bin` is on `PATH` or can be added for the current shell

If a precondition fails, stop and return a concise failure report with the exact
missing requirement and a fix hint.

## Check-Only Procedure

Run from any working directory:

```bash
set -euo pipefail

export PATH="$HOME/.metabot/bin:$PATH"

node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20 || major >= 25) { console.error(`Node.js ${process.versions.node} is unsupported. Install Node.js 20, 22, or 24.`); process.exit(1); }'

command -v npm >/dev/null 2>&1 || {
  echo "npm is required to check the latest Open Agent Connect package version." >&2
  exit 1
}

LOCAL_VERSION="not_installed"
if command -v metabot >/dev/null 2>&1; then
  LOCAL_VERSION="$(metabot --version | awk '{print $2}')"
elif command -v oac >/dev/null 2>&1; then
  LOCAL_VERSION="$(oac --version | awk '{print $2}')"
fi

LATEST_VERSION="$(npm view open-agent-connect version)"

node - <<'NODE' "$LOCAL_VERSION" "$LATEST_VERSION"
const [localVersion, latestVersion] = process.argv.slice(2);

function parse(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || ''));
  return match ? match.slice(1).map(Number) : null;
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

const local = parse(localVersion);
const latest = parse(latestVersion);
const result = {
  localVersion,
  latestVersion,
  updateAvailable: false,
  reason: 'same_or_older'
};

if (!latest) {
  result.reason = 'latest_version_unavailable';
} else if (!local) {
  result.updateAvailable = true;
  result.reason = 'not_installed_or_unreadable';
} else {
  const delta = compare(latest, local);
  if (delta > 0) {
    result.updateAvailable = true;
    result.reason = 'latest_newer';
  } else if (delta < 0) {
    result.reason = 'local_newer_than_registry';
  }
}

console.log(JSON.stringify(result, null, 2));
NODE
```

Expected output:

- one JSON report with `updateAvailable: true|false`
- includes local and latest npm package versions
- recommends apply only when `updateAvailable` is true or the local install is
  unreadable and the user wants a repair reinstall

## Apply-Update Procedure (Run Only After User Confirmation)

Preferred:

```bash
metabot system update
```

This command performs the same effective steps as:

```bash
npm i -g open-agent-connect@latest
oac install
```

To pin a specific package version:

```bash
metabot system update --target-version v0.2.7
```

Manual fallback, only when `metabot system update` is unavailable but `npm` and
`oac` are available:

```bash
npm i -g open-agent-connect@latest
oac install
```

After apply, run:

```bash
export PATH="$HOME/.metabot/bin:$PATH"
oac doctor
metabot --version
metabot identity --help >/dev/null

if metabot identity who >/tmp/open-agent-connect-identity.json 2>/tmp/open-agent-connect-identity.err; then
  metabot doctor
else
  echo "Open Agent Connect core update is complete, but no active Bot identity exists yet."
fi
```

Apply mode acceptance criteria:

- `metabot system update` exits `0`
- the result reports `updateMode: "npm"`
- shared skills are refreshed under `~/.metabot/skills/`
- `oac doctor` verifies the shim, shared skills, `~/.agents/skills`, and detected platform bindings
- `metabot --version` reports the expected version
- `metabot doctor` is run only when an active Bot identity exists

## Shared Install Reference

For the full shared install, multi-host bind flow, and shared skill verification
rules, refer back to `docs/install/open-agent-connect.md`.

For source-checkout development update loops, use
`docs/hosts/codex-dev-test-runbook.md` instead of this end-user update runbook.

## Daily Agent Cron Pattern

For agent-platform cron jobs, use `check-only` once per day and return:

- whether update is available
- local vs latest version summary
- recommended next action (`apply`, `repair reinstall`, or `no action`)

Do not auto-run apply mode unless the user has explicitly opted in.

## Expected Final Report Format

At the end of each check or apply run, return:

- mode: `check-only` or `apply`
- result: `success`, `failed`, or `blocked`
- local version summary
- latest version summary
- update decision made
- user-facing apply summary: "Open Agent Connect runtime refreshed; your local agent keeps its Bot/network abilities."
- follow-up action required (if any)
