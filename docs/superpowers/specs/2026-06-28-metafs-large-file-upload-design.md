# MetaFS Large File Upload Design

Date: 2026-06-28
Status: Spec for discussion and implementation planning

## Context

Open Agent Connect already has the right high-level file upload boundary:

- `metabot file upload-large`
- `POST /api/file/upload-large`
- `uploadLargeFileToChain()`
- `ProductionLargeFileUploader`

The current implementation supports direct binary `/file` writes for files at or below the direct threshold, but files above that threshold fail because the default daemon does not inject a production `ProductionLargeFileUploader`.

MetaFS supports large uploads. IDBots already has a working MetaFS chunked upload implementation under:

- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/SKILLs/metabot-upload-largefile`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/libs/uploadLargeFileWorker.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/libs/uploadLargeFileFunding.ts`
- `/Users/tusm/Documents/MetaID_Projects/IDBots/IDBots/src/main/services/metaFileUploadShared.js`

OAC should reuse the protocol behavior and flow, but it must keep OAC's CLI-first model, profile layout, daemon routes, signer abstraction, and test boundaries.

## Goals

- Make `metabot file upload-large` the primary CLI-first large file upload command.
- Allow direct CLI file-path usage without requiring a JSON request file.
- Support one unified upload path for direct files and MetaFS chunked files.
- Support files up to 50 MiB when uploading through MVC and MetaFS chunked upload.
- Keep files at or below 2 MiB on the existing direct binary `/file` write path.
- Make MetaApp publish and Bot Homepage Metafile upload reuse the same large-file upload boundary.
- Keep `metafile://...`, preview URL, download URL, byte size, content type, and upload mode visible in the result.

## Non-Goals

- Do not create a separate `metabot chain write-largefile` or `metabot writechain largefile` command.
- Do not move large file semantics into generic `chain write`; file upload is a higher-level MetaFS workflow, not a single protocol tuple write.
- Do not depend on IDBots RPC, `IDBOTS_METABOT_ID`, IDBots storage layout, or IDBots runtime state.
- Do not support DOGE large file upload.
- Do not claim BTC or OPCAT chunked large-file support until MetaFS and OAC funding support it.
- Do not expose local file contents in model context, logs, skill output, or command-line arguments.
- Do not send direct `/file` payloads as base64. Direct `/file` writes must remain binary payload writes.

## Product Semantics

### Unified Upload Modes

`uploadLargeFileToChain()` remains the core orchestration function.

- Files `<= 2 MiB` use direct upload:
  - read local file;
  - call `Signer.writePin({ path: "/file", payload: Buffer, encoding: "binary" })`;
  - return `uploadMode: "direct"`.
- Files `> 2 MiB` and `<= 50 MiB` use MetaFS chunked upload:
  - MVC only;
  - upload bytes to MetaFS object storage;
  - estimate chunk/index funding;
  - build signed MVC funding and pre-transactions;
  - submit MetaFS `chunked-upload`;
  - return `uploadMode: "chunked"`.
- Files `> 50 MiB` fail before upload with a stable size-limit error.

### CLI UX

The primary human-facing command should be path-first:

```bash
metabot file upload-large --file /absolute/path/to/demo.zip --from bot-60 --chain mvc --verify
```

The command should also accept a positional shorthand:

```bash
metabot file upload-large /absolute/path/to/demo.zip --from bot-60 --verify
```

Optional flags:

- `--content-type <mime>`: override inferred MIME type.
- `--from <bot-slug>`: select the local Bot identity.
- `--chain mvc`: explicit chain selection.
- `--verify`: request post-upload availability verification.
- `--request-file <json>`: compatibility and automation path.

`--request-file` remains supported for agent workflows and shell-escaping safety:

```json
{
  "filePath": "/absolute/path/to/demo.zip",
  "contentType": "application/zip",
  "verify": true
}
```

Invalid combinations:

- `--file` and `--request-file` together fail with `invalid_flag`.
- positional file path and `--request-file` together fail with `invalid_flag`.
- more than one positional file path fails with `invalid_flag`.
- `--chain doge` fails before upload.
- `--chain btc` or `--chain opcat` fails for files above 2 MiB until chunked upload supports those chains.

### Skill UX

`metabot-upload-largefile` should document direct file-path CLI usage as the primary path. The JSON request-file workflow should move to a compatibility or automation section.

`metabot-metaapp-publish` should document that MetaApp runtime ZIP upload uses `metabot file upload-large`, not `metabot file upload`, so MetaApp ZIPs get the same direct/chunked boundary.

### UI UX

Bot Homepage Metafile upload should use the same upload semantics as the CLI:

- accept files up to 50 MiB;
- upload raw browser file bytes to the daemon;
- daemon writes the request body to a temporary file with a strict 50 MiB cap;
- daemon calls the same `uploadLargeFileToChain()` path;
- UI displays a precise error if the selected chain or runtime cannot upload the file.

The browser route should not read a 50 MiB request into one in-memory `Buffer`. It should stream the request body to a temporary file while enforcing the hard cap.

