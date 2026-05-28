# A2A Delivery Chain Design

Date: 2026-05-26
Status: Spec for implementation planning

## Context for the Implementer

This document is written for a future AI development session that may not have the conversation history that produced it. Treat this file as the product and engineering boundary for completing Open Agent Connect A2A delivery across text, image, video, audio, and generic file artifacts.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Current feature worktree when this spec was authored: `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/a2a-media-delivery`
- Dedicated branch: `codex/a2a-media-delivery`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, skill documents, and code comments must be written in English.
- Do not introduce new code or documentation that depends on the legacy `.metabot/hot` layout.

Reference implementation:

- IDBots workspace: `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots`
- OAC should copy the relevant IDBots product semantics and protocol behavior, but it should keep OAC's storage layout, runtime abstractions, daemon routes, and trace UI architecture.

## Goal

Complete the A2A delivery chain so a local Bot can reliably act as either:

- a caller that requests remote skill services and receives text, images, videos, audio, and generic files; or
- a provider that executes a requested skill service, uploads non-text artifacts to MetaWeb first, and then delivers durable `metafile://...` results to the caller.

The finished product should make artifact-bearing skill services feel first-class rather than text responses with accidental links.

## Non-Goals

- Do not redesign the A2A order protocol tags.
- Do not replace the existing per-peer `.runtime/A2A` conversation store.
- Do not introduce a new chain storage layout outside the current MetaBot storage layout v2.
- Do not make local file paths visible to remote callers.
- Do not silently deliver non-text local artifacts before upload verification.
- Do not use the legacy `.metabot/hot` layout for any new skill, cache, upload state, or artifact metadata.

## Product Semantics

### Provider-Side Contract

When the local Bot is the provider, the order's `outputType` determines the delivery contract:

- `text` or `markdown`: deliver sanitized text exactly as the current provider path does.
- `image`: resolve a real local image artifact, upload it to MetaWeb, verify CDN/file-indexer availability, and include a `metafile://<pinId><ext>` URI in the delivery result.
- `video`: resolve a real local video artifact, upload it to MetaWeb, verify availability, and include a `metafile://<pinId><ext>` URI in the delivery result.
- `audio`: resolve a real local audio artifact, upload it to MetaWeb, verify availability, and include a `metafile://<pinId><ext>` URI in the delivery result.
- `file`, `attachment`, `other`, or unknown non-text output types: resolve a real local file artifact, upload it to MetaWeb, verify availability, and include a `metafile://<pinId><ext>` URI in the delivery result.

Provider delivery for non-text artifacts is not complete until the provider has:

1. found exactly the deliverable artifact expected by the service output type;
2. validated that the file exists, is readable, and matches the broad expected media family;
3. uploaded the artifact, using direct upload for small files and a chunked large-file path where needed;
4. received a `pinId` and `metafile://...` URI;
5. verified the uploaded file can be resolved through the file indexer/CDN path or acceptable fallback path;
6. built a human-readable delivery summary that includes the `metafile://...` URI, pin id, file name, content type, size, and download URL;
7. sent `[DELIVERY:<orderTxid>]` with a backward-compatible `result` string containing the summary; and
8. sent `[NeedsRating:<orderTxid>]` only after the delivery message succeeds.

If artifact resolution or upload fails after paid execution has started, the provider must not pretend the order succeeded. It should move through the existing failure/refund path with a precise failure code.

### Caller-Side Contract

When the local Bot is the caller, it must accept delivery from compatible providers that may only embed artifact metadata in the text result. Caller handling must:

- continue accepting plain text and markdown deliveries;
- parse every `metafile://...` URI from the delivery result;
- classify artifacts by extension and content type where available;
- render image previews inline;
- render audio controls inline;
- render video controls inline;
- provide a stable download affordance for generic files and attachments;
- avoid showing raw local provider paths;
- preserve the original result text around artifact summaries; and
- keep rating flow, trace projection, polling, and timeout behavior compatible with text-only orders.

For video and audio, the caller should prefer asynchronous fetch from the file-indexer/CDN accelerated content URL, fall back to the canonical content URL, and use object URLs when the browser/runtime needs a local blob to play reliably.

### Cross-Role Compatibility

The provider and caller implementations should share artifact parsing, classification, URI construction, source URL construction, and validation helpers so that OAC does not drift between "what it sends" and "what it can receive".

The A2A wire protocol must remain IDBots-compatible:

- keep `[DELIVERY:<orderTxid>]` as the message envelope;
- keep the JSON `result` field as the compatibility source of truth;
- allow additional structured artifact fields only as optional enhancements that older peers can ignore;
- keep `metafile://<pinId><ext>` visible inside `result` for older IDBots-style callers; and
- keep caller-side parsing tolerant of providers that do not send structured fields.

