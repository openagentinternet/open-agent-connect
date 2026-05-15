# MetaBot Loom CLI Design

Date: 2026-05-15
Status: SDD for implementation planning

## Context for the Implementer

This document is written for a future AI development session that does not have the conversation history that produced it. Treat this file as the source of truth for the Loom CLI feature boundary and implementation direction.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, skill documents, and code comments must be written in English.
- New storage must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce code or documentation that depends on the legacy `.metabot/hot` layout.

Protocol source of truth:

- `docs/metaid_protocols/05-loom.md`

Superseded planning note:

- `docs/superpowers/plans/2026-05-15-metabot-loom-cli-prd.md` is historical background only.
- Do not use that PRD as an implementation source. This design and `docs/metaid_protocols/05-loom.md` supersede it.

## Goal

Add a `metabot loom` command group that helps local MetaBots and higher-level skills work with Loom development collaboration protocols without duplicating the existing generic chain write layer.

The command group should provide:

- protocol payload validation;
- export of validated Loom payloads into `metabot chain write` request JSON;
- LLM-assisted task payload drafting;
- raw on-chain Loom protocol synchronization into a global local cache;
- simple task-centric inspection for early verification.

The existing `metabot chain write` command remains the only protocol record write entry point.

## Key Decisions

1. `metabot chain write` is the only chain write entry point for Loom protocol records.
2. `metabot loom` must not add `publish-task`, `publish-claim`, `publish-status`, `publish-delivery`, `publish-acceptance`, or `publish-claim-reject` commands.
3. `metabot loom export-chain-request` exists only to convert a validated Loom payload into the request shape expected by `metabot chain write`.
4. `docs/metaid_protocols/05-loom.md` defines the six protocol payload schemas and must stay authoritative.
5. `loom-claim.payoutAddress` is required and identifies where the requester should pay the developer if that claim is accepted and delivered successfully.
6. Phase 1 intentionally avoids business side effects: no payment execution, no git inspection, no pull request creation, no attachment upload, no optimistic local cache writes after chain writes, and no permission or reference existence checks.
7. Phase 2 should build the business layer: aggregation, validity rules, payment workflow commands, skill-generated payloads, UI, and optional third-party aggregation APIs.

## Layer Model

Loom should be implemented as layered capabilities:

1. **Protocol layer**
   - `docs/metaid_protocols/05-loom.md`
   - Defines payload fields, paths, versions, and content types.

2. **Chain write layer**
   - Existing `metabot chain write`
   - Writes arbitrary MetaID tuples.
   - Owns actor selection through `--from` and chain selection through `--chain`.

3. **Loom helper layer**
   - New `metabot loom validate`
   - New `metabot loom export-chain-request`
   - New `metabot loom draft-task`

4. **Raw index layer**
   - New `metabot loom sync`
   - New global cache under `~/.metabot/loom/`
   - Stores raw indexed records for the six Loom protocol paths.

5. **Light inspection layer**
   - New `metabot loom list`
   - New `metabot loom show`
   - Uses the local raw cache and performs only shallow task-centric grouping.

6. **Business workflow layer**
   - Phase 2.
   - Aggregates task state, validates author relationships, handles payment workflows, and powers UI or skills.

## Phase 1 Scope

Phase 1 creates a thin but useful foundation. It should be safe, deterministic where possible, and easy for skills or humans to compose.

### `metabot loom validate`

Usage:

```bash
metabot loom validate --protocol <task|claim|status|delivery|acceptance|claim-reject> --payload-file <path>
```

Behavior:

- Read the payload JSON file.
- Select the schema for the requested protocol.
- Validate required fields, basic scalar types, enum values, decimal strings, millisecond timestamps, PINID-like references, `metafile://` attachment URI fields, and acceptance payment consistency.
- Return a machine-first command envelope.
- Do not read chain state.
- Do not verify referenced pin IDs exist.
- Do not verify author permissions.
- Do not write chain data.

Successful output shape:

