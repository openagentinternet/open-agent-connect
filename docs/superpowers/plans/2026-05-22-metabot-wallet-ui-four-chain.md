# MetaBot Four-Chain Wallet UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement BTC, MVC/SPACE, DOGE, and OPCAT wallet addresses, balances, and two-step transfers in `/ui/bot` while keeping CLI/shared wallet handlers as the capability boundary.

**Architecture:** Add a shared native-wallet operation module and route CLI/runtime plus daemon wallet paths through it. Extend bot wallet data/routes to expose four-chain addresses, balances, preview, and confirm. Keep `/ui/bot` as a thin modal over daemon routes with OAC styling and UI-only display-unit normalization.

**Tech Stack:** TypeScript, Node test runner, existing `ChainAdapter` registry, existing command result envelopes, browser-side plain TypeScript for `/ui/bot`.

---

## File Structure

- Create `src/core/wallet/nativeWallet.ts`
  - Owns native wallet amount parsing, chain address resolution, balance querying, preview, and confirm.
  - Exports small pure helpers for tests.
- Create `tests/wallet/nativeWallet.test.mjs`
  - Covers parser, no-MVC-fallback address resolution, balance querying, preview, and confirm.
- Modify `src/cli/runtime.ts`
  - Replace wallet balance and transfer internals with shared wallet operations.
  - Remove or stop using the local duplicate `parseTransferAmount()`.
- Modify `src/daemon/defaultHandlers.ts`
  - Use shared wallet operations for Loom wallet transfers and bot wallet routes.
  - Add bot wallet preview/confirm handlers.
- Modify `src/core/bot/metabotProfileManager.ts`
  - Return four-chain wallet addresses from secrets/runtime state.
- Modify `src/daemon/routes/types.ts`
  - Add bot wallet preview/confirm handler types.
- Modify `src/daemon/routes/bot.ts`
  - Add POST preview/confirm routes.
- Modify `src/ui/pages/bot/app.ts`
  - Render four-chain wallet rows, balances, and transfer form/preview/confirm states.
- Modify `src/ui/pages/bot/index.html`
  - Add only small wallet-modal CSS needed for the existing OAC style.
- Modify tests:
  - `tests/cli/wallet.test.mjs`
  - `tests/bot/metabotProfileManager.test.mjs`
  - `tests/daemon/httpServer.test.mjs`
  - `tests/ui/botPageScript.test.mjs`

Use Node 22 for all commands:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" <command>
```

---

### Task 1: Shared Native Wallet Operations And CLI Runtime

**Files:**
- Create: `src/core/wallet/nativeWallet.ts`
- Create: `tests/wallet/nativeWallet.test.mjs`
- Modify: `src/cli/runtime.ts`
- Modify: `src/daemon/defaultHandlers.ts` only for the existing Loom wallet transfer helper
- Test: `tests/wallet/nativeWallet.test.mjs`
- Test: `tests/cli/wallet.test.mjs`

- [ ] **Step 1: Write failing native wallet operation tests**

Add `tests/wallet/nativeWallet.test.mjs` with fake adapters. Cover:

```javascript
test('queryWalletBalances queries every registered native chain with its chain-specific address', async () => {
  const calls = [];
  const adapters = new Map(['mvc', 'btc', 'doge', 'opcat'].map((chain) => [chain, fakeAdapter(chain, calls)]));
  const identity = {
    globalMetaId: 'gm',
    mvcAddress: 'mvc-address',
    addresses: { mvc: 'mvc-address', btc: 'btc-address', doge: 'doge-address', opcat: 'opcat-address' },
  };

  const result = await queryWalletBalances({ identity, adapters, chain: 'all' });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.address), ['mvc-address', 'btc-address', 'doge-address', 'opcat-address']);
});

