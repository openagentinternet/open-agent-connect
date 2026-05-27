# A2A Provider Caller Artifact Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining A2A provider/caller delivery closure so text, image, video, audio, and generic file service results are uploaded, delivered, stored, rendered, rated, and refunded correctly.

**Architecture:** Use one shared A2A artifact model for both wire parsing and provider delivery. Caller-side handling should normalize structured `artifacts` first and fall back to `metafile://...` links in `result`; provider-side handling should resolve non-text runtime output, upload local artifacts through the existing `uploadLargeFileToChain` boundary, append an IDBots-compatible metafile summary to `result`, and include optional structured artifacts. Provider upload failures must enter the existing failure/refund path before `[NeedsRating]`.

**Tech Stack:** TypeScript, Node.js 20+, `node:test`, current A2A conversation store, current daemon/CLI handlers, current trace UI JavaScript, `uploadLargeFileToChain`, MetaWeb file-indexer URLs, existing A2A payment/refund traces.

**Spec:** `docs/superpowers/specs/2026-05-26-a2a-delivery-chain-design.md`

---

## Ownership Model

This plan is written for subagent-driven development.

- Acceptance owner: the coordinating agent in this thread.
- Implementation owner: one fresh subagent per task unless the acceptance owner intentionally splits a task smaller.
- Review owner: after every implementation task, dispatch a spec compliance reviewer first and a code quality reviewer second.
- Review and test subagents should use model `gpt-5.5`, per `AGENTS.md`.
- The acceptance owner should not write implementation code for this plan. If a task fails review, send targeted feedback back to a subagent.
- Every modification round must be committed independently after relevant verification passes.
- Before every commit, the responsible agent must use the `metabot-post-buzz` skill to post a detailed development diary on-chain.
- All documentation, SKILL documents, and code comments must be written in English.
- Do not introduce any dependency on the legacy `.metabot/hot` layout.

## Current State And Preconditions

Task 9 of `docs/superpowers/plans/2026-05-27-metabot-upload-largefile-implementation.md` is accepted. The branch already contains the large-file foundation:

- `src/core/files/metafileUrls.ts`
- `src/core/files/metafileVerifier.ts`
- `src/core/files/uploadLargeFile.ts`
- `file upload-large` CLI and daemon route
- `SKILLs/metabot-upload-largefile/SKILL.md`
- packaged shared skillpacks

Important boundary:

- Direct small upload at or below 2 MiB is available.
- The OAC default runtime still does not have a production chunked uploader injected for files above 2 MiB.
- The hard cap is 50 MiB.
- When provider delivery requires a file above 2 MiB and no production large uploader is injected, the provider must fail with `large_file_upload_unavailable` and enter the failure/refund path. Do not fake a successful delivery.

## Reference Files To Read Before Editing

OAC files:

- `src/core/files/metafileUrls.ts`
- `src/core/files/uploadLargeFile.ts`
- `src/core/a2a/provider/providerServiceRunner.ts`
- `src/core/a2a/provider/serviceRunnerContracts.ts`
- `src/core/a2a/protocol/orderProtocol.ts`
- `src/core/a2a/metawebReplyWaiter.ts`
- `src/core/a2a/conversationTypes.ts`
- `src/core/a2a/conversationPersistence.ts`
- `src/core/a2a/traceProjection.ts`
- `src/daemon/defaultHandlers.ts`
- `src/ui/pages/trace/viewModel.ts`
- `src/ui/pages/trace/sseClient.ts`
- `tests/a2a/providerServiceRunner.test.mjs`
- `tests/a2a/metawebReplyWaiter.test.mjs`
- `tests/a2a/traceProjectionUnifiedStore.test.mjs`
- `tests/daemon/servicePaymentBoundary.test.mjs`
- `tests/ui/traceViewModel.test.mjs`
- `tests/ui/tracePageScript.test.mjs`

IDBots reference files:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/privateChatOrderCowork.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceDeliveryArtifacts.js`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/renderer/components/cowork/A2AMessageItem.tsx`

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/core/a2a/deliveryArtifacts.ts` | Shared delivery artifact data model, `metafile://` parsing, structured artifact normalization, media-kind classification, summary building, and text extraction. |
| `src/core/a2a/provider/providerDeliveryArtifacts.ts` | Provider-only local artifact resolution, workspace containment checks, media-family validation, secret-like filename rejection, upload orchestration, verification failure mapping, and final summary creation. |
| `tests/a2a/deliveryArtifacts.test.mjs` | Unit tests for shared artifact helpers. |
| `tests/a2a/providerDeliveryArtifacts.test.mjs` | Unit tests for provider artifact resolution/upload/failure semantics. |