```json
{
  "ok": true,
  "state": "success",
  "data": {
    "protocol": "claim",
    "path": "/protocols/loom-claim",
    "valid": true,
    "payload": {}
  }
}
```

Failure semantics:

- Missing `--protocol` fails with `missing_flag`.
- Unknown protocol fails with `invalid_protocol`.
- Missing `--payload-file` fails with `missing_flag`.
- Invalid payload fails with `invalid_payload` and includes structured validation errors.

### `metabot loom export-chain-request`

Usage:

```bash
metabot loom export-chain-request --protocol <task|claim|status|delivery|acceptance|claim-reject> --payload-file <path> [--out <path>]
```

Behavior:

- Read and validate the protocol payload.
- Build a chain write request that can be used with `metabot chain write --request-file <path>`.
- Do not write chain data.
- Do not accept `--chain`; chain selection belongs to `metabot chain write --chain`.
- Do not accept `--from`; actor selection belongs to `metabot chain write --from`.

Generated request shape:

```json
{
  "operation": "create",
  "path": "/protocols/loom-claim",
  "encryption": "0",
  "version": "1.0.0",
  "contentType": "application/json",
  "payload": "{\"taskPinId\":\"...\",\"payoutAddress\":\"...\"}"
}
```

`payload` must be a string because `src/core/chain/writePin.ts` requires `ChainWriteRequest.payload` to be a string.

Output behavior:

- Without `--out`, return the request object inside the JSON command envelope.
- With `--out`, write the request file and return `{ outPath, protocol, path }`.
- If validation fails, fail with `invalid_payload`.

Example flow:

```bash
metabot loom export-chain-request --protocol claim --payload-file claim.json --out claim-chain-request.json
metabot chain write --from developer-bot --request-file claim-chain-request.json --chain mvc
```

### `metabot loom draft-task`

Usage:

```bash
metabot loom draft-task --wish <text> [--from <bot-slug>] [--allow-invalid]
```

Behavior:

- Resolve the actor selected by `--from`; omit it to use the active MetaBot.
- Use the selected MetaBot's configured preferred or primary LLM runtime.
- Prompt the LLM to output only a `/protocols/loom-task` JSON payload.
- Parse the LLM output as JSON.
- Validate the parsed payload with the same `loom-task` schema used by `validate`.
- Return the draft payload and validation result.
- Do not write chain data.
- Do not export a chain request.
- Do not upload attachments.

Default failure behavior:

- If the LLM runtime is unavailable, fail with `llm_runtime_unavailable`.
- If the LLM output cannot be parsed as JSON, fail with `invalid_llm_output`.
- If the parsed payload fails validation, fail with `invalid_payload`.
- The failure envelope should include raw output and validation errors when safe.

`--allow-invalid` behavior:

- If JSON parsing succeeds but validation fails, return `ok: true` with `valid: false`, the draft payload, and validation errors.
- If JSON parsing fails, still fail with `invalid_llm_output`; there is no payload to edit.

Suggested prompt constraints:

- Output JSON only, no Markdown fences.
- Use `requirementContentType: "text/markdown"` and `criteriaContentType: "text/markdown"` by default.
- Prefer `projectBase: "github"` only when the wish provides a repository or clearly implies one.
- Use conservative placeholder values only when the user did not provide enough detail, and make those placeholders obvious enough for validation to fail unless the user edits them.

### `metabot loom sync`

Usage:

```bash
metabot loom sync [--limit <n>]
```

Behavior:

- Query the chain indexer for all six Loom protocol paths:
  - `/protocols/loom-task`
  - `/protocols/loom-claim`
  - `/protocols/loom-status`
  - `/protocols/loom-delivery`
  - `/protocols/loom-acceptance`
  - `/protocols/loom-claim-reject`
- Store raw indexed rows in the global Loom cache.
- Parse payload JSON when possible and store both parsed payload and the original raw row.
- Do not infer business state.
- Do not drop rows only because payload validation fails; keep invalid rows with validation errors so early protocol mistakes are visible.
- Use `METABOT_CHAIN_API_BASE_URL` when configured, otherwise use the same default chain API base as service discovery.

