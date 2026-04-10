# Service Rating Closure Design

**Date:** 2026-04-10

## Goal

Formalize the first `be-metabot` service-rating closure so a remote MetaBot task does not stop at "result delivered." Instead, when the provider requests a DACT T-stage rating, the caller-side MetaBot should automatically publish the rating on-chain, and the provider-side order view should visibly reflect that the order has been rated.

The immediate user-facing outcome is simple:

- buyer-side auto-rating continues to work using the already validated IDBots semantics
- provider-side `My Services` can show whether an order is `未评价` or `已评价`
- trace inspection can clearly show whether T-stage is complete

## Product Truth

This round is not a marketplace reputation system.

This round is about making one real A2A delegation feel complete:

- remote MetaBot delivers a result
- remote MetaBot requests a rating
- local MetaBot publishes the rating on-chain
- provider can observe that the order reached T-stage closure

The product feeling should be:

> "These two MetaBots not only completed a task over MetaWeb, they also closed the loop on-chain."

## Source Of Truth

This round should reuse IDBots semantics instead of inventing a new rating model.

Primary semantic references from IDBots:

- `src/main/services/privateChatDaemon.ts`
- `src/main/services/privateChatOrderCowork.ts`
- `src/main/services/gigSquareRatingSyncService.ts`
- `src/main/sqliteStore.ts`
- `docs/superpowers/specs/2026-03-27-gig-square-my-services-design.md`

Primary `be-metabot` references:

- `src/daemon/defaultHandlers.ts`
- `src/core/provider/providerConsole.ts`
- `src/ui/pages/my-services/viewModel.ts`
- `src/ui/pages/trace/viewModel.ts`

Key protocol path:

- rating publish: `/protocols/skill-service-rate`

## Current State

`be-metabot` already has these pieces:

- caller-side `services rate` writes `/protocols/skill-service-rate`
- caller-side `services rate` attempts one private follow-up message back to the provider
- trace inspector can show rating-related evidence from transcript items
- remote result flow already surfaces `[NeedsRating]` in trace state

What is still missing:

- provider order views do not have a stable order-level rating read model
- provider `My Services` does not clearly show `未评价 / 已评价`
- trace inspection still derives too much from transcript shape instead of an explicit T-stage closure view
- the system does not yet treat "rating exists on-chain" as a first-class completion signal for the order

## Scope

### In scope

- keep existing auto-rating behavior as the default
- formalize order-level rating closure using IDBots-compatible semantics
- add a lightweight local rating-detail cache / read model
- join ratings to provider-side orders using `serviceID + servicePaidTx`
- expose rating closure through provider summary and trace inspection
- show provider-side order rating state in `My Services`
- clearly separate:
  - on-chain rating success
  - provider follow-up message delivery success

### Out of scope

- generalized service reputation ranking in the Hub
- MetaBot-level global reputation
- complex anti-fraud or reputation-weighting rules
- marketplace sorting changes
- redesigning the caller-side auto-rating prompt generation
- replacing the existing `[NeedsRating] -> services rate` path

## Non-Negotiable Principles

### Reuse validated IDBots semantics

This round should preserve the already validated meaning of:

- provider sends `[NeedsRating]`
- caller auto-generates a concise rating
- caller publishes `/protocols/skill-service-rate`
- order-level rating detail is associated using `serviceID + servicePaidTx`

`be-metabot` may implement lighter storage than IDBots, but it should not invent a different public rating meaning.

### On-chain rating is the closure fact

If a matching `/protocols/skill-service-rate` record exists, then:

- the rating is considered published
- the order is considered rated
- T-stage is considered complete

The provider follow-up private message is helpful, but it is not the only proof of rating closure.

### Provider sees order-level truth, not only aggregate truth

The first visible closure should happen in the provider's order view.

The provider should be able to answer:

- was this order rated?
- what score did it receive?
- what comment was left?
- what on-chain pin proves it?

This round should not hide rating closure behind only average scores or service-level summary metrics.

### HTML is still human inspection only

The human-facing HTML pages should show closure clearly, but the runtime truth should remain in daemon-backed state and APIs.

## Desired User Experience

### Caller Side

When a provider sends `[NeedsRating]` after successful delivery:

1. the local MetaBot continues using the current auto-rating behavior
2. `services rate` publishes `/protocols/skill-service-rate`
3. the runtime records whether:
   - rating was published on-chain
   - provider follow-up message was delivered back
4. trace inspection shows that T-stage is complete once the on-chain rating exists

### Provider Side

When the provider opens `My Services`:

- recent orders should show whether the order is rated
- if rated, the provider should see:
  - score
  - comment preview
  - rating pin
- if not rated, the provider should see `未评价`
- if rating refresh fails, the provider should see a sync degradation signal rather than a false rating state

### Trace Inspection

Trace inspection should make it obvious whether:

- rating was requested
- rating was published on-chain
- provider follow-up delivery was confirmed

This should feel like a DACT T-stage panel, not only a transcript guess.

## Rating Identity And Join Semantics

This round should join rating records to provider-side orders using:

- `serviceID`
- `servicePaidTx`

Why this join is required:

- `serviceID` identifies which service was rated
- `servicePaidTx` identifies which paid order instance was rated

This matches the IDBots order-detail design direction and keeps the rating closure tied to one concrete order, not only one service family.

## Runtime Architecture

### Existing write path stays

