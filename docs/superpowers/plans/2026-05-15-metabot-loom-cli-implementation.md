# MetaBot Loom CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 1 `metabot loom` helper/read command group from `docs/superpowers/specs/2026-05-15-metabot-loom-cli-design.md`.

**Architecture:** Keep `metabot chain write` as the only chain-write entry point. Add focused Loom core modules for protocol mapping, validation, chain request export, LLM task drafting, raw chain sync/cache, and task-centric read projections, then expose them through `src/cli/commands/loom.ts` and command help.

**Tech Stack:** TypeScript CommonJS, Node CLI command parser, `MetabotCommandResult` envelopes, existing LLM executor/runtime resolver, existing chain path-list reader pattern, global v2 storage under `~/.metabot/loom/`, Node test runner.

---

## Working Rules

- Work in branch/worktree `codex/metabot-loom-cli`.
- Follow TDD: write failing tests first, run them to confirm failure, implement minimal code, then re-run tests.
- Make one commit per task.
- For every commit, post a development diary with `metabot buzz post` unless the human explicitly pauses that requirement again.
- Do not introduce protocol-specific Loom chain write commands. Loom writes still flow through `metabot chain write`.
- Do not run full `npm test` by default. Use the focused verification commands listed per task plus `npm run build`.
- Subagents are not alone in the codebase. Do not revert edits made by other workers; adapt to the current branch state.

## File Map

- Create `src/core/loom/protocols.ts`: protocol names, protocol path mapping, content constants, chain request operation constants.
- Create `src/core/loom/validation.ts`: schema validation for all six Loom payloads and normalized validation errors.
- Create `src/core/loom/chainRequest.ts`: validated payload to `metabot chain write` request conversion.
- Create `src/core/loom/rawChainReader.ts`: path-list chain API reader for the six Loom protocol paths.
- Create `src/core/loom/rawCache.ts`: global cache store at `~/.metabot/loom/records.json`.
- Create `src/core/loom/taskViews.ts`: task list and show projections from raw cache records.
- Create `src/core/loom/draftTask.ts`: LLM prompt, JSON extraction, validation handling for `draft-task`.
- Create `src/core/loom/index.ts`: public exports for CLI/runtime use.
- Create `src/cli/commands/loom.ts`: CLI parser for `validate`, `export-chain-request`, `sync`, `list`, `show`, and `draft-task`.
- Modify `src/cli/main.ts`: import and dispatch `loom`.
- Modify `src/cli/types.ts`: add optional `loom` dependency group if command handlers need injectable dependencies.
- Modify `src/cli/runtime.ts`: wire default Loom dependencies, LLM runtime execution for draft-task, chain API env, and global cache path resolution.
- Modify `src/cli/commandHelp.ts`: add top-level Loom command and all Loom help specs.
- Test `tests/loom/*.test.mjs`: core protocol, validation, chain request, raw cache/reader, task views, draft-task helpers.
- Test `tests/cli/loom.test.mjs`: CLI behavior.
- Modify `tests/cli/help.test.mjs`: help coverage for Loom.

## Task 1: Protocol Mapping And Validation Core

**Files:**
- Create: `src/core/loom/protocols.ts`
- Create: `src/core/loom/validation.ts`
- Create: `src/core/loom/index.ts`
- Test: `tests/loom/validation.test.mjs`

- [ ] **Step 1: Write failing validation tests**

Create `tests/loom/validation.test.mjs` that imports from `../../dist/core/loom/index.js`.

Required test cases:

```js
test('maps Loom protocol names to protocol paths', () => {
  assert.equal(LOOM_PROTOCOLS.claim.path, '/protocols/loom-claim');
  assert.equal(resolveLoomProtocol('claim').path, '/protocols/loom-claim');
  assert.equal(resolveLoomProtocol('claim-reject').path, '/protocols/loom-claim-reject');
});

test('requires payoutAddress for loom claim payloads', () => {
  const result = validateLoomPayload('claim', { taskPinId: validPinId });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === 'payoutAddress'));
});

test('accepts a valid loom claim payload with payoutAddress', () => {
  const result = validateLoomPayload('claim', {
    taskPinId: validPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    estimatedStartAt: 1750000000000,
    message: 'I can do this task.'
  });
  assert.equal(result.valid, true);
});

test('enforces acceptance payment consistency', () => {
  assert.equal(validateLoomPayload('acceptance', passedWithoutPaymentTx).valid, false);
  assert.equal(validateLoomPayload('acceptance', rejectedWithPaymentTx).valid, false);
  assert.equal(validateLoomPayload('acceptance', passedWithPaymentTx).valid, true);
});
```