test('queryWalletBalances does not fall back to mvcAddress for missing DOGE address', async () => {
  const adapters = new Map([['doge', fakeAdapter('doge', [])]]);
  const result = await queryWalletBalances({
    identity: { globalMetaId: 'gm', mvcAddress: 'mvc-address', addresses: { mvc: 'mvc-address' } },
    adapters,
    chain: 'doge',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'identity_address_missing');
});

test('previewWalletTransfer returns awaiting_confirmation without broadcasting', async () => {
  const broadcasts = [];
  const adapters = new Map([['opcat', fakeAdapter('opcat', [], { totalSatoshis: 100_000 })]]);
  const result = await previewWalletTransfer({
    identity: {
      globalMetaId: 'gm',
      mvcAddress: 'mvc-address',
      addresses: { opcat: 'opcat-address' },
      path: "m/44'/10001'/0'/0/0",
    },
    adapters,
    toAddress: 'opcat-recipient',
    amountRaw: '0.000001OPCAT',
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.chain, 'opcat');
  assert.deepEqual(broadcasts, []);
});
```

Add a confirm test using a fake adapter whose `buildTransfer()` and `broadcastTx()` return deterministic values, then assert `txid`, `explorerUrl`, and `amount`.

Add a confirm test proving the selected profile secret store and path are used:

```javascript
test('confirmWalletTransfer signs with the selected profile secret store and secret path', async () => {
  const buildInputs = [];
  const adapters = new Map([['btc', fakeAdapter('btc', [], {
    totalSatoshis: 100_000,
    buildTransfer: async (input) => {
      buildInputs.push(input);
      return { rawTx: 'signed-raw', fee: 100 };
    },
  })]]);
  const secretStore = {
    readIdentitySecrets: async () => ({
      mnemonic: 'selected profile mnemonic',
      path: "m/44'/10001'/0'/0/7",
    }),
  };

  const result = await confirmWalletTransfer({
    identity: {
      globalMetaId: 'gm-selected',
      mvcAddress: 'mvc-selected',
      addresses: { btc: 'btc-selected' },
      path: "m/44'/10001'/0'/0/0",
    },
    secretStore,
    adapters,
    toAddress: 'btc-recipient',
    amountRaw: '0.000001BTC',
  });

  assert.equal(result.ok, true);
  assert.equal(buildInputs[0].mnemonic, 'selected profile mnemonic');
  assert.equal(buildInputs[0].path, "m/44'/10001'/0'/0/7");
});
```

Add CLI/runtime-level coverage in `tests/cli/wallet.test.mjs` or a focused companion test:

- `wallet balance --chain doge` and `wallet balance --chain opcat` use the shared balance path and return the requested chain.
- `wallet balance --chain doge` returns `identity_address_missing` when the selected identity lacks `addresses.doge`, instead of querying `mvcAddress`.
- `wallet transfer --amount 0.000001BTC`, `1SPACE`, `0.01DOGE`, and `0.000001OPCAT` all flow through the shared transfer parser and preserve the expected chain/currency in preview.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/wallet/nativeWallet.test.mjs
```

Expected: build or test fails because `src/core/wallet/nativeWallet.ts` does not exist.

- [ ] **Step 3: Implement `src/core/wallet/nativeWallet.ts`**

Implement these exports:

```typescript
export const NATIVE_WALLET_CHAINS = ['mvc', 'btc', 'doge', 'opcat'] as const;
export const NATIVE_TRANSFER_UNITS = { mvc: 'SPACE', btc: 'BTC', doge: 'DOGE', opcat: 'OPCAT' } as const;

export function decimalAmountToSatoshis(value: string): number;
export function parseWalletTransferAmount(raw: string, adapters: ChainAdapterRegistry): ParsedWalletTransferAmount;
export function resolveIdentityChainAddress(identity: Pick<DerivedIdentity, 'addresses' | 'mvcAddress'>, chain: string): string | null;
export async function queryWalletBalances(input: QueryWalletBalancesInput): Promise<MetabotCommandResult<unknown>>;
export async function previewWalletTransfer(input: WalletTransferOperationInput): Promise<MetabotCommandResult<unknown>>;
export async function confirmWalletTransfer(input: WalletConfirmTransferInput): Promise<MetabotCommandResult<unknown>>;
```

Required behavior:

- `WalletTransferOperationInput` must include the selected profile's runtime identity and adapters:

```typescript
interface WalletTransferOperationInput {
  identity: Pick<DerivedIdentity, 'globalMetaId' | 'mvcAddress' | 'addresses' | 'path'>;
  adapters: ChainAdapterRegistry;
  toAddress: string;
  amountRaw: string;
}
```

- `WalletConfirmTransferInput` must extend `WalletTransferOperationInput` with the selected profile's secret store:

```typescript
interface WalletConfirmTransferInput extends WalletTransferOperationInput {
  secretStore: Pick<SecretStore, 'readIdentitySecrets'>;
}
```

- Confirm must read mnemonic and signing path from `input.secretStore`, which is created from the selected profile home by the caller. It must never read active/default identity secrets internally.
- Confirm path selection is `secrets.path ?? input.identity.path ?? "m/44'/10001'/0'/0/0"`.

- `decimalAmountToSatoshis()` accepts positive decimal strings with at most 8 decimals and avoids `parseFloat()` rounding for conversion.
- `parseWalletTransferAmount()` accepts `BTC`, `SPACE`, `DOGE`, and `OPCAT`, maps `SPACE` to `mvc`, and validates adapter presence.
- `resolveIdentityChainAddress()` may return `identity.mvcAddress` only for `mvc`; other chains require `identity.addresses[chain]`.
- `queryWalletBalances({ chain: 'all' })` uses `NATIVE_WALLET_CHAINS`, not arbitrary adapter map order.
- `previewWalletTransfer()` estimates fees with the current `Math.ceil(392 * feePerByte)` behavior and returns `commandAwaitingConfirmation`.
- `confirmWalletTransfer()` calls `executeTransfer()` only after the caller has selected confirm, returns `commandSuccess({ txid, explorerUrl, amount, toAddress })`, and maps insufficient balance errors to `insufficient_balance`.

- [ ] **Step 4: Replace CLI runtime wallet internals**

In `src/cli/runtime.ts`:

- Import shared operations from `../core/wallet/nativeWallet`.
- Delete or stop using local `ParsedTransferAmount` and `parseTransferAmount()`.
- In `runWalletTransferRuntime()`, resolve actor and state, then call:
  - `previewWalletTransfer()` when `confirm` is false.
  - `confirmWalletTransfer()` when `confirm` is true.
- Pass `secretStore: createFileSecretStore(homeDir)` to `confirmWalletTransfer()` so `--from <slug>` signs with that selected profile.
- In `createDefaultCliDependencies().wallet.balance`, resolve actor and state, then call `queryWalletBalances()`.
- Preserve current top-level error codes for missing active identity and invalid arguments.

- [ ] **Step 5: Deduplicate Loom wallet transfer internals**

In `src/daemon/defaultHandlers.ts`, replace the implementation inside `runLoomWalletTransfer()` with the shared `previewWalletTransfer()` / `confirmWalletTransfer()` operations.

Required behavior:

- Preserve the existing input contract `{ toAddress, amountRaw, confirm }`.
- Resolve the actor with the existing `resolveActorWriteContext(rawActor)`.
- Use the selected actor's `runtimeStateStore`, `homeDir`, and `createFileSecretStore(actor.homeDir)`.
- Do not keep a separate amount parser, balance check, fee estimator, or transfer confirmation result shape in this Loom helper.

- [ ] **Step 6: Run focused tests**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/wallet/nativeWallet.test.mjs tests/cli/wallet.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/wallet/nativeWallet.ts src/cli/runtime.ts src/daemon/defaultHandlers.ts tests/wallet/nativeWallet.test.mjs tests/cli/wallet.test.mjs
git commit -m "feat: add shared native wallet operations"
```

Controller follow-up after this task: post an on-chain development diary for the commit with `metabot-post-buzz`.

---

### Task 2: Four-Chain Bot Wallet Data And Daemon Routes

**Files:**
- Modify: `src/core/bot/metabotProfileManager.ts`
- Modify: `src/daemon/defaultHandlers.ts`
- Modify: `src/daemon/routes/types.ts`
- Modify: `src/daemon/routes/bot.ts`
- Modify: `tests/bot/metabotProfileManager.test.mjs`
- Modify: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Write failing bot wallet and route tests**

Update `tests/bot/metabotProfileManager.test.mjs` so the wallet info test expects:

```javascript
assert.deepEqual(wallet.addresses, {
  btc: 'btc-secret-address',
  mvc: 'mvc-secret-address',
  doge: 'doge-secret-address',
  opcat: 'opcat-secret-address',
});
```

Update `tests/daemon/httpServer.test.mjs`:

- Existing wallet GET fixture returns four addresses and `balances`.
- GET assertion checks `btc`, `mvc`, `doge`, and `opcat`.
- Add `POST /api/bot/profiles/:slug/wallet/transfer/preview` test that asserts handler input:

```javascript
{ slug: 'alice-bot', chain: 'doge', toAddress: 'D-recipient', amount: '0.01' }
```

- Add `POST /api/bot/profiles/:slug/wallet/transfer/confirm` test with the same shape and a successful txid response.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/bot/metabotProfileManager.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: tests fail because four-chain address output and routes are not implemented.

- [ ] **Step 3: Extend bot wallet address data**

In `src/core/bot/metabotProfileManager.ts`:

- Extend `MetabotWalletInfo.addresses` to include `doge` and `opcat`.
- In `getMetabotWalletInfo()`, read addresses from `secrets?.addresses` first, then `runtimeState.identity?.addresses`.
- Use profile MVC fallback only for `mvc`.
- Do not add DOGE or OPCAT fields to the profile manager index.

- [ ] **Step 4: Add daemon bot wallet handlers**

In `src/daemon/routes/types.ts`, add:

```typescript
previewWalletTransfer?: (input: { slug: string; chain: string; toAddress: string; amount: string }) => Awaitable<MetabotCommandResult<unknown>>;
confirmWalletTransfer?: (input: { slug: string; chain: string; toAddress: string; amount: string }) => Awaitable<MetabotCommandResult<unknown>>;
```

In `src/daemon/defaultHandlers.ts`:

- Add a helper to resolve a bot profile by slug and read its runtime identity.
- For `bot.getWallet`, return `{ wallet: { ...wallet, balances } }` where `balances` comes from `queryWalletBalances({ identity, adapters, chain: 'all' })`.
- Implement `bot.previewWalletTransfer` by converting `{ chain, amount }` to CLI amount unit with `NATIVE_TRANSFER_UNITS` and calling `previewWalletTransfer()`.
- Implement `bot.confirmWalletTransfer` similarly and call `confirmWalletTransfer()`.
- Pass `secretStore: createFileSecretStore(profile.homeDir)` to `confirmWalletTransfer()` so the selected bot slug signs with its own profile secret store.
- Do not edit the Loom wallet helper in this task; it was handled in Task 1.

- [ ] **Step 5: Add daemon bot routes**

In `src/daemon/routes/bot.ts`, before the generic `profileMatch` route:

- Add POST preview route:

```typescript
const walletPreviewMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet\/transfer\/preview$/);
```

- Add POST confirm route:

```typescript
const walletConfirmMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet\/transfer\/confirm$/);
```

Both routes read JSON body and forward `{ slug, chain, toAddress, amount }`. Return 200 on `ok`, 404 on `profile_not_found`, otherwise 400.

- [ ] **Step 6: Run focused tests**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/wallet/nativeWallet.test.mjs tests/bot/metabotProfileManager.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/bot/metabotProfileManager.ts src/daemon/defaultHandlers.ts src/daemon/routes/types.ts src/daemon/routes/bot.ts tests/bot/metabotProfileManager.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: expose four-chain bot wallet routes"
```