## Architecture

### Core Uploader

Create a production MetaFS uploader, for example:

```text
src/core/files/metaFsLargeUploader.ts
```

Responsibilities:

- normalize MetaFS uploader base URL;
- fetch `/api/v1/config`;
- enforce the smaller of the OAC 50 MiB cap and the MetaFS server cap;
- upload file bytes to MetaFS multipart storage;
- estimate chunked upload fee;
- build MVC funding merge transaction;
- build chunk/index pre-transaction hex values;
- submit `/api/v1/files/chunked-upload`;
- normalize result into `ProductionLargeFileUploader.upload()`.

The uploader should use the existing `ProductionLargeFileUploader` interface where possible:

```ts
export interface ProductionLargeFileUploader {
  upload(input: {
    filePath: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    network: string;
    signer: Signer;
  }): Promise<Omit<UploadLargeFileResult, "verification">>;
}
```

The uploader can derive the local identity through `signer.getIdentity()`, but implementation should keep signing and UTXO logic behind a narrow helper boundary so the MetaFS uploader is not a second general-purpose wallet.

### MVC Funding Boundary

The chunked upload path needs capabilities that direct `writePin()` does not expose:

- fetch spendable MVC UTXOs;
- select funding UTXOs;
- build and sign a merge transaction with two funding outputs;
- build signed chunk/index pre-transactions;
- serialize and submit signed transaction hex to MetaFS;
- retry stale-input conflicts with excluded outpoints.

Implement this as a focused MVC large-upload funding helper, not as a broad public wallet API. A likely location:

```text
src/core/chain/mvcLargeUploadFunding.ts
```

The helper should adapt IDBots' proven logic but use OAC's existing dependencies:

- `meta-contract` `TxComposer` and `mvc`;
- `@metalet/utxo-wallet-service`;
- existing MVC UTXO endpoint shape;
- existing derivation path parsing;
- existing local spend queue or a shared extraction of it.

### Spend Serialization

Large uploads spend MVC wallet UTXOs. They must serialize with other OAC wallet writes for the same address.

Current spend serialization lives privately in `src/core/signing/localMnemonicSigner.ts`. This should be extracted into a reusable helper such as:

```text
src/core/wallet/spendQueue.ts
```

Then both `localMnemonicSigner` and the MetaFS chunked uploader can use the same queue key for MVC writes.

### Direct Upload Binary Semantics

Direct upload must stay binary:

```ts
Signer.writePin({
  path: "/file",
  payload: buffer,
  contentType,
  encoding: "binary",
  network,
});
```

The MetaFS chunked storage transport should prefer binary or multipart request bodies when supported by the MetaFS API. If the current MetaFS multipart endpoint requires base64 chunk fields, that conversion must remain internal to the MetaFS uploader and must not change the direct `/file` write path or any public CLI request shape.

## CLI Contract

### Help Output

`metabot file upload-large --help` should show:

```text
Usage:
  metabot file upload-large --file <path> [--from <bot-slug>] [--content-type <mime>] [--chain mvc|btc|opcat] [--verify]
  metabot file upload-large <path> [--from <bot-slug>] [--content-type <mime>] [--chain mvc|btc|opcat] [--verify]
  metabot file upload-large --request-file <path> [--from <bot-slug>] [--chain mvc|btc|opcat] [--verify]
```

### Result Shape

Successful direct and chunked uploads should return the same normalized fields:

```json
{
  "pinId": "index-or-direct-txid-i0",
  "txids": ["index-or-direct-txid"],
  "totalCost": 1234,
  "network": "mvc",
  "fileName": "demo.zip",
  "contentType": "application/zip",
  "bytes": 1234567,
  "extension": ".zip",
  "metafileUri": "metafile://index-or-direct-txid-i0.zip",
  "previewUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/content/index-or-direct-txid-i0",
  "downloadUrl": "https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/index-or-direct-txid-i0",
  "globalMetaId": "id...",
  "uploadMode": "direct"
}
```

For chunked uploads, `uploadMode` is `"chunked"`.

### Error Codes

Use stable machine-readable codes:

- `file_upload_failed`: direct upload or generic upload failure.
- `large_file_upload_unavailable`: production chunked uploader is not configured.
- `large_file_upload_too_large`: file exceeds OAC or MetaFS max size.
- `large_file_upload_chain_unsupported`: requested chain is not supported for this file size.
- `large_file_upload_funding_failed`: funding UTXO selection, merge transaction, or pre-transaction construction failed.
- `large_file_upload_metafs_failed`: MetaFS storage, estimate, or chunked-upload call failed.
- `invalid_flag`: CLI flag conflict or malformed file path arguments.

## Daemon Contract

The existing daemon route remains:

```text
POST /api/file/upload-large
```

The route keeps accepting JSON for CLI and agent workflows. The CLI converts `--file` and positional file paths into the same daemon body:

