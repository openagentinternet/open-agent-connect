# MetaBot Loom Workflow CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 2 `metabot loom` workflow CLI so two local MetaBots can publish, claim, develop, deliver, review, pay, and inspect a Loom task through CLI.

**Architecture:** Add a profile-scoped Loom workflow layer under `src/core/loom/` that composes existing protocol validation, chain write, wallet transfer, file upload, LLM executor, and raw cache pieces. Keep CLI parsing thin in `src/cli/commands/loom.ts`; wire real runtime dependencies in `src/cli/runtime.ts`; keep GitHub and command execution behind injectable adapters so tests do not need real `git`, `gh`, GitHub, wallets, or chain writes.

**Tech Stack:** TypeScript CommonJS, Node.js `fs/path/child_process`, existing `MetabotCommandResult` envelopes, existing Loom validators/cache, existing `LlmExecutor`, existing signer/wallet/file-upload primitives, GitHub CLI (`gh`) and git via injectable command runner, Node test runner.

---

## Source Documents

- Spec: `docs/superpowers/specs/2026-05-16-metabot-loom-workflow-cli-design.md`
- Protocols: `docs/metaid_protocols/05-loom.md`
- Phase 1 design: `docs/superpowers/specs/2026-05-15-metabot-loom-cli-design.md`
- Storage layout: `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`
- Project instructions: `AGENTS.md`

## Execution Rules

- Work in branch/worktree `codex/metabot-loom-cli`.
- Execute tasks sequentially with one fresh implementer subagent per task.
- Do not dispatch implementation subagents in parallel; later tasks depend on earlier exported modules.
- Every task must leave `npm run build` and its targeted tests passing before commit.
- Every task must create one commit.
- After every commit, post a detailed development diary through the `metabot-post-buzz` skill, preferably with `metabot buzz post --from eric --request-file <request.json>`.
- Use targeted tests. Do not run full `npm test` unless a task explicitly expands shared runtime behavior enough to need it.
- All documentation, code comments, and generated SKILL content must be English.
- Do not introduce legacy `.metabot/hot` references.

## File Structure

Create:

- `src/core/loom/workflowTypes.ts`: shared workflow types, error constants, command input/output types.
- `src/core/loom/workflowStore.ts`: profile-scoped `.runtime/loom` paths and workflow state persistence.
- `src/core/loom/workflowState.ts`: minimal aggregation from raw cache plus workflow state.
- `src/core/loom/workflowLog.ts`: process log rendering, redaction, file-chain selection.
- `src/core/loom/commandRunner.ts`: injectable local command runner for `git`, `gh`, and checks.
- `src/core/loom/githubWorkflow.ts`: GitHub repo normalization, tool/auth checks, fork and workspace preparation, push/PR helpers.
- `src/core/loom/workflowChain.ts`: Loom protocol payload write helper and optimistic record helper.
- `src/core/loom/postTaskWorkflow.ts`: `post-task` workflow.
- `src/core/loom/claimStartWorkflow.ts`: `claim-and-start` workflow.
- `src/core/loom/devRoundWorkflow.ts`: `run-dev-round` workflow.
- `src/core/loom/deliveryWorkflow.ts`: `deliver` workflow.
- `src/core/loom/reviewWorkflow.ts`: `accept-and-pay` and `review-delivery` workflows.
- `tests/loom/workflowStore.test.mjs`
- `tests/loom/workflowState.test.mjs`
- `tests/loom/workflowLog.test.mjs`
- `tests/loom/githubWorkflow.test.mjs`
- `tests/loom/workflowChain.test.mjs`
- `tests/loom/postTaskWorkflow.test.mjs`
- `tests/loom/claimStartWorkflow.test.mjs`
- `tests/loom/devRoundWorkflow.test.mjs`
- `tests/loom/deliveryWorkflow.test.mjs`
- `tests/loom/reviewWorkflow.test.mjs`
- `docs/acceptance/metabot-loom-workflow-cli-smoke.md`

Modify:

- `src/core/loom/index.ts`: export new workflow modules.
- `src/cli/types.ts`: add workflow dependency signatures under `loom`.
- `src/cli/commands/loom.ts`: parse workflow commands and delegate.
- `src/cli/commandHelp.ts`: document workflow commands.
- `src/cli/runtime.ts`: wire real workflow dependencies.
- `tests/cli/loom.test.mjs`: parser/delegation and flag validation tests.
- `tests/cli/help.test.mjs`: help smoke coverage for new commands.

## Shared Test Helpers

Use these constants in new tests when useful:

```js
const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;
const deliveryPinId = `${'c'.repeat(64)}i0`;
const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';
```

Use fake command runners and fake dependency callbacks. Do not call real `git`, `gh`, chain APIs, wallets, or LLM runtimes in unit tests.

---

### Task 1: Workflow Store And Shared Types

**Files:**
- Create: `src/core/loom/workflowTypes.ts`
- Create: `src/core/loom/workflowStore.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/workflowStore.test.mjs`

- [ ] **Step 1: Write failing workflow store tests**

