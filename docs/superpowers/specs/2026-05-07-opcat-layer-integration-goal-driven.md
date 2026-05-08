# Goal-Driven: OPCAT-Layer Network Integration

## Goal

[[[[[Add OPCAT-Layer (`'opcat'`) as a supported blockchain network in the MetaBot multi-chain adapter architecture. Implement a single new `OpcatChainAdapter` file implementing the `ChainAdapter` interface. OPCAT-Layer is an MVC-like UTXO chain forked from BTC, supporting only legacy P2PKH addresses, OP_RETURN data inscription (no commit-reveal), and standard bitcoinjs-lib transaction signing. The integration MUST enable OPCAT-Layer balance queries, OPCAT-Layer transfers, and OPCAT-Layer chain-write inscriptions using the existing adapter registry pattern — zero changes to Signer, CLI wiring, or command modules.]]]]]

## Criteria for Success

[[[[[

### C1. Integration criteria (verifiable by code inspection)

- **C1a.** One new file `src/core/chain/adapters/opcat.ts` exists exporting `opcatChainAdapter: ChainAdapter`.
- **C1b.** `src/core/chain/adapters/registry.ts` registers `opcatChainAdapter` into the default adapter registry (one additional entry in `createDefaultChainAdapterRegistry`).
- **C1c.** No changes to Signer (`localMnemonicSigner.ts`), CLI runtime wiring (`cli/runtime.ts` wallet handlers), or CLI command modules (`wallet.ts`, `chain.ts`, `types.ts`).
- **C1d.** `DerivedIdentity.addresses` includes an `'opcat'` key populated during identity derivation (already handled by the dynamic adapter loop in `deriveIdentity.ts` — no code change needed).
- **C1e.** `ChainWriteNetwork` union type already includes `'opcat'` (or the string `'opcat'` is accepted at runtime via the registry — no type-level change needed if `ChainWriteNetwork` is derived from registry keys).

### C2. Correctness criteria (verifiable by running tests)

- **C2a.** `npm run build` succeeds with zero TypeScript errors.
- **C2b.** `npm test` passes with all existing tests green.

### C3. OPCAT-Layer integration criteria (verifiable by sending real transactions)

The test identity is the local MetaBot profile **"eric"**:

| Chain | Address |
|-------|---------|
| MVC | `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` |
| BTC | `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` |
| OPCAT | `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` |

The identity mnemonic is stored at `~/.metabot/profiles/eric/.runtime/identity-secrets.json`. GlobalMetaId: `idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k`.

- **C3a.** `metabot wallet balance --chain opcat` (run with eric as the active identity) returns a balance result for address `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` on OPCAT-Layer.
- **C3b.** `metabot wallet balance --chain all` returns balances for all four chains (mvc, btc, doge, opcat).
- **C3c.** `metabot wallet transfer --to <OPCAT_RECIPIENT> --amount 0.00001OPCAT --confirm` (run with eric) successfully broadcasts an OPCAT-Layer transfer and returns a txid. Verify on `https://mempool.opcatlabs.io/tx/{txid}` that the transaction confirms.
- **C3d.** `metabot chain write --chain opcat --request-file <request.json>` with `operation: "create"`, `path: "/protocols/simplebuzz"`, `payload: "hello, I am from OPCAT"` successfully broadcasts an OPCAT-Layer MetaID inscription (OP_RETURN) and returns a txid + pinId. The pinId equals `{txid}i0`.

### C4. Extensibility confirmation

- **C4a.** The OPCAT-Layer adapter confirms C4a from the parent design doc: adding this network required only one new adapter file + one registry entry, with zero changes to shared infrastructure.

]]]]]

## Background

### OPCAT-Layer Summary

OPCAT-Layer is a UTXO public chain forked from BTC (MVC-like). Key characteristics:

- **Network parameters are identical to BTC mainnet**: pubkeyhash `0x00`, scripthash `0x05`, WIF `0x80`, bip32 xpub `0x0488b21e`, xprv `0x0488ade4`. Addresses are indistinguishable from Bitcoin mainnet addresses.
- **Only legacy P2PKH addresses** are supported (no SegWit, no Taproot).
- **No commit-reveal inscription** — MetaID data is written via OP_RETURN in a single transaction (same pattern as MVC).
- **OP_RETURN size**: effectively unlimited (up to 32MB theoretical max).
- **Dust limit**: 1 satoshi.
- **Fee rate**: very low, default ~0.001 sat/byte.
- **Block explorer**: `https://mempool.opcatlabs.io`.
- **Docs**: `https://docs.opcatlabs.io/overview`.

### API Reference

Two API layers exist. The wallet extension uses v5; the SDK uses v1. We use v5 for primary operations and v1 for raw transaction lookup.

