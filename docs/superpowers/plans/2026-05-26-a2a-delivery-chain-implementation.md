# A2A Delivery Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the A2A delivery chain so local Bots can request and provide skill services that deliver text, images, videos, audio, and generic files.

**Architecture:** Add a shared delivery artifact model, a large-file upload capability, provider-side artifact resolution/upload/verification, caller-side delivery parsing/storage/projection, and trace UI playback/download support. Keep the IDBots-compatible `[DELIVERY:<orderTxid>]` `result` string as the wire compatibility source of truth while adding optional structured artifact metadata for newer OAC peers.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, current MetaBot daemon/CLI, existing signer/file upload helpers, file-indexer/CDN URLs, current trace UI JavaScript, shared skillpack build tooling.

**Spec:** `docs/superpowers/specs/2026-05-26-a2a-delivery-chain-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/core/a2a/deliveryArtifacts.ts` | Shared artifact parsing, URI normalization, media kind classification, file-indexer URL construction, delivery summary building, and text fallback extraction. |
| `src/core/a2a/provider/providerDeliveryArtifacts.ts` | Provider-only artifact resolution from runtime sessions/workspaces, media-family validation, upload orchestration, verification, and failure mapping. |
| `src/core/files/uploadLargeFile.ts` | Direct-or-chunked large-file upload boundary with small-file delegation, hard cap enforcement, and JSON-friendly result types. |
| `src/core/files/metafileVerifier.ts` | Bounded retry verification for accelerated and canonical file-indexer content URLs. |
| `src/cli/commands/uploadLargeFile.ts` | Optional CLI command implementation if the existing `file` command should expose the large-file path. |
| `SKILLs/metabot-upload-largefile/SKILL.md` | Agent-facing large-file upload skill source. |
| `skills/metabot-upload-largefile/SKILL.md` | Installed/shared skill copy used by packaged hosts. |
| `tests/a2a/deliveryArtifacts.test.mjs` | Unit tests for artifact parsing, classification, URL construction, summary building, and payload merging. |
| `tests/a2a/providerDeliveryArtifacts.test.mjs` | Unit tests for provider artifact resolution, upload decision, verification, and failure mapping. |
| `tests/files/uploadLargeFile.test.mjs` | Unit tests for direct/chunked upload threshold behavior and hard cap errors. |
| `tests/files/metafileVerifier.test.mjs` | Unit tests for file-indexer verification success, fallback, retry, and timeout. |

### Existing files to modify

