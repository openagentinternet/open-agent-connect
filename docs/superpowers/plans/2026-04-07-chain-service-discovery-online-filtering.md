# Chain Service Discovery Online Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `metabot network services --online` read existing chain `/protocols/skill-service` services and filter them by IDBots-compatible `/protocols/metabot-heartbeat` online semantics instead of relying only on local seeded daemon directories.

**Architecture:** Add chain-first discovery modules that extract the existing IDBots service parsing and heartbeat semantics into focused `be-metabot` readers, then compose them inside `network.listServices` with the current local runtime services and seeded-daemon fallback. Keep this round read-only for chain services: discovery changes first, chain publish later.

**Tech Stack:** TypeScript, Node 20+, fetch, node:test, existing `metabot` daemon/CLI runtime

---

### Task 1: Add Failing Discovery Parsing Tests

**Files:**
- Create: `tests/discovery/chainServiceDirectory.test.mjs`
- Reference: `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/gigSquareRemoteServiceSync.ts`

- [ ] **Step 1: Write the failing test for a chain `create` row**

Add a test that feeds one `/protocols/skill-service` chain row into the new parser and expects:

- `servicePinId`
- `sourceServicePinId`
- `providerGlobalMetaId`
- `serviceName`
- `displayName`
- `description`
- `price`
- `currency`
- `providerSkill`
- `paymentAddress`
- `available: true`

- [ ] **Step 2: Write the failing test for `modify` replacing the active current row**

Add a test with one `create` row plus one `modify` row for the same source service id and expect the reduced directory to expose only the modified state.

- [ ] **Step 3: Write the failing test for `revoke` hiding the service**

Add a test with `create` then `revoke` for the same source service id and expect the reduced online directory to exclude the revoked service.

- [ ] **Step 4: Run the targeted parser test file**

Run: `npm run build && node --test tests/discovery/chainServiceDirectory.test.mjs`

Expected: FAIL because the chain service discovery module does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add tests/discovery/chainServiceDirectory.test.mjs
git commit -m "test: add chain service discovery parser coverage"
```

### Task 2: Add Failing Heartbeat Online Tests

**Files:**
- Create: `tests/discovery/chainHeartbeatDirectory.test.mjs`
- Reference: `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/heartbeatPollingService.ts`

- [ ] **Step 1: Write the failing test for fresh heartbeat => online**

Add a test that provides one service plus one heartbeat event inside the valid freshness window and expects the provider to be marked online.

- [ ] **Step 2: Write the failing test for stale heartbeat => offline**

Add a test that provides the same service with an old heartbeat timestamp and expects the provider to be filtered out of the `--online` result.

- [ ] **Step 3: Write the failing test for no heartbeat => offline**

Add a test that provides chain services but no heartbeat rows and expects an empty online result.

- [ ] **Step 4: Run the targeted heartbeat test file**

Run: `npm run build && node --test tests/discovery/chainHeartbeatDirectory.test.mjs`

Expected: FAIL because the chain heartbeat filtering module does not exist yet.

- [ ] **Step 5: Commit**

```bash
git add tests/discovery/chainHeartbeatDirectory.test.mjs
git commit -m "test: add chain heartbeat online filtering coverage"
```

### Task 3: Implement Chain Skill-Service Parsing

**Files:**
- Create: `src/core/discovery/chainServiceDirectory.ts`
- Reference: `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/gigSquareRemoteServiceSync.ts`
- Test: `tests/discovery/chainServiceDirectory.test.mjs`

- [ ] **Step 1: Add parser types and normalizers**

Implement focused types and helpers for:

- chain row normalization
- content summary parsing
- operation normalization
- source service pin resolution

- [ ] **Step 2: Implement row parsing compatible with IDBots fields**

Support the payload fields IDBots already reads:

- `serviceName`
- `displayName`
- `description`
- `price`
- `currency`
- `serviceIcon`
- `providerMetaBot`
- `providerSkill`
- `skillDocument`
- `inputType`
- `outputType`
- `endpoint`
- `paymentAddress`

- [ ] **Step 3: Implement current-state reduction**

Reduce `create / modify / revoke` rows into one current service record per `sourceServicePinId`.

- [ ] **Step 4: Run the parser tests**

Run: `npm run build && node --test tests/discovery/chainServiceDirectory.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery/chainServiceDirectory.ts tests/discovery/chainServiceDirectory.test.mjs
git commit -m "feat: add chain skill-service parser"
```

### Task 4: Implement Chain Heartbeat Filtering

**Files:**
- Create: `src/core/discovery/chainHeartbeatDirectory.ts`
- Reference: `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/heartbeatPollingService.ts`
- Test: `tests/discovery/chainHeartbeatDirectory.test.mjs`

- [ ] **Step 1: Implement heartbeat timestamp extraction**

Read heartbeat timestamps from chain rows in a way that matches the IDBots heartbeat protocol assumptions.

- [ ] **Step 2: Implement provider grouping and freshness checks**

Group services by provider globalMetaId and provider address, then mark online only when heartbeat freshness passes the same window used by IDBots.

- [ ] **Step 3: Implement online service filtering helper**

Return only services whose providers are currently online.

- [ ] **Step 4: Run the heartbeat tests**

Run: `npm run build && node --test tests/discovery/chainHeartbeatDirectory.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery/chainHeartbeatDirectory.ts tests/discovery/chainHeartbeatDirectory.test.mjs
git commit -m "feat: add chain heartbeat online filter"
```

### Task 5: Add Chain Read Transport And Orchestrator Tests

**Files:**
- Create: `src/core/discovery/chainDirectoryReader.ts`
- Create: `tests/discovery/chainDirectoryReader.test.mjs`
- Reference: `src/daemon/defaultHandlers.ts`

- [ ] **Step 1: Write the failing test for chain-first discovery**

Add a test that injects chain service rows plus heartbeat rows and expects the orchestrator to return online services without any seeded source.

- [ ] **Step 2: Write the failing test for seeded fallback**

Add a test that simulates chain fetch failure and expects the orchestrator to fall back to current seeded daemon directory services.

- [ ] **Step 3: Run the targeted orchestrator test**

Run: `npm run build && node --test tests/discovery/chainDirectoryReader.test.mjs`

Expected: FAIL because the orchestrator does not exist yet.

- [ ] **Step 4: Implement the chain fetch + fallback orchestrator**

Create a small module that:

- fetches skill-service chain rows
- reduces them to current services
- fetches heartbeat rows
- filters online services
- falls back to seeded daemon sources if chain discovery fails or semantically misses

- [ ] **Step 5: Re-run the orchestrator test**

Run: `npm run build && node --test tests/discovery/chainDirectoryReader.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/discovery/chainDirectoryReader.ts tests/discovery/chainDirectoryReader.test.mjs
git commit -m "feat: add chain-first directory reader"
```

### Task 6: Wire Chain Discovery Into Network Services

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/cli/runtime.test.mjs`
- Modify: `tests/daemon/httpServer.test.mjs`
- Test: `tests/discovery/*.test.mjs`