### Existing files to modify

| File | Change |
|---|---|
| `src/core/a2a/protocol/orderProtocol.ts` | Accept optional structured `artifacts` on delivery payloads without changing `[DELIVERY:<orderTxid>]` semantics. |
| `src/core/a2a/metawebReplyWaiter.ts` | Return normalized delivery artifacts from structured payloads or result text fallback. |
| `src/core/a2a/conversationTypes.ts` | Add optional delivery artifacts to persisted A2A conversation messages. |
| `src/core/a2a/conversationPersistence.ts` | Normalize and persist message artifacts while keeping old records compatible. |
| `src/core/a2a/sessionStateStore.ts` | Add optional delivery artifacts to daemon session transcript item records so runtime traces can persist artifacts without type escapes. |
| `src/core/a2a/traceProjection.ts` | Project delivery artifacts into transcript items and session detail. |
| `src/core/a2a/provider/serviceRunnerContracts.ts` | Extend completed provider results with optional metadata needed for provider delivery artifact resolution. |
| `src/core/a2a/provider/providerServiceRunner.ts` | Stop rejecting non-text outputs in the runner; surface sanitized output and session/workspace metadata so daemon delivery can upload artifacts. Treat `markdown` as text-like. |
| `src/daemon/defaultHandlers.ts` | Caller side: preserve reply artifacts in session traces and validate non-text replies using artifacts. Provider side: resolve/upload non-text artifacts before delivery, include structured artifacts, and fail/refund on upload errors. Add injectable provider upload dependency for tests/future production large uploader wiring. |
| `src/ui/pages/trace/viewModel.ts` | Carry structured delivery artifacts to the browser view model. |
| `src/ui/pages/trace/sseClient.ts` | Render structured artifacts first, fall back to text parsing, and add nonblocking video/audio fetch-to-object-URL playback fallback. |
| `src/ui/pages/trace/index.html` | Add minimal states/classes only if needed by the updated artifact cards. |
| `tests/a2a/metawebReplyWaiter.test.mjs` | Cover structured/fallback artifact parsing and rating compatibility. |
| `tests/a2a/traceProjectionUnifiedStore.test.mjs` | Cover artifact persistence and projection from `.runtime/A2A`. |
| `tests/a2a/providerServiceRunner.test.mjs` | Replace the old non-text rejection expectation with runner completion plus metadata. |
| `tests/daemon/servicePaymentBoundary.test.mjs` | Cover caller validation, provider upload success, provider upload failure/refund, and NeedsRating ordering. |
| `tests/ui/traceViewModel.test.mjs` | Cover structured delivery artifacts in message view models. |
| `tests/ui/tracePageScript.test.mjs` | Cover image/video/audio/file rendering from structured artifacts and text fallback. |

---

## Task 1: Shared A2A Delivery Artifact Helpers

**Files:**
- Create: `src/core/a2a/deliveryArtifacts.ts`
- Create: `tests/a2a/deliveryArtifacts.test.mjs`

- [ ] **Step 1: Write failing parser/classifier tests**

Create `tests/a2a/deliveryArtifacts.test.mjs` and assert:

- `parseMetafileUri('metafile://abc123i0.png')` returns `pinId: 'abc123i0'`, `extension: '.png'`, and `kind: 'image'`.
- `.mp4`, `.webm`, `.mov`, and `.m4v` classify as `video`.
- `.mp3`, `.wav`, `.ogg`, `.flac`, and `.m4a` classify as `audio`.
- unknown extensions classify as `file`.
- `image/*`, `video/*`, and `audio/*` content types override weak or missing extension data.
- trailing punctuation such as `),.;:!?` is removed from parsed text URIs.
- duplicate URIs are deduped while preserving first-seen order.
- file-indexer URLs are derived from `buildMetafileContentUrls()` in `src/core/files/metafileUrls.ts`.
- invalid or empty URIs return `null` or an empty array.

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: FAIL because `src/core/a2a/deliveryArtifacts.ts` does not exist.

