# MetaFS Large File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OAC's native `metabot file upload-large` path upload MVC files up to 50 MiB through MetaFS, while preserving binary direct `/file` writes for files at or below 2 MiB.

**Architecture:** Keep `uploadLargeFileToChain()` as the shared orchestration boundary. Add a production MetaFS `ProductionLargeFileUploader`, share wallet spend serialization with ordinary chain writes, inject the uploader into the default daemon, and make CLI, MetaApp publish, Bot Homepage upload, and skills reuse the same boundary.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, OAC CLI and daemon route patterns, `meta-contract`, `@metalet/utxo-wallet-service`, MetaFS uploader HTTP API, existing skillpack build tooling.

**Spec:** `docs/superpowers/specs/2026-06-28-metafs-large-file-upload-design.md`

---

## Current State

- `src/core/files/uploadLargeFile.ts` already defines `DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024`, `LARGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024`, `ProductionLargeFileUploader`, and direct/chunked orchestration.
- `src/daemon/routes/file.ts` already exposes `POST /api/file/upload-large`.
- `src/daemon/defaultHandlers.ts` already wires `file.uploadLarge` and Bot Homepage upload through `uploadLargeFileToChain()`, but `providerLargeFileUploader` is undefined by default.
- `src/cli/commands/file.ts` already supports `upload-large`, but it requires `--request-file`.
- `src/core/metaapp/publish.ts` accepts an abstract upload dependency, and default daemon MetaApp publish/update currently passes `uploadLocalFileToChain()`.
- `src/daemon/routes/bot.ts` currently reads Homepage upload bodies into one buffer and caps them at `DIRECT_UPLOAD_MAX_BYTES`.
- `src/ui/pages/bot/app.ts` and `src/ui/i18n.ts` currently tell users the Homepage Metafile cap is 2 MiB.
- `SKILLs/metabot-upload-largefile/SKILL.md` still documents request-file as the primary path.
- `SKILLs/metabot-metaapp-publish/SKILL.md` still documents `metabot file upload` for MetaApp ZIP upload.

Live MetaFS config checked on 2026-06-28:

```json
{
  "maxFileSize": 52428800,
  "chains": {
    "doge": { "maxFileSize": 52428800, "chunkSize": 1200, "feeRate": 200000 },
    "mvc": { "maxFileSize": 52428800, "chunkSize": 1048576, "feeRate": 5 }
  }
}
```

