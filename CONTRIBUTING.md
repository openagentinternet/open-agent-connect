# Contributing

Open Agent Connect is an open-source connector for local AI agents. It includes
the `metabot` runtime CLI and daemon, the `oac` installer CLI, local browser UI,
host skill packs, and MetaID network protocol integrations.

## Requirements

- Node.js `>=20 <25` (pnpm 11 itself needs Node ≥ 22.5 — prefer Node 22–24)
- pnpm, enabled once via `corepack enable` (the version is pinned by the
  `packageManager` field in `package.json`)
- macOS, Linux, or Windows

Install dependencies with (the repository root and `dsh-plugin/` are separate
packages with separate lockfiles):

```bash
pnpm install
pnpm --dir dsh-plugin install
```

`pnpm-lock.yaml` is committed; do not reintroduce `package-lock.json`. pnpm
settings live in `pnpm-workspace.yaml` (hoisted node_modules layout, version
overrides, approved dependency build scripts) — pnpm 11 ignores `.npmrc` for
these.

## Development Loop

Build before running tests because source is TypeScript and tests import the
compiled CommonJS output:

```bash
pnpm run build
```

Run all tests:

```bash
pnpm test
```

Regenerate host skill packs when runtime files, skills, templates, or generated
artifacts change:

```bash
pnpm run build:skillpacks
```

Run the release-level local verification set:

```bash
pnpm run verify
```

Run a focused test file:

```bash
pnpm run build && node --test tests/<dir>/<name>.test.mjs
```

## Architecture Pointers

- `src/cli/` contains the `metabot` command entrypoint and domain commands.
- `src/oac/` contains the installer CLI.
- `src/core/` contains domain logic for identity, discovery, A2A delegation,
  wallet and chain access, secrets, services, payments, skills, and runtime
  state.
- `src/daemon/` contains the local HTTP daemon, REST routes, SSE, and browser
  host adapter.
- `src/browser/` and `src/ui/` contain the local browser and inspection pages.
- `SKILLs/` contains source skills; `skillpacks/` contains generated host packs.
- `docs/metaid_protocols/`, `docs/hosts/`, and `docs/acceptance/` contain the
  main protocol, host, and acceptance documentation.

All profile paths must go through `resolveMetabotPaths()` and the v2 profile
layout under `~/.metabot/profiles/<slug>/`. Do not add new dependencies on the
legacy `.metabot/hot` layout.

## Pull Request Expectations

Keep changes narrow and verifiable. A good pull request explains:

- the user-visible behavior change;
- the security impact, especially for daemon, wallet, chain, or message flows;
- the tests and commands run;
- whether generated skill packs changed;
- any remaining low-severity dependency advisories or upstream blockers.

For UI copy changes, route user-visible strings through the i18n dictionaries
and keep English plus Simplified Chinese coverage.

Documentation, skill documents, and code comments should be written in English.

## Security Rules

Do not commit real mnemonics, private keys, API keys, tokens, cookies, profile
secrets, or sensitive local logs. Do not paste secrets into issues, pull
requests, generated buzz posts, or test fixtures.

Before submitting security-sensitive changes, run:

```bash
pnpm run build
pnpm audit --prod --audit-level=moderate
```

Use the smallest test set that covers the change. Run the full suite for shared
runtime behavior, wallet or chain writes, persistence formats, release/build
plumbing, broad skillpack output, or release work.