- [ ] **Step 2: Implement the shared model and parser**

Create these exported types and helpers:

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

export function inferDeliveryArtifactKind(
  extension: string | null,
  contentType?: string | null,
): A2ADeliveryArtifactKind;

export function parseMetafileUri(rawUri: string): A2ADeliveryArtifact | null;

export function extractDeliveryArtifactsFromText(text: string): A2ADeliveryArtifact[];
```

Implementation notes:

- Do not fetch network content in this module.
- Normalize extensions to a leading lowercase dot.
- Set `sourceUrl` to the accelerated file-indexer content URL.
- Set `fallbackUrl` to the canonical file-indexer content URL.
- Set `downloadUrl` to the accelerated URL.
- Use the existing `buildMetafileContentUrls()` helper instead of duplicating URL string templates.

- [ ] **Step 3: Run helper tests**

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/core/a2a/deliveryArtifacts.ts tests/a2a/deliveryArtifacts.test.mjs
git commit -m "feat: add A2A delivery artifact helpers"
```

## Task 2: Structured Artifact Normalization And Summaries

**Files:**
- Modify: `src/core/a2a/deliveryArtifacts.ts`
- Modify: `tests/a2a/deliveryArtifacts.test.mjs`

- [ ] **Step 1: Write failing structured payload tests**

Add tests that assert:

- `normalizeDeliveryArtifacts({ artifacts: [{ uri: 'metafile://abc123i0.mp4', fileName: 'clip.mp4', contentType: 'video/mp4', byteLength: 123 }] })` preserves safe metadata and fills URL fields.
- malformed structured entries are ignored.
- structured entries and text fallback entries are merged and deduped.
- `buildDeliveryArtifactSummary()` includes the `metafile://...` URI, `PINID`, file name, content type, byte length, and download URL when present.
- summaries never include a local filesystem path.
- `appendDeliveryArtifactSummaries()` leaves plain response text intact and appends summaries separated by blank lines.

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: FAIL because the structured normalization and summary helpers do not exist.

- [ ] **Step 2: Implement normalization and summary helpers**

Add:

```typescript
export function normalizeDeliveryArtifacts(input: {
  artifacts?: unknown;
  resultText?: unknown;
}): A2ADeliveryArtifact[];

export function buildDeliveryArtifactSummary(artifact: A2ADeliveryArtifact): string;

export function appendDeliveryArtifactSummaries(
  responseText: string,
  artifacts: A2ADeliveryArtifact[],
): string;
```

Implementation notes:

- Prefer structured artifact metadata when it is valid.
- Fall back to parsing `resultText` for `metafile://...` URIs.
- Deduplicate by normalized URI.
- Do not persist or return `localPath`, `path`, `absolutePath`, or any unknown provider-only local fields.
- Keep the `metafile://...` URI visible in the summary for old IDBots-style callers.

- [ ] **Step 3: Run helper tests**

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/core/a2a/deliveryArtifacts.ts tests/a2a/deliveryArtifacts.test.mjs
git commit -m "feat: normalize A2A delivery artifact payloads"
```

## Task 3: Caller Delivery Parsing, Persistence, And Projection

**Files:**
- Modify: `src/core/a2a/protocol/orderProtocol.ts`
- Modify: `src/core/a2a/metawebReplyWaiter.ts`
- Modify: `src/core/a2a/conversationTypes.ts`
- Modify: `src/core/a2a/conversationPersistence.ts`
- Modify: `src/core/a2a/sessionStateStore.ts`
- Modify: `src/core/a2a/traceProjection.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/a2a/metawebReplyWaiter.test.mjs`
- Modify: `tests/a2a/traceProjectionUnifiedStore.test.mjs`
- Modify: `tests/daemon/servicePaymentBoundary.test.mjs`

- [ ] **Step 1: Write failing caller-side tests**

Add or update tests for:

- `metawebReplyWaiter` returns `artifacts` from a structured delivery payload.
- `metawebReplyWaiter` returns `artifacts` by parsing `result` when no structured payload is present.
- `NeedsRating` grace behavior still returns the same delivery plus artifacts.
- `persistA2AConversationMessage()` stores `message.artifacts` and old records without `artifacts` still load.
- `traceProjection` projects delivery artifacts to transcript items and to the session detail as `deliveryArtifacts`.
- `applyCallerReplyResult()` records reply artifacts in transcript metadata so trace rebuilding keeps them.
- buyer-side non-text deliverable validation accepts either `reply.artifacts.length > 0` or a valid fallback `metafile://...` reference.
- buyer-side non-text deliverable validation still rejects completed replies with no artifact reference and creates a refund request for paid orders.