| File | Change |
|---|---|
| `src/core/files/uploadFile.ts` | Reuse MIME inference and direct upload return shape from the large-file boundary. Export shared constants only if needed. |
| `src/cli/commands/file.ts` | Expose large-file upload when the CLI/skill needs a stable command. Keep existing small upload behavior compatible. |
| `src/core/a2a/provider/serviceRunnerContracts.ts` | Extend provider runner result metadata with optional delivery artifacts and artifact failure details. |
| `src/core/a2a/provider/providerServiceRunner.ts` | Replace the current non-text rejection with artifact resolution, upload, verification, and delivery summary construction. |
| `src/daemon/defaultHandlers.ts` | Build provider `[DELIVERY]` messages with text plus artifact summaries and optional structured `artifacts`. Persist artifact metadata in provider/caller state. |
| `src/core/a2a/protocol/orderProtocol.ts` | Preserve existing delivery parsing while accepting optional structured artifact fields in delivery JSON. |
| `src/core/a2a/metawebReplyWaiter.ts` | Parse delivery artifacts from structured fields or `result`, store them with pending delivery, and keep rating wait behavior stable. |
| `src/core/a2a/conversationTypes.ts` | Add optional normalized artifact arrays on relevant message/session metadata without breaking old JSON records. |
| `src/core/a2a/conversationStore.ts` | Ensure old records without artifact arrays still load; no migration pass should be required. |
| `src/core/a2a/traceProjection.ts` | Project delivery artifacts into trace detail models and response metadata. |
| `src/core/a2a/watch/watchEvents.ts` | Include delivery artifact summaries in watch events when useful, while keeping text output unchanged. |
| `src/ui/pages/trace/viewModel.ts` | Carry structured artifacts to the browser view model. |
| `src/ui/pages/trace/sseClient.ts` | Render structured artifacts, fallback parsed `metafile://...` links, and async video/audio object URL playback with fallback downloads. |
| `src/ui/pages/trace/index.html` | Add minimal CSS/states for loading, fallback, video/audio, and download cards. |
| `tests/a2a/providerServiceRunner.test.mjs` | Replace the current non-text rejection expectation with image/video/audio/file upload success and failure cases. |
| `tests/a2a/metawebReplyWaiter.test.mjs` | Assert caller-side artifact parsing and rating behavior. |
| `tests/a2a/traceProjectionUnifiedStore.test.mjs` | Assert structured artifacts survive store/projection. |
| `tests/ui/tracePageScript.test.mjs` | Assert browser-side rendering for image/video/audio/file cards. |
| `tests/ui/traceViewModel.test.mjs` | Assert trace view model exposes artifact arrays. |
| `tests/daemon/servicePaymentBoundary.test.mjs` | Assert non-text provider delivery succeeds only after artifact upload and fails/refunds when upload cannot complete. |
| `tests/cli/file.test.mjs` | Assert any new large-file CLI surface returns stable JSON and preserves existing small-file behavior. |
| `scripts/build-skillpacks.mjs` or current skillpack build config | Include `metabot-upload-largefile` in generated shared skillpacks if skillpack packaging is not automatic from `SKILLs/` and `skills/`. |
| `skillpacks/**` generated artifacts | Rebuild only in the packaging task, after source skills and runtime exports are complete. |

---

## Phase 1: Shared Artifact Model

### Task 1: Add A2A delivery artifact helpers

**Files:**
- Create: `src/core/a2a/deliveryArtifacts.ts`
- Create: `tests/a2a/deliveryArtifacts.test.mjs`

- [ ] **Step 1: Write failing parser and classifier tests**

Add tests that assert:

- `metafile://abc123.png` parses to `kind: 'image'`, `pinId: 'abc123'`, and `extension: '.png'`;
- `.mp4`, `.webm`, and `.mov` classify as `video`;
- `.mp3`, `.wav`, `.ogg`, and `.flac` classify as `audio`;
- unknown extensions classify as `file`;
- trailing punctuation is removed from parsed URIs;
- duplicate URIs are deduped while preserving order;
- source, fallback, and download URLs use `https://file.metaid.io/metafile-indexer/api/v1/files/...`;
- invalid or empty URIs return no artifact.

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: FAIL because `deliveryArtifacts.ts` does not exist.

- [ ] **Step 2: Implement minimal artifact helper**

Create exported helpers:

```typescript
export type A2ADeliveryArtifactKind = 'image' | 'video' | 'audio' | 'file';

export interface A2ADeliveryArtifact {
  uri: string;
  pinId: string;
  kind: A2ADeliveryArtifactKind;
  fileName: string | null;
  extension: string | null;
  contentType: string | null;
  byteLength: number | null;
  sourceUrl: string;
  fallbackUrl: string;
  downloadUrl: string;
}

export function parseMetafileUri(rawUri: string): A2ADeliveryArtifact | null;
export function extractDeliveryArtifactsFromText(text: string): A2ADeliveryArtifact[];
export function inferDeliveryArtifactKind(extension: string | null, contentType?: string | null): A2ADeliveryArtifactKind;
export function buildMetafileContentUrls(pinId: string): { sourceUrl: string; fallbackUrl: string; downloadUrl: string };
```

Use conservative string parsing and extension checks; do not fetch network content in this module.