**Wallet API v5** (`https://wallet-api.opcatlabs.io`):

```
GET  /v5/address/balance2?address={}
  → { code: 0, data: { availableBalance: number, unavailableBalance: number, totalBalance: number } }

GET  /v5/address/btc-utxo?address={}
  → { code: 0, data: [{ txid, vout, satoshis, scriptPk, data, addressType: "P2PKH" }] }

GET  /v5/default/fee-summary
  → { code: 0, data: { list: [{ title: "Fastest", desc: "10 minutes", feeRate: 0.001 }] } }

POST /v5/tx/broadcast  body: { rawtx }
  → txid string
```

**OpenAPI v1** (`https://openapi.opcatlabs.io`):

```
GET  /api/v1/tx/{txid}/raw
  → { code: 0, data: "<hex>" }
```

### External References

- CATENA Wallet (reference implementation): `/Users/tusm/Documents/MetaID_Projects/wallet-extension`
- OPCAT ts-tools (SDK, network definitions): `/Users/tusm/Documents/MetaID_Projects/wallet-extension/ts-tools`
- Upstream repo: `https://github.com/OPCAT-Labs/ts-tools`
- OPCAT network params: `ts-tools/packages/opcat/esm/networks.js`

### Notes on PIN Indexer

As of writing, `manapi.metaid.io` does not yet support OPCAT-Layer PIN queries. C3d verification will confirm the transaction hash on the block explorer and assume the pinId convention (`{txid}i0`) is correct. Full PIN indexer support is a separate deliverable outside this integration scope.

## Target Architecture

### No Architecture Changes

This is a pure addition to the existing multi-chain adapter architecture. The `ChainAdapter` interface, `ChainAdapterRegistry`, Signer, CLI runtime, and wallet/chain command modules are all unchanged.

### New File

```
src/core/chain/adapters/
  opcat.ts            # OpcatChainAdapter (NEW — the only new file)
```

### Registry Update

```typescript
// src/core/chain/adapters/registry.ts — add one line
export function createDefaultChainAdapterRegistry(): ChainAdapterRegistry {
  return createChainAdapterRegistry([
    mvcChainAdapter,
    btcChainAdapter,
    dogeChainAdapter,
    opcatChainAdapter,  // ← NEW
  ]);
}
```

### OpcatChainAdapter Design

The OPCAT adapter is the simplest adapter in the system because:

1. **No external wallet SDK needed** — standard bitcoinjs-lib handles P2PKH signing (same as DOGE's transfer signing).
2. **No commit-reveal** — inscription is a single OP_RETURN output appended to a transfer transaction (same pattern as MVC).
3. **Network params identical to BTC** — bitcoinjs-lib's built-in `bitcoin.networks.bitcoin` works directly.

```typescript
export const opcatChainAdapter: ChainAdapter = {
  network: 'opcat' as ChainWriteNetwork,
  explorerBaseUrl: 'https://mempool.opcatlabs.io',
  feeRateUnit: 'sat/byte',
  minTransferSatoshis: 1, // OPCAT dust limit

  deriveAddress(mnemonic, path): Promise<string>,
  fetchUtxos(address): Promise<ChainUtxo[]>,
  fetchBalance(address): Promise<ChainBalance>,
  fetchFeeRate(): Promise<number>,
  fetchRawTx(txid): Promise<string>,
  broadcastTx(rawTx): Promise<string>,
  buildTransfer(input): Promise<ChainTransferResult>,
  buildInscription(input): Promise<ChainInscriptionResult>,
};
```

### Transfer Building

Use bitcoinjs-lib P2PKH signing — same approach as `doge.ts` `buildTransfer` but without the `DogeWallet` dependency. The adapter:

1. Derives key pair from mnemonic + path using `ECPairFactory` + `@bitcoinerlab/secp256k1`
2. Fetches UTXOs from v5 API (each has `scriptPk` which is the P2PKH locking script)
3. Builds a bitcoinjs-lib `Transaction`:
   - Add UTXO inputs
   - Add recipient output (P2PKH)
   - Add change output if needed
   - Sign each input with the derived key pair
4. Returns rawTx hex

### Inscription Building (OP_RETURN)

Same pattern as MVC adapter:

1. Build the MetaID inscription payload: `metaid → operation → contentType → encryption → version → path → body`
2. Create a bitcoinjs-lib `Transaction`:
   - Add sufficient UTXO inputs
   - Add OP_RETURN output with the inscription data: `bitcoin.payments.embed({ data: [Buffer.from(payload)] })`
   - Add change output if needed
   - Sign inputs
3. Returns `{ signedRawTxs: [rawTx], revealIndices: [0], totalCost }`

### Derivation Path

OPCAT-Layer shares BIP44 coin type `10001'` with MetaID (same as MVC/BTC). The derivation path `m/44'/10001'/0'/0/0` produces the same address `1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw` due to identical network parameters.

## Implementation Guidance

### What NOT to change

- `src/core/chain/adapters/types.ts` — the `ChainAdapter` interface is complete.
- `src/core/chain/adapters/registry.ts` — only add the registration line, no structural changes.
- `src/core/signing/localMnemonicSigner.ts` — already uses adapter registry, no changes needed.
- `src/cli/runtime.ts` — wallet and chain handlers already use adapters generically.
- `src/cli/commands/wallet.ts` — already reads chain from adapter registry.
- `src/cli/commands/chain.ts` — already uses `readAnyChainFlag`.
- `src/core/identity/deriveIdentity.ts` — dynamic adapter loop already populates `addresses`.
- `src/core/state/runtimeStateStore.ts` — `addresses` map already supports arbitrary chains.

### Implementation Order

1. Create `src/core/chain/adapters/opcat.ts` with the full `ChainAdapter` implementation
2. Register `opcatChainAdapter` in `src/core/chain/adapters/registry.ts`
3. Run `npm run build` and fix any TypeScript errors
4. Run `npm test` and fix any test failures
5. Run real transaction tests (C3a through C3d)

### Construction Notes

**bitcoinjs-lib signing for OPCAT:**

Since OPCAT network params match BTC, the bitcoinjs-lib `bitcoin.networks.bitcoin` can be used directly for address derivation and transaction building. No custom network definition is required.

```typescript
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';

const ecc = await import('@bitcoinerlab/secp256k1');
bitcoin.initEccLib(ecc.default);
const ECPair = ECPairFactory(ecc.default);

// Derive key from mnemonic (BIP44 m/44'/10001'/0'/0/0)
// Use bitcoin.payments.p2pkh({ pubkey, network: bitcoin.networks.bitcoin })
```

**OP_RETURN inscription payload format:**

```
metaid <operation> <contentType> <encryption> <version> <path> <body>
```

Construct as a single Buffer with push-data encoding (same as MVC adapter). The OP_RETURN output is added via `bitcoin.payments.embed({ data: [payloadBuffer] })`.

**API response handling:**

All v5 responses follow `{ code: 0, ... }` where code 0 = success. The adapter should check `code === 0` and throw on non-zero codes.

**Raw transaction fetching:**

Use OpenAPI v1 for rawTx since v5 does not expose this endpoint:

```typescript
async fetchRawTx(txid: string): Promise<string> {
  const url = `https://openapi.opcatlabs.io/api/v1/tx/${txid}/raw`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`OPCAT raw tx fetch failed: ${json.msg}`);
  return json.data;
}
```

**Fee rate selection:**

The v5 fee-summary returns multiple tiers. Prefer "Fastest", fall back to first item, then to default `0.001`:

```typescript
async fetchFeeRate(): Promise<number> {
  const json = await fetchJson('/v5/default/fee-summary');
  const list = json?.data?.list ?? [];
  const fastest = list.find((t: { title: string }) => t.title === 'Fastest');
  return fastest?.feeRate ?? list[0]?.feeRate ?? 0.001;
}
```

### Known Pitfalls

- **No rawTx in v5**: The wallet v5 API does not expose a raw transaction hex endpoint. Use the OpenAPI v1 endpoint `GET /api/v1/tx/{txid}/raw` for `fetchRawTx`.
- **P2PKH only**: OPCAT-Layer rejects SegWit and Taproot addresses. All outputs must be P2PKH.
- **OP_RETURN only**: No commit-reveal pattern exists. Inscription is a single transaction with an OP_RETURN output. The `revealIndices` is always `[0]`.
- **Dust is 1 sat**: Much lower than BTC (546) or DOGE (1,000,000). The adapter's `minTransferSatoshis` should be 1.

## Notes

1. OPCAT-Layer addresses are identical to BTC/MVC addresses because they share the same secp256k1 curve, pubkeyhash prefix, and derivation path. A single mnemonic produces the same address across all three chains.

2. The `@opcat-labs/scrypt-ts-opcat` package's `ExtPsbt` is NOT needed for basic transfers or OP_RETURN inscriptions. Standard bitcoinjs-lib suffices. `ExtPsbt` is only required for CAT20/CAT721 smart contract operations, which are outside the current integration scope.

3. `manapi.metaid.io` PIN indexer support for OPCAT-Layer is pending. C3d verifies the txid and pinId convention but full PIN query verification will require the indexer to add OPCAT-Layer support.

4. The `DerivedIdentity.addresses['opcat']` entry is automatically populated by `deriveIdentity.ts` because address derivation loops over all registered adapters. No identity code changes are needed.