Controller follow-up after this task: post an on-chain development diary for the commit with `metabot-post-buzz`.

---

### Task 3: `/ui/bot` Wallet Modal And Transfer Flow

**Files:**
- Modify: `src/ui/pages/bot/app.ts`
- Modify: `src/ui/pages/bot/index.html`
- Modify: `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Write failing UI tests**

Update `tests/ui/botPageScript.test.mjs`:

- Extend the wallet markup test to pass four addresses and four balances:

```javascript
const walletMarkup = context.walletBodyMarkup({
  addresses: { btc: 'btc-address', mvc: 'mvc-address', doge: 'doge-address', opcat: 'opcat-address' },
  balances: {
    btc: { totalSatoshis: 100000000 },
    mvc: { totalSatoshis: 200000000 },
    doge: { totalSatoshis: 300000000 },
    opcat: { totalSatoshis: 400 },
  },
});
assert.match(walletMarkup, /Balance: 1\\.00000000 BTC/);
assert.match(walletMarkup, /Balance: 2\\.00000000 SPACE/);
assert.match(walletMarkup, /Balance: 3\\.00000000 Doge/);
assert.match(walletMarkup, /Balance: 0\\.00000400 OPCAT-BTC/);
assert.equal((walletMarkup.match(/data-act="wallet-transfer"/g) || []).length, 4);
```

- Add a test for over-balance local validation by invoking the exposed modal helpers in a VM context.
- Add a test that `submitWalletTransferPreview()` posts to `/api/bot/profiles/alice-bot/wallet/transfer/preview`.
- Add a test that `submitWalletTransferConfirm()` posts to `/api/bot/profiles/alice-bot/wallet/transfer/confirm`.

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/ui/botPageScript.test.mjs
```