Create `tests/loom/workflowStore.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLoomWorkflowStore,
  resolveLoomWorkflowPaths,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;
const claimPinId = `${'b'.repeat(64)}i0`;

test('resolves workflow paths under profile runtime loom root', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-')), '.metabot', 'profiles', 'eric');
  const paths = resolveLoomWorkflowPaths(profileHome, { taskPinId, claimPinId, localRunId: 'run-1' });
  assert.match(paths.workflowPath, /\.runtime\/loom\/workflows\/a+.*\/b+.*\.json$/);
  assert.match(paths.workspaceRepoPath, /\.runtime\/loom\/workspaces\/a+.*\/b+.*\/repo$/);
  assert.match(paths.stagingRepoPath, /\.runtime\/loom\/staging\/a+.*\/run-1\/repo$/);
});

test('workflow store writes and reads normalized state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-state-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  const written = await store.write({
    version: 1,
    taskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    requesterGlobalMetaId: 'requester-global',
    developerGlobalMetaId: 'developer-global',
    repoUri: 'https://github.com/example/repo',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'loom-fork',
    forkRepo: 'eric/repo',
    branchName: 'loom/aaaaaaaa-bbbbbbbb',
    workspacePath: '/tmp/repo',
    statuses: [],
    updatedAt: '2026-05-16T00:00:00.000Z',
  });
  assert.equal(written.taskPinId, taskPinId);
  const read = await store.read(taskPinId, claimPinId);
  assert.equal(read.branchName, 'loom/aaaaaaaa-bbbbbbbb');
  const raw = JSON.parse(await readFile(store.resolve(taskPinId, claimPinId).workflowPath, 'utf8'));
  assert.equal(raw.version, 1);
});

test('workflow store returns null for missing state', async () => {
  const profileHome = path.join(await mkdtemp(path.join(os.tmpdir(), 'loom-store-missing-')), '.metabot', 'profiles', 'eric');
  const store = createLoomWorkflowStore(profileHome);
  assert.equal(await store.read(taskPinId, claimPinId), null);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm run build && node --test tests/loom/workflowStore.test.mjs
```

Expected: FAIL because workflow store exports do not exist.

- [ ] **Step 3: Implement shared types**

Create `src/core/loom/workflowTypes.ts` with these exported types:

```ts
import type { MetabotCommandResult } from '../contracts/commandResult';
import type { ChainWriteNetwork } from '../chain/writePin';

export type LoomFileUploadNetwork = 'mvc' | 'btc' | 'opcat';
export type LoomWorkflowStatusValue = 'started' | 'in_progress' | 'completed' | 'failed';
export type LoomDerivedTaskState =
  | 'open'
  | 'claimed'
  | 'in_progress'
  | 'delivered'
  | 'revision_needed'
  | 'rejected'
  | 'accepted_paid'
  | 'failed';

export interface LoomWorkflowCommitRecord {
  sha: string;
  message: string;
  files: string[];
}

export interface LoomWorkflowStatusRecord {
  roundId: string;
  status: LoomWorkflowStatusValue;
  pinId?: string;
  processLogPath?: string;
  processLogUri?: string;
  llmSessionId?: string | null;
  commits: LoomWorkflowCommitRecord[];
  checksPassed?: boolean | null;
}

export interface LoomWorkflowState {
  version: 1;
  taskPinId: string;
  claimPinId: string;
  developerMetaBotSlug: string;
  requesterGlobalMetaId?: string;
  developerGlobalMetaId?: string;
  repoUri: string;
  baseBranch: string;
  upstreamRemote: string;
  forkRemote: string;
  forkRepo?: string;
  branchName: string;
  workspacePath: string;
  claim?: { pinId: string; txids?: string[] };
  statuses: LoomWorkflowStatusRecord[];
  delivery?: { pinId?: string; prUrl?: string; prTitle?: string };
  acceptance?: { pinId?: string; paymentTxId?: string };
  retry?: { acceptanceRequestPath?: string; acceptancePayloadPath?: string };
  updatedAt: string;
}

export interface LoomWorkflowCommandResult<T> extends Promise<MetabotCommandResult<T>> {}

export interface LoomProtocolWriteResult {
  pinId: string;
  txids?: string[];
  network?: ChainWriteNetwork | string;
  globalMetaId?: string;
  mvcAddress?: string;
}
```

- [ ] **Step 4: Implement workflow store**

Create `src/core/loom/workflowStore.ts`:

```ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { LoomWorkflowState } from './workflowTypes';

export interface LoomWorkflowPathInput {
  taskPinId: string;
  claimPinId?: string;
  localRunId?: string;
}

export interface LoomWorkflowPaths {
  loomRuntimeRoot: string;
  workflowsRoot: string;
  stagingRoot: string;
  workspacesRoot: string;
  logsRoot: string;
  workflowPath: string;
  stagingRepoPath: string;
  workspaceRepoPath: string;
  taskLogsRoot: string;
}

function isMetabotPaths(value: unknown): value is MetabotPaths {
  return Boolean(value && typeof value === 'object' && typeof (value as { runtimeRoot?: unknown }).runtimeRoot === 'string');
}

function pathsFor(homeDirOrPaths: string | MetabotPaths): MetabotPaths {
  return isMetabotPaths(homeDirOrPaths) ? homeDirOrPaths : resolveMetabotPaths(homeDirOrPaths);
}

function safeSegment(value: string | undefined, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9._-]/g, '_') : '';
  return normalized || fallback;
}

export function resolveLoomWorkflowPaths(
  homeDirOrPaths: string | MetabotPaths,
  input: LoomWorkflowPathInput,
): LoomWorkflowPaths {
  const paths = pathsFor(homeDirOrPaths);
  const loomRuntimeRoot = path.join(paths.runtimeRoot, 'loom');
  const taskSegment = safeSegment(input.taskPinId, 'unknown-task');
  const claimSegment = safeSegment(input.claimPinId, 'pending-claim');
  const runSegment = safeSegment(input.localRunId, 'run');
  return {
    loomRuntimeRoot,
    workflowsRoot: path.join(loomRuntimeRoot, 'workflows'),
    stagingRoot: path.join(loomRuntimeRoot, 'staging'),
    workspacesRoot: path.join(loomRuntimeRoot, 'workspaces'),
    logsRoot: path.join(loomRuntimeRoot, 'logs'),
    workflowPath: path.join(loomRuntimeRoot, 'workflows', taskSegment, `${claimSegment}.json`),
    stagingRepoPath: path.join(loomRuntimeRoot, 'staging', taskSegment, runSegment, 'repo'),
    workspaceRepoPath: path.join(loomRuntimeRoot, 'workspaces', taskSegment, claimSegment, 'repo'),
    taskLogsRoot: path.join(loomRuntimeRoot, 'logs', taskSegment, claimSegment),
  };
}

function normalizeState(value: LoomWorkflowState): LoomWorkflowState {
  return {
    ...value,
    version: 1,
    statuses: Array.isArray(value.statuses) ? value.statuses : [],
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

export function createLoomWorkflowStore(homeDirOrPaths: string | MetabotPaths) {
  return {
    resolve(taskPinId: string, claimPinId?: string, localRunId?: string) {
      return resolveLoomWorkflowPaths(homeDirOrPaths, { taskPinId, claimPinId, localRunId });
    },
    async read(taskPinId: string, claimPinId: string): Promise<LoomWorkflowState | null> {
      const filePath = this.resolve(taskPinId, claimPinId).workflowPath;
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as LoomWorkflowState;
        if (!parsed || parsed.version !== 1 || parsed.taskPinId !== taskPinId || parsed.claimPinId !== claimPinId) {
          return null;
        }
        return normalizeState(parsed);
      } catch {
        return null;
      }
    },
    async write(state: LoomWorkflowState): Promise<LoomWorkflowState> {
      const normalized = normalizeState({ ...state, updatedAt: new Date().toISOString() });
      const filePath = this.resolve(normalized.taskPinId, normalized.claimPinId).workflowPath;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
  };
}
```

- [ ] **Step 5: Export modules**

Modify `src/core/loom/index.ts`:

```ts
export * from './workflowTypes';
export * from './workflowStore';
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run build && node --test tests/loom/workflowStore.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/workflowTypes.ts src/core/loom/workflowStore.ts src/core/loom/index.ts tests/loom/workflowStore.test.mjs
git commit -m "feat: add loom workflow store"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 2: Minimal Aggregation State

**Files:**
- Create: `src/core/loom/workflowState.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/workflowState.test.mjs`

- [ ] **Step 1: Write failing aggregation tests**

Create `tests/loom/workflowState.test.mjs` with tests for:

```js
test('derives in_progress from valid task claim and latest status', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    statusAuthor: developerGlobalMetaId,
    status: 'in_progress',
  }), taskPinId);
  assert.equal(state.found, true);
  assert.equal(state.state, 'in_progress');
  assert.equal(state.valid.claims[0].pinId, claimPinId);
});

test('marks status from non-claim author invalid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    statusAuthor: 'other-global',
    status: 'completed',
  }), taskPinId);
  assert.equal(state.state, 'claimed');
  assert.ok(state.invalid.statuses.some((entry) => entry.reason.code === 'permission_denied'));
});

test('derives accepted_paid from requester acceptance with payment txid', () => {
  const state = buildLoomWorkflowTaskState(cacheStateWith({
    taskAuthor: requesterGlobalMetaId,
    claimAuthor: developerGlobalMetaId,
    deliveryAuthor: developerGlobalMetaId,
    acceptanceAuthor: requesterGlobalMetaId,
    acceptanceVerdict: 'passed',
  }), taskPinId);
  assert.equal(state.state, 'accepted_paid');
  assert.equal(state.paymentTxId, 'payment-txid');
});
```

Implement helper `cacheStateWith()` in the test file using `LoomCachedRecord`-shaped objects.

- [ ] **Step 2: Run failing test**

```bash
npm run build && node --test tests/loom/workflowState.test.mjs
```

Expected: FAIL because `buildLoomWorkflowTaskState` does not exist.

- [ ] **Step 3: Implement state projector**

Create `src/core/loom/workflowState.ts` exporting:

- `LoomWorkflowTaskState`
- `buildLoomWorkflowTaskState(rawState, taskPinId, options?)`
- `findLatestValidDelivery(state, deliveryPinId?)`
- `findValidClaimForDelivery(state, deliveryPinId)`

Implementation requirements:

- Treat `record.payloadValid === false` as invalid.
- Validate references:
  - claim references task;
  - status references task and claim;
  - delivery references task and claim;
  - acceptance references task and delivery;
  - claim-reject references task and claim.
- Validate author:
  - task author is `task.globalMetaId`;
  - claim/status/delivery author must match claim `globalMetaId`;
  - acceptance/claim-reject author must match task `globalMetaId`.
- Sort records by `timestamp`, then `pinId`.
- Return invalid records with `{ record, reason: { code, message } }`.
- Derive states exactly as the SDD table says.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './workflowState';
```

- [ ] **Step 5: Verify**