- [ ] **Step 3: Run helper tests**

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/a2a/deliveryArtifacts.ts tests/a2a/deliveryArtifacts.test.mjs
git commit -m "feat: add A2A delivery artifact helpers"
```

Post a `metabot-post-buzz` development diary before the commit, per `AGENTS.md`.

### Task 2: Add delivery summary builder

**Files:**
- Modify: `src/core/a2a/deliveryArtifacts.ts`
- Modify: `tests/a2a/deliveryArtifacts.test.mjs`

- [ ] **Step 1: Write failing summary tests**

Add tests for `buildDeliveryArtifactSummary()`:

- summary includes the `metafile://...` URI on its own line;
- summary includes `PINID`;
- summary includes file name, content type, byte length, and download URL when available;
- summary does not include a provider local path;
- summary is stable when optional fields are missing.

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: FAIL because the summary builder does not exist.

- [ ] **Step 2: Implement summary builder**

Add:

```typescript
export function buildDeliveryArtifactSummary(artifact: A2ADeliveryArtifact): string;
export function appendDeliveryArtifactSummaries(responseText: string, artifacts: A2ADeliveryArtifact[]): string;
```

Keep the summary compatible with IDBots-style text parsing by leaving `metafile://...` visible.

- [ ] **Step 3: Run helper tests**

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/a2a/deliveryArtifacts.ts tests/a2a/deliveryArtifacts.test.mjs
git commit -m "feat: build A2A artifact delivery summaries"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 2: Large-File Upload Capability

### Task 3: Add upload verification helper

**Files:**
- Create: `src/core/files/metafileVerifier.ts`
- Create: `tests/files/metafileVerifier.test.mjs`

- [ ] **Step 1: Write failing verifier tests**

Mock `fetch` and assert:

- accelerated URL `HEAD` success verifies the artifact;
- canonical fallback URL success verifies the artifact if accelerated fails;
- `GET` fallback is used if `HEAD` is not supported;
- retry stops after configured attempts;
- verification timeout returns a typed failure.

Run:

```bash
npm run build && node --test tests/files/metafileVerifier.test.mjs
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 2: Implement verifier**

Create:

```typescript
export interface VerifyMetafileInput {
  pinId: string;
  sourceUrl?: string;
  fallbackUrl?: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  delayMs?: number;
}

export async function verifyMetafileAvailability(input: VerifyMetafileInput): Promise<{
  ok: boolean;
  url: string | null;
  attempts: number;
  error?: string;
}>;
```

Use bounded delay. Tests should pass a zero delay.

- [ ] **Step 3: Run verifier tests**

Run:

```bash
npm run build && node --test tests/files/metafileVerifier.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/files/metafileVerifier.ts tests/files/metafileVerifier.test.mjs
git commit -m "feat: verify metafile upload availability"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 4: Add large-file upload boundary

**Files:**
- Create: `src/core/files/uploadLargeFile.ts`
- Modify: `src/core/files/uploadFile.ts`
- Create: `tests/files/uploadLargeFile.test.mjs`

- [ ] **Step 1: Write failing upload boundary tests**

Assert:

- files at or below the small threshold delegate to the existing direct upload behavior;
- files above the small threshold use a chunked upload dependency;
- files above the hard cap fail before any chain write;
- DOGE remains unsupported for file upload;
- returned JSON includes `pinId`, `metafileUri`, `fileName`, `contentType`, `bytes`, `network`, `txids`, and verification status;
- upload result does not include local path in caller-visible metadata.

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/uploadFile.test.mjs
```

Expected: FAIL because `uploadLargeFile.ts` does not exist.

- [ ] **Step 2: Implement direct-or-chunked boundary**

Create a small dependency-injected module:

```typescript
export interface UploadLargeFileInput {
  filePath: string;
  contentType?: string;
  network?: string;
  signer: Signer;
  smallFileMaxBytes?: number;
  hardMaxBytes?: number;
  chunkedUploader?: (input: ChunkedUploadInput) => Promise<UploadLargeFileResult>;
  verify?: boolean;
}

