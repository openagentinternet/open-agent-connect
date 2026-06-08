# Agent Internet Browser Packaging And Standalone Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Browser module usable outside the OAC daemon by adding a Browser-owned module boundary and a standalone local host that serves the same Browser UI and API surface.

**Architecture:** Phase 3 creates `src/browser/*` as an internal package-like boundary that owns Browser page rendering and HTTP API routing, while OAC daemon routes become thin adapters. Phase 4 adds a standalone host that reuses the Browser boundary with a standalone adapter, in-memory settings/cache state, public resource resolution, and disabled host actions until wallet/login infrastructure exists.

**Tech Stack:** TypeScript strict mode, CommonJS output, Node `http`, existing Browser page VM tests, daemon route tests, standalone host route tests.

---

## Success Criteria

- OAC still serves `/ui/browser`, `/browser`, and existing `/api/browser/*` routes.
- Browser API routing can be imported from `dist/browser/*` without importing OAC daemon route types.
- Browser page rendering can be imported from `dist/browser/*` without importing OAC UI route code.
- A standalone Browser server can start from built output and serve:
  - `GET /`
  - `GET /browser`
  - `GET /api/browser/runtime`
  - `GET /api/browser/settings`
  - `GET /api/browser/cache`
  - `POST /api/browser/actions`
- Standalone runtime reports `host.kind === "standalone"` and a wallet-style actor.
- Standalone private-chat and service-call trusted actions fail closed as unsupported.
- After each phase, a fresh subagent reviews the whole phase.

## Phase 3: Browser Module Packaging

**Files:**
- Create `src/browser/http.ts`
- Create `src/browser/page.ts`
- Create `src/browser/index.ts`
- Modify `src/daemon/routes/browser.ts`
- Modify `src/daemon/routes/ui.ts`
- Add `tests/browser/browserModuleBoundary.test.mjs`
- Update existing route/UI tests as needed

- [ ] Move Browser API route logic into `src/browser/http.ts` with a host-neutral `BrowserHttpHandlers` contract.
- [ ] Keep `src/daemon/routes/browser.ts` as a daemon adapter that delegates to Browser module routing.
- [ ] Move Browser page HTML rendering into `src/browser/page.ts`.
- [ ] Make OAC UI routes use `renderBrowserPageHtml()` for Browser pages.
- [ ] Export Browser contracts, API routing, and page rendering from `src/browser/index.ts`.
- [ ] Add tests proving `dist/browser/index.js` exposes the Browser boundary and can render the shell without OAC UI route imports.
- [ ] Run `npm run build && node --test tests/browser/browserModuleBoundary.test.mjs tests/daemon/browserRoutes.test.mjs tests/daemon/browserUiRoutes.test.mjs tests/ui/browserPageState.test.mjs`.
- [ ] Commit as `Add browser module boundary`.
- [ ] Post a development diary buzz for the Phase 3 commit.
- [ ] Spawn a fresh `gpt-5.5` subagent to review Phase 3, then fix any valid findings in a follow-up commit.

## Phase 4: Standalone Host

**Files:**
- Create `src/browser/standalone/adapter.ts`
- Create `src/browser/standalone/server.ts`
- Create `src/browser/standalone/main.ts`
- Modify `package.json`
- Add `tests/browser/browserStandaloneAdapter.test.mjs`
- Add `tests/browser/browserStandaloneServer.test.mjs`

- [ ] Add a standalone Browser adapter that implements `BrowserHostAdapter`.
- [ ] Return a standalone runtime snapshot with `host.kind: "standalone"` and a default wallet actor.
- [ ] Store Browser settings in memory for this first standalone host.
- [ ] Expose cache stats/clear as an in-memory standalone cache contract.
- [ ] Resolve `metaid://` through public Browser resource resolution using Browser settings.
- [ ] Keep `metaapp://` resolution available through the existing public MetaApp resolver when possible, using temporary preview URLs instead of OAC preview sessions.
- [ ] Return `browser_action_not_supported` for private-chat, service-call, login, and any unsupported standalone action.
- [ ] Add `createStandaloneBrowserServer()` that serves Browser page routes, shared CSS, Browser API routes, and preview asset files.
- [ ] Add a CLI entrypoint `browser-standalone` that starts the standalone server on `127.0.0.1` and prints the URL.
- [ ] Add tests proving standalone runtime/settings/cache/action/page routes work without OAC daemon handlers.
- [ ] Run `npm run build && node --test tests/browser/browserStandaloneAdapter.test.mjs tests/browser/browserStandaloneServer.test.mjs tests/browser/browserModuleBoundary.test.mjs tests/daemon/browserRoutes.test.mjs tests/ui/browserPageState.test.mjs`.
- [ ] Commit as `Add standalone browser host`.
- [ ] Post a development diary buzz for the Phase 4 commit.
- [ ] Spawn a fresh `gpt-5.5` subagent to review Phase 4, then fix any valid findings in a follow-up commit.

## Final Verification

- [ ] Run `npm run build`.
- [ ] Run the focused Browser regression suite:

```bash
node --test \
  tests/browser/browserModuleBoundary.test.mjs \
  tests/browser/browserStandaloneAdapter.test.mjs \
  tests/browser/browserStandaloneServer.test.mjs \
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
  tests/daemon/browserUiRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageInspector.test.mjs \
  tests/ui/browserPageLayout.test.mjs \
  tests/ui/browserPageRenderers.test.mjs \
  tests/ui/browserPageState.test.mjs
```

- [ ] Run `git diff --check`.
- [ ] Confirm tracked worktree is clean except allowed untracked local artifacts.
