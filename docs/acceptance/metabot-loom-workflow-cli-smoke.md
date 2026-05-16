# MetaBot Loom Workflow CLI Smoke Runbook

Use this runbook to smoke test the Phase 2 Loom workflow CLI from task posting
through delivery review. It is written for operators who already intend to run
real test-chain writes. Creating or updating this runbook does not require any
chain write.

## Prerequisites

Prepare these items before starting:

- Two local Bot profiles:
  - requester Bot: `<requester-bot>`
  - developer Bot: `<developer-bot>`
- Test balances for the requester Bot on the bounty payment chain. Keep the
  amount small and use only test funds you are willing to spend.
- Test balance for Loom record writes on the selected record chain
  `<record-chain>`, one of `mvc`, `btc`, `doge`, or `opcat`.
- Test balance for process log file uploads on `<file-chain>`, one of `mvc`,
  `btc`, or `opcat`. DOGE is not supported for file upload.
- `git` installed and available on `PATH`.
- `gh` installed and available on `PATH`.
- GitHub CLI authenticated:

```bash
git --version
gh --version
gh auth status
```

- A small GitHub test repository that the requester owns or can accept pull
  requests against:
  - repo URI: `<repo-uri>`, for example `https://github.com/<owner>/<repo>`
  - base branch: `<base-branch>`, for example `main`
  - the developer GitHub account can fork the repository

## Placeholders

Replace these placeholders throughout the runbook:

```bash
REQUESTER_BOT="<requester-bot>"
DEVELOPER_BOT="<developer-bot>"
RECORD_CHAIN="<mvc|btc|doge|opcat>"
FILE_CHAIN="<mvc|btc|opcat>"
REPO_URI="<https://github.com/owner/small-test-repo>"
BASE_BRANCH="<base-branch>"
TASK_PAYLOAD="<path/to/loom-task.json>"
TASK_PIN_ID="<task-pin-id>"
CLAIM_PIN_ID="<claim-pin-id>"
DELIVERY_PIN_ID="<delivery-pin-id>"
DEVELOPER_PAYOUT_ADDRESS="<developer-payout-address>"
```

## Task Payload

Create a small Loom task payload for the GitHub test repository. Keep the
requirements intentionally tiny so the smoke can finish quickly.

```json
{
  "title": "Smoke: add a tiny Loom workflow change",
  "requirementContentType": "text/markdown",
  "requirement": "## Requirement\n\nAdd or update one small text fixture in the GitHub test repository and verify the repository still builds or runs its lightweight check.",
  "criteriaContentType": "text/markdown",
  "criteria": "## Acceptance criteria\n\n- The pull request targets the configured base branch.\n- The requested lightweight check passes.\n- The delivery summary names the changed file.",
  "projectBase": "github",
  "project": {
    "repoUri": "<repo-uri>",
    "baseBranch": "<base-branch>"
  },
  "bounty": {
    "amount": "0.000001",
    "currency": "SPACE"
  },
  "tags": ["smoke", "loom-cli"]
}
```

Save it to `$TASK_PAYLOAD`, then replace `<repo-uri>` and `<base-branch>`.

## Phase 2 Happy Path

Post the task. This writes a `/protocols/loom-task` record unless the operator
adds `--dry-run`.

```bash
metabot loom post-task \
  --from "$REQUESTER_BOT" \
  --payload-file "$TASK_PAYLOAD" \
  --chain "$RECORD_CHAIN"
```

Record the returned task PIN id:

```bash
TASK_PIN_ID="<task-pin-id>"
```

Claim the task and prepare the developer workspace. This checks local GitHub
tooling, forks or reuses the fork, prepares the local workflow workspace, writes
the claim, uploads the startup process log, and writes the started status.

```bash
metabot loom claim-and-start \
  --from "$DEVELOPER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --payout-address "$DEVELOPER_PAYOUT_ADDRESS" \
  --chain "$RECORD_CHAIN" \
  --file-chain "$FILE_CHAIN" \
  --message "Claiming the Loom CLI smoke task."
```

Record the returned claim PIN id:

```bash
CLAIM_PIN_ID="<claim-pin-id>"
```

Run one development round. Use the smallest meaningful repository check.

```bash
metabot loom run-dev-round \
  --from "$DEVELOPER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --claim-pin-id "$CLAIM_PIN_ID" \
  --chain "$RECORD_CHAIN" \
  --file-chain "$FILE_CHAIN" \
  --check "<lightweight-check-command>" \
  --round-note "Smoke development round."
```

Deliver the work. This pushes the workflow branch to the developer fork,
creates a GitHub pull request, and writes a `/protocols/loom-delivery` record.

```bash
metabot loom deliver \
  --from "$DEVELOPER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --claim-pin-id "$CLAIM_PIN_ID" \
  --chain "$RECORD_CHAIN" \
  --pr-title "Smoke: Loom workflow CLI delivery" \
  --delivery-summary "Completed the tiny smoke task and passed the configured check."
```

Record the returned delivery PIN id:

```bash
DELIVERY_PIN_ID="<delivery-pin-id>"
```

