# Skill-Service Provider Runtime Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/ui/publish` and CLI publishing UX primary-runtime-aware while preserving server-side publish validation and the existing chain payload shape.

**Architecture:** Reuse the Phase 1 publish skill catalog endpoint as the single source for publishable skill choices. Extend the publish page view model to combine provider identity, primary runtime diagnostics, catalog availability, skill selector rows, and publish result state. Expose `/ui/publish` as a built-in operator page, keep runtime configuration in `/ui/bot`, and add CLI help for the machine-readable publish skill list command.

**Tech Stack:** TypeScript UI page definitions, daemon built-in UI routes, Node test runner, existing CLI command help renderer, Playwright for final browser acceptance.

---

### Task 1: Publish View-Model Tests

**Files:**
- Modify: `tests/ui/providerViewModels.test.mjs`
- Modify: `src/ui/pages/publish/viewModel.ts`

- [ ] **Step 1: Write failing tests for identity, runtime, and availability**

Add tests that expect:

- provider identity rows include MetaBot slug and global identity;
- primary runtime rows include provider/display name, health, and version;
- publish availability is enabled only when identity, runtime, readable roots, and at least one catalog skill exist;
- disabled states expose a stable reason for missing primary runtime or unreadable skill roots.

- [ ] **Step 2: Run RED**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs`

Expected: FAIL because the Phase 1 view model has no runtime card, skill selector state, or availability model.

### Task 2: Publish UI Route Tests

**Files:**
- Modify: `tests/daemon/httpServer.test.mjs`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/ui/pages/publish/app.ts`
- Modify: `src/ui/pages/publish/index.html`

- [ ] **Step 1: Write failing route/UI shell tests**

Assert that `/ui/publish`:

- returns HTML instead of 404;
- contains `data-provider-skill-select`;
- fetches `/api/services/publish/skills`;
- does not include runtime picker fields such as `runtimeId` or `llmRuntimeId`;
- stays consistent with the built-in `/ui` navigation.

- [ ] **Step 2: Run RED**

Run: `npm run build && node --test tests/daemon/httpServer.test.mjs`

Expected: FAIL because `/ui/publish` is still hidden and the page still uses a free-text `providerSkill` input.

### Task 3: CLI UX Tests

**Files:**
- Modify: `tests/cli/services.test.mjs`
- Modify: `tests/cli/help.test.mjs`
- Modify: `src/cli/commandHelp.ts`

- [ ] **Step 1: Write failing CLI UX tests**

Add help coverage for `metabot services publish-skills --help` and make the `services` group help list the command.

- [ ] **Step 2: Run RED**

Run: `npm run build && node --test tests/cli/services.test.mjs tests/cli/help.test.mjs`

Expected: FAIL because `publish-skills` is implemented but not documented in command help.

### Task 4: Implement Publish UX

**Files:**
- Modify: `src/ui/pages/publish/viewModel.ts`
- Modify: `src/ui/pages/publish/app.ts`
- Modify: `src/ui/pages/publish/index.html`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/cli/commandHelp.ts`

- [ ] **Step 1: Extend the publish view model**

Return provider card rows, primary runtime card rows, publishable skill rows, availability state, and result card rows from catalog and provider summary inputs.

- [ ] **Step 2: Update the browser page**

Load `/api/provider/summary` and `/api/services/publish/skills`, render identity/runtime/availability, populate a `providerSkill` selector, and disable submit until publish availability is true.

- [ ] **Step 3: Preserve payload shape**

Build the submit payload from service fields and selected `providerSkill` only. Do not add runtime id, provider, binary path, cwd, model, or root diagnostics.

- [ ] **Step 4: Expose `/ui/publish`**

Remove `publish` from hidden UI pages and add it to the top navigation without exposing `/ui/my-services` yet.

- [ ] **Step 5: Document CLI command help**

Add `services publish-skills` help with success fields and failure semantics.

- [ ] **Step 6: Run targeted GREEN**

Run: `npm run build && node --test tests/ui/providerViewModels.test.mjs tests/daemon/httpServer.test.mjs tests/cli/services.test.mjs tests/cli/help.test.mjs tests/cli/runtime.test.mjs`

Expected: PASS.

### Task 5: Phase Verification

**Files:**
- All changed files

- [ ] **Step 1: Browser automation**

Run a local daemon or focused test server and use Playwright to verify enabled and disabled `/ui/publish` states. Confirm the browser submit payload contains `providerSkill` and no runtime fields.

- [ ] **Step 2: Repository verification**

Run: `npm run build && npm test`

Expected: PASS.

- [ ] **Step 3: Real-chain publish smoke**

Use the local `eric` profile to publish a valid primary-runtime skill through UI or CLI, then read the service pin back through OAC's chain service directory parsing path. Record only non-secret pin id and txid evidence.

- [ ] **Step 4: Phase gates**

Dispatch separate `gpt-5.5` code-review and acceptance subagents. Tell acceptance that Playwright can be used for UI-effect checks.

- [ ] **Step 5: Commit and buzz diary**

Commit the complete Phase 2 unit, then use `metabot-post-buzz` for the required on-chain development diary.