```bash
npm run build && node --test tests/loom/workflowState.test.mjs tests/loom/taskViews.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and buzz**

```bash
git add src/core/loom/workflowState.ts src/core/loom/index.ts tests/loom/workflowState.test.mjs
git commit -m "feat: add loom workflow state projection"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 3: Command Runner And GitHub Workspace Helpers

**Files:**
- Create: `src/core/loom/commandRunner.ts`
- Create: `src/core/loom/githubWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/githubWorkflow.test.mjs`

- [ ] **Step 1: Write failing GitHub helper tests**

Create `tests/loom/githubWorkflow.test.mjs` covering:

- `normalizeGitHubRepoUri('https://github.com/openagentinternet/open-agent-connect.git')` returns `{ owner: 'openagentinternet', repo: 'open-agent-connect', fullName: 'openagentinternet/open-agent-connect' }`.
- `selectProcessLogFileChain('doge')` is not here; leave for Task 4.
- `assertGitHubToolsReady()` returns `tool_missing` when fake runner reports missing `git`.
- `assertGitHubToolsReady()` returns `github_auth_unavailable` when `gh auth status` exits nonzero.
- `buildLoomBranchName(taskPinId, claimPinId)` returns `loom/aaaaaaaa-bbbbbbbb`.
- `prepareGitHubForkWorkspace()` calls fake runner commands in order: `gh repo view`, `gh repo fork` when needed, `git clone`, `git remote remove/add`, `git checkout -B`.

- [ ] **Step 2: Run failing test**

```bash
npm run build && node --test tests/loom/githubWorkflow.test.mjs
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement command runner**

Create `src/core/loom/commandRunner.ts`:

```ts
import { spawn } from 'node:child_process';

export interface LoomCommandRunInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface LoomCommandRunResult {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface LoomCommandRunner {
  run(input: LoomCommandRunInput): Promise<LoomCommandRunResult>;
}

export function createNodeLoomCommandRunner(): LoomCommandRunner {
  return {
    run(input) {
      return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(input.command, input.args, {
          cwd: input.cwd,
          env: input.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => resolve({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          exitCode: -1,
          stdout,
          stderr: error.message,
          durationMs: Date.now() - started,
        }));
        child.on('close', (code) => resolve({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        }));
      });
    },
  };
}
```

- [ ] **Step 4: Implement GitHub helpers**

Create `src/core/loom/githubWorkflow.ts` exporting:

- `normalizeGitHubRepoUri(value)`
- `buildLoomBranchName(taskPinId, claimPinId)`
- `assertGitHubToolsReady({ runner })`
- `prepareGitHubForkWorkspace(input)`
- `pushLoomBranch(input)`
- `createLoomPullRequest(input)`

Implementation details:

- Use `git --version` and `gh --version` for tool checks.
- Use `gh auth status` for auth check.
- Use `gh repo view <owner/repo> --json parent,nameWithOwner` to resolve current user's fork when possible.
- Use `gh repo fork <owner/repo> --clone=false` when no fork is found.
- Keep command args arrays shell-free.
- Return structured results, never parse human-only output when a `--json` option exists.

- [ ] **Step 5: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './commandRunner';
export * from './githubWorkflow';
```

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/githubWorkflow.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/commandRunner.ts src/core/loom/githubWorkflow.ts src/core/loom/index.ts tests/loom/githubWorkflow.test.mjs
git commit -m "feat: add loom github workspace helpers"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 4: Workflow Chain Helper And Process Logs

**Files:**
- Create: `src/core/loom/workflowChain.ts`
- Create: `src/core/loom/workflowLog.ts`
- Modify: `src/core/loom/index.ts`
- Test: `tests/loom/workflowChain.test.mjs`
- Test: `tests/loom/workflowLog.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/loom/workflowLog.test.mjs` should cover:

- `selectProcessLogFileChain('mvc') === 'mvc'`
- `selectProcessLogFileChain('btc') === 'btc'`
- `selectProcessLogFileChain('opcat') === 'opcat'`
- `selectProcessLogFileChain('doge') === 'mvc'`
- explicit file-chain overrides are honored.
- `redactLoomProcessLog('Authorization: Bearer abc')` does not contain `abc`.
- `renderLoomProcessLog(...)` includes task id, claim id, check summary, commit summary.

`tests/loom/workflowChain.test.mjs` should cover:

- `writeLoomProtocolRecord()` validates payload, stringifies request payload, passes `network` and `from` to injected `writeChain`.
- invalid payload returns `invalid_payload`.
- thrown write error maps to `chain_write_failed`.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/workflowLog.test.mjs tests/loom/workflowChain.test.mjs
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement process log helpers**

Create `src/core/loom/workflowLog.ts` exporting:

- `selectProcessLogFileChain(recordChain, fileChain?)`
- `redactLoomProcessLog(input)`
- `renderLoomProcessLog(input)`
- `writeLoomProcessLogFile(input)`

Rules:

- Accepted file chains: `mvc`, `btc`, `opcat`.
- If record chain is `doge` and file chain omitted, return `mvc`.
- Redact patterns for `Authorization: Bearer ...`, `api_key=...`, `token=...`, `mnemonic`, and private key blocks.
- Cap rendered logs to a conservative size, for example 100 KB, with a truncation note.

- [ ] **Step 4: Implement chain helper**

Create `src/core/loom/workflowChain.ts` exporting:

```ts
export async function writeLoomProtocolRecord(input: {
  protocol: LoomProtocolName;
  payload: Record<string, unknown>;
  from?: string;
  chain?: string;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}): Promise<MetabotCommandResult<{ pinId: string; txids?: string[]; request: LoomChainWriteRequest }>>
```

