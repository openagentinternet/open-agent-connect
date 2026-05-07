# Goal-Driven: Wallet Module Multi-Chain Architecture Refactoring

## Goal

[[[[[Refactor the wallet module (`src/core/signing/`, `src/core/chain/`, `src/core/identity/`, `src/cli/runtime.ts`, `src/cli/commands/wallet.ts`, `src/cli/types.ts`) into a pluggable multi-chain architecture. Each supported blockchain network MUST be implemented as a self-contained `ChainAdapter` that supplies address derivation, UTXO queries, balance queries, fee rate queries, transaction broadcasting, transfer building, and inscription (writePin) building. Adding a new UTXO network MUST require only creating one new adapter file implementing the `ChainAdapter` interface, plus registering it in the adapter registry — no edits to Signer, CLI wiring, or command modules. Use full Dogecoin (DOGE) integration as the validation target: DOGE balance queries, DOGE transfers, and DOGE chain-write inscriptions MUST all work end-to-end with real on-chain transactions.]]]]]

## Criteria for Success

[[[[[

### C1. Architecture criteria (verifiable by code inspection)

- **C1a.** A TypeScript interface named `ChainAdapter` exists that declares the complete contract for a blockchain network. No chain-specific logic (MVC, BTC, DOGE) appears outside of adapter implementation files.
- **C1b.** Three concrete adapter files exist: `MvcChainAdapter`, `BtcChainAdapter`, `DogeChainAdapter`. Each is the single source of truth for its chain's API endpoints, transaction building, and parameters.
- **C1c.** `src/core/signing/localMnemonicSigner.ts` contains NO `if (network === 'mvc')` / `else if (network === 'btc')` chain-dispatch logic. Chain selection goes through an adapter registry (map/dictionary lookup by `ChainWriteNetwork`).
- **C1d.** `src/cli/runtime.ts` contains NO chain-specific balance fetching functions (`fetchMvcBalanceSnapshot`, `fetchBtcBalanceSnapshot`). Balance queries go through `ChainAdapter.fetchBalance()`.
- **C1e.** `src/cli/runtime.ts` contains NO chain-specific transfer execution functions (`executeMvcTransfer`, `executeBtcTransfer`). Transfers go through `ChainAdapter.buildTransfer()` + `ChainAdapter.broadcastTx()`.
- **C1f.** `src/cli/runtime.ts` contains NO chain-specific fee rate fetching. Fee rates go through `ChainAdapter.fetchFeeRate()`.
- **C1g.** `src/cli/commands/wallet.ts` accepts `--chain doge` without any hardcoded chain name validation (the chain list comes from the adapter registry).
- **C1h.** `src/cli/types.ts` wallet balance and transfer types accept any registered chain, not just `'mvc' | 'btc'`.
- **C1i.** `DerivedIdentity` no longer hardcodes `mvcAddress`, `btcAddress`, `dogeAddress` as fixed fields. Addresses are stored in a dynamic `addresses` map keyed by chain network name.
- **C1j.** Block explorer URL for each chain is configured in its adapter (via an `explorerBaseUrl` property or equivalent), not hardcoded in CLI transfer output.

### C2. Correctness criteria (verifiable by running existing tests)

- **C2a.** `npm run build` succeeds with zero TypeScript errors.
- **C2b.** `npm test` passes with all existing tests green.

### C3. DOGE integration criteria (verifiable by sending real transactions)

The test identity is the local MetaBot profile **"eric"**:

| Chain | Address |
|-------|---------|
| MVC | `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` |
| BTC | `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` |
| DOGE | `DJfAud3S8P76aXH3eeY9FgFpjK6coMpFjt` |

The identity mnemonic is stored at `~/.metabot/profiles/eric/.runtime/identity-secrets.json`. GlobalMetaId: `idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k`.

Before verifying DOGE criteria, the tester MUST ensure each address has sufficient balance (at minimum: 0.01 DOGE, a few thousand MVC satoshis, a few thousand BTC satoshis).

- **C3a.** `metabot wallet balance --chain doge` (run with eric as the active identity) returns a balance result that matches the on-chain DOGE balance of `DJfAud3S8P76aXH3eeY9FgFpjK6coMpFjt`.
- **C3b.** `metabot wallet balance --chain mvc` (run with eric) returns a balance matching `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` on MVC.
- **C3c.** `metabot wallet balance --chain btc` (run with eric) returns a balance matching `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` on BTC.
- **C3d.** `metabot wallet balance --chain all` (run with eric) returns balances for all three chains.
- **C3e.** `metabot wallet transfer --to <DOGE_RECIPIENT> --amount 0.01DOGE --confirm` (run with eric) successfully broadcasts a DOGE transfer and returns a txid. Verify on dogechain.info that the transaction confirms.
- **C3f.** `metabot wallet transfer --to <MVC_RECIPIENT> --amount 0.00001SPACE --confirm` (run with eric) successfully broadcasts an MVC transfer and returns a txid. Verify on mvcscan.com.
- **C3g.** `metabot wallet transfer --to <BTC_RECIPIENT> --amount 0.00001BTC --confirm` (run with eric) successfully broadcasts a BTC transfer and returns a txid. Verify on mempool.space.
- **C3h.** `metabot chain write --network doge --operation create --path /protocols/simplebuzz --payload 'hello, I am from DOGE'` (run with eric) successfully broadcasts a DOGE MetaID inscription and returns a txid + pinId. The pinId equals `{txid}i0`. Wait 5-10 seconds after broadcast, then GET `https://manapi.metaid.io/pin/{pinId}` — the response MUST contain the pin data with `path: "/protocols/simplebuzz"` and the payload content.
- **C3i.** `metabot chain write --network mvc --operation create --path /protocols/simplebuzz --payload 'hello, I am from MVC'` (run with eric) successfully broadcasts an MVC MetaID inscription and returns a txid + pinId. Wait 5-10 seconds, then GET `https://manapi.metaid.io/pin/{pinId}` — the response MUST contain the pin data.
- **C3j.** `metabot chain write --network btc --operation create --path /protocols/simplebuzz --payload 'hello, I am from BTC'` (run with eric) successfully broadcasts a BTC MetaID inscription and returns a txid + pinId. Wait 5-10 seconds, then GET `https://manapi.metaid.io/pin/{pinId}` — the response MUST contain the pin data.

### C4. Extensibility criteria (verifiable by code inspection)

- **C4a.** A developer adding a hypothetical new UTXO network ("Litecoin" or similar) needs only: ① one new adapter file implementing `ChainAdapter`, ② one line registering it in the adapter registry. No changes to Signer, CLI commands, runtime wiring, or type files.
- **C4b.** The `ChainAdapter` interface is documented with JSDoc comments on each method explaining the expected input/output and any chain-specific behavior (e.g., fee rate units).

]]]]]