The initial reader should follow the existing path-list pattern used by the service directory reader:

```text
GET <chainApiBaseUrl>/pin/path/list?path=<protocol-path>&size=<page-size>&cursor=<cursor>
```

Phase 1 can use a small page limit because early Loom record volume should be low. The implementation should keep cursor-aware internals so a later phase can scale without changing the cache format.

### `metabot loom list`

Usage:

```bash
metabot loom list [--refresh] [--limit <n>] [--tag <tag>] [--currency <SPACE|BTC|DOGE|OPCAT>]
```

Behavior:

- Read the local global Loom cache.
- If `--refresh` is present, run the same sync operation first.
- Return a task-centric list based on `/protocols/loom-task` rows.
- Include basic task fields and related record counts.
- Do not output a task `status` or derived business state in Phase 1.
- Do not try to decide which claim, delivery, or acceptance is valid.

Suggested item shape:

```json
{
  "taskPinId": "task-pin-i0",
  "title": "Build a MetaWeb music player",
  "bounty": {
    "amount": "0.001",
    "currency": "BTC"
  },
  "deadline": 1750000000000,
  "tags": ["frontend", "music"],
  "updatedAt": 1750000000000,
  "relatedCounts": {
    "claims": 2,
    "statuses": 4,
    "deliveries": 1,
    "acceptances": 0,
    "claimRejections": 0
  }
}
```

### `metabot loom show`

Usage:

```bash
metabot loom show <taskPinId> [--refresh]
```

Behavior:

- Read the local global Loom cache.
- If `--refresh` is present, run sync first.
- Find the task record by `taskPinId`.
- Return the task raw record and related raw records grouped by protocol.
- Do not output a derived status.
- Do not validate author permissions.
- Do not validate payment transactions.

Suggested output shape:

```json
{
  "task": {},
  "related": {
    "claims": [],
    "statuses": [],
    "deliveries": [],
    "acceptances": [],
    "claimRejections": []
  },
  "validation": {
    "taskValid": true,
    "invalidRelatedRecords": []
  }
}
```

## Global Loom Cache

The cache is public-chain-derived data and should be global, not profile-local.

Recommended paths:

```text
~/.metabot/
  loom/
    records.json
```

This mirrors the existing global service cache pattern under `~/.metabot/services/`.

Recommended state shape:

```json
{
  "version": 1,
  "lastSyncedAt": 1750000000000,
  "chainApiBaseUrl": "https://manapi.metaid.io",
  "protocols": {
    "task": {
      "path": "/protocols/loom-task",
      "lastSyncedAt": 1750000000000,
      "lastError": null,
      "records": []
    },
    "claim": {
      "path": "/protocols/loom-claim",
      "lastSyncedAt": 1750000000000,
      "lastError": null,
      "records": []
    }
  }
}
```

Recommended cached record shape:

```json
{
  "pinId": "txidi0",
  "protocol": "claim",
  "path": "/protocols/loom-claim",
  "operation": "create",
  "contentType": "application/json",
  "timestamp": 1750000000000,
  "creatorAddress": "1...",
  "creatorMetaId": "metaid...",
  "globalMetaId": "idq...",
  "payload": {},
  "payloadValid": true,
  "validationErrors": [],
  "raw": {}
}
```

Cache rules:

- Cache envelopes may store chain metadata such as `pinId`, creator, and timestamp.
- Protocol payloads must not duplicate chain metadata unless the protocol itself defines the field.
- Invalid payloads should remain in the cache for inspection.
- Records should be deduplicated by `pinId`.
- Sorting should prefer newest indexed timestamp first for list views.

## Validation Rules

Phase 1 should implement validation for the six Loom protocols defined in `docs/metaid_protocols/05-loom.md`.

General rules:

- Required fields are present.
- Unknown extra fields may be allowed in Phase 1 unless they conflict with protocol semantics.
- `taskPinId`, `claimPinId`, and `deliveryPinId` are PINID-like strings.
- `deadline` and `estimatedStartAt` are positive millisecond timestamps when present.
- Decimal amounts are strings, not numbers.
- Attachment/process/artifact URI fields use `metafile://...` strings.
- No schema should require chain metadata fields inside payloads.

`loom-task` rules:

- `title`, `requirementContentType`, `requirement`, `criteriaContentType`, `criteria`, `projectBase`, `project`, and `bounty` are required.
- `projectBase` must be a supported value from the protocol document.
- `bounty.currency` must be `SPACE`, `BTC`, `DOGE`, or `OPCAT`.
- `bounty.amount` must be a positive decimal string.

`loom-claim` rules:

- `taskPinId` is required.
- `payoutAddress` is required and non-empty.
- Phase 1 should not validate chain-specific address syntax beyond non-empty string validation.

`loom-status` rules:

- `taskPinId`, `claimPinId`, `status`, and `progressSummary` are required.
- `status` must be `started`, `in_progress`, `completed`, or `failed`.
- `commits[].sha`, `commits[].message`, and `commits[].files` should be validated when present.

`loom-delivery` rules:

- `taskPinId`, `claimPinId`, `deliveryBase`, `deliverySummary`, `delivery`, and `reviewChecklist` are required.
- `deliveryBase` must match the protocol document.
- `reviewChecklist[].status` must be `passed` in Phase 1.

`loom-acceptance` rules:

- `taskPinId`, `deliveryPinId`, `verdict`, `score`, `comment`, and `releasePayment` are required.
- `verdict` must be `passed`, `rejected`, or `revision_needed`.
- `score` must be an integer from 1 to 5.
- If `verdict` is `passed`, then `releasePayment` must be `true` and `paymentTxId` must be a non-empty string.
- If `verdict` is `rejected` or `revision_needed`, then `releasePayment` must be `false` and `paymentTxId` must be absent.
- Phase 1 does not verify the payment transaction exists.

`loom-claim-reject` rules:

- `taskPinId`, `claimPinId`, and `reason` are required.
- Phase 1 does not verify that the writer is the task requester.

## Architecture Notes

Likely files for Phase 1 implementation:

- Create `src/core/loom/protocols.ts` for protocol names, path mapping, and chain request constants.
- Create `src/core/loom/validation.ts` for schema validation and normalized validation errors.
- Create `src/core/loom/chainRequest.ts` for `export-chain-request`.
- Create `src/core/loom/draftTask.ts` for LLM prompt assembly, JSON extraction, and validation handling.
- Create `src/core/loom/rawChainReader.ts` for path-list chain API reads.
- Create `src/core/loom/rawCache.ts` for `~/.metabot/loom/records.json`.
- Create `src/core/loom/taskViews.ts` for `list` and `show` projections.
- Create `src/cli/commands/loom.ts` for CLI parsing.
- Modify `src/cli/main.ts` to dispatch `loom`.
- Modify `src/cli/commandHelp.ts` to document the `loom` group and subcommands.
- Modify `src/cli/types.ts` and `src/cli/runtime.ts` only as needed for dependency injection.

Implementation should prefer the existing patterns from:

- `src/cli/commands/services.ts`
- `src/cli/commands/chain.ts`
- `src/core/discovery/chainDirectoryReader.ts`
- `src/core/discovery/onlineServiceCache.ts`
- `src/core/llm/executor/`

## Phase 2 Scope

Phase 2 should build the Loom business layer on top of Phase 1.

### Aggregation Index

Add a business index that derives task state from raw records:

- open;
- claimed;
- in progress;
- delivered;
- accepted and paid;
- rejected;
- revision needed;
- abandoned or failed.

The aggregator should explicitly decide which records are valid rather than assuming every related raw record is valid.

Examples of Phase 2 validity rules:

- A claim is valid only if it references an existing task and has a payout address.
- A claim rejection is valid only if written by the task requester.
- A delivery is valid only if written by the claimant or accepted developer identity.
- An acceptance is valid only if written by the task requester.
- A paid acceptance is valid only if its payment transaction can be verified or externally trusted by configured policy.

