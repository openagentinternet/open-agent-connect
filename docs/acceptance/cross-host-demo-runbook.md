# Cross-Host Demo Runbook

Release is blocked until both manual lines below are completed on real hosts.

## Execute Endpoint Hardening

The provider daemon verifies the buyer's payment on chain before running any
paid service ordered over `POST /api/services/execute` (free services run
without payment, as before). A payment mismatch is rejected with
`order_payment_unverified`; a chain/indexer outage is rejected with the
transient, retryable `order_payment_verification_unavailable`.

The execute endpoint also accepts an optional shared-secret gate:

- Provider side: set `OAC_EXECUTE_API_TOKEN` in the daemon environment before
  `metabot daemon start`. Every `/api/services/execute` call must then carry
  `authorization: Bearer <token>`. Without the variable the endpoint stays
  open (previous behavior) and the daemon logs a one-time warning.
- Caller side: add `executeToken` to the provider's entry in
  `.runtime/state/directory-seeds.json` (next to `baseUrl` and `label`). The
  buyer daemon sends it automatically when it orders through that provider
  daemon. `network sources add` preserves an existing `executeToken` when a
  source is re-added.

## Manual Line 1: Codex -> Claude Code

Prove all of the following in one session:

- identity created
- provider publishes at least one service
- provider online
- provider can open `My Services` and confirm the service is visible there
- after one completed call plus rating, provider can see the order row move into a rated closure state with rating preview
- caller discovers provider
- caller confirms remote execution
- remote result returns
- trace is inspectable afterward and shows T-stage closure explicitly

## Manual Line 2: OpenClaw -> Codex Or Claude Code

Prove all of the following in one session:

- identity created
- provider publishes at least one service
- provider online
- provider can open `My Services` and confirm the service is visible there
- after one completed call plus rating, provider can see the order row move into a rated closure state with rating preview
- caller discovers provider
- caller confirms remote execution
- remote result returns
- trace is inspectable afterward and shows T-stage closure explicitly

## Evidence To Capture

- `metabot doctor` output from both sides
- provider publish result showing the real service pin id
- provider `My Services` page showing online state, the published service row, and the rated order closure row
- the service directory result or local hub page
- the confirmation step before payment
- the returned trace id
- the trace inspection result after the remote task completes, including explicit T-stage closure fields

If a refund interruption is part of the demo, also capture:

- the local refund page with order id, refund request pin id, and trace linkage
- the post-confirmation provider state showing the manual action is cleared