## Background

### Current Problems

The wallet module currently supports MVC and BTC but the implementation is fragmented:

1. **No per-chain abstraction.** `localMnemonicSigner.ts` (900 lines) dispatches chain logic via `if (network === 'mvc') ... else if (network === 'btc')`. Adding a new chain means editing this file's internals.

2. **Balance/transfer bypass the Signer.** In `cli/runtime.ts`, balance queries and transfers call chain-specific functions directly (`fetchMvcBalanceSnapshot`, `fetchBtcBalanceSnapshot`, `executeMvcTransfer`, `executeBtcTransfer`). The Signer interface has no `getBalance()` or `transfer()` methods.

3. **Hardcoded chain lists everywhere.** `WalletBalanceChain` is `'all' | 'mvc' | 'btc'`. `ParsedTransferAmount.chain` is `'mvc' | 'btc'`. The wallet CLI command validates chain names with hardcoded strings.

4. **DerivedIdentity couples all chains.** The `DerivedIdentity` type has fixed `mvcAddress`, `btcAddress`, `dogeAddress` fields. Adding a fourth chain requires touching identity derivation, secret store, runtime state, and bootstrap.

5. **DOGE is partially stubbed but non-functional.** `ChainWriteNetwork` already includes `'doge'`. `deriveIdentity` already derives a `dogeAddress`. But `writePin`, balance, and transfer all reject or ignore DOGE.