Include one valid-payload test for each of `task`, `status`, `delivery`, and `claim-reject`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/loom/validation.test.mjs
```

Expected: FAIL because `dist/core/loom/index.js` does not exist.

- [ ] **Step 3: Implement protocol constants**

In `src/core/loom/protocols.ts`, export:

```ts
export type LoomProtocolName =
  | 'task'
  | 'claim'
  | 'status'
  | 'delivery'
  | 'acceptance'
  | 'claim-reject';

export interface LoomProtocolSpec {
  name: LoomProtocolName;
  path: string;
  version: '1.0.0';
  contentType: 'application/json';
}
```

Also export `LOOM_PROTOCOLS`, `LOOM_PROTOCOL_NAMES`, `LOOM_PROTOCOL_PATHS`, `resolveLoomProtocol(value)`, and `isLoomProtocolName(value)`.

- [ ] **Step 4: Implement validation**

In `src/core/loom/validation.ts`, export:

```ts
export interface LoomValidationError {
  path: string;
  code: string;
  message: string;
}

export interface LoomValidationResult {
  valid: boolean;
  protocol: LoomProtocolName;
  path: string;
  errors: LoomValidationError[];
}

export function validateLoomPayload(
  protocol: LoomProtocolName,
  payload: unknown,
): LoomValidationResult
```

Use local type guards and helper functions. Do not add a new validation dependency unless there is already a project dependency for it.

Required checks:

- required field presence and non-empty strings;
- enum values;
- positive decimal string for `bounty.amount`;
- `SPACE | BTC | DOGE | OPCAT` for `bounty.currency`;
- PINID-like strings for `taskPinId`, `claimPinId`, and `deliveryPinId` (`/^[0-9a-fA-F]{64}i\d+$/` is sufficient for Phase 1);
- positive millisecond timestamps for `deadline` and `estimatedStartAt` when present;
- `metafile://` strings for attachment/process/artifact URI arrays when present;
- `payoutAddress` required for `claim`;
- acceptance consistency: `passed` requires `releasePayment: true` and non-empty `paymentTxId`; `rejected` and `revision_needed` require `releasePayment: false` and no `paymentTxId`.

- [ ] **Step 5: Export core API**

In `src/core/loom/index.ts`, export protocol and validation APIs.

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
npm run build && node --test tests/loom/validation.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/loom/protocols.ts src/core/loom/validation.ts src/core/loom/index.ts tests/loom/validation.test.mjs
git commit -m "feat: add loom protocol validation"
```

Post a buzz development diary for the commit.

## Task 2: Chain Request Export And Validate/Export CLI

**Files:**
- Create: `src/core/loom/chainRequest.ts`
- Create: `src/cli/commands/loom.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/loom/chainRequest.test.mjs`
- Test: `tests/cli/loom.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing chain request tests**

Create `tests/loom/chainRequest.test.mjs`.

Required cases:

- `buildLoomChainWriteRequest('claim', payload)` returns operation `create`, path `/protocols/loom-claim`, encryption `0`, version `1.0.0`, contentType `application/json`, and a stringified JSON payload.
- invalid payload returns or throws a validation failure that includes `invalid_payload` semantics.

- [ ] **Step 2: Write failing CLI tests for validate and export**

Create or start `tests/cli/loom.test.mjs`.

Required cases:

- `metabot loom validate --protocol claim --payload-file claim.json` returns `ok: true`.
- invalid claim without `payoutAddress` exits `1` with `code: invalid_payload`.
- `metabot loom export-chain-request --protocol claim --payload-file claim.json` returns a request object in the JSON envelope.
- `metabot loom export-chain-request --protocol claim --payload-file claim.json --out out.json` writes the request file and returns `outPath`.
- unsupported protocol exits `1` with `invalid_protocol`.

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/loom/chainRequest.test.mjs tests/cli/loom.test.mjs
```

Expected: FAIL because chain request and CLI command are missing.

- [ ] **Step 4: Implement chain request export**

In `src/core/loom/chainRequest.ts`, export:

```ts
export interface LoomChainWriteRequest {
  operation: 'create';
  path: string;
  encryption: '0';
  version: '1.0.0';
  contentType: 'application/json';
  payload: string;
}

export function buildLoomChainWriteRequest(
  protocol: LoomProtocolName,
  payload: Record<string, unknown>,
): { request: LoomChainWriteRequest; validation: LoomValidationResult }
```

If validation fails, return validation with no request or throw a small typed error. Keep CLI error handling clean and stable.

- [ ] **Step 5: Implement initial `runLoomCommand`**

In `src/cli/commands/loom.ts`:

- parse `validate` and `export-chain-request`;
- use `readFlagValue`, `readJsonFile`, and `commandMissingFlag`;
- resolve relative `--out` paths against `context.cwd`;
- write `--out` using `node:fs/promises`;
- return `commandSuccess` or `commandFailed` envelopes.

Do not implement `sync`, `list`, `show`, or `draft-task` in this task except returning `unknown_command`.

- [ ] **Step 6: Wire main dispatch and help**

Modify `src/cli/main.ts`:

- import `runLoomCommand`;
- add `case 'loom'`.

Modify `src/cli/commandHelp.ts`:

- add `loom` to top-level subcommands;
- add specs for `loom`, `loom validate`, and `loom export-chain-request`.

Modify `tests/cli/help.test.mjs` with help assertions for these commands.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run build
node --test tests/loom/validation.test.mjs tests/loom/chainRequest.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/loom/chainRequest.ts src/cli/commands/loom.ts src/cli/main.ts src/cli/commandHelp.ts tests/loom/chainRequest.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add loom validation cli"
```

