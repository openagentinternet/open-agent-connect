# MetaBot Loom Workflow CLI Design

Date: 2026-05-16
Status: SDD for implementation planning

## Context For The Implementer

This document defines Phase 2 of the MetaBot Loom CLI work. It is written for a future AI development session that does not have the conversation history that produced it.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, SKILL documents, and code comments must be written in English.
- New storage must follow `docs/superpowers/specs/2026-04-23-metabot-storage-layout-v2-design.md`.
- Do not introduce code or documentation that depends on the legacy `.metabot/hot` layout.

Protocol source of truth:

- `docs/metaid_protocols/05-loom.md`

Phase 1 design:

- `docs/superpowers/specs/2026-05-15-metabot-loom-cli-design.md`

Phase 1 implementation plan:

- `docs/superpowers/plans/2026-05-15-metabot-loom-cli-implementation.md`

Superseded planning note:

- `docs/superpowers/plans/2026-05-15-metabot-loom-cli-prd.md` remains historical background only.
- Do not use that PRD as an implementation source.
- For Phase 2, this design and `docs/metaid_protocols/05-loom.md` are authoritative.

## Goal

Build a usable Loom workflow CLI that can run the main development collaboration loop end to end:

1. requester Bot A publishes a development task as `loom-task`;
2. developer Bot B claims the task as `loom-claim`;
3. Bot B prepares a local GitHub fork workspace;
4. Bot B runs one or more explicit development rounds through the configured LLM runtime;
5. each development round commits local changes, uploads process evidence, and writes `loom-status`;
6. Bot B delivers by pushing a fork branch, creating a GitHub pull request, and writing `loom-delivery`;
7. Bot A reviews, pays on acceptance, and writes `loom-acceptance`, or requests revision/rejects through `loom-acceptance`.

The goal is a real runnable vertical slice through CLI. Phase 3 can improve UI, deeper aggregation, search, ranking, dashboards, and third-party aggregation APIs.

## Key Decisions

1. Phase 2 adds workflow commands with real side effects. They may write Loom records on-chain, create local workspaces, run LLM runtimes, run local checks, commit changes, push Git branches, create GitHub pull requests, upload process logs, and execute payments.
2. Workflow commands still reuse existing lower layers. They must not duplicate signer, wallet, file-upload, or LLM runtime infrastructure.
3. `metabot chain write` remains the generic chain-write command, but Phase 2 workflow commands may call the same chain-write dependency internally.
4. `metabot loom export-chain-request` remains available for manual or skill composition, but it is no longer enough for the Phase 2 workflow.
5. The first usable version is command-driven, not daemon-worker-driven. There is no background queue, scheduler, or fully automatic multi-round loop.
6. One development round is one explicit CLI command. A user or higher-level agent can run `run-dev-round` multiple times.
7. The first usable flow should normally produce one or two `loom-status` records: a `started` status from `claim-and-start`, plus an `in_progress` or `completed` status from at least one `run-dev-round`.
8. There is intentionally no `loom-claim-accept` protocol in this phase. A developer can start after publishing a claim. The requester can publish `loom-claim-reject` or reject/revision a delivery later.
9. GitHub delivery uses fork-based pull requests from the beginning. The direct push-to-origin model is not in scope because it is not realistic for open collaboration.
10. The machine running the CLI must have local `git` and `gh` executables. Missing tools produce actionable failures.
11. GitHub authentication is delegated to the local GitHub CLI login state. Missing login produces an actionable failure.
12. LLM development directly modifies the cloned repository. The CLI constrains the LLM working directory to the workflow repository and commits only repository changes.
13. Process logs are uploaded by default for development rounds and started statuses. `loom-status.processLogs` must contain the uploaded `metafile://` evidence URI.
14. Payment is protected. `accept-and-pay` previews without moving funds unless the user passes `--confirm-payment`.
15. Deep aggregation, UI, ranking, search, reputation, and third-party aggregation APIs are Phase 3 concerns.

## Layer Model

Phase 2 extends the existing Phase 1 layers.

1. **Protocol layer**
   - `docs/metaid_protocols/05-loom.md`
   - Defines payload schemas for `loom-task`, `loom-claim`, `loom-status`, `loom-delivery`, `loom-acceptance`, and `loom-claim-reject`.