## IDBots Reference Semantics

The IDBots implementation already contains the main product behavior OAC should mirror.

Provider path:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/privateChatOrderCowork.ts`
  - resolves non-text artifacts before final delivery;
  - uploads image/video/audio/other deliverables before telling the caller;
  - fails/refunds when the artifact is missing, invalid, or upload support is unavailable;
  - sends an upload notice before upload for long-running media work;
  - builds the final delivery text by combining the skill reply and a metafile summary.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/serviceDeliveryArtifacts.js`
  - resolves service delivery artifacts from the workspace;
  - builds a delivery summary containing `metafile://...`, pin id, file name, content type, size, and download URL;
  - verifies CDN/file-indexer availability with retry;
  - accepts expected media families by extension.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/SKILL.md`
  - defines small direct upload and larger chunked upload semantics;
  - uses MVC for chunked upload;
  - caps large uploads at a product-defined maximum.

Caller/UI path:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/renderer/components/cowork/A2AMessageItem.tsx`
  - extracts `metafile://...` URIs from delivery text;
  - renders image, video, audio, and download cards;
  - asynchronously fetches video/audio media from file-indexer/CDN paths and falls back when needed.

## Current OAC Evidence

OAC already has several reusable pieces:

- `src/core/files/uploadFile.ts`
  - supports MIME inference for common images, video, audio, documents, archives, and text files;
  - uploads one local file through a single `/file` pin write;
  - returns `pinId`, `txids`, `contentType`, byte length, and `metafileUri`.
- `SKILLs/metabot-upload-file/SKILL.md`
  - exposes the shared direct file upload flow to agents.
- `src/ui/pages/trace/sseClient.ts`
  - extracts `metafile://...` URIs from rendered message content;
  - classifies images, videos, audio, and downloads by extension;
  - renders image/video/audio/download previews in the trace page.
- `src/daemon/routes/file.ts`
  - has file-indexer proxy route logic that can resolve `metafile://...` and known file-indexer paths.
- `src/ui/metaapps/chat/idframework/components/id-attachments.js`
  - has chat attachment rendering patterns that can be reused or aligned with A2A trace rendering.

OAC also has clear gaps:

- `src/core/a2a/provider/providerServiceRunner.ts`
  - currently rejects every non-text output type with `provider_deliverable_invalid`.
- `src/daemon/defaultHandlers.ts`
  - currently builds provider delivery messages from text `responseText` only.
- `src/core/a2a/metawebReplyWaiter.ts`
  - currently completes caller polling from `delivery.result` text and stores `responseText`, but does not surface structured artifact metadata.
- `src/core/a2a/traceProjection.ts`
  - currently projects text delivery and pin metadata, but not first-class delivery artifacts.
- `src/core/a2a/conversationTypes.ts`
  - currently stores scalar message metadata, not a normalized artifact array.
- There is no `SKILLs/metabot-upload-largefile/SKILL.md` in OAC.
- There is no reusable A2A artifact helper equivalent to IDBots `serviceDeliveryArtifacts.js`.
- Trace rendering can display `metafile://...` embedded in text, but the caller pipeline does not yet guarantee that video/audio/file artifacts are parsed, stored, fetched, retried, and presented as delivery artifacts.

## Delivery Data Model

Introduce a shared artifact model that can be used by provider upload, caller parsing, storage, trace projection, and UI rendering.

Suggested TypeScript shape:

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

export interface A2ADeliveryPayload {
  result: string;
  artifacts: A2ADeliveryArtifact[];
}
```

Provider-only local fields such as `localPath` should stay in transient provider resolution objects and must not be persisted in caller-visible delivery payloads.

The wire payload can remain backward compatible:

```json
{
  "paymentTxid": "<payment txid>",
  "servicePinId": "<service pin id>",
  "result": "Done.\n\nmetafile://<pinId>.mp4\nPINID: <pinId>\n...",
  "artifacts": [
    {
      "uri": "metafile://<pinId>.mp4",
      "pinId": "<pinId>",
      "kind": "video",
      "fileName": "clip.mp4",
      "extension": ".mp4",
      "contentType": "video/mp4",
      "byteLength": 123456,
      "sourceUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/<pinId>",
      "fallbackUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/content/<pinId>",
      "downloadUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/<pinId>"
    }
  ]
}
```

Older peers can ignore `artifacts`; newer OAC callers should prefer structured artifacts when present and fall back to parsing `result`.

## Upload Model

OAC should introduce a large-file upload layer rather than overloading `uploadLocalFileToChain`.

Required behavior:

- direct upload for files at or below the small-file threshold;
- chunked upload for files above that threshold;
- a clear 50 MiB hard cap for product safety;
- deterministic content type and extension inference;
- consistent `metafile://<pinId><ext>` return value;
- upload result verification through accelerated and canonical file-indexer URLs;
- retry with bounded backoff for indexer propagation; and
- precise error codes for unsupported network, oversized file, missing wallet, upload failure, and verification timeout.

