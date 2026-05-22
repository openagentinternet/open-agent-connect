# MetaBot Four-Chain Wallet UI Design

**Date:** 2026-05-22

## Goal

Extend `/ui/bot` wallet management so each local MetaBot profile shows BTC, MVC, DOGE, and OPCAT wallet addresses, displays a native balance under each address, and supports a two-step transfer flow for all four native assets.

The UI must remain a thin interface over the existing wallet capability. Balance and transfer behavior belongs in CLI/shared daemon handlers, not in browser-only code.

## Current Findings

The root cause of the current BTC/MVC-only wallet panel is narrow data and rendering:

- `getMetabotWalletInfo()` in `src/core/bot/metabotProfileManager.ts` returns only `addresses.btc` and `addresses.mvc`.
- `walletBodyMarkup()` in `src/ui/pages/bot/app.ts` hardcodes two rows: BTC and MVC.
- `GET /api/bot/profiles/:slug/wallet` only forwards `bot.getWallet`, so the browser has no route for wallet transfer preview or confirmation.
- The CLI already has the right capability shape: `metabot wallet balance --from <slug>` can query registered chain adapters, and `metabot wallet transfer --from <slug> --to <address> --amount <amount><UNIT>` returns an `awaiting_confirmation` preview before `--confirm` broadcasts.
- Current transfer logic is duplicated: CLI transfer flow lives in `src/cli/runtime.ts`, and Loom daemon payment flow has a separate parser/preview/broadcast path in `src/daemon/defaultHandlers.ts`. This work should move shared wallet semantics into one module instead of adding a third route-only implementation.
- `DerivedIdentity.addresses` already includes `mvc`, `btc`, `doge`, and `opcat`. OPCAT currently resolves to the BTC-style address, which is consistent with the current OPCAT adapter.

## User Requirements

1. Show BTC, MVC, DOGE, and OPCAT addresses in the `/ui/bot` wallet panel.
2. Show native balances below each address using these display units:
   - BTC: `BTC`
   - MVC: `SPACE`
   - DOGE: `Doge`
   - OPCAT: `OPCAT-BTC`
3. Show a transfer button beside each chain.
4. Transfer input must reject amounts above the current balance before preview.
5. Fee rates use the current default wallet behavior. The UI must not expose fee selection for this pass.
6. Clicking Next must show a confirmation screen with the amount, sender address, recipient address, and estimated fee.
7. Real transfer broadcast happens only after the user confirms.
8. CLI/shared handler capability is the product boundary. If a UI flow needs behavior not exposed through the CLI/shared handlers, implement that capability first, then wire the UI to it.
9. Layout can reference IDBots behavior, but `/ui/bot` should keep the existing OAC visual style.

## Architecture

### Shared Wallet Capability

Create a small shared wallet operation module under `src/core/wallet/` that CLI runtime, daemon bot routes, and existing daemon wallet-payment paths can call. This avoids making the browser call a special UI-only implementation and removes duplicate transfer parsing logic from CLI and daemon code.

The shared module should expose:

- `parseWalletTransferAmount(raw, adapters)`
- `queryWalletBalances(input)`
- `previewWalletTransfer(input)`
- `confirmWalletTransfer(input)`
- formatting helpers for native units where useful

Inputs should resolve a profile home first, then use that profile's runtime identity, secret store, and the default chain adapter registry. The module should return existing command result envelopes so CLI and daemon routes preserve the same contract.

The shared module must replace:

- CLI wallet balance and transfer internals in `src/cli/runtime.ts`.
- The Loom wallet transfer parser/preview/confirm path in `src/daemon/defaultHandlers.ts`.
- New `/ui/bot` wallet preview and confirm route internals.

There should be one transfer parser, one fee estimation rule, one balance check rule, and one confirmation result shape for native BTC, SPACE, DOGE, and OPCAT transfers.

### CLI Contract

Keep the existing CLI commands as the canonical user-facing capability:

```bash
metabot wallet balance --from <bot-slug>
metabot wallet balance --from <bot-slug> --chain btc
metabot wallet balance --from <bot-slug> --chain mvc
metabot wallet balance --from <bot-slug> --chain doge
metabot wallet balance --from <bot-slug> --chain opcat

metabot wallet transfer --from <bot-slug> --to <address> --amount <amount><UNIT>
metabot wallet transfer --from <bot-slug> --to <address> --amount <amount><UNIT> --confirm
```

The UI should use the same amount units accepted by CLI:

| Display Chain | CLI Chain | Display Unit | Transfer Amount Unit |
| --- | --- | --- | --- |
| BTC | `btc` | `BTC` | `BTC` |
| MVC | `mvc` | `SPACE` | `SPACE` |
| DOGE | `doge` | `Doge` | `DOGE` |
| OPCAT | `opcat` | `OPCAT-BTC` | `OPCAT` |

OPCAT therefore displays as `OPCAT-BTC` per product wording while preserving the existing CLI amount unit `OPCAT`.

### Daemon Routes For `/ui/bot`

Add bot-scoped wallet action routes:

- `GET /api/bot/profiles/:slug/wallet`
  - Returns profile name, slug, all four addresses, and all four native balances.
  - Internally reuses the shared balance capability equivalent to `metabot wallet balance --from <slug>`.
- `POST /api/bot/profiles/:slug/wallet/transfer/preview`
  - Body: `{ chain, toAddress, amount }`.
  - Builds `<amount><UNIT>` and calls the shared preview capability equivalent to the CLI transfer without `--confirm`.