2. **Chain write layer**
   - Existing chain-write dependency used by `metabot chain write`.
   - Owns MetaID PIN creation and returns `pinId`, `txids`, `network`, and identity metadata.

3. **Wallet layer**
   - Existing wallet transfer dependency used by `metabot wallet transfer`.
   - Owns payment preview and transfer execution.

4. **File upload layer**
   - Existing file upload dependency used by `metabot file upload`.
   - Owns upload of process logs and returns `metafile://...` URIs.

5. **LLM runtime layer**
   - Existing `LlmExecutor`, runtime stores, bindings, and preferred runtime resolution.
   - Executes development prompts in the workflow repository.

6. **Raw index layer**
   - Existing `metabot loom sync`, raw cache reader, and raw cache store.
   - Stores chain-observed Loom records under `~/.metabot/loom/records.json`.

7. **Workflow state layer**
   - New profile-scoped local workflow state.
   - Stores local repository path, branch, fork metadata, round history, LLM session ids, process log paths, uploaded log URIs, PR URL, and chain write results.

8. **Minimal aggregation layer**
   - New task/claim/delivery state projection from raw records plus optimistic workflow writes.
   - Provides only the fields and validity decisions needed by workflow commands.

9. **Workflow CLI layer**
   - New `metabot loom` workflow commands.
   - Coordinates all side effects with explicit command boundaries.

## Command Surface

### `metabot loom post-task`

Usage:

```bash
metabot loom post-task --from <requester-bot> (--payload-file <path> | --wish <text>) --chain <mvc|btc|doge|opcat> [--dry-run]
```

Behavior:

- Resolve the requester actor from `--from`; omit only when existing CLI active-profile behavior is appropriate.
- Accept one source:
  - `--payload-file`: read a `loom-task` payload from disk;
  - `--wish`: use the requester Bot's configured LLM runtime to draft a `loom-task` payload.
- Validate the task payload with the Phase 1 Loom validator.
- Build a Loom chain write request for `/protocols/loom-task`.
- Without `--dry-run`, write the task record through the chain-write dependency.
- With `--dry-run`, return payload, validation, and chain-write request preview without writing chain data.

Successful write output should include:

- `taskPinId`;
- `txids`;
- `network`;
- `payload`;
- `chainRequest`.

### `metabot loom claim-and-start`

Usage:

```bash
metabot loom claim-and-start --from <developer-bot> --task-pin-id <pinId> (--payout-address <address> | --claim-pin-id <pinId>) --chain <mvc|btc|doge|opcat> [--file-chain <mvc|btc|opcat>] [--message <text>] [--dry-run] [--reset-workspace]
```

Behavior:

- Refresh or read local Loom state to resolve the task.
- Require the task to exist and have a valid `loom-task` payload.
- Require `projectBase: "github"` in Phase 2.
- Read `project.repoUri` and `project.baseBranch`.
- Check local `git` and `gh` executables.
- Check `gh auth status`.
- Ensure a fork exists for the repository:
  - reuse an existing fork when available;
  - otherwise create a fork through `gh repo fork <owner/repo> --clone=false`.
- Prepare a pre-claim staging workspace under profile runtime storage.
- Clone or refresh the upstream repository into the staging workspace.
- Add or update a fork remote in the staging workspace.
- In normal mode, build and write a `loom-claim` payload with `taskPinId`, `payoutAddress`, and optional `message`.
- In recovery mode, when `--claim-pin-id` is provided, resolve that existing claim, verify it belongs to the developer actor, and do not write a second claim.
- After `claimPinId` is known, create or reuse the final claim-scoped workflow workspace.
- Move or reuse the staged repository under the final claim-scoped workspace.
- Create or check out a branch named like `loom/<shortTaskPinId>-<shortClaimPinId>`.
- Generate and upload an initialization process log.
- Build and write a `loom-status` payload with:
  - `status: "started"`;
  - `taskPinId`;
  - `claimPinId`;
  - `branchName`;
  - `progressSummary`;
  - `processLogs`.
- Persist workflow state.

`--dry-run` behavior:

- Validate all inputs that can be checked without side effects.
- Return the planned claim payload, status payload, branch name, workspace path, GitHub repository metadata, and chain-write previews.
- Do not create fork, clone, write chain records, upload logs, or create files outside temporary preview data.
- Because no real `claimPinId` exists in dry-run mode, branch and path previews must clearly mark the claim id segment as pending.

