# UI My Services IDBots Parity Refactor Design

**Date:** 2026-05-13

## Goal

Rebuild the local `ui/my-services` page as an OAC-native equivalent of IDBots Bot Hub > My Services. The page must manage all locally owned MetaBot skill services across `~/.metabot/profiles/<slug>/`, show service metrics and completed/refunded seller-side order details, and support on-chain modify and revoke operations.

## Reference Behavior

The behavioral reference is IDBots:

- `GigSquareMyServicesModal.tsx` for list, detail, edit, revoke, pagination, refresh, and mutation notices.
- `gigSquareMyServicesService.ts` for service summary aggregation, order detail pagination, revenue metrics, refund counts, and rating matching.
- `gigSquareServiceStateService.ts` for current service version resolution and local mutation overlays.
- `gigSquareServiceMutationService.ts` for mutation validation and MetaID `modify` / `revoke` payload semantics.

OAC must keep its own storage model. IDBots stores marketplace data in SQLite, while OAC stores each local MetaBot profile under `~/.metabot/profiles/<slug>/`, with machine-managed runtime data in `.runtime/`.

## Data Model

OAC service lifecycle state stays in each profile runtime state:

- `runtime-state.json.services[]` contains local published services.
- `runtime-state.json.sellerOrders[]` contains seller-side order state.
- `.runtime/state/rating-detail.json` contains rating details matched by `serviceId + servicePaidTx`.

`PublishedServiceRecord` gains optional `chainPinIds` to keep create/modify pin history. `sourceServicePinId` remains the canonical original create pin, and `currentPinId` points at the latest active create/modify pin. Revoke marks the local record unavailable and sets `revokedAt`; revoked services are excluded from the active service list.

Supported settlement currencies for this round are the existing OAC publish currencies: `BTC`, `SPACE`, `DOGE`, and `BTC-OPCAT`. MRC20 from IDBots is intentionally out of scope.

## Backend Behavior

Add My Services helpers under `src/core/services/`:

- list all local profiles from the manager index
- load each profile runtime state and identity
- aggregate visible services owned by local profile identities
- compute completed and refunded counts from closed seller orders
- compute gross revenue and net income from closed seller orders
- compute average rating from rating details across all service chain pin ids
- return paginated service summaries and paginated order details
- validate modify/revoke requests against current, non-revoked services with a creator profile
- build MetaID `modify` and `revoke` write payloads with `path: @<currentPinId>`

Add daemon APIs:

- `GET /api/services/my?page=&pageSize=&refresh=`
- `GET /api/services/my/orders?serviceId=&page=&pageSize=&refresh=`
- `POST /api/services/my/modify`
- `POST /api/services/my/revoke`

Modify writes a new service payload to chain, appends the new pin to `chainPinIds`, updates `currentPinId`, and preserves `sourceServicePinId`. Revoke writes a revoke pin and updates local JSON immediately so the UI reflects the mutation before chain directory sync catches up.

## UI Behavior

Replace the old provider-led inventory table with an IDBots-like operational surface:

- list view with service icon, display name, provider skill, price, creator MetaBot, updated time, description, gross revenue, net income, average rating, success count, refund count, and `Details`, `Edit`, `Revoke` actions
- detail view with selected service summary and completed/refunded seller order rows
- order rows showing buyer identity, status, payment amount, payment txid, created/delivered/refunded timestamps, rating value/comment/txid, and trace link when available
- edit modal for display name, service identifier, description, provider skill, output type, price, currency, and cover image
- revoke confirmation modal
- mutation notice with copyable broadcast txids and warning text when chain sync is still catching up

The page keeps OAC's compact dark local-console style while copying IDBots' layout semantics and workflow. It is utility UI, not a landing page.

## Verification

Focused verification must cover:

- service summary aggregation across multiple local profiles
- chain pin history across create/modify versions
- completed/refunded order detail filtering and pagination
- rating matching by service pin and payment txid
- modify/revoke validation and local persistence updates
- route behavior for all new `/api/services/my*` endpoints
- browser runtime source execution for the rebuilt UI view model

Because this touches persistence and chain writes, the final branch verification must include full `npm test`.