The first OAC implementation uses MVC chunked upload only. DOGE remains unsupported for OAC file upload. BTC and OPCAT files above 2 MiB remain rejected until MetaFS and OAC funding support them.

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/core/wallet/spendQueue.ts` | Shared per-wallet write serialization used by ordinary signer writes and MetaFS funding writes. |
| `tests/wallet/spendQueue.test.mjs` | Unit tests for queue ordering, release after failure, and stable queue keys. |
| `src/core/chain/mvcPendingUtxos.ts` | Shared MVC pending UTXO tracking extracted from `mvc.ts`, with explicit remembered spent and available outputs. |
| `tests/chain/mvcPendingUtxos.test.mjs` | Unit tests that preserve existing pending-spend filtering and local change availability behavior. |
| `src/core/chain/mvcLargeUploadFunding.ts` | MVC funding helper for MetaFS chunk/index pre-transactions and merge transaction construction. |
| `tests/chain/mvcLargeUploadFunding.test.mjs` | Unit tests for output sizing, UTXO selection, excluded outpoints, and pre-transaction hex construction. |
| `src/core/files/metaFsLargeUploader.ts` | Production MetaFS uploader implementing `ProductionLargeFileUploader`. |
| `tests/files/metaFsLargeUploader.test.mjs` | Unit tests for config limits, multipart upload, chunked submit, retry, and normalized result shape. |

### Modified Files

| File | Change |
|---|---|
| `src/core/signing/localMnemonicSigner.ts` | Replace private spend queue with shared `src/core/wallet/spendQueue.ts`. |
| `src/core/chain/adapters/mvc.ts` | Replace private pending UTXO state with shared `src/core/chain/mvcPendingUtxos.ts`. |
| `src/core/files/uploadLargeFile.ts` | Keep orchestration stable; add specific error codes for too-large, unsupported-chain, funding, and MetaFS failures if uploader exposes them. |
| `src/daemon/defaultHandlers.ts` | Default `providerLargeFileUploader` to `createMetaFsLargeUploader()` and use `uploadLargeFileToChain()` for MetaApp publish/update archive uploads. |
| `src/cli/commands/file.ts` | Add `--file`, positional path, and `--content-type` support for `upload-large`; keep `--request-file`. |
| `src/cli/commandHelp.ts` | Update `file upload-large` usage, examples, and machine-readable help. |
| `tests/cli/file.test.mjs` | Add path-first CLI tests and flag-conflict tests. |
| `tests/cli/help.test.mjs` | Update `upload-large` help assertions. |
| `tests/daemon/defaultBotHandlers.test.mjs` | Update large upload default behavior expectations. |
| `tests/daemon/httpServer.test.mjs` | Update Homepage route tests from 2 MiB to 50 MiB streaming behavior. |
| `src/daemon/httpServer.ts` | Add a route context helper that streams raw request bytes to a file with a hard cap. |
| `src/daemon/routes/types.ts` | Add the streaming helper to `RouteContext`. |
| `src/daemon/routes/bot.ts` | Stream Homepage upload request bytes to a temp file with a 50 MiB cap. |
| `src/ui/pages/bot/app.ts` | Change Homepage Metafile client cap to 50 MiB and preserve raw browser file upload. |
| `src/ui/i18n.ts` | Update English and Simplified Chinese Homepage Metafile copy. |
| `tests/ui/botPageScript.test.mjs` | Update client-side Homepage upload cap tests. |
| `tests/ui/i18n.test.mjs` | Update i18n assertions for 50 MiB copy. |
| `tests/metaapp/publish.test.mjs` | Add or update assertions that default daemon dependencies call the large upload boundary for runtime ZIPs. |
| `SKILLs/metabot-upload-largefile/SKILL.md` | Make direct path CLI usage primary and request-file compatibility secondary. |
| `SKILLs/metabot-metaapp-publish/SKILL.md` | Change ZIP upload guidance from `file upload` to `file upload-large`. |
| `tests/skillpacks/buildSkillpacks.test.mjs` | Update skill content assertions. |
| `skillpacks/**` | Regenerate after source skill edits. |

---

## Task 1: CLI Path-First Upload UX

**Files:**
- Modify: `src/cli/commands/file.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `tests/cli/file.test.mjs`
- Modify: `tests/cli/help.test.mjs`

- [ ] **Step 1: Add failing CLI parser tests**

Append focused tests to `tests/cli/file.test.mjs`:

```js
test('runCli dispatches upload-large --file to uploadLarge', async () => {
  const calls = [];
  const exitCode = await runCli([
    'file',
    'upload-large',
    '--from',
    'alice',
    '--file',
    '/tmp/archive.zip',
    '--content-type',
    'application/zip',
    '--chain',
    'mvc',
    '--verify',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'large-file-path-1' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/archive.zip',
    contentType: 'application/zip',
    network: 'mvc',
    from: 'alice',
    verify: true,
  }]);
});

test('runCli dispatches upload-large positional path to uploadLarge', async () => {
  const calls = [];
  const exitCode = await runCli(['file', 'upload-large', '/tmp/archive.zip'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'large-file-positional-1' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ filePath: '/tmp/archive.zip' }]);
});

test('runCli rejects conflicting upload-large path inputs', async () => {
  const stdout = [];
  const exitCode = await runCli([
    'file',
    'upload-large',
    '/tmp/archive.zip',
    '--request-file',
    '/tmp/request.json',
  ], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async () => commandSuccess({ pinId: 'should-not-happen' }),
      },
    },
  });

  assert.equal(exitCode, 1);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Choose exactly one/i);
});
```

- [ ] **Step 2: Run the new failing tests**

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs
```

Expected: the new `--file` and positional tests fail because `runFileCommand()` still requires `--request-file`.

- [ ] **Step 3: Implement path parsing**

In `src/cli/commands/file.ts`, keep `file upload` request-file only. For `file upload-large`:

- read `--request-file`, `--file`, optional positional path, `--content-type`, `--from`, `--chain`, and `--verify`;
- reject more than one source path;
- reject more than one positional path;
- resolve request-file relative `filePath` exactly as today;
- pass direct `--file` and positional paths as provided, without resolving against the current directory unless the existing CLI helper pattern already does that for non-request-file inputs.

Use this structure:

```ts
function readPositionalFilePaths(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (!value || value.startsWith('-')) {
      if (value === '--request-file' || value === '--file' || value === '--content-type' || value === '--from' || value === '--chain') {
        index += 1;
      }
      continue;
    }
    values.push(value);
  }
  return values;
}
```

Return `commandFailed('invalid_flag', 'Choose exactly one upload file source: --file, positional path, or --request-file.')` for source conflicts.

- [ ] **Step 4: Update help**

Change `src/cli/commandHelp.ts` `file upload-large` usage to:

```text
metabot file upload-large --file <path> [--from <bot-slug>] [--content-type <mime>] [--chain <mvc|btc|opcat>] [--verify]
metabot file upload-large <path> [--from <bot-slug>] [--content-type <mime>] [--chain <mvc|btc|opcat>] [--verify]
metabot file upload-large --request-file <path> [--from <bot-slug>] [--chain <mvc|btc|opcat>] [--verify]
```

Update examples to include:

```text
metabot file upload-large --from alice --file ./dist/metaapp.zip --content-type application/zip --verify
metabot file upload-large ./dist/metaapp.zip --from alice --verify
metabot file upload-large --from alice --request-file large-file-request.json --verify
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs tests/cli/help.test.mjs
git diff --check
```

Expected: all selected tests pass and `git diff --check` prints no output.

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/cli/commands/file.ts src/cli/commandHelp.ts tests/cli/file.test.mjs tests/cli/help.test.mjs
git commit -m "feat: add path-first large file upload CLI"
```

## Task 2: Shared Wallet Spend Queue

**Files:**
- Create: `src/core/wallet/spendQueue.ts`
- Create: `tests/wallet/spendQueue.test.mjs`
- Modify: `src/core/signing/localMnemonicSigner.ts`

- [ ] **Step 1: Write failing queue tests**

Create `tests/wallet/spendQueue.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  resolveWalletSpendQueueKey,
  withWalletSpendQueue,
  __clearWalletSpendQueuesForTests,
} = require('../../dist/core/wallet/spendQueue.js');

test('withWalletSpendQueue serializes work for the same key', async () => {
  __clearWalletSpendQueuesForTests();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = withWalletSpendQueue('mvc:addr', async () => {
    events.push('first-start');
    await firstGate;
    events.push('first-end');
  });
  const second = withWalletSpendQueue('mvc:addr', async () => {
    events.push('second-start');
  });

  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
});

test('withWalletSpendQueue releases after failures', async () => {
  __clearWalletSpendQueuesForTests();
  await assert.rejects(
    () => withWalletSpendQueue('mvc:addr', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  const value = await withWalletSpendQueue('mvc:addr', async () => 'ok');
  assert.equal(value, 'ok');
});

test('resolveWalletSpendQueueKey prefers derived address and falls back safely', async () => {
  const adapter = {
    network: 'mvc',
    deriveAddress: async () => 'derived-address',
  };
  assert.equal(
    await resolveWalletSpendQueueKey({ adapter, mnemonic: 'mnemonic', path: "m/44'/10001'/0'/0/0" }),
    'mvc:derived-address',
  );

  const failingAdapter = {
    network: 'mvc',
    deriveAddress: async () => { throw new Error('derive failed'); },
  };
  assert.equal(
    await resolveWalletSpendQueueKey({
      adapter: failingAdapter,
      mnemonic: 'mnemonic',
      path: "m/44'/10001'/0'/0/1",
      fallbackAddress: 'fallback-address',
    }),
    'mvc:fallback-address',
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run build && node --test tests/wallet/spendQueue.test.mjs
```

Expected: build fails because `src/core/wallet/spendQueue.ts` does not exist.

- [ ] **Step 3: Extract queue implementation**

Create `src/core/wallet/spendQueue.ts` with exported `withWalletSpendQueue()`, `resolveWalletSpendQueueKey()`, and `__clearWalletSpendQueuesForTests()`. Move the existing private implementation from `src/core/signing/localMnemonicSigner.ts` without changing behavior.

The public signature should be:

```ts
import type { ChainAdapter } from '../chain/adapters/types';

export async function withWalletSpendQueue<T>(key: string, run: () => Promise<T>): Promise<T>;

export async function resolveWalletSpendQueueKey(input: {
  adapter: Pick<ChainAdapter, 'network' | 'deriveAddress'>;
  mnemonic: string;
  path: string;
  fallbackAddress?: string | null;
}): Promise<string>;

export function __clearWalletSpendQueuesForTests(): void;
```

Update `src/core/signing/localMnemonicSigner.ts` to import the two runtime functions and remove the local `walletSpendQueues` map.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build && node --test tests/wallet/spendQueue.test.mjs tests/chain/adapters.test.mjs tests/wallet/nativeWallet.test.mjs
git diff --check
```

If either listed existing test file is absent, replace it with the closest existing wallet or chain test file shown by `rg --files tests | rg "(wallet|chain)"`.

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/core/wallet/spendQueue.ts src/core/signing/localMnemonicSigner.ts tests/wallet/spendQueue.test.mjs
git commit -m "refactor: share wallet spend queue"
```

## Task 3: Shared MVC Pending UTXO Tracking

**Files:**
- Create: `src/core/chain/mvcPendingUtxos.ts`
- Create: `tests/chain/mvcPendingUtxos.test.mjs`
- Modify: `src/core/chain/adapters/mvc.ts`

- [ ] **Step 1: Write failing pending UTXO tests**

Create `tests/chain/mvcPendingUtxos.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  __clearPendingMvcUtxosForTests,
  rememberPendingMvcTransaction,
  resolveSpendableMvcUtxos,
} = require('../../dist/core/chain/mvcPendingUtxos.js');

test('resolveSpendableMvcUtxos filters locally spent outpoints', () => {
  __clearPendingMvcUtxosForTests();
  const address = 'mvc-address';
  const spent = { txId: 'a'.repeat(64), outputIndex: 0, satoshis: 1000, address, height: 1 };
  const keep = { txId: 'b'.repeat(64), outputIndex: 1, satoshis: 2000, address, height: 1 };

  rememberPendingMvcTransaction({
    address,
    spentUtxos: [spent],
    createdUtxos: [],
    now: 1000,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address,
    utxos: [spent, keep],
    now: 1001,
  }), [keep]);
});

test('resolveSpendableMvcUtxos includes pending change for the same address', () => {
  __clearPendingMvcUtxosForTests();
  const address = 'mvc-address';
  const change = { txId: 'c'.repeat(64), outputIndex: 2, satoshis: 1200, address, height: 0 };

  rememberPendingMvcTransaction({
    address,
    spentUtxos: [],
    createdUtxos: [change],
    now: 1000,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address,
    utxos: [],
    now: 1001,
  }), [change]);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run build && node --test tests/chain/mvcPendingUtxos.test.mjs
```

Expected: build fails because `mvcPendingUtxos.ts` does not exist.

- [ ] **Step 3: Extract current adapter state**

Move these concepts from `src/core/chain/adapters/mvc.ts` into `src/core/chain/mvcPendingUtxos.ts`:

- pending spent outpoint TTL;
- pending spent map;
- pending available map;
- outpoint key builder;
- prune behavior;
- `rememberPendingTransaction()` behavior;
- `resolveSpendableUtxos()` behavior.

Export names:

```ts
export function getMvcUtxoOutpointKey(input: {
  txId: string;
  outputIndex: number;
  address?: string;
}): string;

export function rememberPendingMvcTransaction(input: {
  address: string;
  spentUtxos: ChainUtxo[];
  createdUtxos: ChainUtxo[];
  now?: number;
}): void;

export function resolveSpendableMvcUtxos(input: {
  address: string;
  utxos: ChainUtxo[];
  now?: number;
}): ChainUtxo[];

export function __clearPendingMvcUtxosForTests(): void;
```

Keep `src/core/chain/adapters/mvc.ts` test export `__clearPendingMvcSpentOutpointsForTests()` as a wrapper that calls `__clearPendingMvcUtxosForTests()` so existing tests keep working.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build && node --test tests/chain/mvcPendingUtxos.test.mjs tests/files/uploadLargeFile.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/core/chain/mvcPendingUtxos.ts src/core/chain/adapters/mvc.ts tests/chain/mvcPendingUtxos.test.mjs
git commit -m "refactor: share mvc pending utxo tracking"
```

## Task 4: MVC Large Upload Funding Helper

**Files:**
- Create: `src/core/chain/mvcLargeUploadFunding.ts`
- Create: `tests/chain/mvcLargeUploadFunding.test.mjs`

- [ ] **Step 1: Write funding helper tests**

Create `tests/chain/mvcLargeUploadFunding.test.mjs` with a deterministic test identity and synthetic UTXOs:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildMvcLargeUploadFunding,
} = require('../../dist/core/chain/mvcLargeUploadFunding.js');

const identity = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  path: "m/44'/10001'/0'/0/0",
  globalMetaId: 'id-test',
  metaId: 'metaid-test',
  mvcAddress: '1JA1nK7QJTnVWqXwVwR9VAoVhhgYwniRif',
  addresses: { mvc: '1JA1nK7QJTnVWqXwVwR9VAoVhhgYwniRif' },
};

test('buildMvcLargeUploadFunding builds merge and pre transactions', async () => {
  const result = await buildMvcLargeUploadFunding({
    identity,
    address: identity.mvcAddress,
    feeRate: 5,
    chunkPreTxFee: 1000,
    indexPreTxFee: 2000,
    utxos: [
      { txId: 'a'.repeat(64), outputIndex: 0, satoshis: 20000, address: identity.mvcAddress, height: 1 },
    ],
  });

  assert.match(result.mergeTxHex, /^[0-9a-f]+$/i);
  assert.match(result.chunkPreTxHex, /^[0-9a-f]+$/i);
  assert.match(result.indexPreTxHex, /^[0-9a-f]+$/i);
  assert.equal(result.chunkPreTxOutputAmount, 2750);
  assert.equal(result.indexPreTxOutputAmount, 3750);
  assert.deepEqual(result.spentOutpoints, [`${'a'.repeat(64)}:0`]);
});

test('buildMvcLargeUploadFunding skips excluded outpoints', async () => {
  const result = await buildMvcLargeUploadFunding({
    identity,
    address: identity.mvcAddress,
    feeRate: 1,
    chunkPreTxFee: 1000,
    indexPreTxFee: 1000,
    excludedOutpoints: new Set([`${'a'.repeat(64)}:0`]),
    utxos: [
      { txId: 'a'.repeat(64), outputIndex: 0, satoshis: 20000, address: identity.mvcAddress, height: 1 },
      { txId: 'b'.repeat(64), outputIndex: 1, satoshis: 20000, address: identity.mvcAddress, height: 1 },
    ],
  });

  assert.deepEqual(result.spentOutpoints, [`${'b'.repeat(64)}:1`]);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run build && node --test tests/chain/mvcLargeUploadFunding.test.mjs
```

Expected: build fails because `mvcLargeUploadFunding.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/core/chain/mvcLargeUploadFunding.ts` with this exported interface:

```ts
export interface MvcLargeUploadFundingResult {
  mergeTxHex: string;
  mergeTxId: string;
  chunkPreTxHex: string;
  indexPreTxHex: string;
  chunkPreTxOutputAmount: number;
  indexPreTxOutputAmount: number;
  spentUtxos: ChainUtxo[];
  spentOutpoints: string[];
  changeUtxo: ChainUtxo | null;
}

export async function buildMvcLargeUploadFunding(input: {
  identity: DerivedIdentity;
  address?: string;
  feeRate: number;
  chunkPreTxFee: number;
  indexPreTxFee: number;
  utxos: ChainUtxo[];
  excludedOutpoints?: ReadonlySet<string>;
}): Promise<MvcLargeUploadFundingResult>;
```

Implementation rules:

- derive MVC private key from `identity.mnemonic` and `identity.path` using the same derivation logic as `src/core/chain/adapters/mvc.ts`;
- build a merge tx with output 0 for chunk pre-tx funding and output 1 for index pre-tx funding;
- compute `chunkPreTxOutputAmount = chunkPreTxFee + Math.ceil((200 + 150) * feeRate)`;
- compute `indexPreTxOutputAmount = indexPreTxFee + Math.ceil((200 + 150) * feeRate)`;
- build pre-tx hex values using `mvc.crypto.Signature.SIGHASH_NONE | mvc.crypto.Signature.SIGHASH_FORKID`;
- return only the change output as `changeUtxo`; outputs 0 and 1 are immediately consumed by the chunk/index pre-transactions.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build && node --test tests/chain/mvcLargeUploadFunding.test.mjs tests/chain/mvcPendingUtxos.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/core/chain/mvcLargeUploadFunding.ts tests/chain/mvcLargeUploadFunding.test.mjs
git commit -m "feat: add mvc large upload funding helper"
```

## Task 5: Production MetaFS Large Uploader

**Files:**
- Create: `src/core/files/metaFsLargeUploader.ts`
- Create: `tests/files/metaFsLargeUploader.test.mjs`
- Modify: `src/core/files/uploadLargeFile.ts`

- [ ] **Step 1: Write MetaFS uploader tests**

Create `tests/files/metaFsLargeUploader.test.mjs` with injected `fetchFn`, `buildFunding`, and `sleep` dependencies. The tests must not hit the network.

Use this expected request order:

```text
GET /api/v1/config
POST /api/v1/files/multipart/initiate
POST /api/v1/files/multipart/upload-part
POST /api/v1/files/multipart/complete
POST /api/v1/files/estimate-chunked-upload
POST /api/v1/files/chunked-upload
```

Add assertions:

- config limit uses the smaller of OAC 50 MiB and server `maxFileSize`;
- part size follows `chains.mvc.chunkSize` when present and defaults to 1 MiB;
- request body for public OAC inputs contains only `filePath`; file bytes never appear in CLI-like request bodies;
- if MetaFS only supports JSON part upload, base64 appears only in the internal `multipart/upload-part` request body;
- `chunked-upload` receives `metaId`, `address`, `fileName`, `path`, `operation: "create"`, `contentType`, `chunkPreTxHex`, `indexPreTxHex`, `mergeTxHex`, `feeRate`, `isBroadcast: true`, and `storageKey`;
- successful response with `indexTxId` returns `pinId: "<indexTxId>i0"` and `uploadMode: "chunked"`;
- retryable stale-input errors exclude previously selected outpoints and retry up to 3 attempts;
- non-retryable MetaFS failures throw an error with `code = "large_file_upload_metafs_failed"`.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm run build && node --test tests/files/metaFsLargeUploader.test.mjs
```

Expected: build fails because `metaFsLargeUploader.ts` does not exist.

- [ ] **Step 3: Implement MetaFS uploader**

Create `src/core/files/metaFsLargeUploader.ts`:

```ts
export const DEFAULT_METAFS_UPLOADER_BASE_URL = 'https://file.metaid.io/metafile-uploader';

export interface MetaFsLargeUploaderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  buildFunding?: typeof buildMvcLargeUploadFunding;
  sleep?: (ms: number) => Promise<void>;
  maxBytes?: number;
}

export function createMetaFsLargeUploader(
  options?: MetaFsLargeUploaderOptions,
): ProductionLargeFileUploader;
```

Implementation rules:

- normalize `options.baseUrl || process.env.METABOT_METAFS_UPLOADER_BASE_URL || DEFAULT_METAFS_UPLOADER_BASE_URL`;
- call `signer.getIdentity()` and require MVC identity address from `identity.addresses?.mvc || identity.mvcAddress`;
- use `identity.metaId` when available, otherwise use `identity.globalMetaId` only if the existing IDBots-compatible API accepts it in smoke testing;
- stream file parts from disk with `fs.open()` and `read()`; do not read the entire 50 MiB file into one buffer;
- use current MetaFS JSON multipart endpoints when no binary part endpoint is advertised by config;
- keep base64 conversion inside `upload-part` only;
- build upload path with `/file/<filename>` or the IDBots-compatible path builder after confirming the deployed endpoint contract;
- use `buildMvcLargeUploadFunding()` with fetched MVC UTXOs and estimate fees;
- wrap the whole funding plus `chunked-upload` section in `withWalletSpendQueue()` using `resolveWalletSpendQueueKey()`;
- on successful chunked upload, call `rememberPendingMvcTransaction()` with original spent UTXOs and the returned `changeUtxo`;
- return normalized `pinId`, `txids`, `totalCost`, `network`, `fileName`, `contentType`, `bytes`, `extension`, `metafileUri`, `globalMetaId`, and `uploadMode: "chunked"`;
- set stable `error.code` values:
  - `large_file_upload_too_large`;
  - `large_file_upload_funding_failed`;
  - `large_file_upload_metafs_failed`;
  - `large_file_upload_chain_unsupported`.

- [ ] **Step 4: Keep upload orchestrator validation**

In `src/core/files/uploadLargeFile.ts`, keep provider result sanitization. Add specific error propagation only when the thrown error already has one of the large-upload codes. Do not let provider-owned `previewUrl`, `downloadUrl`, `network`, `bytes`, `fileName`, `contentType`, or `extension` override orchestrator-owned values.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/metaFsLargeUploader.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/core/files/metaFsLargeUploader.ts src/core/files/uploadLargeFile.ts tests/files/metaFsLargeUploader.test.mjs
git commit -m "feat: add production MetaFS large uploader"
```

## Task 6: Daemon Default Injection And Error Mapping

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/defaultBotHandlers.test.mjs`
- Modify: `tests/files/uploadLargeFile.test.mjs` if error-code expectations need tightening

- [ ] **Step 1: Add failing default injection tests**

Update default handler tests so `file.uploadLarge` and `bot.uploadHomepageFile` no longer require manually injected `providerLargeFileUploader` for files above 2 MiB. Use a dependency hook rather than hitting real MetaFS:

```ts
createDefaultMetabotDaemonHandlers({
  homeDir,
  systemHomeDir,
  getDaemonRecord: () => null,
  signer,
  providerLargeFileUploader: fakeUploader,
});
```

Then add one test that passes no `providerLargeFileUploader` but stubs `createMetaFsLargeUploader()` through a new factory injection option:

```ts
createDefaultMetabotDaemonHandlers({
  homeDir,
  systemHomeDir,
  getDaemonRecord: () => null,
  signer,
  createProviderLargeFileUploader: () => fakeUploader,
});
```

- [ ] **Step 2: Add factory injection**

In `createDefaultMetabotDaemonHandlers()` input type, add:

```ts
createProviderLargeFileUploader?: () => ProductionLargeFileUploader;
```

Then resolve:

```ts
const providerLargeFileUploader =
  input.providerLargeFileUploader
  ?? input.createProviderLargeFileUploader?.()
  ?? createMetaFsLargeUploader();
```

This keeps tests deterministic and makes the default daemon production-ready.

- [ ] **Step 3: Map large upload errors**

For `file.uploadLarge` and `bot.uploadHomepageFile`, map known `error.code` values directly:

```ts
if (code === 'large_file_upload_unavailable'
  || code === 'large_file_upload_too_large'
  || code === 'large_file_upload_chain_unsupported'
  || code === 'large_file_upload_funding_failed'
  || code === 'large_file_upload_metafs_failed') {
  return commandFailed(code, message);
}
```

Keep direct upload failures under existing `file_upload_failed` or `homepage_upload_failed`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs tests/files/uploadLargeFile.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBotHandlers.test.mjs tests/files/uploadLargeFile.test.mjs
git commit -m "feat: enable default MetaFS large uploader"
```

## Task 7: MetaApp Publish Uses Large Upload Boundary

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/metaapp/publish.test.mjs`
- Add daemon-level test if existing MetaApp daemon tests cover dependency wiring

- [ ] **Step 1: Add failing dependency assertion**

In the daemon handler coverage for MetaApp publish/update, assert the upload dependency calls the large upload boundary by injecting `providerLargeFileUploader` and using a generated archive larger than 2 MiB. If `tests/metaapp/publish.test.mjs` only covers core functions, add a focused test to the daemon handler test file that exercises `handlers.metaapp.publish()`.

Expected behavior:

- archive upload result includes `uploadMode: "chunked"`;
- `uploadLocalFileToChain()` is not called for the runtime ZIP above 2 MiB;
- final MetaApp payload still stores a `metafile://...` URI in `content`.

- [ ] **Step 2: Change daemon dependency**

In `src/daemon/defaultHandlers.ts`, replace the `uploadLocalFileToChain()` dependency passed to `publishMetaApp()` and `updateMetaApp()` with:

```ts
const uploaded = await uploadLargeFileToChain({
  filePath: uploadInput.filePath,
  contentType: uploadInput.contentType,
  network,
  signer: actor.signer,
  largeUploader: providerLargeFileUploader,
});
return uploaded as unknown as UploadLikeResult;
```

Do this for both publish and update. Keep `src/core/metaapp/publish.ts` dependency name as `uploadFile` in this task to avoid a broad rename.

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm run build && node --test tests/metaapp/publish.test.mjs tests/daemon/defaultBotHandlers.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/daemon/defaultHandlers.ts tests/metaapp/publish.test.mjs tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: upload MetaApp archives through large file boundary"
```

## Task 8: Homepage 50 MiB Streaming Upload

**Files:**
- Modify: `src/daemon/httpServer.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/bot.ts`
- Modify: `src/ui/pages/bot/app.ts`
- Modify: `src/ui/i18n.ts`
- Modify: `tests/daemon/httpServer.test.mjs`
- Modify: `tests/ui/botPageScript.test.mjs`
- Modify: `tests/ui/i18n.test.mjs`

- [ ] **Step 1: Add route streaming tests**

Update `tests/daemon/httpServer.test.mjs`:

- rename the 2 MiB rejection test to 50 MiB;
- assert `(50 * 1024 * 1024) + 1` returns `413` and does not call the handler;
- keep a small upload forwarding test that verifies the handler receives a temp `filePath` and raw bytes;
- add an assertion that a file of `(2 * 1024 * 1024) + 1` reaches the handler.

- [ ] **Step 2: Add UI cap tests**

Update `tests/ui/botPageScript.test.mjs`:

```js
test('bot page homepage upload accepts files above 2 MiB and below 50 MiB', async () => {
  let fetchCalls = 0;
  const context = createBotScriptContext({
    elements: {
      '[data-homepage-status]': field(),
      '[data-act="upload-homepage"]': field(),
    },
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            pinId: 'homepage-large-pin',
            metafileUri: 'metafile://homepage-large-pin.html',
            contentType: 'text/html',
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];

  await context.handleHomepageUploadFile({
    name: 'homepage.html',
    type: 'text/html',
    size: (2 * 1024 * 1024) + 1,
  });

  assert.equal(fetchCalls, 1);
});
```

Change the existing too-large test to use `(50 * 1024 * 1024) + 1` and assert `/50 MiB/`.

- [ ] **Step 3: Add streaming helper**

In `src/daemon/routes/types.ts`, add:

```ts
streamRawBodyToFile: (filePath: string, maxBytes: number) => Promise<{ bytes: number }>;
```

In `src/daemon/httpServer.ts`, implement it with `createWriteStream()` and `for await (const chunk of req)`, deleting the partial file when the cap is exceeded.

- [ ] **Step 4: Update Bot route**

In `src/daemon/routes/bot.ts`:

- import `LARGE_UPLOAD_MAX_BYTES` instead of `DIRECT_UPLOAD_MAX_BYTES`;
- create temp dir before reading the body;
- stream body to `filePath`;
- reject empty body with `homepage_upload_empty`;
- return `homepage_upload_too_large` with 50 MiB copy for cap failures;
- delete the temp dir in `finally`.

- [ ] **Step 5: Update UI and i18n**

In `src/ui/pages/bot/app.ts`:

```js
var HOMEPAGE_UPLOAD_MAX_BYTES=50*1024*1024;
```

Update fallback copy:

```js
uiText('bot.homepageUploadTooLarge','Homepage file must be 50 MiB or smaller.')
```

In `src/ui/i18n.ts`, change:

- English note to `Upload a local file up to 50 MiB and save it as metafile://<pinId>.`
- Simplified Chinese note should keep the existing wording and replace the size value with 50 MiB.
- English too-large copy to `Homepage file must be 50 MiB or smaller.`
- Simplified Chinese too-large copy should keep the existing wording and replace the size value with 50 MiB.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
git diff --check
```

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add src/daemon/httpServer.ts src/daemon/routes/types.ts src/daemon/routes/bot.ts src/ui/pages/bot/app.ts src/ui/i18n.ts tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
git commit -m "feat: support 50 MiB homepage metafile uploads"
```

## Task 9: Skill And Skillpack Updates

**Files:**
- Modify: `SKILLs/metabot-upload-largefile/SKILL.md`
- Modify: `SKILLs/metabot-metaapp-publish/SKILL.md`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: `skillpacks/**`

- [ ] **Step 1: Update source skill tests**

Change assertions in `tests/skillpacks/buildSkillpacks.test.mjs`:

- large-file skill must mention `file upload-large --file`;
- large-file skill must still mention `--request-file` in a compatibility section;
- MetaApp publish skill must mention `file upload-large` for ZIP upload;
- MetaApp publish skill must not recommend `metabot file upload --from <bot-slug> --request-file <zip-upload.json>` for runtime ZIP upload.

- [ ] **Step 2: Update large-file skill**

In `SKILLs/metabot-upload-largefile/SKILL.md`, make this the primary command:

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/archive.zip --content-type application/zip --verify
```

Keep request-file as compatibility:

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --request-file request.json --verify
```

Keep the privacy rule that agents must never paste, summarize, or base64 encode file contents in chat.

- [ ] **Step 3: Update MetaApp publish skill**

In `SKILLs/metabot-metaapp-publish/SKILL.md`, change the ZIP upload command to:

```bash
{{METABOT_CLI}} file upload-large --from <bot-slug> --file /absolute/path/to/metaapp.zip --content-type application/zip
```

For image assets, keep direct `file upload` acceptable for small image assets, or use `file upload-large` consistently when the asset size is unknown.

- [ ] **Step 4: Regenerate skillpacks**

Run:

```bash
npm run build:skillpacks
npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs
git diff --check
```

Expected: generated shared and host skillpacks include the updated skill text.

- [ ] **Step 5: Commit**

Post a development diary with `metabot-post-buzz`, then commit:

```bash
git add SKILLs/metabot-upload-largefile/SKILL.md SKILLs/metabot-metaapp-publish/SKILL.md tests/skillpacks/buildSkillpacks.test.mjs skillpacks
git commit -m "docs: update large file upload skills"
```

## Task 10: Final Verification And Smoke

**Files:**
- No expected source edits unless verification exposes a defect.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run build
node --test tests/cli/file.test.mjs tests/cli/help.test.mjs
node --test tests/files/uploadLargeFile.test.mjs tests/files/metaFsLargeUploader.test.mjs
node --test tests/chain/mvcPendingUtxos.test.mjs tests/chain/mvcLargeUploadFunding.test.mjs tests/wallet/spendQueue.test.mjs
node --test tests/daemon/httpServer.test.mjs tests/daemon/defaultBotHandlers.test.mjs
node --test tests/metaapp/publish.test.mjs
node --test tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs
npm run build:skillpacks
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 2: Run full test suite because this touches wallet, chain writes, daemon routes, UI, and skillpack artifacts**

Run:

```bash
npm test
```

Expected: full suite exits 0.

- [ ] **Step 3: Run real CLI smoke for direct upload**

Use a funded local Bot such as `bot-60` only if the user confirms that live writes are acceptable for this smoke. Then run:

```bash
tmp_file="$(mktemp -t oac-small-upload).txt"
printf 'OAC small upload smoke\n' > "$tmp_file"
$HOME/.metabot/bin/metabot file upload-large --from bot-60 --file "$tmp_file" --content-type text/plain --verify
rm -f "$tmp_file"
```

Expected: command returns `ok: true`, `uploadMode: "direct"`, and a `metafile://...` URI.

- [ ] **Step 4: Run real CLI smoke for chunked upload**

Use a funded MVC Bot only after explicit user confirmation:

```bash
tmp_file="$(mktemp -t oac-large-upload).bin"
dd if=/dev/zero of="$tmp_file" bs=1048576 count=3
$HOME/.metabot/bin/metabot file upload-large --from bot-60 --file "$tmp_file" --content-type application/octet-stream --chain mvc --verify
rm -f "$tmp_file"
```

Expected: command returns `ok: true`, `uploadMode: "chunked"`, and a `metafile://...` URI. If the command fails, capture the structured `code` and `message` without exposing wallet secrets or signed transaction hex.

- [ ] **Step 5: Closeout**

Run:

```bash
git status --short --branch
```

Expected: clean worktree. If final smoke required source fixes, make one final verified commit and post one final development diary with `metabot-post-buzz`.

## Spec Coverage Checklist

- CLI-first `metabot file upload-large`: Task 1.
- Direct file path without request JSON: Task 1.
- `--request-file` compatibility: Task 1 and Task 9.
- `<= 2 MiB` binary direct `/file`: existing `uploadLargeFileToChain()` tests plus Task 10.
- `> 2 MiB <= 50 MiB` MVC MetaFS chunked upload: Tasks 4, 5, 6, and 10.
- No DOGE file upload: existing CLI/core tests plus Task 5 error mapping.
- BTC/OPCAT above 2 MiB rejected: existing core behavior plus Task 5 error mapping.
- Default daemon no longer reports unavailable for MVC large uploads: Task 6.
- MetaApp ZIPs use the large-file boundary: Task 7.
- Homepage Metafile supports 50 MiB without buffering the full request in route memory: Task 8.
- Skills document the new workflow: Task 9.