export async function uploadLargeFileToChain(input: UploadLargeFileInput): Promise<UploadLargeFileResult>;
```

Implementation notes:

- Start with direct upload reuse and an injectable chunked uploader.
- If no production chunked uploader exists yet, return a typed `large_file_chunked_upload_unavailable` failure for files above threshold and add the production chunked uploader in Task 5.
- Keep threshold constants exported for tests and skills.

- [ ] **Step 3: Run upload tests**

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/uploadFile.test.mjs
```

Expected: PASS for the boundary and existing upload tests.

- [ ] **Step 4: Commit**

```bash
git add src/core/files/uploadLargeFile.ts src/core/files/uploadFile.ts tests/files/uploadLargeFile.test.mjs
git commit -m "feat: add large file upload boundary"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 5: Implement chunked upload or adapt existing MetaWeb large-file API

**Files:**
- Modify: `src/core/files/uploadLargeFile.ts`
- Modify: `tests/files/uploadLargeFile.test.mjs`
- Modify or create additional files under `src/core/files/` as needed after inspecting current MetaWeb signer/upload APIs.

- [ ] **Step 1: Inspect current chain and signer APIs**

Read:

```bash
rg -n "chunk|large|upload|writePin|/file|metafile" src/core src/daemon src/cli tests
```

Expected: identify whether OAC already has a hidden chunked API, or whether IDBots code must be adapted.

- [ ] **Step 2: Write failing production chunked tests**

Use dependency-injected fake transport/signers. Assert:

- chunk manifest is written with stable metadata;
- chunks are written in order;
- final result returns the assembled file `pinId` or the protocol-defined large-file pin id;
- retryable chunk failures are retried within the configured limit;
- permanent failures return a typed error.

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs
```

Expected: FAIL until production chunking is implemented.

- [ ] **Step 3: Implement the production chunked uploader**

Follow IDBots semantics where applicable, but adapt to OAC signer and state boundaries. Keep MVC-only chunking unless current OAC chain APIs prove multi-chain chunking is safe.

Do not proceed with guessed chain writes. If the MetaWeb large-file API is not available in OAC, stop and document the exact missing dependency before coding a fake production uploader.

- [ ] **Step 4: Run upload tests**

Run:

```bash
npm run build && node --test tests/files/uploadLargeFile.test.mjs tests/files/metafileVerifier.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/files tests/files/uploadLargeFile.test.mjs
git commit -m "feat: support chunked large file uploads"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 6: Add `metabot-upload-largefile` skill and CLI surface

**Files:**
- Create: `SKILLs/metabot-upload-largefile/SKILL.md`
- Create: `skills/metabot-upload-largefile/SKILL.md`
- Modify: `src/cli/commands/file.ts`
- Create or modify: `src/cli/commands/uploadLargeFile.ts`
- Modify: `tests/cli/file.test.mjs`

- [ ] **Step 1: Write failing CLI/skill tests**

Assert the CLI can upload a large file through a JSON-producing command, and existing `metabot file upload` behavior remains unchanged.

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs
```

Expected: FAIL until the command is wired.

- [ ] **Step 2: Implement CLI command**

Expose a stable JSON command that the skill can call. Suggested shape:

```bash
metabot file upload-large --path /absolute/file.mp4 --content-type video/mp4 --json
```

Return JSON with at least `ok`, `pinId`, `metafileUri`, `contentType`, `bytes`, `network`, and `verification`.

- [ ] **Step 3: Write skill docs**

Create the skill docs in English. Include:

- when to use the skill;
- direct upload vs chunked upload threshold;
- hard cap;
- JSON command;
- expected JSON output;
- failure handling;
- privacy constraints.

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npm run build && node --test tests/cli/file.test.mjs tests/files/uploadLargeFile.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SKILLs/metabot-upload-largefile skills/metabot-upload-largefile src/cli/commands tests/cli/file.test.mjs
git commit -m "feat: add metabot large file upload skill"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 3: Provider-Side Artifact Delivery

### Task 7: Extend provider runner contracts