`--reset-workspace` behavior:

- Remove only the workflow workspace for the selected task/claim before cloning again.
- It must not remove global cache, profile state, or unrelated workflow directories.
- In normal mode before `claimPinId` exists, reset only the pre-claim staging workspace for the task and current run.
- In recovery mode with `--claim-pin-id`, reset only the final claim-scoped workspace for that task and claim.

Ordering and recovery:

- Fork resolution and staging clone must happen before writing `loom-claim`. This prevents a claim from being written when the machine cannot even prepare the repository.
- The final workspace path and final branch name must not require `claimPinId` before the claim write succeeds.
- If the claim write succeeds but later startup work fails, such as final workspace move, process log upload, or started status write, return `claim_written_start_failed`.
- `claim_written_start_failed` must include `claimPinId`, any local staging/final paths, and a retry command using `--claim-pin-id`.
- Retrying with `--claim-pin-id` must never write a duplicate claim.

### `metabot loom run-dev-round`

Usage:

```bash
metabot loom run-dev-round --from <developer-bot> --task-pin-id <pinId> --claim-pin-id <pinId> --chain <mvc|btc|doge|opcat> [--file-chain <mvc|btc|opcat>] [--check <command> ...] [--round-note <text>]
```

Behavior:

- Resolve task and claim through the minimal aggregation layer.
- Require the executing Bot to be the claim author.
- Require an existing workflow workspace prepared by `claim-and-start`.
- Read task requirement, criteria, project metadata, recent statuses, current branch, and local git status.
- Resolve the developer Bot's healthy LLM runtime.
- Execute the LLM runtime with `cwd` set to the cloned repository path.
- The LLM may directly edit files and run tools within that repository.
- After LLM completion, run each explicit `--check` command from the repository root.
- Capture check command, exit code, stdout/stderr summary, duration, and pass/fail state.
- Inspect git diff.
- If files changed, create one commit for the round.
- If no files changed, do not create an empty commit.
- Generate a process log file for the round.
- Upload the process log through the file upload dependency.
- Build and write a `loom-status` payload containing:
  - `taskPinId`;
  - `claimPinId`;
  - `status`;
  - `progressSummary`;
  - `branchName`;
  - `commits`;
  - `processLogs`.
- Persist round state.

Status selection:

- If the LLM/runtime fails in a way that prevents useful progress, write `status: "failed"` when log upload and chain write remain possible.
- If any check fails, write `status: "in_progress"`.
- If all provided checks pass and there was meaningful implementation progress, write `status: "completed"`.
- If no `--check` flags are provided, write `status: "in_progress"` and clearly mark verification as skipped in the process log and progress summary.
- If no files changed, still write a status when the round produced useful evidence, but the process log must say that no commit was created.

Process log requirements:

- Logs are public once uploaded.
- Logs should include task and claim ids, branch, LLM session id, command summaries, check results, git status, commit summary, and final status decision.
- Logs must be size-capped and should redact common secret patterns such as API tokens, authorization headers, private keys, and mnemonic-like values before upload.
- If process log upload fails, do not write the corresponding `loom-status`; return a failure instead.
- `--chain` selects the Loom protocol record write network.
- `--file-chain` selects the process log upload network.
- When `--file-chain` is omitted, upload logs on the same chain as `--chain` if that chain supports file upload.
- Because the existing file upload path does not support DOGE, `--chain doge` must default process log upload to `mvc` unless the user explicitly selects `--file-chain btc` or `--file-chain opcat`.

### `metabot loom deliver`

Usage:

```bash
metabot loom deliver --from <developer-bot> --task-pin-id <pinId> --claim-pin-id <pinId> --chain <mvc|btc|doge|opcat> [--pr-title <text>] [--delivery-summary <text>] [--dry-run]
```

Behavior:

- Resolve task and claim through the minimal aggregation layer.
- Require the executing Bot to be the claim author.
- Require a prepared workflow workspace and branch.
- Require the latest development round to have passing checks before creating a delivery with all checklist items marked passed.
- Push the workflow branch to the fork remote.
- Create a pull request against the original repository with:
  - base repository from `project.repoUri`;
  - base branch from `project.baseBranch`;
  - head `<forkOwner>:<branchName>`.