Post a buzz development diary for the commit.

## Task 3: Raw Sync Cache And Task Views

**Files:**
- Create: `src/core/loom/rawChainReader.ts`
- Create: `src/core/loom/rawCache.ts`
- Create: `src/core/loom/taskViews.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/commands/loom.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/loom/rawCache.test.mjs`
- Test: `tests/loom/taskViews.test.mjs`
- Test: `tests/cli/loom.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing raw cache and view tests**

Create `tests/loom/rawCache.test.mjs` for:

- empty cache read returns version `1` and all six protocol buckets;
- write/read roundtrip preserves invalid records;
- duplicate `pinId` rows deduplicate by latest timestamp.

Create `tests/loom/taskViews.test.mjs` for:

- task list returns task basics and related counts;
- no derived status field is present;
- show returns task and grouped related records;
- missing task returns a clear not-found result.

- [ ] **Step 2: Extend failing CLI tests**

In `tests/cli/loom.test.mjs`, add injected dependency tests:

- `loom sync` calls `context.dependencies.loom.sync`;
- `loom list` calls `context.dependencies.loom.list`;
- `loom list --refresh` passes `refresh: true`;
- `loom show <taskPinId> --refresh` passes task pin and refresh flag.

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/loom/rawCache.test.mjs tests/loom/taskViews.test.mjs tests/cli/loom.test.mjs
```

Expected: FAIL because modules and commands are missing.

- [ ] **Step 4: Implement raw chain reader**

In `src/core/loom/rawChainReader.ts`:

- follow `src/core/discovery/chainDirectoryReader.ts` path-list URL pattern;
- use default base URL `https://manapi.metaid.io`;
- support injected `fetchImpl`, `chainApiBaseUrl`, `pageSize`, and `maxPages`;
- fetch all six Loom protocol paths;
- normalize raw rows into cached record candidates with `pinId`, `path`, `operation`, `contentType`, `timestamp`, creator metadata, parsed `payload`, `payloadValid`, `validationErrors`, and `raw`.

- [ ] **Step 5: Implement global raw cache store**

In `src/core/loom/rawCache.ts`:

- store at `path.join(paths.metabotRoot, 'loom', 'records.json')`;
- expose `createLoomRawCacheStore(homeDirOrPaths)`;
- implement `read`, `write`, and `update`;
- normalize missing/corrupt cache to an empty version `1` state;
- keep invalid records.

- [ ] **Step 6: Implement task views**

In `src/core/loom/taskViews.ts`:

- export `listLoomTasksFromCache(state, filters)`;
- export `showLoomTaskFromCache(state, taskPinId)`;
- include related counts only;
- do not emit derived status.

- [ ] **Step 7: Wire runtime dependencies**

In `src/cli/types.ts`, add optional:

```ts
loom?: {
  sync?: (input: { limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
  list?: (input: { refresh: boolean; limit?: number; tag?: string; currency?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  show?: (input: { taskPinId: string; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
}
```

In `src/cli/runtime.ts`, implement default dependency methods using the raw reader/cache/task views. Use `METABOT_CHAIN_API_BASE_URL` from `context.env`.

- [ ] **Step 8: Extend CLI and help**

In `src/cli/commands/loom.ts`, add `sync`, `list`, and `show`.

Rules:

- `sync [--limit <n>]`;
- `list [--refresh] [--limit <n>] [--tag <tag>] [--currency <SPACE|BTC|DOGE|OPCAT>]`;
- `show <taskPinId> [--refresh]`;
- invalid numeric limit fails with `invalid_flag`;
- missing show task id fails with `missing_argument`.

Update `src/cli/commandHelp.ts` and `tests/cli/help.test.mjs`.

- [ ] **Step 9: Run tests to verify GREEN**

Run:

```bash
npm run build
node --test tests/loom/validation.test.mjs tests/loom/chainRequest.test.mjs tests/loom/rawCache.test.mjs tests/loom/taskViews.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/core/loom src/cli/commands/loom.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/loom tests/cli/loom.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add loom raw index commands"
```

Post a buzz development diary for the commit.

## Task 4: LLM Draft Task Command