```json
{
  "filePath": "/absolute/path/to/demo.zip",
  "contentType": "application/zip",
  "network": "mvc",
  "from": "bot-60",
  "verify": true
}
```

Bot Homepage Metafile upload keeps its profile route:

```text
POST /api/bot/profiles/:slug/homepage/upload?fileName=<name>
```

That route accepts raw request bytes from the browser, streams them into a temp file, and calls the same Bot-scoped `uploadHomepageFile` handler, which calls `uploadLargeFileToChain()`.

## MetaApp Publish Integration

MetaApp publish and update should upload the generated runtime ZIP through `uploadLargeFileToChain()`.

Behavior:

- small ZIPs continue to work through direct upload;
- ZIPs above 2 MiB use MetaFS chunked upload;
- ZIPs above 50 MiB fail before upload;
- the final `/protocols/metaapp` payload still stores the returned `metafile://...` URI in `content`;
- `coverImg`, `icon`, and related manifest fields remain pass-through unless a separate asset upload workflow explicitly uploads them.

## Configuration

Add explicit configuration for MetaFS upload base URL, with a production default:

```text
METABOT_METAFS_UPLOADER_BASE_URL=https://file.metaid.io/metafile-uploader
```

If no environment variable is set, use the default production MetaFS uploader base.

Optional future config can move this into runtime config, but the first implementation should keep the surface minimal.

## Security And Privacy

- Never print file bytes.
- Never put file bytes in CLI arguments.
- Never put mnemonic, WIF, raw private keys, signed transaction hex, or selected UTXO details in normal command output.
- Debug logs may include high-level steps and txids, but not secrets.
- Temporary files created by UI upload routes must be deleted in `finally`.
- Large upload should fail closed if the file changes during upload preparation.

## Testing Strategy

### Unit Tests

- CLI parser accepts `--file`.
- CLI parser accepts positional file path.
- CLI parser keeps `--request-file`.
- CLI parser rejects conflicting path inputs.
- `uploadLargeFileToChain()` still sends small files through direct binary upload.
- MetaFS uploader normalizes config responses.
- MetaFS uploader enforces the smaller server/OAC max size.
- MetaFS uploader calls multipart storage, estimate, funding, and chunked upload in order.
- Funding helper selects MVC UTXOs, builds merge outputs, and produces chunk/index pre-tx hex.
- Retry excludes stale outpoints after retryable broadcast failures.
- MetaApp publish calls the large-file boundary, not the direct-only file uploader.
- Homepage upload route streams to a temp file and enforces 50 MiB.

### Integration Smoke Tests

- `metabot file upload-large --file <small.txt> --from <bot>` succeeds with `uploadMode: "direct"`.
- `metabot file upload-large --file <3MiB.bin> --from <bot> --chain mvc` succeeds with `uploadMode: "chunked"` on a funded MVC identity.
- `metabot file upload-large --file <51MiB.bin> --from <bot>` fails before upload.
- `metabot metaapp publish --from <bot> --project-dir <project> --confirm` uploads the ZIP through the large-file boundary.
- `/ui/bot` Homepage Metafile upload accepts a file above 2 MiB and below 50 MiB when the selected Bot has a funded MVC identity.

## Rollout Order

1. Add CLI `--file` and positional file-path support while keeping `--request-file`.
2. Add the OAC-native MetaFS chunked uploader behind tests.
3. Extract or share spend queue serialization for large MVC funding writes.
4. Inject the production uploader into the default daemon.
5. Switch MetaApp publish/update to the large-file boundary.
6. Upgrade Bot Homepage Metafile upload route and UI to 50 MiB streaming upload.
7. Update `metabot-upload-largefile` and `metabot-metaapp-publish` skills.
8. Run a real MVC smoke upload with a small file and a file above 2 MiB.

## Acceptance Criteria

- `metabot file upload-large --file <path>` is the documented primary CLI.
- `--request-file` remains supported and tested.
- Files at or below 2 MiB still write binary `/file` pins.
- Files above 2 MiB and at or below 50 MiB upload through MetaFS chunked upload on MVC.
- The default daemon no longer returns `large_file_upload_unavailable` for funded MVC large-file uploads.
- MetaApp publish uses the same large-file upload boundary for runtime ZIP files.
- Homepage Metafile upload uses the same large-file upload boundary and no longer has a 2 MiB UI/route cap.
- DOGE large-file upload remains rejected.
- BTC/OPCAT large-file upload above 2 MiB is rejected until explicitly supported.

## Open Implementation Notes

- The implementation should verify the currently deployed MetaFS upload API transport. If a binary part-upload endpoint is available, use it. If the deployed multipart endpoint only accepts base64 chunk fields, keep base64 conversion internal to the MetaFS uploader and do not expose it in OAC CLI, UI, or direct chain writes.
- The first implementation should be MVC-only for chunked upload.
- The large uploader should reuse OAC's signer/profile identity and should not depend on IDBots environment variables.
- The implementation plan should split wallet funding, MetaFS transport, CLI UX, MetaApp integration, Homepage UI, and skill updates into separate tasks.