### External References for DOGE Implementation

The Metalet wallet extension (`/Users/tusm/Documents/MetaID_Projects/metalet-extension-next`) and IDBots (`/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src`) contain complete DOGE implementation references:

- **UTXO query:** `GET {METALET_HOST}/wallet-api/v4/doge/address/utxo-list?address={}&net=livenet` → `{ code: 0, data: { list: [{ txid, outIndex, value, height }] } }`
- **Balance query:** `GET {METALET_HOST}/wallet-api/v4/doge/address/balance-info?address={}&net=livenet` → `{ code: 0, data: { address, confirmed, unconfirmed, utxoCount } }`
- **Fee rate:** `GET {METALET_HOST}/wallet-api/v4/doge/fee/summary?net=livenet` → `{ code: 0, data: { list: [{ title, feeRate }] } }`. **Important:** DOGE fee rates are in **satoshis per KILOBYTE** (sat/KB), not sat/byte like MVC/BTC. The adapter must handle unit conversion internally.
- **Broadcast:** `POST {METALET_HOST}/wallet-api/v4/doge/tx/broadcast` body `{ net, rawTx }` → `{ code: 0, data: { TxId } }`
- **Block explorer:** `https://dogechain.info/tx/{txid}`
- **Transaction building:** `DogeWallet` from `@metalet/utxo-wallet-service` (already in package.json). DOGE uses commit-reveal for inscriptions (same pattern as BTC). Transfers use `DogeWallet.signTx(SignType.SEND, ...)` or bitcoinjs-lib Psbt with P2PKH inputs.
- **Derivation path:** BIP44 `m/44'/3'/0'/0/{addressIndex}` (coin type 3). DOGE addresses are legacy P2PKH starting with `D`.
- **Dust limit:** 1,000,000 satoshis (0.01 DOGE) for UTXO filtering. 600 satoshis for minimum transfer.

The Metalet API host is `https://www.metalet.space` (defined in `localMnemonicSigner.ts` as `METALET_HOST`).

## Target Architecture

### `ChainAdapter` Interface

This is the core abstraction. Every supported blockchain network implements this interface.

```typescript
interface ChainAdapter {
  /** Unique network identifier matching ChainWriteNetwork values */
  readonly network: ChainWriteNetwork;

  /** Base URL for block explorer, e.g. "https://dogechain.info" */
  readonly explorerBaseUrl: string;

  /**
   * Fee rate unit for this chain.
   * "sat/byte" for MVC and BTC, "sat/KB" for DOGE.
   * The adapter handles unit conversion internally so callers always
   * get a usable fee rate number for transaction building.
   */
  readonly feeRateUnit: 'sat/byte' | 'sat/KB';

  /** Minimum transfer amount in satoshis (dust limit) */
  readonly minTransferSatoshis: number;

  /**
   * Derive the chain-specific address from a BIP39 mnemonic and derivation path.
   * Each adapter knows its own coin type and address format.
   */
  deriveAddress(mnemonic: string, path: string): Promise<string>;

  /** Fetch UTXOs for an address. Returns confirmed UTXOs with txid, outputIndex, satoshis. */
  fetchUtxos(address: string): Promise<ChainUtxo[]>;

  /** Fetch balance summary for an address. */
  fetchBalance(address: string): Promise<ChainBalance>;

  /** Fetch current recommended fee rate. Unit is adapter-specific (see feeRateUnit). */
  fetchFeeRate(): Promise<number>;

  /** Fetch the raw transaction hex for a given txid. */
  fetchRawTx(txid: string): Promise<string>;

  /** Broadcast a raw transaction hex. Returns the txid. */
  broadcastTx(rawTx: string): Promise<string>;

  /**
   * Build and sign a transfer transaction.
   * Returns the signed raw transaction hex — does NOT broadcast.
   * Caller chains broadcastTx() afterward.
   */
  buildTransfer(input: ChainTransferInput): Promise<ChainTransferResult>;

  /**
   * Build and sign a MetaID inscription (writePin) transaction.
   * For chains using commit-reveal (BTC, DOGE), returns both commit and reveal txids.
   * For chains using single-TX (MVC), returns one txid.
   * Returns the signed raw transaction(s) — does NOT broadcast.
   */
  buildInscription(input: ChainInscriptionInput): Promise<ChainInscriptionResult>;
}
```