**Files:**
- Create: `src/core/loom/draftTask.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/commands/loom.ts`
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/loom/draftTask.test.mjs`
- Test: `tests/cli/loom.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing draft helper tests**

Create `tests/loom/draftTask.test.mjs` for:

- JSON extraction from plain JSON output;
- JSON extraction from fenced JSON output if easy to support;
- invalid JSON returns `invalid_llm_output`;
- valid JSON plus validation returns valid draft;
- invalid task JSON returns validation errors and supports allow-invalid behavior at the helper boundary.

- [ ] **Step 2: Extend failing CLI tests**

In `tests/cli/loom.test.mjs`, add:

- `loom draft-task --wish "..."` calls injected dependency with `{ wish, allowInvalid: false }`;
- `loom draft-task --wish "..." --from alice --allow-invalid` forwards `from` and `allowInvalid`;
- missing `--wish` fails with `missing_flag`.

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm run build && node --test tests/loom/draftTask.test.mjs tests/cli/loom.test.mjs
```

Expected: FAIL because draft helper and command are missing.

- [ ] **Step 4: Implement draft helper**

In `src/core/loom/draftTask.ts`, export:

```ts
export interface DraftLoomTaskInput {
  wish: string;
  allowInvalid: boolean;
  executePrompt: (input: { prompt: string; systemPrompt: string }) => Promise<string>;
}
```

The helper should:

- build a strict system prompt that says "output JSON only";
- ask for a `/protocols/loom-task` payload;
- parse JSON from LLM output;
- validate with `validateLoomPayload('task', payload)`;
- fail invalid JSON even with `allowInvalid`;
- return invalid payload with `valid: false` when `allowInvalid` is true.

- [ ] **Step 5: Wire runtime LLM execution**

In `src/cli/types.ts`, extend `loom` with:

```ts
draftTask?: (input: { wish: string; from?: string; allowInvalid: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
```

In `src/cli/runtime.ts`, implement `loom.draftTask`:

- resolve actor profile from `from` or active profile;
- resolve `MetabotPaths`;
- create or reuse `LlmRuntimeResolver` and `LlmExecutor` in the same style as existing runtime code;
- execute a prompt through the selected runtime;
- poll `llmExecutor.getSession(sessionId)` until terminal result or timeout;
- map missing runtime to `llm_runtime_unavailable`;
- return command envelopes from the draft helper.

Keep runtime wiring small; do not change existing chat/service LLM behavior.

- [ ] **Step 6: Extend CLI and help**

In `src/cli/commands/loom.ts`, add `draft-task`.

Rules:

- `--wish` required;
- `--from` optional;
- `--allow-invalid` boolean;
- no chain write, no request export.

Update `src/cli/commandHelp.ts` and `tests/cli/help.test.mjs`.

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```bash
npm run build
node --test tests/loom/draftTask.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/loom/draftTask.ts src/core/loom/index.ts src/cli/commands/loom.ts src/cli/types.ts src/cli/runtime.ts src/cli/commandHelp.ts tests/loom/draftTask.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add loom llm task drafting"
```

Post a buzz development diary for the commit.

## Task 5: Final Integration Verification And Polish

**Files:**
- Modify as needed based on verification findings.
- Test: all focused Loom tests.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run build
node --test tests/loom/*.test.mjs
node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run CLI smoke checks against built dist**

Run:

```bash
node dist/cli/main.js loom --help
node dist/cli/main.js loom validate --help --json
node dist/cli/main.js loom export-chain-request --help --json
node dist/cli/main.js loom sync --help --json
node dist/cli/main.js loom list --help --json
node dist/cli/main.js loom show --help --json
node dist/cli/main.js loom draft-task --help --json
```

Expected: all exit `0` and print help payloads.

- [ ] **Step 3: Inspect git diff for accidental scope creep**

Run:

```bash
git status --short
git diff --stat HEAD
git diff --check
```

Expected: no unrelated files and no whitespace errors.

- [ ] **Step 4: Fix issues discovered by verification**

If any focused test or smoke command fails, write or update a failing test first, then fix the implementation.

- [ ] **Step 5: Commit final polish if needed**

Only commit if this task changes files:

```bash
git add <changed-files>
git commit -m "fix: polish loom cli integration"
```

Post a buzz development diary for the commit.

## Final Review Gate

After Task 5 passes, dispatch a final review subagent over the whole branch.

The final reviewer should verify:

- implementation matches `docs/superpowers/specs/2026-05-15-metabot-loom-cli-design.md`;
- no protocol-specific Loom chain write commands were added;
- `metabot chain write` remains the only write entry point;
- Phase 1 does not execute payments, inspect git, upload attachments, infer status, enforce permissions, or verify payment txids;
- focused tests and build pass;
- commits are small and scoped.

Do not merge or finish the branch until the final review is approved.
