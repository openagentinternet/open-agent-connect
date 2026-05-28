# MetaBot Upload Large File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-grade `metabot-upload-largefile` capability that uploads local files to MetaWeb through a stable OAC CLI/daemon boundary, supports direct upload for small files, supports verified large-file upload where the current MetaWeb wallet/upload APIs allow it, and returns durable `metafile://...` results for later A2A delivery.

**Architecture:** Keep the existing `metabot-upload-file` direct upload path compatible, then add a separate large-file boundary with explicit size limits, upload-mode selection, verification, and a new `file upload-large` CLI/daemon command. The new skill document should call the OAC CLI rather than a host-local ad hoc script so all hosts share one runtime implementation and one JSON result contract.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, existing OAC CLI/daemon routes, existing `Signer.writePin` direct upload path, MetaWeb file-indexer URLs, optional MetaFS uploader HTTP API after API validation, skillpack build tooling.

**Spec:** `docs/superpowers/specs/2026-05-26-a2a-delivery-chain-design.md`

---

## Ownership Model

This plan is intended for subagent-driven implementation.

- Implementation owner: one fresh subagent per task or per small task group.
- Acceptance owner: the coordinating agent in this thread.
- The coordinating agent should not write feature code while executing this plan. It should review diffs, run verification commands, and either accept the subagent's commit or send targeted feedback.
- Each implementation subagent must read `AGENTS.md`, this plan, and the relevant files listed in its assigned task before editing.
- Each implementation subagent must make one independent, verifiable commit for the assigned task and must use `metabot-post-buzz` before that commit, per `AGENTS.md`.
- If a subagent discovers that production chunked upload cannot be implemented with the currently available OAC signer/wallet APIs, it must stop at the explicit blocker checkpoint in Task 4 and return evidence. It must not ship a fake large-file uploader that reports success without durable chain/indexer proof.

## Current-State Evidence

Important existing OAC files:

- `src/core/files/uploadFile.ts`
  - direct small-file upload only;
  - reads the full local file into memory;
  - writes one `/file` pin through `Signer.writePin`;
  - returns `pinId`, `txids`, `totalCost`, `network`, `filePath`, `fileName`, `contentType`, `bytes`, `extension`, `metafileUri`, and `globalMetaId`;
  - rejects DOGE before writing.
- `src/cli/commands/file.ts`
  - currently supports only `file upload --request-file`;
  - dispatches to `context.dependencies.file.upload`.
- `src/daemon/routes/file.ts`
  - currently exposes only `POST /api/file/upload`.
- `src/daemon/defaultHandlers.ts`
  - wires `handlers.file.upload` to `uploadLocalFileToChain`.
- `src/cli/runtime.ts`
  - maps `dependencies.file.upload` to `POST /api/file/upload`.
- `src/cli/commandHelp.ts`
  - documents only `file upload`.
- `SKILLs/metabot-upload-file/SKILL.md`
  - existing source skill for one direct file upload.
- `scripts/build-metabot-skillpacks.mjs`
  - has an explicit `METABOT_SKILLS` allowlist that currently includes `metabot-upload-file` but not `metabot-upload-largefile`.
- `package.json`
  - has an explicit npm `files` allowlist for `SKILLs/*/SKILL.md`; it currently excludes `metabot-upload-largefile`.
- `tests/files/uploadFile.test.mjs`, `tests/cli/file.test.mjs`, `tests/cli/help.test.mjs`, `tests/daemon/httpServer.test.mjs`, `tests/skillpacks/buildSkillpacks.test.mjs`, and `tests/npm/packageFiles.test.mjs`
  - provide the current direct-upload, CLI, route, help, package, and skillpack test patterns.

Relevant reference code:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/SKILL.md`
  - reference semantics: direct upload at or below 2 MiB, chunked upload above 2 MiB, historical IDBots hard cap at 20 MiB, and large chunking currently MVC-only. OAC's target hard cap is 50 MiB; do not implement the historical 20 MiB cap in OAC.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/scripts/upload-largefile.js`
  - script delegates to IDBots local RPC; do not copy this directly because OAC should use its own CLI/daemon boundary.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js`
  - browser-side MetaFS uploader reference that calls `https://file.metaid.io/metafile-uploader` endpoints such as `direct-upload`, `multipart/*`, `estimate-chunked-upload`, and `chunked-upload`;
  - this code depends on browser wallet APIs and must not be copy-pasted into daemon code without proving equivalent signer capabilities exist server-side.