### Shared Types

```typescript
interface ChainUtxo {
  txId: string;
  outputIndex: number;
  satoshis: number;
  address: string;
  height: number;
  rawTx?: string; // required for P2PKH signing on some chains
}

interface ChainBalance {
  chain: ChainWriteNetwork;
  address: string;
  totalSatoshis: number;
  confirmedSatoshis: number;
  unconfirmedSatoshis: number;
  utxoCount: number;
}

interface ChainTransferInput {
  mnemonic: string;
  path: string;
  toAddress: string;
  amountSatoshis: number;
  feeRate?: number;
}

interface ChainTransferResult {
  rawTx: string;
  fee: number;
}

interface ChainInscriptionInput {
  request: NormalizedChainWriteRequest;
  identity: DerivedIdentity;
  feeRate?: number;
}

interface ChainInscriptionResult {
  txids: string[];
  pinId: string;
  totalCost: number;
}
```

### `DerivedIdentity` Refactoring

Change from hardcoded fields:

```typescript
// BEFORE (hardcoded)
interface DerivedIdentity {
  mnemonic: string;
  path: string;
  publicKey: string;
  chatPublicKey: string;
  mvcAddress: string;
  btcAddress: string;
  dogeAddress: string;
  metaId: string;
  globalMetaId: string;
}

// AFTER (dynamic)
interface DerivedIdentity {
  mnemonic: string;
  path: string;
  publicKey: string;
  chatPublicKey: string;
  /** Chain addresses keyed by ChainWriteNetwork. Always includes "mvc" at minimum. */
  addresses: Record<string, string>;
  /** Convenience getter: same as addresses['mvc'] */
  mvcAddress: string;
  metaId: string;
  globalMetaId: string;
}
```

The `mvcAddress` getter is preserved for backward compatibility — many consumers depend on it. `metaId` and `globalMetaId` remain MVC-derived as they are fundamental to the MetaID identity system.

### Signer Refactoring

`createLocalMnemonicSigner` changes from accepting individual `mvcTransport`/`btcTransport`/`btcCreatePin` options to accepting a `ChainAdapterRegistry`:

```typescript
type ChainAdapterRegistry = Map<ChainWriteNetwork, ChainAdapter>;

function createLocalMnemonicSigner(input: {
  secretStore: SecretStore;
  adapters: ChainAdapterRegistry;
}): Signer
```

The `Signer.writePin` method looks up the adapter by `request.network` and delegates `buildInscription` + `broadcastTx` to it.

### CLI Refactoring

`src/cli/runtime.ts` wallet handlers change from:

```typescript
// BEFORE
const result = parsed.chain === 'btc'
  ? await executeBtcTransfer(transferInput)
  : await executeMvcTransfer(transferInput);

// AFTER
const adapter = adapters.get(parsed.chain);
const { rawTx } = await adapter.buildTransfer(transferInput);
const txid = await adapter.broadcastTx(rawTx);
```

Balance queries use `adapter.fetchBalance(address)` instead of `fetchMvcBalanceSnapshot`/`fetchBtcBalanceSnapshot`.

Fee rates use `adapter.fetchFeeRate()` instead of chain-branching in `fetchTransferFeeRate`.

### File Structure

```
src/core/chain/
  adapters/
    types.ts           # ChainAdapter interface + shared types
    registry.ts        # ChainAdapterRegistry type + factory
    mvc.ts             # MvcChainAdapter
    btc.ts             # BtcChainAdapter
    doge.ts            # DogeChainAdapter
  writePin.ts          # (existing, minor updates for types)
```

### Construction Notes for DOGE Adapter

The DOGE adapter implementation should reference:

**For transfer building:**
- Use `DogeWallet` from `@metalet/utxo-wallet-service` (already imported in `deriveIdentity.ts`)
- Or use bitcoinjs-lib Psbt approach (reference: `metalet-extension-next/src/lib/doge/wallet.ts`)
- P2PKH inputs only — DOGE does not support SegWit
- Fee estimation: `Math.ceil(txSize * feeRate / 1000)` (converts sat/KB to actual fee)

**For inscription building (writePin):**
- Commit-reveal pattern (same as BTC)
- Reference: `metalet-extension-next/src/lib/actions/doge/inscribe.ts` or `IDBots/IDBots/src/main/libs/dogeInscribe.ts`
- Uses `DogeWallet` or raw bitcoinjs-lib
- MetaID data: `metaid` + operation + contentType + encryption + version + path + body

**Dust filtering:**
- UTXOs below 1,000,000 satoshis (0.01 DOGE) are excluded from selection
- Minimum transfer: 600 satoshis

**Fee rate:**
- DOGE fee rates are sat/KB, not sat/byte
- Default fallback: 200,000 sat/KB (Fast tier)
- The adapter internally converts sat/KB to actual fee for given tx size

## Implementation Guidance

### What NOT to change

- `src/core/chain/writePin.ts` — the `ChainWriteNetwork` type, `ChainWriteRequest`, `ChainWriteResult`, and `normalizeChainWriteRequest` are already correct. Only minor updates if `DerivedIdentity` shape changes.
- `src/core/identity/deriveIdentity.ts` — the key derivation logic (BIP39, ECDH, GlobalMetaId encoding) is correct. Refactor `DerivedIdentity` type and `deriveIdentity()` to loop over adapters for address derivation instead of hardcoding three wallets.
- `src/core/secrets/secretStore.ts` — update `LocalIdentitySecrets` to use `addresses: Record<string, string>` instead of fixed fields.
- `src/core/bootstrap/` — update to use dynamic addresses.
- `src/daemon/` — the daemon handler that resolves payment addresses by chain should use the adapter registry.
- Tests — existing test files should be updated to use the new adapter interfaces. No test logic changes needed.

### Implementation Order (Recommended)

1. Define `ChainAdapter` interface and shared types in `src/core/chain/adapters/types.ts`
2. Implement `MvcChainAdapter` by extracting MVC logic from `localMnemonicSigner.ts` and `cli/runtime.ts`
3. Implement `BtcChainAdapter` by extracting BTC logic
4. Implement `DogeChainAdapter` using Metalet v4 API endpoints and DogeWallet
5. Refactor `DerivedIdentity` to use dynamic addresses
6. Refactor Signer (`createLocalMnemonicSigner`) to use adapter registry
7. Refactor CLI (`cli/runtime.ts`, `cli/commands/wallet.ts`, `cli/types.ts`) to use adapters
8. Update secret store, bootstrap, daemon, and tests for new types
9. Run `npm run build && npm test` and fix any failures
10. Run real transaction tests (C3a through C3j)

### Testing Strategy

- **Unit tests:** Each adapter's transaction building logic should be testable in isolation
- **Integration tests:** The Signer with adapter registry should pass existing tests
- **Real transaction tests:** Manual verification using criteria C3a through C3j

## Notes

1. The `globalMetaId` is fundamentally tied to the MVC address (it's a bech32 encoding of the MVC address hash). This is a MetaID protocol design choice and should NOT be refactored. The `mvcAddress` convenience getter on `DerivedIdentity` preserves this invariant.

2. DOGE inscription (writePin) uses commit-reveal like BTC, but the script construction details differ (DOGE uses P2SH, BTC uses taproot-style reveals). Each adapter handles its own inscription format.

3. Some chains share the same address (BTC SameAsMvc, DOGE DogeSameAsMvc). This is expected and handled by each adapter's `deriveAddress` method.

4. The Metalet API v4 endpoints follow a consistent pattern: `wallet-api/v4/{chain}/address/utxo-list`, `wallet-api/v4/{chain}/address/balance-info`, `wallet-api/v4/{chain}/fee/summary`, `wallet-api/v4/{chain}/tx/broadcast`. When adding a new network supported by Metalet, the adapter implementation is mostly copy-paste with the chain name changed.