Expected: tests fail because wallet markup and transfer helpers do not exist yet.

- [ ] **Step 3: Implement wallet display helpers**

In `src/ui/pages/bot/app.ts`, add browser-side constants and helpers:

```javascript
var WALLET_CHAINS=[
  {chain:'btc',label:'BTC',displayUnit:'BTC',inputUnit:'BTC'},
  {chain:'mvc',label:'MVC',displayUnit:'SPACE',inputUnit:'SPACE'},
  {chain:'doge',label:'DOGE',displayUnit:'Doge',inputUnit:'DOGE'},
  {chain:'opcat',label:'OPCAT',displayUnit:'OPCAT-BTC',inputUnit:'OPCAT'}
];
function walletDisplayUnit(chain){...}
function walletInputUnit(chain){...}
function formatWalletBalance(balance,chain){...}
function walletChainRowsMarkup(wallet){...}
```

`formatWalletBalance()` should divide `totalSatoshis` by `1e8` and show 8 decimals. If balance is absent, show `Balance: unavailable`.

- [ ] **Step 4: Implement transfer modal states**

Keep the same dynamic modal system. Add:

- `walletTransferFormMarkup(wallet, chain, status)`
- `walletTransferPreviewMarkup(wallet, chain, preview, status)`
- `walletTransferSuccessMarkup(result)`
- `openWalletTransferForm(chain)`
- `submitWalletTransferPreview()`
- `submitWalletTransferConfirm()`