Run:

```bash
npm run build && node --test tests/a2a/metawebReplyWaiter.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: FAIL because caller artifacts are not yet parsed or persisted.

- [ ] **Step 2: Extend delivery protocol typing**

In `src/core/a2a/protocol/orderProtocol.ts`, add an optional field to `DeliveryMessagePayload`:

```typescript
artifacts?: unknown;
```

Do not change `buildDeliveryMessage()` or the `[DELIVERY:<orderTxid>]` JSON envelope.

- [ ] **Step 3: Extend reply waiter result**

In `src/core/a2a/metawebReplyWaiter.ts`:

- Import `A2ADeliveryArtifact` and `normalizeDeliveryArtifacts`.
- Add `artifacts: A2ADeliveryArtifact[]` to the completed `AwaitMetaWebServiceReplyResult`.
- When a delivery is accepted, set artifacts from `normalizeDeliveryArtifacts({ artifacts: delivery.artifacts, resultText: delivery.result })`.
- Preserve `responseText`, `deliveryPinId`, `observedAt`, `rawMessage`, and `ratingRequestText` behavior.

- [ ] **Step 4: Persist artifacts in A2A conversations**

In `src/core/a2a/conversationTypes.ts`, add:

```typescript
import type { A2ADeliveryArtifact } from './deliveryArtifacts';

// on A2AConversationMessage
artifacts?: A2ADeliveryArtifact[];
```

In `src/core/a2a/conversationPersistence.ts`:

- Accept `message.artifacts?: unknown`.
- Normalize with `normalizeDeliveryArtifacts({ artifacts: input.message.artifacts, resultText: input.message.content })`.
- Store the property only when the normalized array is non-empty.
- Keep old records compatible; no migration pass.

- [ ] **Step 5: Project artifacts into trace detail**

In `src/core/a2a/sessionStateStore.ts`:

- Import `A2ADeliveryArtifact`.
- Add `artifacts?: A2ADeliveryArtifact[]` to `A2ATranscriptItemRecord`.
- Keep old `session-state.json` records compatible; no migration pass.

In `src/core/a2a/traceProjection.ts`:

- Add `artifacts?: A2ADeliveryArtifact[]` to `UnifiedA2ATraceTranscriptItem`.
- Add `deliveryArtifacts: A2ADeliveryArtifact[]` to `UnifiedA2ATraceSessionDetail`.
- For delivery protocol messages, normalize artifacts from `message.artifacts`, `parsed?.artifacts`, and the content fallback.
- Put artifacts on the transcript item and in `metadata.deliveryArtifacts`.
- Update projected result extraction to return the latest provider delivery artifacts.
- Keep the existing `artifacts: { transcriptMarkdownPath, traceMarkdownPath, traceJsonPath }` export bundle unchanged.

- [ ] **Step 6: Preserve caller reply artifacts in daemon traces**

In `src/daemon/defaultHandlers.ts`:

- Update `applyCallerReplyResult()` so the provider delivery transcript item includes `artifacts: reply.artifacts` and `metadata.deliveryArtifacts`.
- Update `validateBuyerReplyDeliverable()` so non-text expected output accepts `reply.artifacts` before falling back to text/raw detection.
- Keep the existing refund behavior for missing non-text deliverables.

- [ ] **Step 7: Run caller tests**

Run:

```bash
npm run build && node --test tests/a2a/metawebReplyWaiter.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/core/a2a/protocol/orderProtocol.ts src/core/a2a/metawebReplyWaiter.ts src/core/a2a/conversationTypes.ts src/core/a2a/conversationPersistence.ts src/core/a2a/sessionStateStore.ts src/core/a2a/traceProjection.ts src/daemon/defaultHandlers.ts tests/a2a/metawebReplyWaiter.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/daemon/servicePaymentBoundary.test.mjs
git commit -m "feat: persist A2A delivery artifacts for callers"
```

## Task 4: Trace UI Structured Artifact Rendering

**Files:**
- Modify: `src/ui/pages/trace/viewModel.ts`
- Modify: `src/ui/pages/trace/sseClient.ts`
- Modify: `src/ui/pages/trace/index.html`
- Modify: `tests/ui/traceViewModel.test.mjs`
- Modify: `tests/ui/tracePageScript.test.mjs`

- [ ] **Step 1: Write failing UI/view-model tests**

Add tests that assert:

- `buildSessionDetailViewModel()` exposes `message.deliveryArtifacts` from `item.artifacts`.
- It also accepts fallback `metadata.deliveryArtifacts`.
- `sseClient` renders structured image artifacts even when the message text does not contain a `metafile://...` URI.
- `sseClient` still renders old text-only `metafile://...` image/video/audio/file links.
- structured artifacts are preferred over duplicate text-parsed artifacts.
- video and audio cards include a stable download link even before async playback hydration completes.
- media file names, pin ids, and URLs are escaped before rendering.

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
```

Expected: FAIL because the UI only parses metafile links from message text.

- [ ] **Step 2: Extend the trace view model**

In `src/ui/pages/trace/viewModel.ts`:

- Add a view-model artifact interface matching the shared artifact fields.
- Add `deliveryArtifacts: TraceDeliveryArtifact[]` to `TraceSessionMessage`.
- Coerce artifacts from `item.artifacts`, `item.metadata.deliveryArtifacts`, and `item.metadata.deliveryPayload.artifacts`.
- Do not parse text in the view model; leave text fallback parsing to the browser script for old payloads.

- [ ] **Step 3: Render structured artifacts first**

In `src/ui/pages/trace/sseClient.ts`:

- Replace the local-only metafile model with a normalizer that accepts `msg.deliveryArtifacts`.
- In `renderMessage()`, use structured artifacts first.
- If structured artifacts are empty, fall back to `extractMetafiles(msg.content)`.
- Only strip `metafile://...` text from the rendered markdown when the displayed artifacts came from text fallback.
- Render `kind: 'file'` as a download card. Keep compatibility with the old local `kind: 'download'` only inside the UI normalizer.

