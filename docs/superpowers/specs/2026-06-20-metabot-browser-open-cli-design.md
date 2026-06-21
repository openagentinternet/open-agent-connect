# MetaBot Browser Open CLI Design

**Date:** 2026-06-20

## Goal

Add a dedicated top-level Browser CLI entrypoint for opening the built-in Agent Internet Browser shell without routing it through the local `/ui/*` bridge surface.

The first version should support exactly two user-facing forms:

```bash
metabot browser open
metabot browser open --uri 'metaid://idq1...'
```

## Why This Exists

The current Browser product surface is exposed by daemon routes under `/browser` and `/ui/browser`, but the CLI only exposes the generic `metabot ui open --page ...` bridge. That is the wrong layer for Browser:

- `/ui/*` is the human HTML framework layer;
- `/browser` is a separate product surface with its own route family, runtime API, and URI semantics;
- Browser already uses `uri` as its primary input contract across page load and `/api/browser/resolve`.

The CLI should reflect that architecture instead of forcing Browser through the generic UI page bridge.

## Scope

In scope:

- add a new top-level command group: `metabot browser`
- add `metabot browser open`
- allow optional `--uri <resource-uri>`
- return a `localUiUrl` that targets `/browser`, not `/ui/browser`
- document supported URI examples in CLI help
- add focused CLI/help/runtime tests

Out of scope:

- compatibility alias for `metabot ui open --page browser`
- Browser-specific shortcuts such as `open-metaid`, `open-metaapp`, or positional URI arguments
- changes to Browser runtime behavior, Browser route rendering, or `/api/browser/*`
- removal of the existing `/ui/browser` daemon route

## User-Facing Command Surface

### Canonical Commands

```bash
metabot browser open
metabot browser open --uri 'metaid://<globalMetaId>'
metabot browser open --uri 'metaapp://<pinId>'
metabot browser open --uri 'metafile://<pinId>'
```

### Semantics

`metabot browser open`

- opens the Browser shell with no explicit resource URI
- returns a `localUiUrl` pointing at `/browser`
- relies on existing Browser page defaults for empty-location behavior

`metabot browser open --uri <resource-uri>`

- opens the Browser shell with an initial Browser resource URI
- returns a canonical `localUiUrl` at `/browser/<scheme>/<resource-id>` for clean `metaid://`, `metaapp://`, and `metafile://` URIs
- returns `/browser?uri=<encoded>` only for non-canonical or unsupported URI values so the Browser shell can surface the parse/resolve result directly
- accepts the URI as user input; the CLI only recognizes the supported Browser schemes for path deep links in v1

### Flag Naming

Use `--uri`, not `--address`.

Reason:

- Browser already uses `uri` in existing route and API contracts
- supported targets are not limited to addresses
- `metaid://`, `metaapp://`, and `metafile://` are resource identifiers, not just location strings

## URI Handling Rules

The CLI accepts the `--uri` value exactly as passed by the user. It maps clean Browser resource URIs to path deep links when the value has no surrounding whitespace, uses one of the supported schemes, and contains only a resource id after `://`.

Examples:

- `metaid://idq1alice`
- `metaapp://8544d8...i0`
- `metafile://8544d8...i0`

These become:

- `/browser/metaid/idq1alice`
- `/browser/metaapp/8544d8...i0`
- `/browser/metafile/8544d8...i0`

Values that do not match this canonical shape fall back to `/browser?uri=<encoded>`. The Browser shell then owns parse and resolve errors instead of silently redirecting to a default Bot page.

V1 intentionally does not normalize case, trim internal whitespace, or reject unknown schemes before forwarding them. The CLI only trims surrounding whitespace from the flag value before deciding whether the flag is present.

## Compatibility Decision

Do not support `metabot ui open --page browser`.

Reason:

1. there is no existing browser-specific CLI user to preserve;
2. dual entrypoints would increase future debugging cost by making Browser look like both a UI page and a product command;
3. the repo already treats `/browser` as the primary human-facing Browser launch path, including topbar links and route tests.

This is a deliberate boundary choice, not an accidental omission.

## Architecture

### CLI Layer

Add a new top-level command group in the main CLI dispatcher:

```text
metabot browser open [--uri <resource-uri>]
```