Preview acceptance and payment first. This must not move funds because
`--confirm-payment` is omitted.

```bash
metabot loom accept-and-pay \
  --from "$REQUESTER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --delivery-pin-id "$DELIVERY_PIN_ID" \
  --score 5 \
  --comment "Accepted after smoke verification." \
  --chain "$RECORD_CHAIN"
```

Expected result:

- command returns an awaiting-confirmation or preview-style result
- no payment transaction id is broadcast
- no `/protocols/loom-acceptance` record is written

Confirm payment only after the preview is correct.

```bash
metabot loom accept-and-pay \
  --from "$REQUESTER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --delivery-pin-id "$DELIVERY_PIN_ID" \
  --score 5 \
  --comment "Accepted after smoke verification." \
  --chain "$RECORD_CHAIN" \
  --confirm-payment
```

Inspect the final derived state.

```bash
metabot loom state "$TASK_PIN_ID" --refresh
```

Expected result:

- task is accepted and paid
- acceptance includes `paymentTxId`
- latest delivery points at the GitHub pull request
- workflow state includes the claim branch and process log evidence

## Negative Smoke Checks

Run these checks in a disposable smoke session. Prefer placeholder ids that
belong to the same smoke task so the state checks are meaningful.

### Accept Without Payment Confirmation

Run the acceptance command without `--confirm-payment`:

```bash
metabot loom accept-and-pay \
  --from "$REQUESTER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --delivery-pin-id "$DELIVERY_PIN_ID" \
  --score 5 \
  --comment "Preview only; do not pay." \
  --chain "$RECORD_CHAIN"
```

Pass criteria:

- the result indicates payment is not confirmed yet
- the result does not include a real payment transaction id
- wallet balance does not decrease beyond normal read/write fee behavior
- `metabot loom state "$TASK_PIN_ID" --refresh` does not show an accepted-paid
  state from this preview command

### Invalid File Upload Chain

Run a parser-level failure check with DOGE as the file-upload chain. This should
fail before any process log upload or chain write.

```bash
metabot loom claim-and-start \
  --from "$DEVELOPER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --payout-address "$DEVELOPER_PAYOUT_ADDRESS" \
  --chain "$RECORD_CHAIN" \
  --file-chain doge \
  --dry-run
```

Pass criteria:

- command exits non-zero
- result code is `invalid_flag`
- message says DOGE is not supported for file upload
- no claim, status, file upload, workspace reset, or GitHub operation occurs

### Missing GitHub CLI

Check local tooling before workflow commands that touch GitHub:

```bash
command -v git
command -v gh
gh auth status
```

Pass criteria:

- `command -v git` prints a path
- `command -v gh` prints a path
- `gh auth status` exits zero for the account that should own or fork the test
  repository

If `gh` is missing, install GitHub CLI and rerun the checks. If `gh auth status`
is logged out or fails, run the normal GitHub CLI login flow and rerun:

```bash
gh auth login
gh auth status
```

For a practical workflow failure smoke, start from a shell where `gh` is absent
from `PATH`, then run:

```bash
METABOT_BIN="$(command -v metabot)"
NODE_BIN="$(command -v node)"
SMOKE_BIN="$(mktemp -d "${TMPDIR:-/tmp}/loom-smoke-bin.XXXXXX")"
trap 'rm -rf "$SMOKE_BIN"' EXIT
ln -s "$METABOT_BIN" "$SMOKE_BIN/metabot"
ln -s "$NODE_BIN" "$SMOKE_BIN/node"

PATH="$SMOKE_BIN:/usr/bin:/bin" metabot loom claim-and-start \
  --from "$DEVELOPER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --payout-address "$DEVELOPER_PAYOUT_ADDRESS" \
  --chain "$RECORD_CHAIN" \
  --file-chain "$FILE_CHAIN" \
  --dry-run
```

Pass criteria:

- command fails before claim write
- result reports GitHub tooling or authentication as unavailable
- no claim PIN id is created
- no workflow payment or delivery side effect occurs

## Optional Negative Review Path

Use this path instead of `accept-and-pay` when validating a rejected or
revision-needed delivery. It must not pay the developer.

```bash
metabot loom review-delivery \
  --from "$REQUESTER_BOT" \
  --task-pin-id "$TASK_PIN_ID" \
  --delivery-pin-id "$DELIVERY_PIN_ID" \
  --verdict revision_needed \
  --score 2 \
  --comment "Please adjust the smoke task and deliver again." \
  --chain "$RECORD_CHAIN"
```

Expected result:

- a `/protocols/loom-acceptance` review record is written with
  `releasePayment: false`
- no `paymentTxId` is present
- `metabot loom state "$TASK_PIN_ID" --refresh` shows the review outcome

## Cleanup Notes

After the smoke:

- close or merge the test pull request according to the repository policy
- delete disposable test branches and forks only when they are no longer needed
- keep the task, claim, status, delivery, and acceptance PIN ids in the smoke
  report
- record the final output of `metabot loom state "$TASK_PIN_ID" --refresh`
