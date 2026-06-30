# Contributing

Open Agent Connect is an open-source connector for local AI agents. It includes
the `metabot` runtime CLI and daemon, the `oac` installer CLI, local browser UI,
host skill packs, and MetaID network protocol integrations.

## Requirements

- Node.js `>=20 <25`
- npm
- macOS, Linux, or Windows

Install dependencies with:

```bash
npm ci
```

## Development Loop

Build before running tests because source is TypeScript and tests import the
compiled CommonJS output:

```bash
npm run build
```

Run all tests:

```bash
npm test
```

Regenerate host skill packs when runtime files, skills, templates, or generated
artifacts change:

```bash
npm run build:skillpacks
```

Run the release-level local verification set:

```bash
npm run verify
```

Run a focused test file:

```bash
npm run build && node --test tests/<dir>/<name>.test.mjs
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
npm run build
npm audit --omit=dev --audit-level=moderate
```

Use the smallest test set that covers the change. Run the full suite for shared
runtime behavior, wallet or chain writes, persistence formats, release/build
plumbing, broad skillpack output, or release work.