**Files:**
- Modify: `src/core/a2a/provider/serviceRunnerContracts.ts`
- Modify: `src/core/a2a/provider/providerServiceRunner.ts`
- Modify: `tests/a2a/providerServiceRunner.test.mjs`

- [ ] **Step 1: Write failing contract tests**

Update tests so non-text output no longer expects unconditional `provider_deliverable_invalid`. Add cases where a fake resolver/upload dependency returns an image/video/audio/file artifact and the provider runner returns `state: 'completed'`, `responseText` with `metafile://...`, and metadata artifacts.

Run:

```bash
npm run build && node --test tests/a2a/providerServiceRunner.test.mjs
```

Expected: FAIL because the runner still rejects non-text deliverables.

- [ ] **Step 2: Add contract fields**

Add optional fields such as:

```typescript
deliveryArtifacts?: A2ADeliveryArtifact[];
deliveryArtifactFailure?: {
  code: string;
  message: string;
};
```

Keep existing text callers compatible.

- [ ] **Step 3: Run provider tests**

Run:

```bash
npm run build && node --test tests/a2a/providerServiceRunner.test.mjs
```

Expected: still FAIL until artifact resolution is implemented.

- [ ] **Step 4: Commit only if contract changes are independently passing**

If this task cannot pass without Task 8, merge Task 7 and Task 8 into one commit. Otherwise:

```bash
git add src/core/a2a/provider/serviceRunnerContracts.ts tests/a2a/providerServiceRunner.test.mjs
git commit -m "feat: extend provider delivery artifact contract"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 8: Add provider artifact resolver and upload orchestration

**Files:**
- Create: `src/core/a2a/provider/providerDeliveryArtifacts.ts`
- Modify: `src/core/a2a/provider/providerServiceRunner.ts`
- Create: `tests/a2a/providerDeliveryArtifacts.test.mjs`
- Modify: `tests/a2a/providerServiceRunner.test.mjs`

- [ ] **Step 1: Write failing resolver tests**

Assert:

- explicit structured artifact path is preferred;
- `metafile://...` outputs are reused after verification;
- local files outside the session workspace are rejected;
- missing files return `provider_artifact_missing`;
- wrong media family returns `provider_artifact_type_mismatch`;
- oversized files return `provider_artifact_too_large`;
- successful upload returns a normalized `A2ADeliveryArtifact`.

Run:

```bash
npm run build && node --test tests/a2a/providerDeliveryArtifacts.test.mjs
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 2: Implement resolver**

Create a provider-only module that accepts:

```typescript
export interface ResolveProviderDeliveryArtifactInput {
  outputType: string | null | undefined;
  responseText: string;
  session: unknown;
  sessionWorkspace: string;
  upload: (filePath: string, contentType?: string) => Promise<UploadLargeFileResult>;
  verify: (artifact: A2ADeliveryArtifact) => Promise<boolean>;
}
```

Keep filesystem scanning constrained to the session workspace. Start with explicit hints and `metafile://...` parsing before adding workspace scanning.

- [ ] **Step 3: Wire provider runner**

In `providerServiceRunner.ts`, replace the non-text rejection with:

1. resolve artifact;
2. upload or reuse verified metafile;
3. append delivery summary to sanitized text;
4. return `deliveryArtifacts` in metadata;
5. return typed failure for artifact errors.

- [ ] **Step 4: Run provider artifact tests**

Run:

```bash
npm run build && node --test tests/a2a/providerDeliveryArtifacts.test.mjs tests/a2a/providerServiceRunner.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/provider/providerDeliveryArtifacts.ts src/core/a2a/provider/providerServiceRunner.ts tests/a2a/providerDeliveryArtifacts.test.mjs tests/a2a/providerServiceRunner.test.mjs
git commit -m "feat: upload provider A2A delivery artifacts"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 9: Wire provider delivery messages and refund failures

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/core/a2a/protocol/orderProtocol.ts`
- Modify: `tests/daemon/servicePaymentBoundary.test.mjs`
- Modify: `tests/orders/serviceOrderProtocols.test.mjs`