- [ ] **Step 4: Add nonblocking video/audio playback hydration**

In `src/ui/pages/trace/sseClient.ts`:

- Render video/audio elements with `data-source-url`, `data-fallback-url`, and `data-download-url`.
- After messages render, call a bounded async hydration function that:
  - fetches the accelerated URL first;
  - falls back to the canonical URL on fetch or non-2xx failure;
  - converts a successful response to a `Blob`;
  - assigns `URL.createObjectURL(blob)` to the media element;
  - leaves the direct download link intact on all failures;
  - revokes old object URLs when a session re-renders.
- Keep text rendering synchronous; media fetch must not block delivery display.

- [ ] **Step 5: Add minimal CSS if needed**

In `src/ui/pages/trace/index.html`, add only the classes needed for:

- media loading/fallback state;
- file download card state;
- stable footer layout.

Do not introduce a new page layout or decorative redesign.

- [ ] **Step 6: Run UI tests**

Run:

```bash
npm run build && node --test tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/ui/pages/trace/viewModel.ts src/ui/pages/trace/sseClient.ts src/ui/pages/trace/index.html tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs
git commit -m "feat: render structured A2A delivery artifacts"
```

## Task 5: Provider Runner Allows Non-Text Candidate Output

**Files:**
- Modify: `src/core/a2a/provider/serviceRunnerContracts.ts`
- Modify: `src/core/a2a/provider/providerServiceRunner.ts`
- Modify: `tests/a2a/providerServiceRunner.test.mjs`

- [ ] **Step 1: Write failing runner tests**

Update the existing test named like `rejects non-text deliverables after session start` so it now asserts:

- an `image` output type with runtime output `/tmp/provider-image.png` completes at the runner layer;
- the result `responseText` is still sanitized;
- result metadata includes `outputType`, `runtimeId`, `sessionId`, and a session/workspace cwd when available;
- fallback runtime is not retried merely because the output type is non-text.

Add a markdown test:

- `outputType: 'markdown'` is treated as text-like and completes.

Run:

```bash
npm run build && node --test tests/a2a/providerServiceRunner.test.mjs
```

Expected: FAIL because the runner still returns `provider_deliverable_invalid`.