- `POST /api/bot/profiles/:slug/wallet/transfer/confirm`
  - Body: `{ chain, toAddress, amount }`.
  - Calls the shared confirm capability equivalent to the CLI transfer with `--confirm`.

The route layer must validate only basic HTTP shape. Chain support, amount parsing, balance checks, fee estimation, and broadcast errors belong to the shared wallet capability.

### Bot Wallet Data

`MetabotWalletInfo.addresses` should become a four-chain map:

```typescript
addresses: {
  btc: string;
  mvc: string;
  doge: string;
  opcat: string;
}
```

Use this source order when resolving addresses:

1. identity secrets addresses
2. runtime state identity addresses
3. MVC profile fallback only for MVC

This rule applies to both wallet display and balance querying. A DOGE, BTC, or OPCAT balance query must fail with `identity_address_missing` when that chain address is absent; it must not silently query `mvcAddress`.

Do not persist new profile fields for DOGE or OPCAT in the manager index; follow the current storage layout and read derived addresses from the profile runtime/secret state.

### Display Unit Normalization

CLI and adapter results may use canonical machine units such as `DOGE` and `OPCAT`. The `/ui/bot` wallet modal must normalize display units on every wallet surface while preserving canonical units for CLI request construction.

Display labels:

- BTC: `BTC`
- MVC: `SPACE`
- DOGE: `Doge`
- OPCAT: `OPCAT-BTC`

Apply these labels consistently to:

- address row balances
- max balance hints
- form labels
- preview amount
- preview estimated fee
- confirmation total/current balance text
- success state summaries
- validation messages when they mention the native unit

The POST payload may still send `chain: "opcat"` and the daemon may still build `0.000001OPCAT` for the CLI-equivalent capability.

### UI Flow

`/ui/bot` should keep the current modal style and extend it in place:

1. Opening Wallet shows a loading state.
2. Loaded state renders four rows in a single modal.
3. Each row includes chain label, address, copy action, `Balance: <amount> <display-unit>`, and Transfer button.
4. Transfer button opens a form for that chain:
   - recipient address
   - amount
   - max balance hint
   - Back/Next actions
5. Next validates amount locally against the displayed balance, then calls preview.
6. Preview state shows:
   - from address
   - to address
   - amount
   - estimated fee
   - current balance when available
7. Confirm calls the confirm route and shows txid/explorer URL on success.
8. Successful transfer refreshes the wallet balances.

The UI must not build or sign transactions. It only collects input, displays preview/confirmation data, and calls daemon routes.

## Error Handling

- Missing identity or missing chain address: show the command result message in the modal.
- Balance query failure for one chain should not hide other chain addresses. Prefer showing `Balance: unavailable` for the failed chain when the shared capability can return partial data. If the shared capability currently fails all-at-once, this pass can show the top-level error and keep the route contract simple.
- Amount greater than the displayed balance: block Next locally with a clear validation message.
- Preview failure: keep the form open and show the error message.
- Confirm failure: keep the confirmation screen open and show the error message.
- Broadcast success: show txid and explorer URL if returned.

## Testing Strategy

Use TDD for each implementation task.

### Focused Automated Tests

- CLI wallet tests:
  - `wallet transfer` still dispatches BTC, SPACE, DOGE, and OPCAT units.
  - shared parsing rejects unsupported units and invalid amounts.
- Core wallet tests:
  - all-chain balance calls query registered adapters for `mvc`, `btc`, `doge`, and `opcat`.
  - transfer preview returns `awaiting_confirmation` and includes sender, recipient, amount, estimated fee, chain, and currency.
  - transfer confirm calls `executeTransfer()` only after confirmation.
- Bot manager tests:
  - `getMetabotWalletInfo()` returns four-chain addresses from secrets/runtime state.
- Daemon route tests:
  - wallet GET returns four addresses and balance payloads.
  - preview and confirm routes forward slug, chain, recipient, and amount to the shared wallet handler.
- UI script tests:
  - wallet modal renders four chains, four balances, and transfer actions.
  - transfer form blocks over-balance amounts before preview.
  - preview screen renders sender, recipient, amount, and fee.
  - confirm success renders txid/explorer link and refreshes wallet data.

### Verification Commands

Use Node 22 for local verification:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/cli/wallet.test.mjs tests/bot/metabotProfileManager.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
```

Run the full test suite only if the implementation touches broad runtime behavior beyond the scoped wallet shared module, daemon routes, and bot UI script.

### Manual Acceptance

With a local MetaBot profile available:

1. Open `/ui/bot`.
2. Open Wallet for a profile.
3. Confirm BTC, MVC, DOGE, and OPCAT address rows are visible.
4. Confirm each row shows `Balance: ...` with the required unit.
5. Start a transfer for each chain with an amount above balance and confirm the UI blocks it.
6. Start a transfer with a valid low amount and confirm preview appears before broadcast.
7. Do not broadcast real funds unless the tester has explicitly chosen a funded test profile and recipient.

## Implementation Plan Shape

Use subagent-driven development with small commits:

1. Shared wallet operations and CLI deduplication.
2. Bot wallet data and daemon route contract.
3. `/ui/bot` wallet rendering and transfer modal flow.
4. Focused verification and acceptance cleanup.

Each implementation task should commit independently after targeted verification. After each commit, post an on-chain development diary using the `metabot-post-buzz` skill.