- [ ] **Step 1: Write the failing runtime-level discovery test**

Add a CLI/runtime test that injects chain-backed discovery data and expects `metabot network services --online` to return chain-backed online services without any local source seed.

- [ ] **Step 2: Write the failing handler-level fallback test**

Add a handler or route-level test that confirms a chain read failure still preserves the seeded daemon fallback behavior.

- [ ] **Step 3: Update `network.listServices` to use the chain-first orchestrator**

Keep the result envelope compatible with the existing CLI and skill pack expectations.

- [ ] **Step 4: Re-run the targeted runtime and handler tests**

Run: `npm run build && node --test tests/cli/runtime.test.mjs tests/daemon/httpServer.test.mjs tests/discovery/*.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/defaultHandlers.ts tests/cli/runtime.test.mjs tests/daemon/httpServer.test.mjs tests/discovery/*.test.mjs
git commit -m "feat: wire chain-backed online service discovery"
```

### Task 7: Fix Human-Facing Wording And Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/hosts/codex.md`
- Modify: `docs/hosts/claude-code.md`
- Modify: `docs/hosts/openclaw.md`

- [ ] **Step 1: Update docs to describe chain-first discovery**

Replace wording that currently implies users must seed a source before seeing any network services.

- [ ] **Step 2: Document seeded sources as fallback / demo helpers**

Clarify that `network sources` remains useful for demos and direct daemon execution, but is not the primary service-discovery path anymore.

- [ ] **Step 3: Run a quick grep to confirm wording changes**

Run: `rg -n "seed one remote demo provider.*first|yellow-pages feed first|current没有可展示|network sources" README.md docs`

Expected: only the updated wording remains.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/hosts/codex.md docs/hosts/claude-code.md docs/hosts/openclaw.md
git commit -m "docs: describe chain-first service discovery"
```

### Task 8: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`

Expected: PASS with all existing and new discovery tests green.

- [ ] **Step 2: Manual smoke-check the intended UX**

Run:

```bash
metabot network services --online
```

Expected:

- returns chain-backed services when chain data exists
- does not require a seeded source for chain-backed visibility
- still works with seeded fallback if chain discovery fails

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: support chain-first online service discovery"
```