This should be implemented as its own command handler under `src/cli/commands/browser.ts`, not bolted into `ui.ts`.

### Dependency Boundary

Extend CLI dependencies with a dedicated Browser opener:

```text
dependencies.browser.open({ uri? }) -> CommandSuccess { localUiUrl }
```

Do not route `browser open` through `dependencies.ui.open`. Browser is not a generic UI page in this design.

### URL Construction

The Browser opener should:

- ensure the daemon base URL the same way other local UI entrypoints do;
- return `${baseUrl}/browser` when `uri` is absent;
- return `${baseUrl}/browser/<scheme>/<resource-id>` for canonical `metaid://`, `metaapp://`, and `metafile://` resource URIs;
- return `${baseUrl}/browser?uri=${encoded}` for non-canonical or unsupported URI values.

The returned payload should follow the same machine-first command envelope style already used by other CLI commands:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "localUiUrl": "http://127.0.0.1:24885/browser/metaid/idq1alice"
  }
}
```

Including a small data field such as `"uri"` is acceptable if it helps consistency, but it is not required for v1. `localUiUrl` is the contract that matters.

## Help Output

Add a top-level help section for `browser` and a specific help entry for `browser open`.

The `browser open` help should:

- describe Browser as the built-in Agent Internet Browser shell
- show `--uri <resource-uri>` as optional
- explain that `--uri` accepts Browser resource URIs such as `metaid://<globalMetaId>`, `metaapp://<pinId>`, and `metafile://<pinId>`
- avoid promising scheme validation that the implementation does not perform

Recommended examples:

```bash
metabot browser open
metabot browser open --uri 'metaid://idq1alice'
metabot browser open --uri 'metaapp://8544d8...i0'
metabot browser open --uri 'metafile://8544d8...i0'
```

## Error Handling

V1 error handling should stay minimal:

- unknown Browser subcommands return the standard unknown-subcommand failure
- missing value after `--uri` returns the standard missing-flag-value style failure already used by helper parsing
- daemon startup or base-URL resolution failures reuse the existing local-daemon failure path

Do not add Browser-specific URI validation errors in this change.

## Testing Requirements

### CLI Dispatch Tests

Add focused tests that prove:

1. `runCli(['browser', 'open'])` dispatches to the new Browser dependency and returns `/browser`
2. `runCli(['browser', 'open', '--uri', 'metaid://idq1alice'])` forwards the raw URI and returns `/browser/metaid/idq1alice`
3. `runCli(['browser', 'open', '--uri', 'metaapp://<pinId>'])` and `metafile://<pinId>` return `/browser/metaapp/<pinId>` and `/browser/metafile/<pinId>`
4. unknown Browser subcommands fail cleanly

### Runtime URL Builder Tests

Add or update tests around the default CLI dependency implementation to prove:

1. Browser open without `uri` returns `${baseUrl}/browser`
2. Browser open with canonical Browser resource URIs returns `${baseUrl}/browser/<scheme>/<resource-id>`
3. Browser open with non-canonical URI values falls back to `${baseUrl}/browser?uri=<encoded>`
4. Browser open does not route through `/ui/browser`

### Help Tests

Add or update help tests to prove:

1. `metabot browser --help` exists
2. `metabot browser open --help` documents optional `--uri`
3. examples mention `metaid://`, `metaapp://`, and `metafile://`
4. `ui open` help does not add `browser` back into the supported page list

## Files Expected To Change

Primary code:

- `src/cli/main.ts`
- `src/cli/commands/browser.ts` (new)
- `src/cli/commandHelp.ts`
- `src/cli/runtime.ts`
- `src/cli/types.ts`

Tests:

- `tests/cli/doctor.test.mjs` or a more appropriate CLI dispatch test file
- `tests/cli/help.test.mjs`
- optional focused Browser CLI test file if that keeps coverage cleaner

## Non-Goals And Future Work

Potential future work, intentionally excluded from this change:

- `metabot browser settings ...`
- `metabot browser cache ...`
- scheme-aware convenience commands
- additional Browser resource schemes beyond `metaid`, `metaapp`, and `metafile`
- deprecating or removing `/ui/browser`

Keeping v1 narrow reduces risk and keeps the command boundary obvious.
