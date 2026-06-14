# UI Services Single-Bot Console Design

Date: 2026-06-13
Status: approved product direction, ready for implementation planning

## Purpose

This document defines the next `/ui/services` iteration. The current page treats
Services as a cross-profile inventory and keeps the selected service detail in a
right-side column. That layout is a poor fit for OAC because the product is
multi-Bot and multi-account: service ownership is first understood through the
active local Bot, not through one global mixed list.

The new Services page must behave like a focused provider console for one local
Bot at a time. The visual and workflow reference is IDBots Bot Hub > My Services,
adapted to OAC's static local UI and daemon APIs.

## Goals

- Show services for exactly one selected local Bot.
- Default the selected Bot to the currently active local Bot.
- Reuse the Conversations local Bot selector pattern, including avatar and name.
- Remove the permanent right-side service detail panel.
- Present the service list as one centered column of wider service cards.
- Open service details in a centered modal when the user clicks the service name
  or a Details action.
- Keep edit, revoke, publish, refunds, and order trace workflows available.
- Scope service and order API reads with the selected Bot slug.

## Non-Goals

- Do not provide an "All Bots" option.
- Do not rewrite the service domain model or chain mutation semantics.
- Do not migrate the local static UI to React.
- Do not copy IDBots storage behavior; IDBots is only the interaction and
  hierarchy reference.
- Do not redesign unrelated `/ui/publish`, `/ui/refunds`, or `/ui/trace`
  screens beyond the query propagation needed for this flow.

## Current Problems

The current `/ui/services` layout creates four product issues:

- Mixed ownership: all local Bots' services can appear in the same list, which
  makes the page unclear in a multi-Bot system.
- Weak hierarchy: service cards, metrics, orders, and mutation actions compete
  visually instead of reading as a provider console.
- Poor detail placement: the right-side detail panel can be pushed out of view
  or become disconnected from the scrolling list.
- Excessive layout density: each Bot normally owns only a few services, so a
  split-pane inventory layout is heavier than the expected workload requires.

## Reference Behavior

Use IDBots as the primary workflow reference:

- `GigSquareMyServicesModal.tsx` for service list, detail view, metrics, order
  rows, edit, revoke, refresh, and empty states.
- `GigSquareServiceCard.tsx` for service card information hierarchy: icon,
  display name, service identifier, provider skill chips, price, description,
  provider identity, and primary action.
- `GigSquareRefundsModal.tsx` for the operational shape of refund access.

OAC should copy the product structure, not the implementation. OAC remains a
static TypeScript-generated page served by the daemon.

## Proposed UX

### Top Bot Selector

The page header gets a local Bot selector at the top of the main content area.
It should visually match the Conversations selector:

- closed state: Bot avatar, display name, and a dropdown affordance;
- open state: one row per local Bot, with avatar, display name, and slug or
  short identity as secondary text;
- no "All Bots" row;
- selected state clearly marks the active row;
- fallback avatar initials must match the existing Conversations avatar behavior.

Selection rules:

- If the URL has a valid selected Bot slug, use it.
- Otherwise use the daemon-reported active Bot.
- If no active marker is available, fall back to the first local profile.
- If there are no local profiles, show an empty state that links users back to
  Bot creation or activation flows instead of rendering the service list.

The selected Bot should be persisted in the URL as `from=<profileSlug>` so that
refreshing, sharing a local URL, and navigating back from Publish or Refunds
keeps the same Bot context.

### Service List

The main service list becomes a single column, centered in the page. The target
content width is approximately 820-960 px on desktop, with normal responsive
constraints on smaller viewports.

Each service card should include:

- icon or fallback initials;
- display name as the primary clickable title;
- service identifier as secondary text;
- short description, clamped to a compact number of lines;
- provider skill chips;
- price and currency;
- success count, refund count, gross revenue, net income, and average rating;
- creator Bot name or slug when useful for confirmation;
- updated or published timestamp;
- Details, Edit, and Revoke actions where allowed.

Cards should use restrained application styling: quiet surfaces, clear borders,
stable spacing, and no marketing hero treatment. Since each selected Bot will
usually have only three to five services, the list should prioritize readability
over dense table behavior.

### Service Detail Modal

Clicking the service title or Details opens a centered modal. The modal replaces
the old right-side detail panel and should remain readable without depending on
the page scroll position.

The modal contains:

- a compact service summary header with icon, display name, identifier,
  description, price, provider skill, and creator Bot;