Use `buildLoomChainWriteRequest()`.

- [ ] **Step 5: Export modules**

Modify `src/core/loom/index.ts`:

```ts
export * from './workflowChain';
export * from './workflowLog';
```

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/workflowLog.test.mjs tests/loom/workflowChain.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/workflowChain.ts src/core/loom/workflowLog.ts src/core/loom/index.ts tests/loom/workflowChain.test.mjs tests/loom/workflowLog.test.mjs
git commit -m "feat: add loom workflow chain and logs"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 5: CLI Parser And Help For Workflow Commands

**Files:**
- Modify: `src/cli/types.ts`
- Modify: `src/cli/commands/loom.ts`
- Modify: `src/cli/commandHelp.ts`
- Test: `tests/cli/loom.test.mjs`
- Test: `tests/cli/help.test.mjs`

- [ ] **Step 1: Write failing CLI parser tests**

Append tests to `tests/cli/loom.test.mjs` for delegated inputs:

- `post-task --from alice --payload-file task.json --chain mvc --dry-run`
- `post-task --from alice --wish "..." --chain mvc`
- reject `post-task` when both `--payload-file` and `--wish` are missing or both provided.
- `claim-and-start --from bob --task-pin-id ... --payout-address ... --chain mvc --file-chain btc --message hi`
- `claim-and-start --from bob --task-pin-id ... --claim-pin-id ... --chain mvc --reset-workspace`
- reject `claim-and-start` when neither payout address nor claim pin id is provided.
- `run-dev-round` forwards repeated `--check`.
- `deliver` forwards `--dry-run`, `--pr-title`, `--delivery-summary`.
- `accept-and-pay` forwards `--confirm-payment`, score, comment.
- `review-delivery` forwards verdict, score, comment, repeated `--attachment`.
- `state <taskPinId> --refresh` delegates to `loom.state`.

Use injected dependencies as existing tests do.

- [ ] **Step 2: Write failing help tests**

Append help checks to `tests/cli/help.test.mjs`:

```js
for (const command of ['post-task', 'claim-and-start', 'run-dev-round', 'deliver', 'accept-and-pay', 'review-delivery', 'state']) {
  const exitCode = await runCli(['loom', command, '--help'], context);
  assert.equal(exitCode, 0);
  assert.match(output, new RegExp(`metabot loom ${command}`));
}
```

- [ ] **Step 3: Run failing tests**