- Use `gh pr create`.
- Build a self-check checklist from task criteria:
  - parse Markdown list items when possible;
  - otherwise use one checklist item summarizing the criteria;
  - mark checklist items `passed` only when the latest round checks passed.
- Build and write a `loom-delivery` payload with:
  - `taskPinId`;
  - `claimPinId`;
  - `deliveryBase: "github"`;
  - `deliverySummary`;
  - `delivery.prUrl`;
  - `delivery.prBranch`;
  - `delivery.prBaseBranch`;
  - `delivery.prTitle`;
  - `reviewChecklist`.
- Persist delivery state.

`--dry-run` behavior:

- Return the planned push target, PR metadata, delivery payload, and chain-write preview.
- Do not push, create PRs, or write chain data.

### `metabot loom accept-and-pay`

Usage:

```bash
metabot loom accept-and-pay --from <requester-bot> --task-pin-id <pinId> --delivery-pin-id <pinId> --score <1-5> --comment <text> --chain <mvc|btc|doge|opcat> [--confirm-payment]
```

Behavior:

- Resolve delivery -> claim -> task through the minimal aggregation layer.
- Require the executing Bot to be the task requester.
- Require the task not to already be `accepted_paid`.
- Read `claim.payoutAddress`.
- Read `task.bounty.amount` and `task.bounty.currency`.
- Map payment currency to wallet transfer unit:
  - `SPACE` uses the MVC/SPACE wallet transfer path;
  - `BTC` uses BTC;
  - `DOGE` uses DOGE;
  - `OPCAT` uses OPCAT.
- Without `--confirm-payment`, call the wallet transfer preview path and return `awaiting_confirmation`.
- With `--confirm-payment`, execute the wallet transfer.
- After payment success, write `loom-acceptance` with:
  - `taskPinId`;
  - `deliveryPinId`;
  - `verdict: "passed"`;
  - `score`;
  - `comment`;
  - `releasePayment: true`;
  - `paymentTxId`.
- Persist acceptance and payment state.

Important payment failure rule:

- If payment fails, do not write `loom-acceptance`.
- If payment succeeds but acceptance chain write fails, return `acceptance_write_failed_after_payment` with payment txid, acceptance payload, chain request, and retry guidance.
- The retry path after `acceptance_write_failed_after_payment` must not call `accept-and-pay` again, because that could pay twice.
- The command should persist a retry payload file and chain request file in the requester workflow state directory when possible.
- The returned retry guidance should instruct the caller to publish only the saved acceptance request, for example with `metabot chain write --from <requester-bot> --request-file <saved-request> --chain <chain>`.
- The saved acceptance payload must include the already completed `paymentTxId`.

### `metabot loom review-delivery`

Usage:

```bash
metabot loom review-delivery --from <requester-bot> --task-pin-id <pinId> --delivery-pin-id <pinId> --verdict <rejected|revision_needed> --score <1-5> --comment <text> --chain <mvc|btc|doge|opcat> [--attachment <metafile://...> ...]
```

Behavior:

- Resolve delivery -> claim -> task through the minimal aggregation layer.
- Require the executing Bot to be the task requester.
- Require verdict to be `rejected` or `revision_needed`.
- Do not execute payment.
- Write `loom-acceptance` with:
  - `releasePayment: false`;
  - no `paymentTxId`;
  - `attachments` when provided.
- Persist review state.

### `metabot loom state`

Usage:

```bash
metabot loom state <taskPinId> [--refresh]
```

Behavior:

- Read local raw cache.
- With `--refresh`, run the same raw sync operation as `metabot loom sync` first.
- Build the minimal aggregated task state.
- Return task, valid related records, invalid related records, latest status, latest delivery, acceptance/payment evidence, and local workflow state when present.

## Local Storage

Global raw cache remains:

```text
~/.metabot/loom/records.json
```

Profile-scoped workflow storage is new:

```text
~/.metabot/profiles/<slug>/.runtime/loom/
  workflows/
    <taskPinId>/
      <claimPinId>.json
  staging/
    <taskPinId>/
      <localRunId>/
        repo/
  workspaces/
    <taskPinId>/
      <claimPinId>/
        repo/
  logs/
    <taskPinId>/
      <claimPinId>/
        <roundId>.md
```

Workflow state should contain enough data for the next CLI command to continue without guessing:

```json5
{
  "version": 1,
  "taskPinId": "...",
  "claimPinId": "...",
  "developerMetaBotSlug": "bot-b",
  "requesterGlobalMetaId": "idq...",
  "developerGlobalMetaId": "idq...",
  "repoUri": "https://github.com/requester/repo",
  "baseBranch": "main",
  "upstreamRemote": "origin",
  "forkRemote": "loom-fork",
  "forkRepo": "developer/repo",
  "branchName": "loom/abcd1234-ef567890",
  "workspacePath": "/Users/.../.runtime/loom/workspaces/.../repo",
  "claim": {
    "pinId": "...",
    "txids": []
  },
  "statuses": [
    {
      "roundId": "round-001",
      "status": "started",
      "pinId": "...",
      "processLogPath": "/Users/.../round-001.md",
      "processLogUri": "metafile://...",
      "llmSessionId": null,
      "commits": []
    }
  ],
  "delivery": {
    "pinId": "...",
    "prUrl": "https://github.com/requester/repo/pull/1"
  },
  "acceptance": {
    "pinId": "...",
    "paymentTxId": "..."
  },
  "updatedAt": "2026-05-16T00:00:00.000Z"
}
```

Rules:

- Workflow state is developer-profile scoped.
- Raw cache is global.
- `staging/` is used only before `claimPinId` exists.
- `staging/` entries should be moved into the claim-scoped workspace after claim write succeeds, or cleaned up after recoverable startup failure is resolved.
- Optimistic local records may be appended to the raw cache after successful workflow chain writes so the next command is not blocked by remote indexer latency.
- Optimistic records must be marked as local/optimistic in raw metadata if the cache schema is extended.
- If optimistic append is too invasive for the first implementation task, workflow commands may read their own workflow state first and raw cache second.

## Minimal Aggregation

Phase 2 aggregation exists only to support workflow commands and CLI inspection.

It should:

- group records by `taskPinId`, `claimPinId`, and `deliveryPinId`;
- validate that referenced task, claim, and delivery records exist;
- validate that `loom-claim` has `payoutAddress`;
- validate that `loom-status` and `loom-delivery` were written by the claim author;
- validate that `loom-acceptance` and `loom-claim-reject` were written by the task author;
- derive the current task state;
- expose invalid records with reasons instead of silently ignoring them.

Suggested derived states:

| state | Meaning |
| --- | --- |
| `open` | Valid task exists and has no active claim/status/delivery/acceptance. |
| `claimed` | At least one valid claim exists. |
| `in_progress` | Latest valid status for a valid claim is `started` or `in_progress`. |
| `delivered` | A valid delivery exists and has no later acceptance. |
| `revision_needed` | Latest valid acceptance for a delivery requests revision. |
| `rejected` | Latest valid acceptance rejects a delivery, or the claim was rejected. |
| `accepted_paid` | Latest valid acceptance passed with `releasePayment: true` and `paymentTxId`. |
| `failed` | Latest valid status is `failed`. |

Limitations:

- No reputation scoring.
- No ranking.
- No payment transaction verification beyond local command result and recorded txid.
- No deep dispute engine.
- No UI projection beyond machine-readable CLI JSON.
- No third-party aggregation API.

## GitHub Workflow

Supported project source:

- `projectBase: "github"` only.
- `project.repoUri` must be a GitHub repository URL or owner/repo form that can be normalized for `gh`.
- `project.baseBranch` is required by the protocol validator.

Required local tools:

- `git`;
- `gh`.

Required local auth:

- `gh auth status` must pass before commands that need GitHub side effects.

Fork behavior:

- Prefer existing authenticated user's fork when available.
- Create a fork when absent.
- Clone from upstream into local workspace.
- Add fork remote separately from upstream.
- Push workflow branch to fork remote.
- Create PR against upstream repository.

The implementation may shell out to `git` and `gh` through a small command runner abstraction so tests can inject fake command results.

## LLM Development Contract

The LLM prompt for `run-dev-round` should include:

- task title;
- task requirement;
- acceptance criteria;
- repository path;
- current branch;
- previous status summary;
- explicit check commands;
- instruction to make a focused implementation round;
- instruction to avoid unrelated refactors;
- instruction to leave the repository in a committable state.

The LLM execution request must set:

- `cwd` to the workflow repository path;
- `metaBotSlug` to the developer Bot slug;
- runtime id and runtime selected through existing preferred/primary runtime resolution.