## Product Contract

### Command

Add a new command:

```bash
metabot file upload-large [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|opcat>] [--verify]
```

The request JSON should support:

```json
{
  "filePath": "/absolute/or/relative/path/to/file.mp4",
  "contentType": "video/mp4",
  "verify": true
}
```

The command should resolve relative `filePath` values relative to the request file's directory, matching the existing `file upload` behavior.

### Result Envelope

The CLI should keep using the existing command result envelope:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "pinId": "abc123i0",
    "metafileUri": "metafile://abc123i0.mp4",
    "previewUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0",
    "downloadUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0",
    "fileName": "demo.mp4",
    "contentType": "video/mp4",
    "bytes": 3145728,
    "extension": ".mp4",
    "network": "mvc",
    "uploadMode": "chunked",
    "txids": ["..."],
    "totalCost": 1234,
    "globalMetaId": "idq...",
    "verification": {
      "ok": true,
      "url": "https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0",
      "attempts": 2
    }
  }
}
```

For direct small-file uploads, preserve the existing fields from `uploadLocalFileToChain` and add `uploadMode`, `previewUrl`, `downloadUrl`, and optional `verification`.

### Limits

- `DIRECT_UPLOAD_MAX_BYTES`: `2 * 1024 * 1024`.
- `LARGE_UPLOAD_MAX_BYTES`: `50 * 1024 * 1024`.
- Files at or below `DIRECT_UPLOAD_MAX_BYTES` use existing direct upload.
- Files above `DIRECT_UPLOAD_MAX_BYTES` use production large/chunked upload.
- Files above `LARGE_UPLOAD_MAX_BYTES` fail before any chain or network write.
- DOGE remains unsupported for file upload.
- Large/chunked upload is MVC-only unless API research proves BTC/OPCAT support is safe.

### Skill

Add a new source skill:

- `SKILLs/metabot-upload-largefile/SKILL.md`

Do not add untracked `skills/` files as source of truth. The skillpack build renders from `SKILLs/`.

The skill should instruct agents to:

- not read large file contents into model context;
- create a temporary JSON request file;
- call `{{METABOT_CLI}} file upload-large --request-file <path>`;
- pass `--from <bot-slug>` when the user selected an actor;
- pass `--chain mvc|btc|opcat` only when explicitly requested;
- understand that large/chunked upload may be MVC-only;
- surface `pinId`, `metafileUri`, `previewUrl`, `downloadUrl`, byte size, content type, upload mode, and verification status.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `docs/superpowers/validation/2026-05-27-metabot-upload-largefile-api-notes.md` | Task 1 research note proving which production upload API is available and which signer/wallet capability is required. |
| `src/core/files/metafileUrls.ts` | Build canonical and accelerated file-indexer URLs from a pin id. |
| `src/core/files/metafileVerifier.ts` | Verify uploaded metafile availability with bounded retry over accelerated and canonical URLs. |
| `src/core/files/uploadLargeFile.ts` | Public direct-or-large upload orchestration, limits, result shape, and failure mapping. |
| `src/core/files/metafsLargeUploader.ts` | Production large/chunked uploader adapter if API research proves it can be implemented with current OAC capabilities. |
| `tests/files/metafileVerifier.test.mjs` | Unit tests for URL verification and retry behavior. |
| `tests/files/uploadLargeFile.test.mjs` | Unit tests for size-mode selection, hard caps, DOGE guard, result shape, and verification. |
| `tests/files/metafsLargeUploader.test.mjs` | Unit tests for production large uploader API calls, retry/error mapping, and result normalization. |
| `SKILLs/metabot-upload-largefile/SKILL.md` | Source skill document for large-file upload. |

### Existing files to modify

| File | Change |
|---|---|
| `src/core/files/uploadFile.ts` | Export shared MIME inference and keep direct upload compatible. Do not change existing return fields. |
| `src/daemon/routes/types.ts` | Add optional `file.uploadLarge` handler. |
| `src/daemon/routes/file.ts` | Add `POST /api/file/upload-large` while preserving `POST /api/file/upload`. |
| `src/daemon/defaultHandlers.ts` | Wire `file.uploadLarge` to `uploadLargeFileToChain`. |
| `src/cli/types.ts` | Add optional `dependencies.file.uploadLarge`. |
| `src/cli/runtime.ts` | Route `file.uploadLarge` to `POST /api/file/upload-large`. |
| `src/cli/commands/file.ts` | Add `upload-large` subcommand parsing. Preserve `upload` behavior. |
| `src/cli/commandHelp.ts` | Document `file upload-large` and list it under `file`. |
| `package.json` | Include `SKILLs/metabot-upload-largefile/SKILL.md` in the npm files allowlist. |
| `scripts/build-metabot-skillpacks.mjs` | Include `metabot-upload-largefile` in `METABOT_SKILLS`. |
| `tests/cli/file.test.mjs` | Add CLI dispatch tests for `file upload-large`. |
| `tests/cli/help.test.mjs` | Add help tests for `file upload-large`. |
| `tests/daemon/httpServer.test.mjs` | Add route test for `POST /api/file/upload-large`. |
| `tests/cli/runtime.test.mjs` | Add daemon-backed CLI smoke for upload-large if the existing runtime file-upload coverage pattern requires it. |
| `tests/npm/packageFiles.test.mjs` | Add `metabot-upload-largefile` to expected npm skills. |
| `tests/skillpacks/buildSkillpacks.test.mjs` | Add `metabot-upload-largefile` to expected skillpacks and content assertions. |
| `skillpacks/**` | Regenerate in the packaging task only. |

---

## Task 1: Production Upload API Research Gate

**Files:**
- Create: `docs/superpowers/validation/2026-05-27-metabot-upload-largefile-api-notes.md`

- [ ] **Step 1: Inspect the direct upload and signer boundary**

Read:

```bash
sed -n '1,140p' src/core/files/uploadFile.ts
sed -n '1,80p' src/core/signing/signer.ts
rg -n "writePin|utxo|preTxHex|signTransaction|metafile-uploader|chunked-upload|multipart" src/core src/daemon src/ui tests
```

Expected: current direct upload works through `Signer.writePin`; current daemon signer may not expose the same browser wallet APIs used by the UI MetaFS uploader.

- [ ] **Step 2: Inspect the browser MetaFS uploader reference**

Read:

```bash
sed -n '520,820p' src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js
sed -n '520,820p' src/ui/metaapps/chat/idframework/commands/PostBuzzCommand.js
```

Document which endpoints are used and which wallet primitives they require.

- [ ] **Step 3: Inspect IDBots skill and RPC boundary**

Read:

```bash
sed -n '1,180p' /Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/SKILL.md
sed -n '1,180p' /Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/scripts/upload-largefile.js
rg -n "upload-largefile|largefile|chunked" /Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src /Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/scripts
```

Expected: IDBots delegates from skill script to local RPC; OAC should not depend on `IDBOTS_METABOT_ID` or IDBots RPC.

- [ ] **Step 4: Write the research note**

Create `docs/superpowers/validation/2026-05-27-metabot-upload-largefile-api-notes.md` with:

- available OAC direct upload capability;
- candidate production large-upload API;
- required signer/wallet primitives;
- whether those primitives already exist in OAC;
- exact endpoint request/response shapes if known;
- explicit decision: "implement production chunked upload now" or "block and add missing signer/wallet capability first";
- links to the exact files and line ranges inspected.

The note must not include secrets, private keys, local wallet data, or live UTXO values.

- [ ] **Step 5: Acceptance review**

Run:

```bash
git diff --check
LC_ALL=C rg -n "[^[:ascii:]]" docs/superpowers/validation/2026-05-27-metabot-upload-largefile-api-notes.md || true
```

Expected: both commands produce no actionable output.

Acceptance owner checks:

- The note names a real production upload strategy.
- If production chunked upload is blocked, the note gives exact missing APIs and the implementation should pause before Task 5.
- The note does not propose a fake success path.

- [ ] **Step 6: Commit**

Use `metabot-post-buzz` with a development diary, then commit:

```bash
git add docs/superpowers/validation/2026-05-27-metabot-upload-largefile-api-notes.md
git commit -m "docs: record large file upload API research"
```

---

## Task 2: Metafile URL And Verification Helpers

**Files:**
- Create: `src/core/files/metafileUrls.ts`
- Create: `src/core/files/metafileVerifier.ts`
- Create: `tests/files/metafileVerifier.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests for:

- `buildMetafileContentUrls('abc123i0')` returns accelerated, canonical, and legacy content URLs;
- pin ids are URL encoded;
- `verifyMetafileAvailability` succeeds on accelerated `HEAD`;
- falls back to canonical `HEAD` when accelerated fails;
- falls back to `GET` when `HEAD` returns method-not-allowed;
- respects injected `fetchImpl`, `attempts`, and `delayMs`;
- returns `{ ok: false, url: null, attempts, error }` after bounded retries.

Run:

```bash
npm run build && node --test tests/files/metafileVerifier.test.mjs
```

Expected: FAIL because the helper files do not exist.

- [ ] **Step 2: Implement URL helper**

Create `src/core/files/metafileUrls.ts`:

```typescript
const FILE_INDEXER_BASE = 'https://file.metaid.io/metafile-indexer/api/v1/files';

export interface MetafileContentUrls {
  accelerateUrl: string;
  contentUrl: string;
  legacyContentUrl: string;
  previewUrl: string;
  downloadUrl: string;
}

export function buildMetafileContentUrls(pinId: string): MetafileContentUrls {
  const normalized = String(pinId || '').trim();
  if (!normalized) {
    throw new Error('pinId is required.');
  }
  const encoded = encodeURIComponent(normalized);
  const accelerateUrl = `${FILE_INDEXER_BASE}/accelerate/content/${encoded}`;
  const contentUrl = `${FILE_INDEXER_BASE}/content/${encoded}`;
  return {
    accelerateUrl,
    contentUrl,
    legacyContentUrl: `https://file.metaid.io/metafile-indexer/content/${encoded}`,
    previewUrl: contentUrl,
    downloadUrl: accelerateUrl,
  };
}
```

Use this shape unless the current route/file-indexer code proves a better local convention.

- [ ] **Step 3: Implement verifier**

Create `src/core/files/metafileVerifier.ts`:

```typescript
import { setTimeout as delay } from 'node:timers/promises';
import { buildMetafileContentUrls } from './metafileUrls';

export interface VerifyMetafileAvailabilityInput {
  pinId: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  delayMs?: number;
}

export interface VerifyMetafileAvailabilityResult {
  ok: boolean;
  url: string | null;
  attempts: number;
  error?: string;
}
```

Implementation requirements:

- try accelerated URL before canonical URL;
- use `HEAD` first;
- if `HEAD` returns `405`, `403`, or another fetch-compatible body-safe failure, try `GET`;
- do not download the full body when only status is needed;
- keep default attempts small enough for provider delivery but configurable for tests.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run build && node --test tests/files/metafileVerifier.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Use `metabot-post-buzz`, then:

```bash
git add src/core/files/metafileUrls.ts src/core/files/metafileVerifier.ts tests/files/metafileVerifier.test.mjs
git commit -m "feat: verify metafile availability"
```

---

## Task 3: Direct-Or-Large Upload Orchestration

**Files:**
- Create: `src/core/files/uploadLargeFile.ts`
- Modify: `src/core/files/uploadFile.ts`
- Create: `tests/files/uploadLargeFile.test.mjs`
- Modify: `tests/files/uploadFile.test.mjs` only if exports move.

- [ ] **Step 1: Write failing orchestration tests**

Tests must use local temp files and fake dependencies. Cover:

- file path is required;
- missing file fails before any upload dependency is called;
- files at exactly `DIRECT_UPLOAD_MAX_BYTES` use direct upload;
- files larger than `DIRECT_UPLOAD_MAX_BYTES` call the injected large uploader;
- files above `LARGE_UPLOAD_MAX_BYTES` fail before upload;
- DOGE fails before upload;
- content type is inferred from extension when omitted;
- explicit content type wins;
- direct result includes `uploadMode: 'direct'`, `previewUrl`, `downloadUrl`, `metafileUri`, `bytes`, `fileName`, and old direct fields;
- large result includes `uploadMode: 'chunked'` or `uploadMode: 'large'`, `pinId`, `metafileUri`, `previewUrl`, `downloadUrl`, `bytes`, `fileName`, `contentType`, `network`, and `verification` when requested;
- caller-visible result does not expose provider local paths except the existing direct-upload `filePath` field kept for compatibility.

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/uploadFile.test.mjs
```

Expected: FAIL because `uploadLargeFile.ts` does not exist.

- [ ] **Step 2: Define the public API**

Create `src/core/files/uploadLargeFile.ts`:

```typescript
import type { Signer } from '../signing/signer';

export const DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const LARGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export type UploadLargeFileMode = 'direct' | 'chunked';

export interface UploadLargeFileResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  filePath?: string;
  fileName: string;
  contentType: string;
  bytes: number;
  extension: string;
  metafileUri: string;
  previewUrl: string;
  downloadUrl: string;
  globalMetaId: string;
  uploadMode: UploadLargeFileMode;
  verification?: {
    ok: boolean;
    url: string | null;
    attempts: number;
    error?: string;
  };
}

export interface ProductionLargeFileUploader {
  upload(input: {
    filePath: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    network: string;
    signer: Signer;
  }): Promise<Omit<UploadLargeFileResult, 'verification'>>;
}

export async function uploadLargeFileToChain(input: {
  filePath: string;
  contentType?: string;
  network?: string;
  signer: Signer;
  largeUploader?: ProductionLargeFileUploader;
  verify?: boolean;
  verifyAvailability?: (pinId: string) => Promise<UploadLargeFileResult['verification']>;
  directMaxBytes?: number;
  hardMaxBytes?: number;
}): Promise<UploadLargeFileResult>;
```

Keep thresholds injectable only for tests.

- [ ] **Step 3: Implement orchestration**

Rules:

- Use `fs.stat` before reading the file.
- For direct files, delegate to `uploadLocalFileToChain`.
- For large files, require a `largeUploader`.
- If a large file has no uploader, throw `large_file_upload_unavailable` with a clear message.
- Reject non-MVC large upload unless Task 1 proves another network is supported.
- Build `previewUrl` and `downloadUrl` through `metafileUrls.ts`.
- Run verification only when `verify` is true or when the caller injects an explicit verification dependency.

- [ ] **Step 4: Run tests**

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/uploadFile.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Use `metabot-post-buzz`, then:

```bash
git add src/core/files/uploadLargeFile.ts src/core/files/uploadFile.ts tests/files/uploadLargeFile.test.mjs tests/files/uploadFile.test.mjs
git commit -m "feat: add large file upload orchestration"
```

---

## Task 4: Production Large Uploader Adapter

**Files:**
- Create: `src/core/files/metafsLargeUploader.ts`
- Create: `tests/files/metafsLargeUploader.test.mjs`
- Modify: `src/core/files/uploadLargeFile.ts`
- Modify: `tests/files/uploadLargeFile.test.mjs`

Do not start this task until Task 1 concludes that a production upload strategy is implementable with the current OAC runtime. If Task 1 says required signer/wallet APIs are missing, stop and ask the acceptance owner for the next plan rather than shipping a fake uploader.

- [ ] **Step 1: Write failing adapter tests**

Use injected `fetchImpl`, fake signer/wallet capability, and local temp files. Cover the exact API from the Task 1 research note. At minimum:

- multipart object storage upload is initiated;
- file chunks are sent without loading the whole file into memory;
- multipart upload completes and returns a storage key;
- chunked upload fee/transaction preparation request is sent if required by the API;
- final chunked upload returns a stable pin id or index tx id;
- non-zero API `code` maps to a typed error;
- HTTP failures include endpoint names in the error;
- returned result normalizes `pinId`, `txids`, `totalCost`, `network`, `globalMetaId`, `metafileUri`, `previewUrl`, and `downloadUrl`.

Run:

```bash
npm run build && node --test tests/files/metafsLargeUploader.test.mjs
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 2: Define the adapter around proven dependencies**

Create `src/core/files/metafsLargeUploader.ts` with a dependency-injected constructor such as:

```typescript
export interface MetaFsLargeUploaderOptions {
  uploadBaseUrl?: string;
  fetchImpl?: typeof fetch;
  chunkSizeBytes?: number;
}

export function createMetaFsLargeUploader(options?: MetaFsLargeUploaderOptions): ProductionLargeFileUploader;
```

If the API requires capabilities beyond `Signer.writePin`, define the smallest explicit interface for those capabilities. Do not silently cast `Signer` to `any` and hope fields exist.

- [ ] **Step 3: Implement streaming or bounded-buffer chunk reads**

Implementation requirements:

- never read files larger than `DIRECT_UPLOAD_MAX_BYTES` into a single base64 buffer;
- use `fs.open` or streams to read bounded chunks;
- keep chunk size configurable for tests;
- keep retry policy bounded and testable;
- never log raw file contents;
- never include local paths in thrown messages that could be sent to a remote caller, except local operator errors.

- [ ] **Step 4: Wire as the default large uploader**

In `uploadLargeFileToChain`, use `createMetaFsLargeUploader()` as the default only after tests prove production dependencies are available. Keep dependency injection for tests.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run build && node --test tests/files/metafsLargeUploader.test.mjs tests/files/uploadLargeFile.test.mjs tests/files/metafileVerifier.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Acceptance owner review**

Acceptance owner must inspect:

- no browser-only `window.metaidwallet` dependency exists in Node runtime code;
- no fake pin id is generated;
- final success requires a real API response field chosen in Task 1;
- error paths are deterministic and typed;
- files above the 50 MiB hard cap do not open network requests.

- [ ] **Step 7: Commit**

Use `metabot-post-buzz`, then:

```bash
git add src/core/files/metafsLargeUploader.ts src/core/files/uploadLargeFile.ts tests/files/metafsLargeUploader.test.mjs tests/files/uploadLargeFile.test.mjs
git commit -m "feat: add production MetaFS large file uploader"
```

---

## Task 5: Daemon Route And Handler

**Files:**
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/file.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write failing HTTP route tests**

Add tests to `tests/daemon/httpServer.test.mjs`:

- `POST /api/file/upload-large` forwards JSON to `handlers.file.uploadLarge`;
- route returns the command envelope from the handler;
- route returns `not_implemented` when handler is missing;
- existing `POST /api/file/upload` still forwards to `handlers.file.upload`;
- method guard still returns method-not-allowed for non-POST.

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: FAIL until the route is added.

- [ ] **Step 2: Extend handler types**

Add:

```typescript
file?: {
  upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  uploadLarge?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
};
```

- [ ] **Step 3: Implement route**

Keep `FILE_UPLOAD_ROUTE_PATH = '/api/file/upload'` and add `FILE_UPLOAD_LARGE_ROUTE_PATH = '/api/file/upload-large'`.

- [ ] **Step 4: Wire default handler**

In `defaultHandlers.ts`, implement `file.uploadLarge` using:

- `resolveActorWriteContext(rawInput.from)`;
- identity guard matching `file.upload`;
- `resolveFileUploadNetworkForHome(rawInput.network, actor.homeDir)`;
- `uploadLargeFileToChain({ filePath, contentType, network, signer: actor.signer, verify })`;
- `commandFailed('file_upload_failed', message)` on errors, unless a more specific existing code is already used for file upload failures.

- [ ] **Step 5: Run route tests**

Run:

```bash
npm run build && node --test tests/daemon/httpServer.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Use `metabot-post-buzz`, then:

```bash
git add src/daemon/routes/types.ts src/daemon/routes/file.ts src/daemon/defaultHandlers.ts tests/daemon/httpServer.test.mjs
git commit -m "feat: expose large file upload route"
```

---

## Task 6: CLI Command And Help

**Files:**
- Modify: `src/cli/types.ts`
- Modify: `src/cli/runtime.ts`
- Modify: `src/cli/commands/file.ts`
- Modify: `src/cli/commandHelp.ts`
- Modify: `tests/cli/file.test.mjs`
- Modify: `tests/cli/help.test.mjs`
- Modify: `tests/cli/runtime.test.mjs` if needed for daemon-backed CLI coverage.

- [ ] **Step 1: Write failing CLI dispatch tests**

Add tests for:

- `metabot file upload-large --request-file request.json` dispatches to `dependencies.file.uploadLarge`;
- relative file paths are resolved relative to the request file directory;
- `--from` is forwarded;
- `--chain btc` and `--chain opcat` are forwarded for small/direct cases;
- `--chain doge` fails before dependency call;
- `--verify` sets `verify: true`;
- missing `--request-file` fails with `missing_flag`;
- unknown file subcommand still fails.

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs
```

Expected: FAIL until CLI parser supports `upload-large`.

- [ ] **Step 2: Extend CLI dependency type and runtime**

In `src/cli/types.ts`:

```typescript
file?: {
  upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  uploadLarge?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
};
```

In `src/cli/runtime.ts`:

```typescript
file: {
  upload: async (input) => requestJson(context, 'POST', '/api/file/upload', input),
  uploadLarge: async (input) => requestJson(context, 'POST', '/api/file/upload-large', input),
}
```

- [ ] **Step 3: Extend `runFileCommand`**

Keep `upload` behavior exactly as-is. Add a branch for `upload-large`:

- parse `--request-file`;
- parse `--from`;
- parse `--chain` using the existing file upload chain helper;
- parse `--verify` as a boolean flag;
- read JSON request;
- resolve request-relative `filePath`;
- call `dependencies.file.uploadLarge`.

- [ ] **Step 4: Write failing help tests**

In `tests/cli/help.test.mjs`, assert:

- `metabot file --help` lists `upload-large`;
- `metabot file upload-large --help` shows usage, request shape, success fields, DOGE exclusion, MVC large-upload note, and examples;
- JSON help includes the new command path.

Run:

```bash
npm run build && node --test tests/cli/help.test.mjs
```

Expected: FAIL until help is updated.

- [ ] **Step 5: Update command help**

Add a new command help entry for `['file', 'upload-large']` and include it in the file group subcommands.

- [ ] **Step 6: Run CLI/help tests**

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs tests/cli/help.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Optional runtime smoke**

If `tests/cli/runtime.test.mjs` has a close existing file-upload daemon smoke, add a focused upload-large case and run:

```bash
npm run build && node --test --test-concurrency=1 tests/cli/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

Use `metabot-post-buzz`, then:

```bash
git add src/cli/types.ts src/cli/runtime.ts src/cli/commands/file.ts src/cli/commandHelp.ts tests/cli/file.test.mjs tests/cli/help.test.mjs tests/cli/runtime.test.mjs
git commit -m "feat: add large file upload CLI command"
```

---

## Task 7: Source Skill And Distribution Allowlists

**Files:**
- Create: `SKILLs/metabot-upload-largefile/SKILL.md`
- Modify: `package.json`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `tests/npm/packageFiles.test.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`

- [ ] **Step 1: Write failing package and skillpack tests**

Update expected skill lists to include `metabot-upload-largefile`, then run:

```bash
npm run build && node --test tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: FAIL because package and skillpack allowlists do not include the new skill yet.

- [ ] **Step 2: Write the skill document**

Create `SKILLs/metabot-upload-largefile/SKILL.md` in English.

Required sections:

- frontmatter `name: metabot-upload-largefile`;
- description that triggers on uploading local large files to MetaWeb for later use;
- actor selection;
- command using `{{METABOT_CLI}} file upload-large --request-file request.json`;
- request JSON shape;
- success envelope and fields;
- direct vs large thresholds;
- 50 MiB hard cap;
- DOGE exclusion;
- note that large/chunked upload is MVC-only unless current implementation supports more;
- privacy rule: never read large local files into agent context;
- handoff to `metabot-post-buzz`, `metabot-post-skillservice`, and later A2A provider delivery code.

Do not include Chinese text, emoji, or host-specific absolute paths.

- [ ] **Step 3: Update distribution allowlists**

Modify:

- `package.json` files array: add `SKILLs/metabot-upload-largefile/SKILL.md`;
- `scripts/build-metabot-skillpacks.mjs` `METABOT_SKILLS`: add `metabot-upload-largefile`;
- `tests/npm/packageFiles.test.mjs` `EXPECTED_NPM_SKILLS`;
- `tests/skillpacks/buildSkillpacks.test.mjs` `EXPECTED_METABOT_SKILLS` and content assertions.

- [ ] **Step 4: Run package and skillpack tests**

Run:

```bash
npm run build && node --test tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Use `metabot-post-buzz`, then:

```bash
git add SKILLs/metabot-upload-largefile/SKILL.md package.json scripts/build-metabot-skillpacks.mjs tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "feat: add metabot upload largefile skill"
```

---

## Task 8: Regenerate Skillpacks

**Files:**
- Modify: `skillpacks/**`

- [ ] **Step 1: Rebuild skillpacks**

Run:

```bash
npm run build && npm run build:skillpacks
```

Expected: generated shared and host skillpacks include `metabot-upload-largefile`.

- [ ] **Step 2: Verify tracked generated artifacts**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Inspect generated skill copies**

Run:

```bash
rg -n "metabot-upload-largefile|file upload-large" skillpacks/shared skillpacks/codex skillpacks/claude-code skillpacks/openclaw
```

Expected: generated README and shared skill files reference the new skill and command.

- [ ] **Step 4: Commit**

Use `metabot-post-buzz`, then:

```bash
git add skillpacks
git commit -m "build: package metabot upload largefile skill"
```

---

## Task 9: Final Acceptance Suite

**Files:**
- No source changes expected unless tests reveal defects.

- [ ] **Step 1: Focused verification**

Run:

```bash
npm run build && node --test \
  tests/files/uploadFile.test.mjs \
  tests/files/metafileVerifier.test.mjs \
  tests/files/uploadLargeFile.test.mjs \
  tests/files/metafsLargeUploader.test.mjs \
  tests/cli/file.test.mjs \
  tests/cli/help.test.mjs \
  tests/daemon/httpServer.test.mjs \
  tests/npm/packageFiles.test.mjs \
  tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Runtime smoke if touched**

If Task 6 modified `tests/cli/runtime.test.mjs`, run:

```bash
npm run build && node --test --test-concurrency=1 tests/cli/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Full suite decision**

Because this work touches chain/file upload boundaries, daemon routes, CLI runtime, package allowlists, and skillpack artifacts, run full suite before merging:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual local CLI smoke with a tiny file**

Use a disposable tiny file so the smoke does not require large upload or high chain cost:

```bash
tmp_file="$(mktemp /tmp/oac-upload-large-smoke.XXXXXX.txt)"
printf "large upload smoke\n" > "$tmp_file"
tmp_req="$(mktemp /tmp/oac-upload-large-request.XXXXXX.json)"
printf '{"filePath":"%s","contentType":"text/plain","verify":false}\n' "$tmp_file" > "$tmp_req"
$HOME/.metabot/bin/metabot file upload-large --request-file "$tmp_req"
```

Expected: command returns a success envelope with `uploadMode: "direct"` and a `metafileUri`.

Do not run an actual large paid upload unless the human explicitly approves the chain cost.

- [ ] **Step 5: Acceptance owner diff review**

Review:

```bash
git status --short
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Acceptance checklist:

- Existing `file upload` behavior remains compatible.
- New `file upload-large` has stable JSON output.
- Large files cannot bypass the 50 MiB hard cap.
- DOGE is rejected before upload.
- Production large/chunked success cannot be faked.
- New skill is packaged in npm files and skillpacks.
- No generated `skills/` local directory was accidentally committed.
- No local secrets, UTXOs, private keys, or file contents appear in docs/tests/logs.

- [ ] **Step 6: Final development diary**

Use `metabot-post-buzz` to post the final implementation diary with:

- files changed;
- upload modes implemented;
- verification commands and results;
- whether production large/chunked upload is fully enabled or blocked by a documented signer/API gap;
- manual smoke result, if run.

No commit is required for Task 9 unless fixes were made.

---

## Review Guidance For The Acceptance Owner

Reject a subagent result if any of these are true:

- It creates a fake pin id or fake `metafile://...` URI.
- It treats "large upload unavailable" as success.
- It reads an entire file above `DIRECT_UPLOAD_MAX_BYTES` into memory.
- It copies browser-only `window.metaidwallet` code into Node runtime.
- It broadens existing small-file behavior without tests.
- It adds source-of-truth skill docs under untracked `skills/` instead of `SKILLs/`.
- It changes package or skillpack generated artifacts without running the matching tests.
- It commits code comments or docs in a non-English language.
- It skips the `metabot-post-buzz` diary before a commit.

Prefer sending the subagent targeted feedback with exact failing tests and file references rather than editing the code directly in the acceptance session.