- [ ] **Step 2: Extend completed result metadata contract**

In `src/core/a2a/provider/serviceRunnerContracts.ts`, keep `metadata?: Record<string, unknown> | null` and document through tests that completed results may include:

```typescript
{
  outputType?: string;
  sessionCwd?: string | null;
  runtimeId?: string;
  sessionId?: string;
}
```

Do not add signer or upload dependencies to the runner contract.

- [ ] **Step 3: Remove non-text rejection from the runner**

In `src/core/a2a/provider/providerServiceRunner.ts`:

- Treat `markdown` as text-like where text compatibility is checked.
- Remove the `provider_deliverable_invalid` failure block from the runner.
- Return completed output for non-text types and include:
  - `runtimeId`
  - `sessionId`
  - `providerSkill`
  - `outputType`
  - `sessionCwd: session?.cwd ?? null`
  - existing selection/fallback metadata
- Keep empty-result failure behavior unchanged.

- [ ] **Step 4: Run runner tests**

Run:

```bash
npm run build && node --test tests/a2a/providerServiceRunner.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/core/a2a/provider/serviceRunnerContracts.ts src/core/a2a/provider/providerServiceRunner.ts tests/a2a/providerServiceRunner.test.mjs
git commit -m "feat: allow provider runner artifact candidates"
```

## Task 6: Provider Artifact Resolution And Upload Helper

**Files:**
- Create: `src/core/a2a/provider/providerDeliveryArtifacts.ts`
- Create: `tests/a2a/providerDeliveryArtifacts.test.mjs`

- [ ] **Step 1: Write failing provider helper tests**

Create `tests/a2a/providerDeliveryArtifacts.test.mjs` and cover:

- existing `metafile://abc123i0.png` in response text is normalized and reused for an image service.
- existing `metafile://abc123i0.png` reuse calls the injected availability verifier before success.
- existing `metafile://abc123i0.png` verifier failure maps to `provider_artifact_unavailable` and does not return a successful artifact.
- existing `metafile://abc123i0.mp4` fails media validation for an image service.
- explicit local path marker such as `artifactPath: ./out/chart.png` resolves relative to `executionCwd`.
- a bare local path line such as `./out/clip.mp4` resolves when it is the only explicit candidate.
- fallback workspace scan succeeds only when exactly one file matches the requested media family.
- resolution rejects files outside `executionCwd`, including `../outside.png` and symlink escapes.
- resolution rejects secret-like names such as `.env`, `id_rsa`, `wallet.json`, `private-key.txt`, and `mnemonic.txt`.
- local file upload uses an injected uploader with `verify: true`.
- direct small-file upload result becomes one `A2ADeliveryArtifact` and a final response text with no local path.
- uploader failure with code `large_file_upload_unavailable` maps to a provider failure code of the same name.
- files above 50 MiB fail before upload.

Run:

```bash
npm run build && node --test tests/a2a/providerDeliveryArtifacts.test.mjs
```

Expected: FAIL because the provider helper does not exist.

- [ ] **Step 2: Implement media-family helpers**

In `src/core/a2a/provider/providerDeliveryArtifacts.ts`, add:

```typescript
export type ProviderExpectedArtifactFamily = 'text' | 'image' | 'video' | 'audio' | 'file';

export function classifyProviderOutputType(outputType: unknown): ProviderExpectedArtifactFamily;

export function isTextLikeProviderOutputType(outputType: unknown): boolean;
```

Rules:

- empty, `text`, and `markdown` are text-like.
- `image` expects image extensions/content types.
- `video` expects video extensions/content types.
- `audio` expects audio extensions/content types.
- `file`, `attachment`, `other`, and unknown non-text values use generic `file`.

- [ ] **Step 3: Implement candidate resolution**

Add a public helper shaped like:

```typescript
export interface ResolveProviderDeliveryArtifactsInput {
  responseText: string;
  outputType: string | null | undefined;
  executionCwd?: string | null;
  network?: string | null;
  signer: Signer;
  uploadLargeFile?: typeof uploadLargeFileToChain;
  verifyAvailability?: Parameters<typeof uploadLargeFileToChain>[0]['verifyAvailability'];
  largeUploader?: Parameters<typeof uploadLargeFileToChain>[0]['largeUploader'];
}

export interface ResolveProviderDeliveryArtifactsResult {
  responseText: string;
  artifacts: A2ADeliveryArtifact[];
}

export async function resolveProviderDeliveryArtifacts(
  input: ResolveProviderDeliveryArtifactsInput,
): Promise<ResolveProviderDeliveryArtifactsResult>;
```