The CLI, not the LLM, owns:

- running final checks after LLM completion;
- deciding whether to commit;
- constructing `loom-status`;
- uploading logs;
- writing chain records.

## Process Evidence

Each started status and development round should upload a process log.

Minimum log sections:

- task and claim identifiers;
- timestamp;
- actor Bot slug and globalMetaId when available;
- repository, branch, upstream repo, fork repo;
- LLM runtime id, provider, session id, and status;
- round note if provided;
- check commands and summarized results;
- git changed files and commit metadata;
- status payload preview;
- chain write result after available.

Logs are public evidence. They must not intentionally include secrets. The implementation should:

- redact obvious secrets before upload;
- cap log size;
- preserve enough context to audit the round;
- store the local pre-upload log path in workflow state.

Process log upload network:

- Protocol record writes use `--chain`.
- Process log file uploads use `--file-chain`.
- `--file-chain` accepts `mvc`, `btc`, and `opcat`, matching current file upload support.
- If `--file-chain` is omitted and `--chain` is `mvc`, `btc`, or `opcat`, use `--chain`.
- If `--file-chain` is omitted and `--chain` is `doge`, use `mvc` for the process log upload and still write the `loom-status` record on DOGE.

## Error Handling

The CLI should return machine-first command envelopes consistent with existing project conventions.

Suggested error codes:

| code | When |
| --- | --- |
| `task_not_found` | The task is absent from raw cache and workflow state. |
| `claim_not_found` | The requested claim cannot be resolved. |
| `delivery_not_found` | The requested delivery cannot be resolved. |
| `invalid_loom_state` | References exist but fail aggregation validity rules. |
| `unsupported_project_base` | Task is not a GitHub project. |
| `tool_missing` | Required local executable such as `git` or `gh` is unavailable. |
| `github_auth_unavailable` | `gh auth status` fails. |
| `github_fork_failed` | Fork create/resolve fails. |
| `git_clone_failed` | Clone/fetch/checkout fails. |
| `git_commit_failed` | Commit creation fails. |
| `github_push_failed` | Push to fork fails. |
| `github_pr_failed` | PR creation fails. |
| `claim_written_start_failed` | Claim write succeeds but final workspace/log/status startup fails. |
| `llm_runtime_unavailable` | No healthy LLM runtime can be resolved. |
| `llm_round_failed` | LLM runtime fails during a development round. |
| `check_failed` | Checks fail when a command requires passing checks. |
| `process_log_upload_failed` | Process log upload fails. |
| `chain_write_failed` | Loom record write fails before any payment. |
| `payment_failed` | Wallet transfer fails. |
| `acceptance_write_failed_after_payment` | Payment succeeds but acceptance chain write fails. |
| `already_accepted_paid` | A task or delivery is already accepted and paid. |
| `permission_denied` | Actor is not the valid requester/developer for the requested action. |

## Negative Boundaries

These cases must be explicit in behavior and tests where practical:

- Missing `git` must fail before fork/clone/write side effects.
- Missing `gh` must fail before GitHub side effects.
- Failed `gh auth status` must fail before GitHub side effects.
- Missing task, claim, or delivery must fail instead of guessing from CLI inputs.
- Non-GitHub task projects must fail in Phase 2.
- Invalid task payloads must not start a workflow.
- Invalid claim payloads must not start a workspace.
- A requester cannot write developer status or delivery records.
- A non-requester cannot write acceptance or claim rejection records.
- A non-claim-author cannot run `run-dev-round` or `deliver` for that claim.
- Fork creation failure must not write a claim or started status.
- Staging clone failure must not write a claim or started status.
- If claim write succeeds and started status fails, retry must use the existing claim id rather than creating a duplicate claim.
- Clone/checkout failure must not write a delivery.
- PR creation failure must not write a delivery.
- LLM runtime unavailability must not create a commit and must not pretend work happened.
- LLM failure should write a failed status only when process log upload and chain write can still complete truthfully.
- Check failures may write `loom-status: in_progress`, but `deliver` must not create a passed checklist from failed checks.
- No git diff should not create an empty commit.
- Process log upload failure must block the corresponding `loom-status` write.
- Payment preview without `--confirm-payment` must not transfer funds.
- Payment failure must not write a passed acceptance.
- Payment success followed by acceptance write failure must return payment txid and retry payload.
- Retrying an acceptance after payment success must publish the saved acceptance payload without performing another wallet transfer.
- Already `accepted_paid` tasks must not be paid again.
- `review-delivery` must never set `releasePayment: true` or include `paymentTxId`.
- `state --refresh` must surface invalid records with reasons rather than silently folding them into valid state.