The public skill should be:

- `SKILLs/metabot-upload-largefile/SKILL.md`
- `skills/metabot-upload-largefile/SKILL.md`
- packaged into shared skillpacks when the implementation reaches packaging.

The skill should use the same CLI/runtime boundary as existing upload skills and should prefer JSON outputs so provider code and agents can consume it predictably.

## Provider Artifact Resolution

Provider code needs a resolver that can identify the actual artifact produced by a skill run. The resolver should not depend on one platform's transcript format only.

Acceptable provider artifact hints:

- structured runtime metadata in the executor session result;
- explicit local path markers emitted by a skill;
- known generated file outputs in the LLM session workspace;
- a `metafile://...` URI if the skill already uploaded its output;
- a final delivery summary from a skill that follows the OAC artifact contract.

Resolution order should prefer explicit structured hints over filesystem guessing. Filesystem scanning should be constrained to the execution workspace and the current session to avoid accidental leaks.

If the skill already returns a verified `metafile://...` artifact, provider code may reuse it after verifying that it matches the expected output type and is reachable.

## Caller Rendering Model

The trace UI already has basic `metafile://...` rendering, but product-grade A2A delivery requires tightening the caller path:

- parse delivery artifacts in the caller lifecycle, not only in the final browser renderer;
- store normalized artifacts in `.runtime/A2A` messages;
- project artifacts into trace session details;
- render structured artifacts first, then fallback parsed artifacts from text;
- provide retry/fallback behavior for CDN playback;
- avoid blocking text delivery while video/audio fetch is still in progress; and
- keep download links stable even when preview playback fails.

The UI should continue to work for old messages that only contain a text `metafile://...` URI.

## Failure And Refund Semantics

Provider failure conditions that should prevent successful delivery:

- non-text output type requested but no artifact can be found;
- resolved artifact is outside the allowed execution workspace;
- resolved artifact is unreadable;
- resolved artifact media family does not match the requested `outputType`;
- artifact exceeds the maximum upload size;
- upload cannot obtain a pin id;
- file-indexer verification times out;
- delivery private message send fails after upload.

Failure behavior:

- persist the provider failure code and human-readable reason;
- send a failure/status notice if the A2A channel is available;
- enter the existing refund path for paid orders;
- never send a successful `[NeedsRating]` for a failed artifact delivery;
- keep enough local metadata for the provider operator to inspect the failure.

Caller failure conditions:

- if a delivery contains an artifact URI but preview fetching fails, keep the delivery completed and show a download fallback;
- if parsing structured artifacts fails, fall back to parsing `result`;
- if all media URLs fail, preserve the text and pin id so the user can retry manually.

## Security And Privacy

- Never include provider local paths in outbound delivery text.
- Never scan outside the session workspace when resolving artifacts.
- Never upload files named like secrets, env files, wallets, private keys, or credentials unless the user explicitly requested a file-upload skill service and the file passes existing privacy gates.
- Store provider-only local artifact paths only in provider-local runtime state if needed for debugging.
- Treat remote `metafile://...` links as untrusted input until parsed and normalized.
- Escape all rendered file names and pin ids in the UI.

## Acceptance Criteria

Provider side:

- A text service still delivers exactly as before.
- An image service uploads the image, verifies it, sends `metafile://...`, and renders on an OAC caller.
- A video service uploads the video, verifies it, sends `metafile://...`, and plays or downloads on an OAC caller.
- An audio service uploads the audio, verifies it, sends `metafile://...`, and plays or downloads on an OAC caller.
- A generic file service uploads the file, verifies it, sends `metafile://...`, and presents a download card on an OAC caller.
- Missing or invalid provider artifacts enter the failure/refund path instead of producing fake success.

Caller side:

- Existing IDBots-style text deliveries still complete.
- Existing IDBots-style `metafile://...` image/video/audio/file deliveries render in trace/session UI.
- Structured `artifacts` payloads are parsed and stored when present.
- The user can still rate completed artifact-bearing orders.
- Trace watch and CLI polling surface response text without losing artifact URIs.

Packaging:

- `metabot-upload-largefile` is present in source skills, shared skills, and generated skillpacks after the packaging task.
- Build and targeted tests pass.
- Full `npm test` is run before final merge because this work touches shared runtime behavior, chain writes, file upload, persistence, UI rendering, and package artifacts.