### Workflow Commands

High-level workflow commands may be added after the aggregation index exists. Candidate commands:

```bash
metabot loom claim-and-start ...
metabot loom status-from-git ...
metabot loom deliver-from-pr ...
metabot loom accept-and-pay ...
```

These commands are intentionally out of Phase 1 because they have business side effects.

`accept-and-pay` should:

- select a valid delivery and claim through the aggregator;
- read the claim's `payoutAddress`;
- read the task bounty;
- execute payment through wallet/payment primitives;
- receive a real payment txid;
- build a `loom-acceptance` payload with `releasePayment: true` and `paymentTxId`;
- export or write the acceptance through the existing chain write layer.

### Skill Integration

Phase 2 should provide or update skills that generate Loom payloads from local work:

- read git branch and commits;
- summarize verification output;
- upload process logs or artifacts through `metabot file upload`;
- build `loom-status` and `loom-delivery` payloads;
- call `metabot loom validate` before exporting chain requests.

### UI And Display Layer

Phase 2 may add UI only after the aggregation semantics are stable.

The UI should use the business index, not raw cache heuristics, for:

- task state;
- selected claim;
- delivery readiness;
- acceptance status;
- payment evidence display.

### Third-Party Aggregation API

Phase 2 may optionally support a third-party Loom aggregation API.

The local raw cache should remain useful as:

- a fallback;
- a verification source;
- a local development fixture;
- a way to inspect raw protocol records when API output is disputed.

## Non-Goals

Phase 1 does not:

- add protocol-specific chain write commands;
- replace `metabot chain write`;
- perform payment;
- perform escrow;
- read git state;
- create branches, commits, pull requests, or releases;
- upload attachments;
- call LLMs except for `draft-task`;
- infer task state;
- enforce requester/developer permissions;
- verify referenced pin IDs exist;
- verify payment transaction existence;
- build UI.

## Testing Requirements

### Unit Tests

Add focused tests for:

- protocol path mapping;
- schema validation success and failure for all six protocols;
- `payoutAddress` required for `loom-claim`;
- `loom-acceptance` payment consistency rules;
- chain request export payload stringification;
- raw cache normalization and deduplication;
- task list related counts;
- task show grouping.

### CLI Tests

Add tests under `tests/cli/loom.test.mjs` for:

- `validate` success and invalid payload failure;
- `export-chain-request` envelope output;
- `export-chain-request --out` writes a request file;
- `draft-task` with a fake LLM executor returning valid JSON;
- `draft-task` invalid JSON failure;
- `draft-task --allow-invalid` success with validation errors;
- `sync` with fake chain API rows;
- `list --refresh` invokes sync then projects tasks;
- `show <taskPinId> --refresh` returns grouped records;
- help output for all Loom subcommands.

### Build And Verification

For Phase 1 implementation, a focused verification set should be enough:

```bash
npm run build
node --test tests/cli/loom.test.mjs
node --test tests/loom/*.test.mjs
```

Run broader tests only if implementation touches shared runtime behavior beyond the Loom command, chain reader, LLM executor wiring, or global storage helpers.

## Acceptance Criteria

Phase 1 is complete when:

1. `metabot loom --help` documents the helper/read command group.
2. `metabot loom validate` validates all six Loom payload types.
3. `metabot loom export-chain-request` produces chain write request JSON accepted by `metabot chain write`.
4. `metabot loom draft-task` uses the selected MetaBot's configured LLM runtime and validates the generated task payload.
5. `metabot loom sync` stores raw records for all six Loom protocol paths under `~/.metabot/loom/records.json`.
6. `metabot loom list` returns task rows with related record counts but no derived status.
7. `metabot loom show <taskPinId>` returns the task and related raw records grouped by protocol.
8. No Phase 1 command writes chain data except through user-invoked `metabot chain write`.
9. Targeted build and tests pass.

Phase 2 should not begin until Phase 1's raw cache and validation behavior are stable enough to serve as fixtures for aggregation rules.