- [ ] **Step 1: Write failing daemon delivery tests**

Add coverage for:

- image/video/audio/file delivery message includes `result` text with `metafile://...`;
- delivery JSON includes optional `artifacts`;
- `[NeedsRating]` is sent after successful artifact delivery;
- missing artifact enters the failure/refund path;
- upload verification timeout does not send a successful rating request.

Run:

```bash
npm run build && node --test tests/daemon/servicePaymentBoundary.test.mjs tests/orders/serviceOrderProtocols.test.mjs
```

Expected: FAIL until daemon delivery is wired.

- [ ] **Step 2: Preserve protocol compatibility**

Update `orderProtocol.ts` parsing/building only as needed:

- keep `result` as a string;
- accept optional `artifacts` in parsed delivery payloads;
- ignore malformed `artifacts` rather than rejecting otherwise valid text delivery;
- keep old `[DELIVERY]` and `[DELIVERY:<orderTxid>]` tests passing.

- [ ] **Step 3: Wire daemon provider send path**

In `defaultHandlers.ts`, pass `deliveryArtifacts` from the provider runner into delivery message construction and persistence. Ensure failure codes from provider artifact upload reach the existing refund/manual refund flow.

- [ ] **Step 4: Run daemon delivery tests**

Run:

```bash
npm run build && node --test tests/daemon/servicePaymentBoundary.test.mjs tests/orders/serviceOrderProtocols.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/defaultHandlers.ts src/core/a2a/protocol/orderProtocol.ts tests/daemon/servicePaymentBoundary.test.mjs tests/orders/serviceOrderProtocols.test.mjs
git commit -m "feat: deliver provider A2A artifacts over protocol"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 4: Caller-Side Parsing, Persistence, And Trace Projection

### Task 10: Parse artifacts in caller reply waiter

**Files:**
- Modify: `src/core/a2a/metawebReplyWaiter.ts`
- Modify: `tests/a2a/metawebReplyWaiter.test.mjs`

- [ ] **Step 1: Write failing caller parsing tests**

Assert:

- text-only delivery still completes as before;
- delivery with `result: "...metafile://pin.mp4"` returns `artifacts[0].kind === 'video'`;
- delivery with structured `artifacts` uses structured metadata;
- malformed structured artifacts fall back to `result` parsing;
- rating request wait still completes after artifact delivery.

Run:

```bash
npm run build && node --test tests/a2a/metawebReplyWaiter.test.mjs
```

Expected: FAIL until artifacts are parsed.

- [ ] **Step 2: Implement reply waiter parsing**

Use `deliveryArtifacts.ts` helpers. Extend pending delivery with optional `artifacts` while keeping existing `responseText`, `deliveryPinId`, `observedAt`, `rawMessage`, and `ratingRequestText`.

- [ ] **Step 3: Run caller parsing tests**

Run:

```bash
npm run build && node --test tests/a2a/metawebReplyWaiter.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/a2a/metawebReplyWaiter.ts tests/a2a/metawebReplyWaiter.test.mjs
git commit -m "feat: parse caller A2A delivery artifacts"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 11: Persist and project delivery artifacts

**Files:**
- Modify: `src/core/a2a/conversationTypes.ts`
- Modify: `src/core/a2a/conversationStore.ts`
- Modify: `src/core/a2a/traceProjection.ts`
- Modify: `src/core/a2a/watch/watchEvents.ts`
- Modify: `tests/a2a/conversationStore.test.mjs`
- Modify: `tests/a2a/traceProjectionUnifiedStore.test.mjs`
- Modify: `tests/a2a/traceWatch.test.mjs`

- [ ] **Step 1: Write failing persistence/projection tests**

Assert:

- a delivery message can store `artifacts`;
- old records without `artifacts` still load;
- trace session detail includes `deliveryArtifacts`;
- response text remains unchanged;
- watch events include artifact counts or summaries without breaking existing text consumers.

