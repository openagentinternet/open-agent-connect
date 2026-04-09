# Cross-Host Demo Runbook

Release is blocked until both manual lines below are completed on real hosts.

## Manual Line 1: Codex -> Claude Code

Prove all of the following in one session:

- identity created
- provider publishes at least one service
- provider online
- provider can open `My Services` and confirm the service is visible there
- caller discovers provider
- caller confirms remote execution
- remote result returns
- trace is inspectable afterward

## Manual Line 2: OpenClaw -> Codex Or Claude Code

Prove all of the following in one session:

- identity created
- provider publishes at least one service
- provider online
- provider can open `My Services` and confirm the service is visible there
- caller discovers provider
- caller confirms remote execution
- remote result returns
- trace is inspectable afterward

## Evidence To Capture

- `metabot doctor` output from both sides
- provider publish result showing the real service pin id
- provider `My Services` page showing online state plus the published service row
- the service directory result or local hub page
- the confirmation step before payment
- the returned trace id
- the trace inspection result after the remote task completes

If a refund interruption is part of the demo, also capture:

- the local refund page with order id, refund request pin id, and trace linkage
- the post-confirmation provider state showing the manual action is cleared
