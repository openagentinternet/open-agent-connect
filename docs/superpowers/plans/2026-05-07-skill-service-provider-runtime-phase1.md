# Skill-Service Provider Runtime Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the primary-runtime skill catalog and block service publishes when the selected local MetaBot cannot serve the requested `providerSkill`.

**Architecture:** Add a focused catalog module under `src/core/services` that resolves the active MetaBot's enabled primary binding, scans only that runtime provider's platform skill roots, and exposes reusable publish validation. Wire the same validation into daemon and CLI publish paths before any chain write, keeping runtime diagnostics local and out of `/protocols/skill-service` payloads.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing LLM runtime/binding stores, platform registry, daemon command result envelopes, Node test runner.

---

### Task 1: Skill Catalog Tests

**Files:**
- Create: `tests/services/platformSkillCatalog.test.mjs`
- Modify: none
- Test: `tests/services/platformSkillCatalog.test.mjs`

- [ ] **Step 1: Write failing tests for primary-runtime catalog behavior**

Cover these cases:

- Codex primary with Claude fallback returns Codex skills only.
- Unsafe names (`/`, `\\`, `..`, whitespace) are rejected.
- `SKILL.md` front matter title/description is read when present.
- Unreadable or missing roots produce diagnostics without mutating directories.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run build && node --test tests/services/platformSkillCatalog.test.mjs`

Expected: FAIL because `dist/core/services/platformSkillCatalog.js` does not exist yet.

### Task 2: Publish Validation Tests

**Files:**
- Create: `tests/services/servicePublishValidation.test.mjs`
- Modify: `tests/services/publishService.test.mjs`
- Test: `tests/services/servicePublishValidation.test.mjs`, `tests/services/publishService.test.mjs`

- [ ] **Step 1: Write failing tests for validation outcomes**

Cover these stable codes:

- `primary_runtime_missing`
- `primary_runtime_unavailable`
- `provider_skill_missing`
- `invalid_provider_skill`

Also assert success returns selected skill, platform id, runtime id, and root diagnostics, and assert publish payloads still contain no runtime metadata.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm run build && node --test tests/services/servicePublishValidation.test.mjs tests/services/publishService.test.mjs`

Expected: FAIL because validation helpers do not exist yet.

### Task 3: Implement Catalog and Validation

**Files:**
- Create: `src/core/services/platformSkillCatalog.ts`
- Create: `src/core/services/servicePublishValidation.ts`
- Modify: `src/core/platform/platformRegistry.ts` if root path helpers need a project-root overload
- Test: `tests/services/platformSkillCatalog.test.mjs`, `tests/services/servicePublishValidation.test.mjs`

- [ ] **Step 1: Implement safe skill name validation**

Reject empty names, whitespace-only names, names containing `/`, `\\`, or `..`.

- [ ] **Step 2: Implement platform root expansion**

Use `getPlatformSkillRoots()` and `resolvePlatformSkillRootPath()` for global roots. Resolve project roots against the provider execution workspace cwd used by the local command/daemon context.

- [ ] **Step 3: Implement catalog scanning**

Read directory entries only. Accept skill directories containing `SKILL.md`. Deduplicate by skill name in deterministic root order. Return metadata and diagnostics.

- [ ] **Step 4: Implement primary binding resolution**

Use the enabled `primary` binding for the current MetaBot slug. Require the runtime to be present, non-`unavailable`, and backed by a platform provider.

- [ ] **Step 5: Implement publish validation**

Validate the requested `providerSkill` against the primary catalog and return local diagnostics only.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm run build && node --test tests/services/platformSkillCatalog.test.mjs tests/services/servicePublishValidation.test.mjs tests/services/publishService.test.mjs`

Expected: PASS.

### Task 4: Wire Daemon and CLI Publish

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/daemon/routes/services.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commands/services.ts`
- Test: `tests/daemon/providerRoutes.test.mjs` or a new daemon route test, `tests/cli/runtime.test.mjs`

- [ ] **Step 1: Add daemon endpoint for primary publish skills**

Expose a machine-readable endpoint under `/api/services/publish/skills` for UI/CLI tests and Phase 2 UI work.

- [ ] **Step 2: Revalidate in daemon publish handler**

Before `publishServiceToChain()`, call the publish validation helper. Return the helper's stable code before chain write when invalid.

- [ ] **Step 3: Add CLI command for list/validate support**

Add `metabot services publish-skills` to list primary-runtime publishable skills for the active MetaBot. Keep `metabot services publish --payload-file` unchanged except for server-side validation.

- [ ] **Step 4: Add CLI/daemon tests**

Assert invalid CLI publish fails before fake chain write, valid publish reaches the existing chain path, and listing returns only primary skills.

- [ ] **Step 5: Run targeted tests**

Run: `npm run build && node --test tests/services/*.test.mjs tests/daemon/providerRoutes.test.mjs tests/cli/runtime.test.mjs`

Expected: PASS.

### Task 5: Phase Verification

**Files:**
- All changed files

- [ ] **Step 1: Run repository tests**

Run: `npm test`

Expected: PASS, or document any environmental blocker exactly.

- [ ] **Step 2: Real-chain publish smoke**

Using the local `eric` profile only if environment is ready, publish a valid primary-runtime skill and record non-secret pin id/txid evidence. If skipped, document the exact environmental reason and substituted local tests.

- [ ] **Step 3: Review subagent**

Dispatch a separate `gpt-5.5` code-review subagent for Phase 1 changed files.

- [ ] **Step 4: Acceptance subagent**

Dispatch a separate `gpt-5.5` acceptance subagent for Phase 1. Tell it it may use Playwright for UI-effect checks when useful, though Phase 1 is mostly API/CLI.

- [ ] **Step 5: Commit and buzz diary**

Commit one verifiable Phase 1 unit, then use `metabot-post-buzz` to post the required detailed development diary.