Resolution order:

1. Valid structured/metafile URI already present in `responseText`.
2. Explicit local path markers in `responseText`: `artifactPath:`, `filePath:`, `outputFile:`, `outputPath:`, `attachment:`.
3. Bare local path lines from `responseText` when the path exists under `executionCwd`.
4. Constrained scan under `executionCwd` when exactly one matching file exists.

Containment rules:

- Require `executionCwd` for local file resolution.
- Compare `fs.realpath()` of the cwd and candidate.
- Reject candidates whose real path is outside the real cwd.
- Never return or summarize a local path to the remote caller.
- Use `verifyAvailability` for both newly uploaded local files and reused `metafile://...` artifacts. If `verifyAvailability` is absent for a reused metafile, call the default `verifyMetafileAvailability({ pinId })`.

- [ ] **Step 4: Implement upload and summary creation**

For a resolved local file:

- call `uploadLargeFileToChain` or the injected `uploadLargeFile`;
- pass `verify: true`;
- pass `network`, `signer`, `largeUploader`, and `verifyAvailability`;
- convert the upload result to `A2ADeliveryArtifact`;
- validate kind against expected media family;
- append a delivery summary with `appendDeliveryArtifactSummaries()`;
- remove local path marker lines from the final response text.

For an existing `metafile://...` URI:

- normalize it to an artifact;
- validate kind against expected media family;
- verify file-indexer/CDN availability through the injected `verifyAvailability` function or the default `verifyMetafileAvailability()` helper;
- fail with `provider_artifact_unavailable` when verification returns `ok: false` or throws;
- leave the URI visible in the final response text;
- do not upload again.

- [ ] **Step 5: Run provider helper tests**

Run:

```bash
npm run build && node --test tests/a2a/providerDeliveryArtifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/core/a2a/provider/providerDeliveryArtifacts.ts tests/a2a/providerDeliveryArtifacts.test.mjs
git commit -m "feat: resolve provider delivery artifacts"
```

## Task 7: Provider Daemon Delivery Closure

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `tests/daemon/servicePaymentBoundary.test.mjs`

- [ ] **Step 1: Write failing provider daemon tests**

Add tests for the local Bot acting as provider:

- text services still send the same delivery result and one `NeedsRating`.
- image service with a generated local `.png` uploads through an injected provider upload function, sends `[DELIVERY:<orderTxid>]` containing a `metafile://...` summary, includes structured `artifacts`, and then sends `[NeedsRating:<orderTxid>]`.
- video service with `.mp4` follows the same path and returns `kind: 'video'`.
- audio service with `.mp3` follows the same path and returns `kind: 'audio'`.
- generic `other` or `file` output returns `kind: 'file'`.
- upload failure before delivery writes an order failure, persists failure trace metadata, requests/refunds where the current paid-order path already does so, and sends no `NeedsRating`.
- `large_file_upload_unavailable` is preserved as the failure code when a file above 2 MiB has no injected large uploader.
- delivery send failure after upload still uses the existing `provider_delivery_failed` path and sends no `NeedsRating`.
- outbound delivery text and raw metadata do not include provider local paths.

Run:

```bash
npm run build && node --test tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: FAIL because provider delivery is still text-only.

- [ ] **Step 2: Add provider upload dependency injection**

In `createDefaultMetabotDaemonHandlers()` input, add optional dependencies for provider artifact delivery:

```typescript
providerArtifactUploadLargeFile?: typeof uploadLargeFileToChain;
providerLargeFileUploader?: ProductionLargeFileUploader;
```

Use defaults:

- `providerArtifactUploadLargeFile ?? uploadLargeFileToChain`
- `providerLargeFileUploader` is optional and may be absent. Absence must keep >2 MiB provider uploads failing with `large_file_upload_unavailable`.

Do not change the public HTTP route contract for `file upload-large`.

- [ ] **Step 3: Resolve/upload artifacts before provider delivery**

In the provider inbound order execution path in `src/daemon/defaultHandlers.ts`, immediately after `runnerResult.state === 'completed'`:

- compute `baseResponseText = normalizeText(runnerResult.responseText)`;
- if output type is text-like, keep current behavior;
- if output type is non-text, call `resolveProviderDeliveryArtifacts()` with:
  - `responseText: baseResponseText`
  - `outputType: service.outputType`
  - `executionCwd` from `runnerResult.metadata?.sessionCwd`
  - provider signer
  - default write network for file upload
  - injected upload function and optional large uploader
  - verification enabled
- on success, use `resolved.responseText` as the delivery result and `resolved.artifacts` as structured payload artifacts;
- on failure, convert the error to a provider runner failed result and use the existing failure/refund persistence path.

- [ ] **Step 4: Include artifacts in outbound delivery and local traces**

Update the provider success path:

- `buildDeliveryMessage()` payload includes `artifacts: deliveryArtifacts`.
- `ratingRequestText` generation receives the final response text with metafile summary.
- provider runner result transcript item includes final response text and `metadata.deliveryArtifacts`.
- provider delivery transcript item includes `artifacts` and `metadata.deliveryArtifacts`.
- `persistA2AConversationMessageBestEffort()` for outgoing delivery passes `message.artifacts`.
- Do not include local file paths in delivery text, payload artifacts, transcript metadata, or conversation raw metadata.

- [ ] **Step 5: Preserve NeedsRating ordering**

Keep the ordering:

1. upload and verify artifact;
2. send `[DELIVERY:<orderTxid>]`;
3. only after delivery send succeeds, send `[NeedsRating:<orderTxid>]`.

If step 1 or 2 fails, no `NeedsRating` is sent.

- [ ] **Step 6: Run provider daemon tests**

Run:

```bash
npm run build && node --test tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Before committing, post a `metabot-post-buzz` development diary. Then run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/servicePaymentBoundary.test.mjs
git commit -m "feat: deliver provider A2A artifacts"
```

## Task 8: Cross-Role Regression And Final Verification

**Files:**
- Modify only files required to fix defects found by the final focused suite.

- [ ] **Step 1: Run the focused artifact delivery suite**

Run:

```bash
npm run build && node --test tests/a2a/deliveryArtifacts.test.mjs tests/a2a/metawebReplyWaiter.test.mjs tests/a2a/traceProjectionUnifiedStore.test.mjs tests/a2a/providerServiceRunner.test.mjs tests/a2a/providerDeliveryArtifacts.test.mjs tests/ui/traceViewModel.test.mjs tests/ui/tracePageScript.test.mjs tests/daemon/servicePaymentBoundary.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run runtime smoke if daemon/runtime files changed**

Run:

```bash
npm run build && node --test --test-concurrency=1 tests/cli/runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run full suite before merge readiness**

This work touches shared A2A runtime behavior, persistence, UI rendering, provider delivery, payment/refund semantics, and chain upload boundaries. Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect branch state**

Run:

```bash
git status --short --branch
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected:

- working tree is clean;
- all commits are small, reviewable, and have corresponding buzz diary posts;
- the commit list includes the earlier large-file foundation plus this provider/caller closure.

- [ ] **Step 5: Final code review**

Dispatch a final code-review subagent with:

- spec: `docs/superpowers/specs/2026-05-26-a2a-delivery-chain-design.md`
- this plan path;
- base SHA before Task 1 of this plan;
- head SHA after Task 8 verification.

Reviewer must check:

- IDBots wire compatibility;
- caller structured/fallback artifact handling;
- provider upload-before-delivery semantics;
- no local path leaks;
- no fake large-file success when `largeUploader` is absent;
- NeedsRating ordering;
- refund/failure behavior.

- [ ] **Step 6: Fix final review issues if any**

If the final reviewer finds Critical or Important issues:

- dispatch a fix subagent with the exact findings;
- run the relevant focused tests again;
- post a buzz diary;
- commit the fix;
- re-run the final code review if the issue affected architecture or cross-role behavior.

- [ ] **Step 7: Do not merge without user approval**

After final review and verification, report:

- completed tasks;
- test evidence;
- remaining product limitation: production chunked uploads above 2 MiB still require an injected OAC-compatible `ProductionLargeFileUploader`;
- branch name and latest commit.

Wait for the user before merging into `main`.
