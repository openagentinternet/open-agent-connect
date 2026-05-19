# MetaBot Loom Dashboard UI Smoke Runbook

Use this runbook to smoke test the Phase 3 Loom dashboard CLI, daemon API, and
local board UI after a real or cached Phase 2 Loom workflow exists. The
dashboard is read-first: it can refresh local Loom records and render CLI
handoffs, but it must not perform browser-side chain writes, wallet payments,
GitHub mutations, or local repository mutations.

## Prerequisites

Prepare these items before starting:

- Two local Bot profiles:
  - requester Bot: `<requester-bot>`
  - developer Bot: `<developer-bot>`
- A Phase 2 Loom smoke task, either reused from a previous run or created with
  `docs/acceptance/metabot-loom-workflow-cli-smoke.md`.
- The task should have enough records to exercise the board:
  - `/protocols/loom-task`
  - `/protocols/loom-claim`
  - at least one `/protocols/loom-status`
  - `/protocols/loom-delivery` with a GitHub pull request URL
  - either an acceptance with `releasePayment: true` and `paymentTxId`, or a
    negative review with `releasePayment: false`
- The requester and developer profiles should have names and avatars when
  possible. Keep one fallback case available, such as a Bot with no avatar or
  no display name, so fallback initials and compact IDs can be checked.
- A local daemon/UI environment that can serve the built UI.
- `metabot` available on `PATH`, or use `node dist/cli/main.js` from this repo.

## Placeholders

Replace these placeholders throughout the runbook:

```bash
REQUESTER_BOT="<requester-bot>"
DEVELOPER_BOT="<developer-bot>"
TASK_PIN_ID="<task-pin-id>"
DELIVERY_PIN_ID="<delivery-pin-id>"
```

## Prepare Or Reuse Phase 2 Evidence

Reuse an existing Phase 2 E2E task when possible. Confirm the task has current
derived state:

```bash
metabot loom state "$TASK_PIN_ID" --refresh
```

If no suitable task exists, run the Phase 2 smoke checklist through delivery,
then choose one of these endings:

- accepted and paid, using `metabot loom accept-and-pay --confirm-payment`
- revision needed or rejected, using `metabot loom review-delivery`

Keep the task PIN id, delivery PIN id, requester Bot slug, developer Bot slug,
pull request URL, and payment transaction id or negative review PIN id in the
smoke notes.

## Refresh The Dashboard Index

Refresh the local raw Loom cache and dashboard index from the requester actor:

```bash
metabot loom dashboard --from "$REQUESTER_BOT" --refresh --json
```

Repeat from the developer actor:

```bash
metabot loom dashboard --from "$DEVELOPER_BOT" --refresh --json
```

Pass criteria:

- command exits zero
- JSON includes `summary`, `columns`, `tasks`, `details`, `warnings`, `actor`,
  and `refresh`
- `actor.profileSlug` matches the `--from` value
- the smoke task appears in `tasks`
- the task detail includes the task, claim, status, delivery, and acceptance or
  review timeline records
- the pull request URL is present for delivered or later states
- an accepted-paid task shows `paymentTxId`
- a revision-needed, rejected, or failed task does not pretend payment was
  released
- `summary.invalidRecords` matches any intentionally injected invalid smoke
  records

If refresh fails because the chain API is unavailable, the dashboard may still
return cached data. Pass the stale fallback only when:

- `refresh.succeeded` is false or a warning is present
- stale data is clearly marked in the CLI JSON and UI
- previously cached tasks remain readable
- the operator can rerun with `--refresh` after connectivity returns

## Open The Loom Board

Open the board for the requester:

```bash
metabot ui open --page loom --from "$REQUESTER_BOT"
```

Open the returned URL in the browser. Repeat for the developer actor:

```bash
metabot ui open --page loom --from "$DEVELOPER_BOT"
```

Pass criteria:

- the URL points at `/ui/loom` and includes the selected actor when `--from` is
  supplied
- the toolbar shows the selected actor and latest refresh state
- the board loads without JavaScript errors
- refresh, filters, task selection, copy buttons, and PR links are usable

## Expected Board State