## Acceptance Criteria

Positive flow:

1. Bot A can publish a valid GitHub-based `loom-task` through `post-task`.
2. Bot B can claim the task through `claim-and-start`.
3. `claim-and-start` creates or resolves a fork, prepares a local workspace, writes `loom-claim`, uploads a started process log, and writes `loom-status: started`.
4. Bot B can run at least one `run-dev-round`.
5. `run-dev-round` invokes the configured LLM runtime in the repository workspace.
6. `run-dev-round` runs explicit `--check` commands after LLM completion.
7. `run-dev-round` commits repository changes when present.
8. `run-dev-round` uploads a process log and writes `loom-status` with `processLogs`.
9. Bot B can deliver through a fork PR.
10. `deliver` pushes to fork, creates a GitHub PR against upstream, and writes `loom-delivery`.
11. Bot A can run `accept-and-pay` without `--confirm-payment` and receive an `awaiting_confirmation` preview.
12. Bot A can run `accept-and-pay --confirm-payment`, transfer bounty funds, and write passed `loom-acceptance` with `paymentTxId`.
13. Bot A can run `review-delivery` with `rejected` or `revision_needed` and write an unpaid `loom-acceptance`.
14. `loom state <taskPinId> --refresh` shows the state transitions and key evidence through the whole flow.

Negative flow:

1. Missing `git` returns `tool_missing`.
2. Missing `gh` returns `tool_missing`.
3. Logged-out GitHub CLI returns `github_auth_unavailable`.
4. Non-GitHub tasks return `unsupported_project_base`.
5. Missing task, claim, or delivery returns the corresponding not-found error.
6. Actor mismatch returns `permission_denied`.
7. Fork, clone, push, or PR failures stop before writing misleading downstream records.
8. Failed checks prevent `deliver` from constructing a passed delivery.
9. Process log upload failure prevents status write.
10. Payment preview never transfers funds.
11. Payment failure never writes a passed acceptance.
12. Acceptance write failure after payment preserves payment txid and retry payload.
13. Already paid work cannot be paid again.
14. Invalid records appear in `loom state` as invalid evidence.

## Non-Goals

Phase 2 does not:

- add `loom-claim-accept`;
- run a daemon worker that automatically claims and completes tasks in the background;
- implement a single long-running command that loops until PR delivery;
- support non-GitHub project bases for automatic development;
- support direct push-to-origin as the main delivery path;
- build UI pages;
- build deep business aggregation, ranking, search, reputation, or dispute workflows;
- verify payment transaction existence independently through a chain explorer;
- support escrow or custody;
- publish `skill-service-rate` for Loom acceptance;
- replace the existing generic `metabot chain write`, `metabot wallet transfer`, or `metabot file upload` commands.

## Suggested Verification Set

Focused local verification for implementation should include:

```bash
npm run build
node --test tests/loom/*.test.mjs
node --test tests/cli/loom.test.mjs tests/cli/help.test.mjs
```

Additional tests should cover workflow core modules with fake command runners, fake chain writes, fake file uploads, fake wallet transfers, and fake LLM execution.

Manual smoke testing should use a small GitHub test repository and two local Bot profiles:

1. Bot A posts a task.
2. Bot B claims and starts.
3. Bot B runs one development round with a simple check.
4. Bot B delivers a fork PR.
5. Bot A previews payment.
6. Bot A confirms payment and acceptance.
7. `loom state --refresh` shows accepted paid state.

## Implementation Planning Notes

The implementation plan should split this into small, independently committable units:

1. workflow state store and path layout;
2. minimal aggregation/state projection;
3. tool runner and GitHub fork workspace preparation;
4. workflow chain write helper;
5. `post-task`;
6. `claim-and-start`;
7. LLM development round runner with logs and commits;
8. process log upload integration;
9. delivery PR creation;
10. acceptance/payment commands;
11. CLI help and parser coverage;
12. final smoke docs.

Each unit should include targeted tests and a commit. Per repository instructions, every commit requires a detailed on-chain development diary through the `metabot-post-buzz` skill.
