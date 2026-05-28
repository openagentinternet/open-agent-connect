# MetaBot Large File Upload API Notes

Date: 2026-05-27

Scope: Task 1 research gate for adding an OAC large-file upload path. This note does not implement feature code. The OAC target hard cap is 50 MiB, not the historical IDBots 20 MiB cap.

## Decision

Decision: block and add missing signer/wallet capability first.

OAC already has a production direct-upload capability for small files through `Signer.writePin`, but the candidate production large-upload API requires wallet primitives that are not exposed by the current OAC `Signer` interface. The implementation should add and verify an OAC-owned signer/wallet boundary for MVC large-upload funding and pre-transaction signing before wiring a production chunked upload command.

## Available OAC Direct Upload Capability

`src/core/files/uploadFile.ts` provides the current file upload path:

- It resolves a local path, reads the whole file into memory, infers or accepts a content type, and rejects DOGE.
- It writes one `/file` pin by calling `input.signer.writePin({ path: '/file', payload: buffer.toString('base64'), contentType, encoding: 'base64', network })`.
- It returns `pinId`, `txids`, `totalCost`, `network`, local file metadata, `metafileUri`, and `globalMetaId`.

This is suitable as the OAC direct path for files at or below the planned 2 MiB direct threshold, subject to adding mode metadata later. It is not a chunked uploader because it loads the full file and relies on one chain write.

## Candidate Production Large-Upload API

The browser MetaFS uploader reference uses `https://file.metaid.io/metafile-uploader` as the base URL. The large-file flow is:

1. Upload the file bytes to multipart object storage.
2. Ask the uploader to estimate chunked-upload funding.
3. Build signed funding/pre-transactions with wallet primitives.
4. Submit the chunked upload request and receive the index transaction result.

Known endpoint request shapes from the browser reference:

### Direct Upload Endpoint

`POST /api/v1/files/direct-upload`

Content type: `multipart/form-data`

Fields:

- `file`: file body
- `path`: `/file/<sanitized file name>`
- `mergeTxHex`: optional signed merge transaction hex
- `preTxHex`: signed pre-transaction hex
- `operation`: `create`
- `contentType`: MIME type, with `;binary` appended for non-text files in the browser reference
- `metaId`: wallet MetaID
- `address`: wallet address
- `changeAddress`: wallet address
- `feeRate`: numeric string
- `totalInputAmount`: numeric string

Response handling in the reference expects JSON with `code === 0` and returns `data`.

### Multipart Object Storage Endpoints

`POST /api/v1/files/multipart/initiate`

JSON request:

```json
{
  "fileName": "demo.mp4",
  "fileSize": 3145728,
  "metaId": "metaid",
  "address": "address"
}
```

Known JSON response data: `uploadId`, `key`.

`POST /api/v1/files/multipart/upload-part`

JSON request:

```json
{
  "uploadId": "upload id",
  "key": "storage key",
  "partNumber": 1,
  "content": "base64 chunk"
}
```

Known JSON response data: `etag`.

`POST /api/v1/files/multipart/complete`

JSON request:

```json
{
  "uploadId": "upload id",
  "key": "storage key",
  "parts": [
    {
      "partNumber": 1,
      "etag": "etag",
      "size": 1048576
    }
  ]
}
```

Known JSON response data: `key`.

### Chunked Upload Estimate Endpoint

`POST /api/v1/files/estimate-chunked-upload`

JSON request:

```json
{
  "fileName": "demo.mp4",
  "path": "/file/demo.mp4",
  "contentType": "video/mp4;binary",
  "feeRate": 1,
  "storageKey": "storage key"
}
```

Known JSON response data from IDBots production worker usage: `chunkPreTxFee`, `indexPreTxFee`.

### Chunked Upload Endpoint

`POST /api/v1/files/chunked-upload`

JSON request:

```json
{
  "metaId": "metaid",
  "address": "address",
  "fileName": "demo.mp4",
  "path": "/file/demo.mp4",
  "operation": "create",
  "contentType": "video/mp4;binary",
  "chunkPreTxHex": "signed chunk funding pre-tx hex",
  "indexPreTxHex": "signed index funding pre-tx hex",
  "mergeTxHex": "signed merge tx hex",
  "feeRate": 1,
  "isBroadcast": true,
  "storageKey": "storage key"
}
```

Known JSON response handling:

- The reference requires `code === 0`.
- `data.status`, when present, must be `success`.
- The durable index transaction id is read as `data.indexTxId` or `data.txId`.
- The final pin id is expected to be `<indexTxId>i0`.

### Chunked Upload Task Endpoint

`POST /api/v1/files/chunked-upload-task`

This endpoint accepts the same chunked-upload identity, file, path, content type, pre-transaction, merge transaction, fee rate, and storage key fields, but the browser reference does not pass `isBroadcast`. It returns `data` after requiring `code === 0`. This looks like an async task variant rather than the primary CLI target.

## Required Signer and Wallet Primitives

The browser reference requires these primitives:

- Current MetaID and wallet address.
- UTXO discovery with spendable outpoints and values.
- For direct upload: build a signed base pre-transaction from exactly one funding UTXO using the wallet signature flow, then pass `preTxHex` and the total input amount.
- Optional UTXO merge for direct upload when more than one funding UTXO is needed.
- For chunked upload: estimate two funding outputs, build a signed merge transaction that creates chunk and index funding outputs, derive each output script/index/amount, and build signed chunk/index pre-transactions.
- Wallet signing modes equivalent to the browser `window.metaidwallet.signTransaction` calls using sigtype `0x3 | 0x80 | 0x40` for the direct SIGHASH_SINGLE path and sigtype `0x2 | 0x40` for the chunk/index pre-transaction path.
- A wallet payment/signing capability equivalent to `window.metaidwallet.pay` for merge transactions, or an OAC-local equivalent that can build and sign the same transaction safely.
- Stale-input handling around MVC funding UTXO selection and retry.

## Do These Primitives Already Exist in OAC?

Partially, but not at the boundary needed for this feature.

The public `Signer` interface exposes only:

- `getIdentity()`
- `getPrivateChatIdentity()`
- `writePin(input)`

The local mnemonic signer implementation delegates `writePin` to chain adapters and broadcasts signed inscription transactions, but it does not expose UTXO listing, arbitrary transaction signing, merge transaction construction, pre-transaction signing, or the browser wallet `pay` semantics required by the MetaFS uploader API.

Therefore, Task 2 should not call the browser MetaFS chunked endpoints directly through the current `Signer` shape. A preceding OAC-owned wallet capability should expose a narrow, testable MVC large-upload funding API, or the large-upload implementation should be explicitly blocked until that API exists.

## IDBots Boundary Findings

IDBots is useful as a reference, not a dependency:

- Its skill script calls a local IDBots RPC endpoint at `/api/idbots/files/upload-largefile`.
- It requires `IDBOTS_METABOT_ID` and optionally `IDBOTS_RPC_URL`.
- Its historical skill cap is 20 MiB, while OAC's target hard cap is 50 MiB.
- The IDBots worker already follows the production MetaFS flow: multipart storage, estimate, local MVC funding UTXO selection, merge/pre-transaction construction, `chunked-upload`, then `pinId = indexTxId + "i0"`.

OAC should not depend on `IDBOTS_METABOT_ID`, IDBots local RPC, or IDBots runtime layout.

## References Inspected

- `AGENTS.md` lines 1-45: commit, buzz diary, documentation language, and verification policy.
- `docs/superpowers/plans/2026-05-27-metabot-upload-largefile-implementation.md` lines 1-160: broader implementation context, limits, and Task 1 acceptance.
- `src/core/files/uploadFile.ts` lines 56-97: OAC direct upload reads the file, rejects DOGE, writes `/file` through `Signer.writePin`, and returns the direct upload result.
- `src/core/signing/signer.ts` lines 10-14: current signer boundary exposes identity, private chat identity, and `writePin` only.
- `src/core/signing/localMnemonicSigner.ts` lines 95-153: local mnemonic signer implementation exposes `writePin`, delegates to chain adapters, and broadcasts adapter-built signed transactions.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 270-275: MetaFS uploader base URL.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 427-535: browser wallet UTXO lookup, merge, and direct pre-transaction signing.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 537-562: direct upload endpoint shape.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 577-659: multipart upload and chunked estimate endpoint shapes.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 662-781: chunked merge/pre-transaction building and `chunked-upload` endpoint shape.
- `src/ui/metaapps/buzz/idframework/commands/PostBuzzCommand.js` lines 784-808: `chunked-upload-task` endpoint shape.
- `src/ui/metaapps/chat/idframework/commands/PostBuzzCommand.js` lines 270-808: same browser MetaFS uploader flow in the chat metaapp reference.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/SKILL.md` lines 11-14 and 71-78: IDBots direct/chunked thresholds, historical 20 MiB cap, and MVC-only large upload warning.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile/scripts/upload-largefile.js` lines 5-6 and 44-63: script delegates to IDBots local RPC and requires `IDBOTS_METABOT_ID`.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/metaidRpcServer.ts` lines 37-50: IDBots local RPC path constants.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/libs/uploadLargeFileWorker.ts` lines 309-350: IDBots production worker reads the file, enforces effective limits, uploads multipart storage, and estimates chunked upload.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/libs/uploadLargeFileWorker.ts` lines 360-478: IDBots production worker selects MVC funding, builds merge/pre-transactions, calls `chunked-upload`, and emits `pinId`.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/metaFileUploadShared.js` lines 93-147: IDBots mode selection and normalized success payload.
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/libs/uploadLargeFileFunding.ts` lines 7-59: IDBots MVC funding UTXO normalization, selection, and retryable stale-input classification.

## Safety Notes

This note intentionally omits secrets, private keys, local wallet data, live UTXO values, and large copied code blocks. Example JSON values are placeholders only.