Run:

```bash
npm run build && node --test tests/a2a/conversationStore.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/a2a/traceWatch.test.mjs
```

Expected: FAIL until types/projection are extended.

- [ ] **Step 2: Extend types and normalization**

Add optional arrays only. Do not require migration of existing `.runtime/A2A` JSON.

- [ ] **Step 3: Extend projection**

Map artifacts into trace details and session summaries where useful. Avoid duplicating parsed artifacts when both structured and text-parsed artifacts exist.

- [ ] **Step 4: Run persistence/projection tests**

Run:

```bash
npm run build && node --test tests/a2a/conversationStore.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/a2a/traceWatch.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/a2a/conversationTypes.ts src/core/a2a/conversationStore.ts src/core/a2a/traceProjection.ts src/core/a2a/watch/watchEvents.ts tests/a2a
git commit -m "feat: persist A2A delivery artifacts in traces"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 5: Caller UI Media Playback And Downloads

### Task 12: Render structured artifacts in trace UI

**Files:**
- Modify: `src/ui/pages/trace/viewModel.ts`
- Modify: `src/ui/pages/trace/sseClient.ts`
- Modify: `src/ui/pages/trace/index.html`
- Modify: `tests/ui/traceViewModel.test.mjs`
- Modify: `tests/ui/tracePageScript.test.mjs`

- [ ] **Step 1: Write failing UI tests**

Assert:

- structured image artifacts render an image preview;
- structured video artifacts render video controls;
- structured audio artifacts render audio controls;
- generic files render a download card;
- text-only `metafile://...` fallback still renders;
- duplicate structured/text artifacts are not duplicated.

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
```

Expected: FAIL until UI consumes structured artifacts.

- [ ] **Step 2: Extend view model**

Add `deliveryArtifacts` or a similarly named field to the trace message/session view model. Keep old fields stable.

- [ ] **Step 3: Render structured artifacts**

Update `sseClient.ts`:

- prefer structured artifacts on messages;
- parse fallback `metafile://...` from text when structured artifacts are absent;
- keep the existing text cleanup behavior so raw artifact URIs do not clutter media cards;
- escape all labels.

- [ ] **Step 4: Run UI tests**

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/pages/trace tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
git commit -m "feat: render A2A delivery artifacts in trace UI"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 13: Add robust video/audio async playback fallback

**Files:**
- Modify: `src/ui/pages/trace/sseClient.ts`
- Modify: `src/ui/pages/trace/index.html`
- Modify: `tests/ui/tracePageScript.test.mjs`

- [ ] **Step 1: Write failing playback fallback tests**

Assert:

- video/audio cards can start in a loading state;
- failed accelerated fetch falls back to canonical URL;
- failed blob/object URL playback leaves a download link visible;
- object URLs are revoked when cards are replaced or session reloads.

Run:

```bash
npm run build && node --test tests/ui/tracePageScript.test.mjs
```

Expected: FAIL until async media handling exists.

- [ ] **Step 2: Implement async media loader**

Add browser-side helpers:

```javascript
async function resolvePlayableMetafileUrl(artifact) { /* accelerated fetch, fallback fetch, object URL */ }
function cleanupMetafileObjectUrls() { /* revoke old URLs */ }
```

Do not block message rendering while media fetches. Show controls/download fallback immediately.

- [ ] **Step 3: Run playback tests**

Run:

