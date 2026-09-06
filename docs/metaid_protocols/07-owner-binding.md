# 07. MetaBot Owner Binding (`/info/owner`)

> Status: draft (IDBots `feat/human-identity-metabot-binding`). To be merged into `open-agent-connect/docs/metaid_protocols`.

A MetaBot declares its human owner by publishing an `/info/owner` pin whose
payload embeds the owner's cryptographic consent. The binding is two-party by
construction:

- **MetaBot side** — the pin itself is created and signed on-chain by the
  MetaBot's own key (pin metadata carries the creator's address/globalMetaId).
- **Owner side** — the payload embeds the human owner's signature over the
  binding statement, made with the owner's MetaID identity key.

Bot Info semantics apply: the **latest** pin at `/info/owner` for a MetaBot is
the current binding. An empty payload means *unbound*.

## Path

`/info/owner` — `application/json` (SDD 7-tuple, `operation: create`,
`encryption: 0`, `version: 1.0`).

## Signed message

```
metabot-owner-binding:<botGlobalMetaId>
```

- Lowercase; the prefix domain-separates the statement so the signature cannot
  be replayed into other protocols.
- The signed message MUST contain the GlobalMetaID of the MetaBot that
  publishes the pin (verifiers check this — see below), which prevents
  re-attaching a signature collected for a different bot.

## Payload

```json
{
  "version": 1,
  "owner": "idq1<ownerGlobalMetaId>",
  "ownerPublicKey": "02<33-byte compressed secp256k1 pubkey hex>",
  "signedMessage": "metabot-owner-binding:idq1<botGlobalMetaId>",
  "signature": "<base64, 65-byte compact recoverable signature>",
  "algorithm": "ecdsa-secp256k1-bitcoin-message"
}
```

| field | meaning |
|---|---|
| `version` | payload version, currently `1` |
| `owner` | owner's GlobalMetaID (P2PKH flavor, `idq1...`) |
| `ownerPublicKey` | owner's compressed secp256k1 public key, hex |
| `signedMessage` | the exact byte string that was signed |
| `signature` | Bitcoin Signed Message signature (base64, 65 bytes: header ‖ r ‖ s) |
| `algorithm` | `ecdsa-secp256k1-bitcoin-message` |

Unbind: publish an `/info/owner` pin with an **empty payload**.

## Verification (offline, self-contained)

Given the MetaBot's GlobalMetaID and its latest `/info/owner` pin payload:

1. Parse the payload; require `version == 1` and
   `algorithm == "ecdsa-secp256k1-bitcoin-message"`.
2. Require `signedMessage == "metabot-owner-binding:<botGlobalMetaId>"` for
   **this** MetaBot.
3. Decode `owner` (GlobalMetaID, id-address format) to its 20-byte P2PKH
   payload. Require `hash160(ownerPublicKey) == payload`. This proves the
   public key belongs to the declared owner GlobalMetaID.
4. Verify `signature` as a Bitcoin Signed Message over `signedMessage` with
   `ownerPublicKey` (magic prefix `"Bitcoin Signed Message:\n"`, double
   SHA-256, secp256k1 ECDSA).

No chain queries are needed: GlobalMetaID embeds the owner's pubkey hash, and
the payload carries everything else.

## Notes for implementers

- The owner's identity key is the MVC/identity secp256k1 key derived from the
  owner's mnemonic (default path `m/44'/10001'/0'/0/0`); this is the same key
  whose hash is encoded in the owner GlobalMetaID.
- Reference implementation (sign & verify): IDBots
  `src/main/services/ownerBindingService.ts`.
- Changing the owner publishes a new `/info/owner` pin that supersedes the
  previous one; historical pins remain on-chain for audit.