The existing `services rate` handler remains the only public write path for buyer-side ratings.

It continues to:

- validate the trace and buyer role
- extract service and payment metadata from the trace
- publish `/protocols/skill-service-rate`
- attempt one provider follow-up private message
- append transcript evidence

This round should not add a second public rating write command.

### New lightweight rating-detail read model

Add one dedicated local rating-detail cache focused only on closure visibility.

The cache should store the minimum order-facing detail needed from chain ratings:

- `pinId`
- `serviceId`
- `servicePaidTx`
- `rate`
- `comment`
- `raterGlobalMetaId`
- `raterMetaId`
- `createdAt`

This cache is not a full marketplace analytics store. Its only responsibility is to support:

- provider order-level rating visibility
- trace closure visibility
- later safe extension into service-level aggregates if needed

### Refresh strategy

Use a lightweight best-effort refresh model instead of a heavy always-on sync daemon in this round.

Recommended behavior:

- refresh the rating-detail cache before serving provider summary when the cache is stale
- refresh the rating-detail cache before serving trace inspection data when needed
- persist enough cursor / latest-pin state to support incremental chain reads

This keeps the design aligned with IDBots' chain-sync semantics while staying lightweight inside `be-metabot`.

## Daemon And Read Model Changes

### Provider console snapshot

Extend the provider console snapshot so each recent seller order can carry rating closure fields:

- `ratingStatus`
- `ratingValue`
- `ratingComment`
- `ratingPinId`
- `ratingCreatedAt`
- `ratingSyncState` when needed

The snapshot builder should join:

- seller-side trace / order truth
- rating-detail cache

The UI should consume the snapshot directly, without re-implementing chain or transcript logic in the browser.

### Trace view model

Extend the trace read model so rating closure is explicit rather than only inferred from transcript items.

Suggested structured fields:

- `ratingRequested`
- `ratingRequestText`
- `ratingRequestedAt`
- `ratingPublished`
- `ratingPinId`
- `ratingComment`
- `ratingValue`
- `ratingMessageSent`
- `ratingMessageError`
- `tStageCompleted`

The trace page may still use transcript evidence as a fallback, but it should prefer explicit closure state.

## Status Semantics

This round should use these rating closure states:

- `not_requested`
  - provider never requested a rating
- `requested_unrated`
  - provider requested a rating, but no matching on-chain rating has been found yet
- `rated_on_chain`
  - matching `/protocols/skill-service-rate` exists; T-stage is complete
- `rated_on_chain_followup_unconfirmed`
  - rating exists on-chain, but provider follow-up message delivery was not confirmed
- `sync_error`
  - the runtime could not safely refresh or interpret the rating-detail cache

Important rule:

> `rated_on_chain` and `rated_on_chain_followup_unconfirmed` are both successful T-stage closure states.

The second only means the provider-side message echo was not confirmed.

## UI Semantics

### My Services

Recent orders should display one rating closure indicator:

- `未评价`
- `已评价 · 4/5`
- `已评价 · 4/5 · 回传未确认`
- `评分同步异常`

Where available, the UI should also expose:

- rating comment preview
- rating pin
- trace link

### Trace inspector

The trace rating panel should display a clear closure summary:

- no rating requested
- rating requested but not yet completed
- rating completed on-chain
- rating completed on-chain but provider follow-up not confirmed

The panel should not imply failure merely because provider message delivery was not confirmed.

## Failure And Degradation Handling

### No rating yet

If no matching rating is found:

- provider order row shows `未评价`
- trace shows `requested_unrated` when a rating request exists

### Rating cache refresh fails

If chain refresh or cache parsing fails:

- provider order row degrades to `评分同步异常` or equivalent machine-backed degraded state
- trace keeps the last known closure state if safe
- the runtime must not invent a positive rating state

### Follow-up delivery fails

If the private follow-up message back to the provider fails but the on-chain rating write succeeded:

- trace remains a successful T-stage closure
- provider-side messaging visibility may lag
- UI language must say "回传未确认" or equivalent, not "评分失败"

## Testing

Required coverage for this round:

- rating-detail parser reads chain `/protocols/skill-service-rate` pins using IDBots-compatible fields
- rating detail joins to provider orders using `serviceID + servicePaidTx`
- provider summary exposes `未评价 / 已评价 / 回传未确认 / 同步异常` semantics correctly
- trace inspection exposes T-stage completion explicitly when on-chain rating exists
- follow-up message failure does not downgrade a successful on-chain rating into failure
- existing `services rate` tests remain green

## Acceptance Criteria

This round is complete only if all of the following are true:

1. a remote provider can request rating through the existing `[NeedsRating]` path
2. the caller-side runtime automatically publishes `/protocols/skill-service-rate`
3. the provider-side `My Services` recent order view shows:
   - rated vs unrated
   - numeric score
   - comment preview
   - rating pin
4. the trace inspector clearly shows whether T-stage completed
5. "on-chain rating exists but provider follow-up delivery is unconfirmed" is shown as a successful but partially unconfirmed closure, not as a failure

## Why This Scope

This is the smallest useful slice that makes rating closure feel real without expanding into a full reputation product.

If this round succeeds:

- the current A2A demo no longer ends at "remote result returned"
- provider-side humans can observe DACT T-stage closure from their own order view
- the runtime is better prepared for a later service-level reputation layer without committing to it now
