# Agent Internet Browser Runtime UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Browser UI onto the Phase 1 host-neutral runtime and trusted-action boundary while keeping OAC route compatibility.

**Architecture:** Add `/api/browser/runtime` and `/api/browser/actions` as host-neutral Browser routes backed by the OAC adapter. Keep existing `/api/browser/context`, `from=<slug>`, `/api/chat/private`, and `/api/services/call` behavior available for compatibility, but make `/ui/browser` track `actorId` internally and post trusted actions through the Browser action endpoint.

**Tech Stack:** TypeScript strict mode, CommonJS build output, daemon route tests with `node:test`, Browser page VM tests.

---

## Scope

- Implement Phase 2 from `docs/superpowers/specs/2026-06-08-agent-internet-browser-independent-module-design.md`.
- Do not build standalone hosting, IDBots adapter, wallet login, template uploads, or Browser package extraction.
- Preserve the existing OAC Browser UI behavior for current users.

## Files

- Modify `src/daemon/routes/types.ts` to add Browser runtime and action handler signatures.
- Modify `src/daemon/routes/browser.ts` to add `GET /api/browser/runtime` and `POST /api/browser/actions`.
- Modify `src/daemon/defaultHandlers.ts` to expose adapter-backed `getRuntime` and `runTrustedAction`.
- Modify `src/daemon/browser/oacBrowserHostAdapter.ts` to fulfill OAC private chat and service-call trusted actions by delegating through injected action callbacks.
- Modify `src/ui/pages/browser/app.ts` to load runtime, store `actorId`, use runtime labels, and post action confirmations through `/api/browser/actions`.
- Modify `tests/daemon/browserRoutes.test.mjs`, `tests/daemon/defaultBrowserHandlers.test.mjs`, `tests/daemon/oacBrowserHostAdapter.test.mjs`, `tests/ui/browserPageState.test.mjs`, and `tests/ui/browserPageActions.test.mjs` for regressions.

## Tasks

### Task 1: Runtime And Action Routes

- [ ] Add route handler types for `getRuntime(input?: { actorId?: string; from?: string })` and `runTrustedAction(input: { actorId?: string; from?: string; resourceUri: string; kind: string; payload?: Record<string, unknown> })`.
- [ ] Add `GET /api/browser/runtime`, reading `actorId` first and legacy `from` second.
- [ ] Add `POST /api/browser/actions`, reading JSON body plus optional query `actorId` or `from`.
- [ ] Add route tests proving `actorId` is forwarded and legacy `from` still works.
- [ ] Run `npm run build && node --test tests/daemon/browserRoutes.test.mjs`.
- [ ] Commit as `Add browser runtime and action routes`.

### Task 2: OAC Trusted Action Adapter

- [ ] Extend `CreateOacBrowserHostAdapterInput` with optional `privateChat` and `serviceCall` callbacks.
- [ ] Implement `runTrustedAction` for `private-chat` and `service-call`; keep unsupported actions returning `browser_action_not_supported`.
- [ ] Preserve the existing OAC request bodies for private chat and service call inside adapter mapping.
- [ ] Add adapter/default-handler tests for successful action mapping and unsupported action failure.
- [ ] Run `npm run build && node --test tests/daemon/oacBrowserHostAdapter.test.mjs tests/daemon/defaultBrowserHandlers.test.mjs tests/daemon/browserRoutes.test.mjs`.
- [ ] Commit as `Route browser trusted actions through adapter`.

### Task 3: UI Runtime Snapshot And Actor Id State

- [ ] Rename Browser page state from `usingSlug` to `actorId`.
- [ ] Load `/api/browser/runtime` before rendering host-dependent controls.
- [ ] Render actor chip and no-actor empty state from runtime actors and labels.
- [ ] Build Browser route URLs with `actorId`, while backend continues to support `from`.
- [ ] Update settings/cache/resolve calls to use `actorId`.
- [ ] Post private chat and service-call confirmations to `/api/browser/actions`.
- [ ] Add UI VM tests for runtime labels, actor id routing, and action endpoint calls.
- [ ] Run the focused Browser UI tests plus route tests.
- [ ] Commit as `Use browser runtime actor ids in UI`.

### Task 4: Final Verification

- [ ] Run `npm run build`.
- [ ] Run the focused Browser regression suite:

```bash
node --test \
  tests/browser/browserRuntimeContext.test.mjs \
  tests/browser/botHomepageResolver.test.mjs \
  tests/browser/browserResolver.test.mjs \
  tests/browser/metaAppPinResolver.test.mjs \
  tests/browser/metaAppResolver.test.mjs \
  tests/config/browserConfig.test.mjs \
  tests/config/configStore.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/defaultBrowserHandlers.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageInspector.test.mjs \
  tests/ui/browserPageLayout.test.mjs \
  tests/ui/browserPageRenderers.test.mjs \
  tests/ui/browserPageState.test.mjs
```

- [ ] Run `git diff --check`.
- [ ] Post a development diary buzz for each commit.