```bash
npm run build && node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: FAIL because parser/help entries do not exist.

- [ ] **Step 4: Extend dependency types**

Modify `src/cli/types.ts` under `CliDependencies.loom`:

```ts
postTask?: (input: {
  from?: string;
  payloadFile?: string;
  wish?: string;
  chain?: string;
  dryRun: boolean;
}) => Awaitable<MetabotCommandResult<unknown>>;
claimAndStart?: (input: {
  from?: string;
  taskPinId: string;
  payoutAddress?: string;
  claimPinId?: string;
  chain?: string;
  fileChain?: string;
  message?: string;
  dryRun: boolean;
  resetWorkspace: boolean;
}) => Awaitable<MetabotCommandResult<unknown>>;
runDevRound?: (input: {
  from?: string;
  taskPinId: string;
  claimPinId: string;
  chain?: string;
  fileChain?: string;
  checks: string[];
  roundNote?: string;
}) => Awaitable<MetabotCommandResult<unknown>>;
deliver?: (input: {
  from?: string;
  taskPinId: string;
  claimPinId: string;
  chain?: string;
  prTitle?: string;
  deliverySummary?: string;
  dryRun: boolean;
}) => Awaitable<MetabotCommandResult<unknown>>;
acceptAndPay?: (input: {
  from?: string;
  taskPinId: string;
  deliveryPinId: string;
  score: number;
  comment: string;
  chain?: string;
  confirmPayment: boolean;
}) => Awaitable<MetabotCommandResult<unknown>>;
reviewDelivery?: (input: {
  from?: string;
  taskPinId: string;
  deliveryPinId: string;
  verdict: 'rejected' | 'revision_needed';
  score: number;
  comment: string;
  chain?: string;
  attachments: string[];
}) => Awaitable<MetabotCommandResult<unknown>>;
state?: (input: { taskPinId: string; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
```

- [ ] **Step 5: Implement parser helpers**

Modify `src/cli/commands/loom.ts`:

- Add `readAllFlagValues(args, flag)`.
- Add positive score parser.
- Use existing `readChainWriteFlag()` for `--chain`.
- Use existing `readFileUploadChainFlag()` for `--file-chain`, but parse it by temporarily reading `--file-chain` or adding a generic helper if cleaner.
- Reject missing required flags with `missing_flag`.
- Reject invalid flag combinations with `invalid_flag`.

- [ ] **Step 6: Add command dispatch**

Add cases:

```ts
case 'post-task':
case 'claim-and-start':
case 'run-dev-round':
case 'deliver':
case 'accept-and-pay':
case 'review-delivery':
case 'state':
```

Each should call the corresponding dependency and return `dependency_unavailable` when missing.

- [ ] **Step 7: Update help**

Modify `src/cli/commandHelp.ts`:

- Loom group summary should mention workflow commands.
- Add subcommand entries and specs for all new commands.
- Include negative semantics for payment confirmation and GitHub tool requirements.

- [ ] **Step 8: Verify**

```bash
npm run build && node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit and buzz**

```bash
git add src/cli/types.ts src/cli/commands/loom.ts src/cli/commandHelp.ts tests/cli/loom.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add loom workflow cli surface"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 6: Post Task Workflow Runtime

**Files:**
- Create: `src/core/loom/postTaskWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/loom/postTaskWorkflow.test.mjs`
- Test: `tests/cli/loom.test.mjs`

- [ ] **Step 1: Write failing core tests**

Create `tests/loom/postTaskWorkflow.test.mjs` covering:

- payload-file path publishes valid task through injected `writeChain`.
- `dryRun` returns payload and request without write.
- invalid task returns `invalid_payload`.
- wish path uses injected `draftTask` and then writes.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/postTaskWorkflow.test.mjs
```

Expected: FAIL because `postTaskWorkflow` does not exist.

- [ ] **Step 3: Implement core workflow**

Create `src/core/loom/postTaskWorkflow.ts` exporting `runLoomPostTaskWorkflow(input)`.

Inputs:

- `from`, `payload`, `wish`, `chain`, `dryRun`.
- injected `readPayloadFile`, `draftTask`, and `writeChain`.

Behavior:

- Validate one source only.
- Use `validateLoomPayload('task', payload)`.
- Build request with `buildLoomChainWriteRequest('task', payload)`.
- On dry run, return `commandSuccess({ dryRun: true, payload, request })`.
- On write, call `writeLoomProtocolRecord`.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './postTaskWorkflow';
```

- [ ] **Step 5: Wire runtime**

Modify `src/cli/runtime.ts` in `loom` dependencies:

- `postTask` reads payload file through `context.readTextFile` when `payloadFile` is present.
- `postTask` uses existing `draftLoomTask` path when `wish` is present. Prefer extracting a small local helper from the existing `draftTask` runtime code only if it avoids duplication without broad refactor.
- `postTask` calls `context.dependencies.chain?.write` equivalent directly through local runtime's default `chain.write` or a local signer. Keep behavior consistent with `metabot chain write --from`.

Implementation note: if calling the default dependency is awkward inside `mergeCliDependencies`, implement a local `writeChainFromActor(input)` helper in `src/cli/runtime.ts` and reuse it later.

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/postTaskWorkflow.test.mjs tests/cli/loom.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/postTaskWorkflow.ts src/core/loom/index.ts src/cli/runtime.ts tests/loom/postTaskWorkflow.test.mjs tests/cli/loom.test.mjs
git commit -m "feat: add loom post task workflow"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 7: Claim And Start Workflow

**Files:**
- Create: `src/core/loom/claimStartWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/loom/claimStartWorkflow.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/loom/claimStartWorkflow.test.mjs` covering:

- non-GitHub task returns `unsupported_project_base`.
- missing task returns `task_not_found`.
- missing git/gh returns `tool_missing` before chain writes.
- dry-run returns planned claim/status payloads and pending-claim branch/path previews without calling fork, clone, chain write, upload, or filesystem mutation dependencies.
- normal flow prepares staging, writes claim, moves to final workspace, uploads log, writes started status.
- `--reset-workspace` in normal mode deletes only the current task/run staging workspace and leaves global cache plus unrelated task/claim workspaces untouched.
- `--reset-workspace` in recovery mode with `--claim-pin-id` deletes only that task/claim final workspace and leaves staging plus unrelated task/claim workspaces untouched.
- recovery flow with `--claim-pin-id` resolves the existing claim, verifies its author is the developer actor, and does not write a duplicate claim.
- recovery flow with `--claim-pin-id` returns `permission_denied` when the existing claim belongs to another developer.
- process log upload failure after claim write returns `claim_written_start_failed` with `claimPinId` and retry command.
- `--chain doge` without `--file-chain` uploads log on `mvc` but writes Loom records on `doge`.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/claimStartWorkflow.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement core workflow**

Create `src/core/loom/claimStartWorkflow.ts` exporting `runLoomClaimAndStartWorkflow(input)`.

Core dependencies to inject:

- `stateProvider` or raw `LoomWorkflowTaskState`.
- `workflowStore`.
- `github` helper functions.
- `writeChain`.
- `uploadFile`.
- `writeLogFile`.

Ordering:

1. Resolve task.
2. Validate GitHub project.
3. Check tools/auth.
4. If `dryRun`, return planned payloads, pending branch/path previews, and no side effects.
5. Apply `--reset-workspace` to only the scoped staging or claim workspace described in the SDD.
6. Resolve/create fork.
7. Prepare staging clone.
8. Write claim unless recovery mode.
9. In recovery mode, resolve existing claim and require claim `globalMetaId` to match the developer actor before startup continues.
10. Create final claim-scoped workspace and branch.
11. Render/write/upload started log.
12. Write started status.
13. Persist workflow state.

On any failure after claim write, return `claim_written_start_failed`.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './claimStartWorkflow';
```

- [ ] **Step 5: Wire runtime**

Modify `src/cli/runtime.ts`:

- Resolve actor home and `resolveMetabotPaths`.
- Create raw cache store and workflow store.
- Refresh raw cache only if needed by command option. If no refresh option exists, read local cache and rely on workflow state/optimistic state.
- Create real command runner with `createNodeLoomCommandRunner()`.
- Use `uploadLocalFileToChain()` with file-chain selection.
- Use local chain write helper for claim/status.

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/claimStartWorkflow.test.mjs tests/cli/loom.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/claimStartWorkflow.ts src/core/loom/index.ts src/cli/runtime.ts tests/loom/claimStartWorkflow.test.mjs
git commit -m "feat: add loom claim and start workflow"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 8: Development Round Workflow

**Files:**
- Create: `src/core/loom/devRoundWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/loom/devRoundWorkflow.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/loom/devRoundWorkflow.test.mjs` covering:

- claim author mismatch returns `permission_denied`.
- missing workflow state returns `claim_not_found` or `invalid_loom_state`.
- LLM success, checks pass, git diff exists -> commit, upload log, write `completed` status with commit.
- check failure -> commit if diff exists, upload log, write `in_progress`, not `completed`.
- no checks -> write `in_progress` and log verification skipped.
- no git diff -> no commit, status still written with empty commits and log says no changes.
- process log upload failure prevents status write.
- LLM failure writes `failed` status when log upload and chain write can complete.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/devRoundWorkflow.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement core workflow**

Create `src/core/loom/devRoundWorkflow.ts` exporting `runLoomDevRoundWorkflow(input)`.

Inject:

- `executeLlmRound(prompt, cwd)` returning `{ sessionId, status, output, error }`.
- `runner` for git/check commands.
- `workflowStore`.
- `writeChain`.
- `uploadFile`.
- `writeLogFile`.

Prompt construction:

- Add and test a helper such as `buildLoomDevRoundPrompt(input)`.
- Include task title, task requirement, acceptance criteria, repository path, current branch, previous status summary, explicit check commands, and round note.
- Tell the LLM to make one focused implementation round, avoid unrelated refactors, and leave the repository in a committable state.
- Pass the generated prompt to `executeLlmRound(prompt, cwd)`.

Git commands:

- `git status --porcelain`
- `git diff --name-only`
- `git add -A`
- `git commit -m "..."` only when diff exists
- `git rev-parse HEAD`
- `git show --name-only --format=%s HEAD`

Check commands:

- Run with shell only if necessary. Prefer `commandRunner` with a documented `shell` mode if checks are strings. If implementing shell mode, keep it isolated and tested.

Status decision:

- all checks passed and meaningful progress -> `completed`;
- any failed check or no checks -> `in_progress`;
- LLM hard failure -> `failed`.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './devRoundWorkflow';
```

- [ ] **Step 5: Wire runtime LLM execution**

Modify `src/cli/runtime.ts`:

- Resolve developer actor.
- Resolve healthy LLM runtime exactly like `draftTask`.
- Execute with `cwd` equal to workflow repo path.
- Poll session until complete.
- Mark binding used on completion.
- Mark runtime unavailable on runtime failure when appropriate.

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/devRoundWorkflow.test.mjs tests/cli/loom.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/devRoundWorkflow.ts src/core/loom/index.ts src/cli/runtime.ts tests/loom/devRoundWorkflow.test.mjs
git commit -m "feat: add loom dev round workflow"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 9: Delivery Workflow

**Files:**
- Create: `src/core/loom/deliveryWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/loom/deliveryWorkflow.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/loom/deliveryWorkflow.test.mjs` covering:

- non-claim author returns `permission_denied`.
- no passing latest checks returns `check_failed`.
- dry-run returns delivery payload and request without push/PR/write.
- success pushes branch, creates PR, writes delivery.
- PR failure does not write delivery.
- checklist is parsed from Markdown list criteria.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/deliveryWorkflow.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement core workflow**

Create `src/core/loom/deliveryWorkflow.ts` exporting `runLoomDeliverWorkflow(input)`.

Implementation:

- Read workflow state.
- Verify latest status has `checksPassed === true` or equivalent.
- Push branch through `pushLoomBranch()`.
- Create PR through `createLoomPullRequest()`.
- Build checklist from criteria:
  - Markdown `- ` and numbered list lines become checklist items.
  - fallback to one item.
- Write `loom-delivery` after PR succeeds.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './deliveryWorkflow';
```

- [ ] **Step 5: Wire runtime**

Modify `src/cli/runtime.ts` to call delivery workflow with real runner and chain write helper.

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/deliveryWorkflow.test.mjs tests/cli/loom.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/deliveryWorkflow.ts src/core/loom/index.ts src/cli/runtime.ts tests/loom/deliveryWorkflow.test.mjs
git commit -m "feat: add loom delivery workflow"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 10: Acceptance, Payment, And Review Workflows

**Files:**
- Create: `src/core/loom/reviewWorkflow.ts`
- Modify: `src/core/loom/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/loom/reviewWorkflow.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/loom/reviewWorkflow.test.mjs` covering:

- `accept-and-pay` by non-requester returns `permission_denied`.
- without `confirmPayment`, wallet preview is called and no chain write happens.
- with `confirmPayment`, transfer succeeds and passed acceptance is written with `paymentTxId`.
- payment failure does not write acceptance.
- acceptance write failure after payment returns `acceptance_write_failed_after_payment` with payment txid and saved request paths.
- already accepted paid returns `already_accepted_paid`.
- `review-delivery` writes `rejected` or `revision_needed` with `releasePayment: false` and no `paymentTxId`.
- invalid verdict for `review-delivery` is rejected by CLI parser or core.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/loom/reviewWorkflow.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement review workflow**

Create `src/core/loom/reviewWorkflow.ts` exporting:

- `runLoomAcceptAndPayWorkflow(input)`
- `runLoomReviewDeliveryWorkflow(input)`
- `buildLoomPaymentAmountRaw(bounty)`

Payment amount mapping:

- `SPACE` -> `${amount}SPACE`
- `BTC` -> `${amount}BTC`
- `DOGE` -> `${amount}DOGE`
- `OPCAT` -> `${amount}OPCAT`

Preview:

- call injected wallet transfer with `confirm: false`;
- return the awaiting confirmation envelope from wallet with Loom delivery/task context included when possible.

Confirm:

- call wallet transfer with `confirm: true`;
- extract `txid`;
- write acceptance payload.

Failure after payment:

- save `acceptance-payload.json` and `acceptance-chain-request.json` under requester workflow retry state where possible;
- return `acceptance_write_failed_after_payment`.

- [ ] **Step 4: Export module**

Modify `src/core/loom/index.ts`:

```ts
export * from './reviewWorkflow';
```

- [ ] **Step 5: Wire runtime**

Modify `src/cli/runtime.ts`:

- Use existing `wallet.transfer` dependency semantics.
- Use real chain write helper for acceptance.
- Use workflow store for retry file paths.

- [ ] **Step 6: Verify**

```bash
npm run build && node --test tests/loom/reviewWorkflow.test.mjs tests/cli/loom.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and buzz**

```bash
git add src/core/loom/reviewWorkflow.ts src/core/loom/index.ts src/cli/runtime.ts tests/loom/reviewWorkflow.test.mjs
git commit -m "feat: add loom review and payment workflows"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 11: Runtime State Command And Integration Polish

**Files:**
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commands/loom.ts` if parser defects remain
- Modify: `tests/cli/loom.test.mjs`
- Test: `tests/loom/workflowState.test.mjs`

- [ ] **Step 1: Add missing tests for `loom state` runtime behavior**

Add tests that:

- `loom state <taskPinId> --refresh` returns derived state and cache metadata.
- invalid related records appear under `invalid`.
- local workflow state is included when available.

- [ ] **Step 2: Run failing tests**

```bash
npm run build && node --test tests/cli/loom.test.mjs tests/loom/workflowState.test.mjs
```

Expected: FAIL if runtime state dependency is not complete.

- [ ] **Step 3: Wire runtime `loom.state`**

Modify `src/cli/runtime.ts`:

- read raw cache;
- refresh on `--refresh`;
- call `buildLoomWorkflowTaskState`;
- include cache metadata;
- include workflow states found under profile `.runtime/loom/workflows/<taskPinId>/`.

- [ ] **Step 4: Polish command errors**

Ensure all new commands return expected codes:

- `missing_flag`;
- `invalid_flag`;
- `dependency_unavailable`;
- `task_not_found`;
- `claim_not_found`;
- `delivery_not_found`;
- `permission_denied`.

- [ ] **Step 5: Verify**

```bash
npm run build && node --test tests/loom/*.test.mjs tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and buzz**

```bash
git add src/cli/runtime.ts src/cli/commands/loom.ts tests/cli/loom.test.mjs tests/loom/workflowState.test.mjs
git commit -m "feat: wire loom workflow state runtime"
```

Post a development diary with `metabot-post-buzz`.

---

### Task 12: Smoke Runbook And Final Verification

**Files:**
- Create: `docs/acceptance/metabot-loom-workflow-cli-smoke.md`
- Modify: `tests/cli/help.test.mjs` only if help examples need final updates

- [ ] **Step 1: Write smoke runbook**

Create `docs/acceptance/metabot-loom-workflow-cli-smoke.md` with:

- prerequisites:
  - two local Bot profiles;
  - test balances;
  - `git`;
  - `gh`;
  - `gh auth status`;
  - small GitHub test repository;
- exact commands:
  - `metabot loom post-task ...`;
  - `metabot loom claim-and-start ...`;
  - `metabot loom run-dev-round ...`;
  - `metabot loom deliver ...`;
  - `metabot loom accept-and-pay ...`;
  - `metabot loom review-delivery ...`;
  - `metabot loom state ...`;
- negative smoke checks:
  - run without `--confirm-payment` and confirm no payment;
  - invalid `--file-chain doge`;
  - missing `gh`/logged-out guidance where practical.

- [ ] **Step 2: Verify help examples still match**

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run final targeted suite**

Run:

```bash
npm run build
node --test tests/loom/*.test.mjs
node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit and buzz**

```bash
git add docs/acceptance/metabot-loom-workflow-cli-smoke.md tests/cli/help.test.mjs
git commit -m "docs: add loom workflow smoke runbook"
```

Post a development diary with `metabot-post-buzz`.

---

## Final Acceptance Subagent

After all implementation tasks pass controller review:

1. Spawn a fresh `gpt-5.5` final test subagent.
2. Instruct it to run the targeted suite:

```bash
npm run build
node --test tests/loom/*.test.mjs
node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

3. Instruct it to run as much of the smoke runbook as is safe locally.
4. If real chain writes are needed for the smoke, it may use the local `metabot` CLI and the `eric` profile.
5. It must return either:
   - explicit acceptance with commands run and evidence; or
   - explicit modification requests with failing command output and file/line references.

## Completion Criteria

The implementation is complete only when:

- every task above is committed;
- every commit has an on-chain development diary buzz;
- all targeted verification commands pass;
- the final `gpt-5.5` acceptance subagent explicitly approves or all requested fixes are completed and re-reviewed;
- `git status --short` is clean.