Implementation rules:

- Store the currently loaded wallet in state, for example `state._walletPanel`.
- Validate amount is positive and `amount <= balance` before calling preview.
- Do not expose fee-rate controls.
- Use display units (`Doge`, `OPCAT-BTC`) in form, preview, errors, and success.
- Send canonical route body `{ chain, toAddress, amount }`.
- Refresh wallet after success.

- [ ] **Step 5: Add CSS in `index.html`**

Add minimal classes near existing wallet modal CSS:

- `.wallet-row-actions`
- `.wallet-balance`
- `.wallet-transfer-grid`
- `.wallet-confirm-grid`

Keep the visual style aligned with existing `.wallet-row`, `.modal-actions`, `.btn`, and `.save-status`.

- [ ] **Step 6: Run focused UI tests**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/ui/botPageScript.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/botPageScript.test.mjs
git commit -m "feat: add four-chain wallet transfer UI"
```

Controller follow-up after this task: post an on-chain development diary for the commit with `metabot-post-buzz`.

---

### Task 4: Integrated Verification And Acceptance Cleanup

**Files:**
- Modify only files needed to fix review or verification gaps.
- Test: all focused wallet/UI tests.

- [ ] **Step 1: Run focused verification**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run build
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test tests/wallet/nativeWallet.test.mjs tests/cli/wallet.test.mjs tests/bot/metabotProfileManager.test.mjs tests/daemon/httpServer.test.mjs tests/ui/botPageScript.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Start dev daemon for browser acceptance**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm run dev:daemon
```

Open the reported `/ui/bot` URL with the Browser plugin. Verify:

- Wallet modal opens.
- Four chain rows are visible.
- Balances render with `BTC`, `SPACE`, `Doge`, and `OPCAT-BTC`.
- Transfer buttons open the form.
- An amount above the displayed balance is blocked locally.
- A valid amount reaches preview without broadcasting.

Do not confirm real transfers unless the operator explicitly asks for a live transfer.

- [ ] **Step 3: Request final code review**

Dispatch a review subagent with model `gpt-5.5`. Provide:

- Base commit before Task 1.
- Current head commit.
- SDD path.
- This implementation plan path.
- Focused verification output.

Fix Critical and Important findings before final acceptance.

- [ ] **Step 4: Commit acceptance fixes if any**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: polish four-chain wallet acceptance"
```

Controller follow-up after this task: post an on-chain development diary for the commit with `metabot-post-buzz`.

If no fixes were needed, do not create an empty commit.

---

## Completion Checklist

- [ ] Design doc committed and buzz posted.
- [ ] Shared wallet operations committed and buzz posted.
- [ ] Daemon/bot routes committed and buzz posted.
- [ ] UI transfer flow committed and buzz posted.
- [ ] Focused verification passes under Node 22.
- [ ] Browser acceptance performed without unintended broadcasts.
- [ ] Final review has no unresolved Critical or Important findings.