```bash
npm run build && node --test tests/ui/tracePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/pages/trace/sseClient.ts src/ui/pages/trace/index.html tests/ui/tracePageScript.test.mjs
git commit -m "feat: add A2A video and audio playback fallback"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 6: End-To-End Service Behavior

### Task 14: Add artifact-bearing A2A integration tests

**Files:**
- Modify or create: `tests/e2e/localCrossHostDemo.test.mjs`
- Modify or create: `tests/e2e/a2aMediaDelivery.test.mjs`
- Modify supporting fixtures under `tests/e2e/` only as needed.

- [ ] **Step 1: Write failing e2e tests**

Create fake/local cross-host cases for:

- caller receives an image delivery;
- caller receives a video delivery;
- caller receives an audio delivery;
- caller receives a generic file delivery;
- provider missing artifact triggers failure/refund behavior.

Use fake upload/verifier dependencies where possible to avoid live chain writes in unit-like e2e tests.

Run:

```bash
npm run build && node --test tests/e2e/a2aMediaDelivery.test.mjs
```

Expected: FAIL until all phases are integrated.

- [ ] **Step 2: Wire remaining integration gaps**

Fix any state plumbing, daemon route, watch, or CLI polling gaps exposed by the e2e tests. Keep changes narrow.

- [ ] **Step 3: Run e2e media tests**

Run:

```bash
npm run build && node --test tests/e2e/a2aMediaDelivery.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e src
git commit -m "test: cover A2A media delivery end to end"
```

Post a `metabot-post-buzz` development diary before the commit.

---

## Phase 7: Packaging And Final Verification

### Task 15: Rebuild skillpacks with large-file skill

**Files:**
- Modify: `skillpacks/**` generated artifacts
- Modify: `release/compatibility.json` only if the implementation requires compatibility metadata changes.

- [ ] **Step 1: Run skillpack build**

Run:

```bash
npm run build:skillpacks
```

Expected: generated skillpacks include `metabot-upload-largefile`.

- [ ] **Step 2: Verify generated artifacts are tracked**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit packaging artifacts**

```bash
git add skillpacks release/compatibility.json
git commit -m "build: package metabot large file upload skill"
```

Post a `metabot-post-buzz` development diary before the commit.

### Task 16: Full regression verification before merge

**Files:**
- No source changes expected unless verification finds issues.

- [ ] **Step 1: Run focused media delivery suite**

Run:

```bash
npm run build && node --test \
  tests/a2a/deliveryArtifacts.test.mjs \
  tests/a2a/providerDeliveryArtifacts.test.mjs \
  tests/a2a/providerServiceRunner.test.mjs \
  tests/a2a/metawebReplyWaiter.test.mjs \
  tests/a2a/traceProjectionUnifiedStore.test.mjs \
  tests/files/uploadLargeFile.test.mjs \
  tests/files/metafileVerifier.test.mjs \
  tests/ui/traceViewModel.test.mjs \
  tests/ui/tracePageScript.test.mjs \
  tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full suite**

Run:

```bash
npm test
```

Expected: PASS.

Full `npm test` is required here because this feature touches shared runtime behavior, chain/file upload, persistence, UI rendering, packaging, and paid provider failure/refund flows.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
```

Expected: only intentional files are changed.

- [ ] **Step 4: Final development diary**

Use `metabot-post-buzz` to post a final on-chain diary that lists:

- provider-side artifact upload behavior;
- caller-side parsing/rendering behavior;
- large-file upload skill;
- verification commands and results;
- known limitations, if any.

- [ ] **Step 5: Prepare merge**

Use `superpowers:finishing-a-development-branch` before merging. If merging locally, follow `AGENTS.md` and use:

```bash
git checkout main
git merge --no-ff codex/a2a-media-delivery
```

Do not skip the `--no-ff` merge point.

---

## Implementation Notes

- Keep every documentation file, skill document, and code comment in English.
- Make small commits after each independent, passing task.
- Post a `metabot-post-buzz` development diary before every commit.
- Prefer dependency injection for upload, verification, and fetch behavior so tests do not require live chain or CDN access.
- Preserve text-only behavior first; artifact support must be additive.
- Keep `metafile://...` visible in delivery `result` for IDBots compatibility.
- Never put provider local paths in outbound delivery text or caller-visible persisted state.
- Avoid broad refactors in `defaultHandlers.ts`; extract focused helpers if the delivery changes make the file harder to reason about.
- Re-run targeted tests after each task and save full `npm test` for the final cross-cutting verification phase.