- metric tiles for success count, refund count, gross revenue, net income, and
  average rating;
- completed and refunded seller-side orders for this service;
- order rows with buyer identity, order status, payment amount, payment txid,
  delivered/refunded timestamps when present, rating when present, and trace
  actions;
- pagination or load-more controls if the order API returns additional pages.

The modal should close through an explicit close button, Escape, and backdrop
click. Focus should move into the modal on open and return to the triggering
card on close.

### Publish And Refunds

The Services toolbar keeps Publish and Refunds entry points, but both should
preserve selected Bot context:

- Publish should navigate to `/ui/publish?from=<selectedSlug>`.
- Refunds should navigate to the refund UI with the same `from=<selectedSlug>`
  query if that page supports or is extended to support Bot scoping.

The Publish page should preselect the `from` profile when the query parameter is
valid. If the selected Bot cannot publish because required local runtime data is
missing, show the existing publish-page error state rather than silently falling
back to another Bot.

### Edit And Revoke

Edit and revoke remain separate modal flows. Their visual treatment should be
harmonized with the new detail modal, but their behavior stays scoped:

- Edit fetches provider skills for the selected service creator.
- Modify requests use the service creator slug.
- Revoke requests use the service creator slug.
- Mutation notices remain visible after success or failure.

No cross-Bot mutation fallback should be introduced.

## Data Flow

The page should stop using global reads for the default Services experience.

Profile loading:

- `GET /api/bot/profiles` should provide enough information to identify the
  active local Bot. The daemon can add an `isActive` boolean by comparing each
  profile home directory to the active input home.
- The UI selects one profile slug and stores it as `state.selectedBotSlug`.

Service loading:

- `GET /api/services/owned?from=<selectedSlug>&page=<n>&pageSize=<n>`
- `refresh=true` may be added for manual refresh.
- `all=true` should not be used by `/ui/services`.

Order loading:

- `GET /api/services/owned/orders?serviceId=<id>&from=<selectedSlug>&page=<n>&pageSize=<n>`
- The selected service detail modal owns order loading state.

Mutations:

- Edit and revoke should continue to send the service creator slug in request
  bodies.
- The selected Bot should not override a service's own creator metadata; it only
  controls which services are visible.

## Expected Files

The implementation is expected to touch:

- `src/ui/pages/my-services/app.ts` for page state, selector markup, card
  layout, detail modal, query persistence, scoped service and order reads, and
  Publish/Refunds navigation.
- `src/ui/pages/my-services/viewModel.ts` only if existing normalized fields are
  insufficient for the new card or modal hierarchy.
- `src/ui/pages/services/app.ts` if the `/ui/services` wrapper needs revised
  labels or page-level actions.
- `src/ui/pages/conversations/app.ts` as a read-only style and behavior
  reference for the Bot selector.
- `src/daemon/defaultHandlers.ts` or the profile route plumbing if
  `/api/bot/profiles` needs to expose `isActive`.
- `src/ui/pages/publish/app.ts` to honor `from=<selectedSlug>` preselection.
- Refund UI files only if the refund page does not already preserve `from`.

## Empty And Error States

The selected-Bot model requires explicit states:

- no local Bots: explain that no local Bot profile is available and expose the
  existing Bot activation or management path;
- selected Bot has no services: show a quiet empty state with Publish as the
  primary action for that Bot;
- selected Bot slug is invalid: fall back to the active Bot and update the URL;
- service load error: keep the selected Bot visible and show retry;
- order load error inside detail modal: keep service summary visible and show
  retry for orders only.

## Accessibility And Responsiveness

- The selector, modal, and action buttons must be keyboard reachable.
- Icon-only controls need accessible labels.
- Text inside cards and buttons must not overflow at mobile widths.
- The modal should use a stable max-height with internal scrolling for orders.
- Cards should keep stable dimensions for icons, metrics, and actions to avoid
  layout shift when data changes.

## Verification Plan

Focused verification for the implementation should include:

- `npm run build`;
- browser smoke test of `/ui/services` with at least two local Bot profiles;
- selected Bot defaults to active Bot;
- switching Bot reloads only that Bot's services and updates the URL;
- no All Bots option appears;
- service title and Details open the modal;
- order pagination and trace links still work inside the modal;
- Publish receives the selected `from` slug;
- edit and revoke still use the service creator slug.

Full `npm test` is not required for this UI-only iteration unless the
implementation changes shared runtime behavior, persistence formats, chain write
logic, or release/build artifacts.