Check the board visually at desktop width and a narrow/mobile width.

Pass criteria:

- columns render in the stable board order: Open, Claimed, Working, Review,
  Revision, and Closed
- cards stay compact; titles, repo labels, bounty labels, state badges, warning
  counts, and Bot chips do not overlap or resize the layout unexpectedly
- requester and developer Bot names and avatars appear when identity data is
  available
- fallback initials and short Bot IDs appear when a name or avatar is missing
- actor-sensitive labels change when reopening with requester versus developer
  `--from` values
- accepted-paid tasks appear in Closed with a PR link and payment transaction
  evidence
- revision-needed, rejected, and failed tasks appear in the correct non-payment
  state
- the detail panel shows requirements, criteria, claims, local workflow
  evidence, timeline events, warnings, and raw record evidence
- timeline events are ordered and labeled by protocol kind
- warning blocks are visible near the affected task and in the detail panel
- PR links open the GitHub pull request in a new browser context or tab
- copy buttons copy full PIN ids, globalMetaIds, addresses, payment txids, and
  CLI handoff commands
- filter controls for state, role, and query reload the board and preserve the
  selected actor
- the refresh control posts the selected actor and updates the stale/fresh
  refresh indicator

## CLI Handoff Checks

The UI should provide command handoffs for high-risk actions instead of running
them in the browser. Confirm the detail panel shows shell-safe commands such as:

```bash
metabot loom state "$TASK_PIN_ID" --refresh
metabot loom dashboard --from "$REQUESTER_BOT" --refresh --json
```

When an actor contains shell-sensitive text, copied handoff commands must quote
the `--from` value instead of allowing flag injection.

Pass criteria:

- accept/pay remains a CLI workflow, not a browser button that pays funds
- handoff commands include the current actor with `--from` when one is selected
- copied commands preserve the exact task PIN id and actor value

## Negative Checks

Run these checks in a disposable smoke session or against a local cache fixture.

### Invalid Or Unsafe Records

Add or reuse records that the dashboard should reject or warn about, such as:

- a status record that references an unknown claim
- an acceptance record with `releasePayment: true` but no `paymentTxId`
- a delivery record with an invalid or missing task reference
- a malformed payload that fails Loom protocol validation

Refresh and open the board:

```bash
metabot loom dashboard --from "$REQUESTER_BOT" --refresh --json
metabot ui open --page loom --from "$REQUESTER_BOT"
```

Pass criteria:

- invalid records are not silently merged into a false happy-path state
- warnings are visible in CLI JSON, card badges, and detail warnings
- raw evidence remains inspectable so the operator can identify the record PIN
  id and protocol
- unsafe records do not enable acceptance, payment, GitHub mutation, or local
  repository mutation from the browser

### No Browser-Side Payment Or Mutations

With browser developer tools or request logging enabled, use the board normally:

- load `/ui/loom`
- click Refresh
- change state, role, and query filters
- select tasks
- click copy buttons
- open PR links

Pass criteria:

- browser requests are limited to read-only dashboard endpoints and the refresh
  endpoint for local cache/index refresh
- the browser does not call chain write endpoints, wallet transfer/payment
  endpoints, Loom accept/pay endpoints, GitHub mutation endpoints, or local repo
  mutation endpoints
- no request contains `confirmPayment: true`
- no request broadcasts a payment transaction or writes `/protocols/loom-*`
  records
- no request creates, edits, merges, or closes a GitHub pull request
- no request changes local repository files, branches, remotes, or worktrees
- accepting and paying a delivery remains a deliberate CLI handoff through
  `metabot loom accept-and-pay --confirm-payment`

## Smoke Report

Record these items after the run:

- requester Bot slug and developer Bot slug
- task PIN id and delivery PIN id
- final state from `metabot loom dashboard --refresh --json`
- UI URL returned by `metabot ui open --page loom`
- whether the task appeared in the expected column
- PR URL and payment txid, when applicable
- warning count and representative warning record PIN ids
- stale refresh behavior, if chain refresh failed
- confirmation that browser-side payment, chain writes, GitHub mutations, and
  local repository mutations did not occur
