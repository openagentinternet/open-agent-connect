# MVC Sponsor Upload Integration

> Audience: downstream developers integrating MVC fee sponsorship into another module inside OAC.
> Scope: how to reuse the existing sponsor upload path safely, how the config gate works, and what success, fallback, and failure semantics to expect.

This repository already has a production sponsor integration for **direct MVC file uploads**. If another module wants the same "try sponsor first, otherwise keep the main flow usable" behavior, reuse the existing OAC modules instead of calling the remote assist endpoints ad hoc.

The current production path is intentionally narrow:

- only for `mvc`
- only for direct uploads at or below `2 MiB`
- only for the `/file` inscription shape used by `upload-large`

For non-MVC uploads, or MVC files above the direct-upload threshold, OAC does not use sponsor today.

---

## 1. The modules to reuse

There are three layers, and they have different responsibilities:

| Module | Responsibility |
|---|---|
| `src/core/subsidy/mvcSponsorV2Client.ts` | Typed HTTP client for the remote sponsor service: `address/info`, `challenge`, `pre`, `commit`. |
| `src/core/files/mvcSponsorDirectUpload.ts` | Full sponsor orchestration for one direct MVC `/file` upload, including fallback and `feeAssist` metadata. |
| `src/core/files/uploadLargeFile.ts` | Public upload entry. This is the usual integration point when the caller just wants "upload this file". |

If your module is still "upload a local file and return a metafile result", prefer `uploadLargeFileToChain(...)`.

If your module already owns a direct MVC `/file` write flow and only wants the sponsor branch, then `uploadMvcSponsorDirectFile(...)` is the lower-level entry.

---

## 2. Default behavior and the feature switch

The sponsor path is controlled by the persistent config key:

```text
chain.mvcSponsorUploadEnabled
```

Current default:

```text
true
```

Source of truth:

- `src/core/config/configTypes.ts`
- `src/core/config/configStore.ts`
- `src/cli/runtime.ts`

CLI examples:

```bash
metabot config get --from bob chain.mvcSponsorUploadEnabled
metabot config set --from bob chain.mvcSponsorUploadEnabled false
metabot config set --from bob chain.mvcSponsorUploadEnabled true
```

Runtime gate:

- if `network !== "mvc"`, sponsor is skipped
- if `chain.mvcSponsorUploadEnabled !== true`, sponsor is skipped
- otherwise OAC injects an `mvcSponsorClient` and the direct MVC upload path tries sponsor first

In the daemon default handlers this gate is applied by `resolveMvcSponsorUploadClientForHome(...)`.

---

## 3. The recommended integration shape

For downstream modules inside OAC, the safest pattern is:

1. Resolve the write network.
2. Resolve the signer.
3. Resolve `mvcSponsorClient` only when the config gate allows it.
4. Call `uploadLargeFileToChain(...)`.
5. Read `result.feeAssist` when present.

Minimal shape:

```ts
import { uploadLargeFileToChain } from '../core/files/uploadLargeFile';
import { createMvcSponsorV2Client } from '../core/subsidy/mvcSponsorV2Client';

const result = await uploadLargeFileToChain({
  filePath,
  network,
  signer,
  verify: true,
  mvcSponsorClient: shouldUseSponsor ? createMvcSponsorV2Client() : undefined,
});
```

If you already have a home dir and want behavior consistent with the CLI and daemon, the gate should be equivalent to:

```ts
const config = await createConfigStore(homeDir).read();
const shouldUseSponsor = network === 'mvc' && config.chain.mvcSponsorUploadEnabled === true;
```

Do not instantiate the sponsor client when the gate is off. A disabled switch should fully bypass the sponsor service.

---

## 4. Eligibility rules

Sponsor is only attempted when all of the following are true:

- the target network is `mvc`
- the file size is at or below `DIRECT_UPLOAD_MAX_BYTES` (`2 * 1024 * 1024`)
- the caller provided `mvcSponsorClient`

If any of those conditions is false:

- the upload still works
- OAC uses the normal self-paid path
- `feeAssist` is omitted unless the sponsor path was actually attempted and then fell back

This means "sponsor enabled by default" does not mean "all file uploads are sponsored". It only covers the eligible direct MVC path.

---

## 5. Sponsor flow sequence

The direct sponsor upload flow is:

1. Read `address/info`
2. Build the unsigned user draft transaction
3. Request `challenge`
4. Sign the challenge with the user's MVC address key
5. Call `pre`
6. Sign only the user-owned inputs of `preparedTxHex`
7. Call `commit`
8. Record pending local UTXO state from the prepared transaction

The important detail is step 2:

- the **sponsor** draft must preserve the user's full change
- the user transaction must **not** pre-deduct miner fee from the user's outputs

For the current `/file` shape, the correct user-side economic shape is:

- output 0: `1 sat` dummy output for the pin
- output 1: user change = `inputs - 1`

If you reuse sponsor semantics in another MVC write path, do not feed `pre` a self-paid draft that already deducted miner fee from the user change. That causes double payment.

---

## 6. Why the existing sponsor helper is safer than ad hoc code

`uploadMvcSponsorDirectFile(...)` already handles the parts that are easy to get subtly wrong:

- challenge signing with the correct MVC address-derived key
- `1...` and `q...` address compatibility via the upstream service contract
- sponsor-specific draft construction
- signing only the user-owned prepared inputs
- recording pending local MVC UTXOs from the final prepared transaction shape
- attaching stable `feeAssist` metadata on both success and failure
- controlled fallback to self-paid when the service is temporarily unavailable before `pre`

If you call the remote endpoints directly from a new module, you will have to rebuild all of that correctly.

---

## 7. Success result contract

The public result type is `UploadLargeFileResult` in `src/core/files/uploadLargeFile.ts`.

On sponsor success, `result.feeAssist` looks like this conceptually:

```ts
{
  attempted: true,
  used: true,
  mode: 'mvc_sponsor_v2',
  sponsor: 'mvc_sponsor_v2',
  stage: 'done',
  orderId: '...',
  quotaBefore: { ... },
  quotaAfter: { ... },
  advisoryFeeEstimate: 1553877,
  sponsoredMinerFee: 1553877,
  savedFee: 1553877,
}
```

Fields downstream code will most commonly care about:

- `used`: whether sponsor actually paid
- `savedFee`: how much fee the user saved
- `sponsoredMinerFee`: the fee paid by the sponsor service
- `quotaBefore.availableAmount`
- `quotaAfter.availableAmount`
- `orderId`: useful for server-side debugging with the sponsor provider

Recommended UI wording logic:

- if `feeAssist?.used === true`, tell the user how much fee was sponsored and how much quota remains
- if `feeAssist?.mode === "self_paid"`, treat the upload as a normal self-paid success and optionally mention sponsor was unavailable

---

## 8. Fallback vs hard failure

Downstream modules must distinguish these two cases.

### Fallback to self-paid success

OAC intentionally falls back to self-paid for some early-stage sponsor problems, mainly when the sponsor service is unavailable before `pre`.

Typical result:

```ts
{
  feeAssist: {
    attempted: true,
    used: false,
    mode: 'self_paid',
    sponsor: 'mvc_sponsor_v2',
    reason: 'service_unavailable',
    stage: 'challenge',
  }
}
```

Meaning:

- the user still got a successful upload
- sponsor was attempted but not used
- the normal self-paid cost applies

### Hard failure with feeAssist metadata

Once sponsor reaches a stage where silent fallback would be misleading or unsafe, OAC throws and attaches `error.data.feeAssist`.

Typical reasons:

- `insufficient_quota`
- `pre_rejected`
- `commit_failed`

Meaning:

- the caller should treat this as a failed upload
- the attached `feeAssist` object is for diagnostics and user messaging

Do not swallow these failures and pretend the upload succeeded.

---

## 9. Advisory quota is not authoritative

`address/info` is useful but not final.

You can use it to show the user:

- whether the address currently has sponsor quota
- approximate remaining quota before upload

But do not treat `address/info.availableAmount` as the final approval signal.

The authoritative decision still happens at `pre`, because the real sponsor fee depends on:

- the exact prepared transaction
- current sponsor-side UTXOs
- service-side rules at that moment

That is why OAC treats `address/info` as advisory and still handles `pre` rejection explicitly.

---

## 10. Guidance for new sponsor-enabled write paths

If another module later wants sponsor support for a new MVC write shape, the practical recommendation is:

1. Keep the config gate exactly the same.
2. Reuse `mvcSponsorV2Client`.
3. Build a sponsor-specific unsigned user draft for that write shape.
4. Ensure the user draft does not pre-pay miner fee.
5. Reuse the same challenge signing and commit-signing pattern.
6. Return a `feeAssist` object with the same semantics used by `upload-large`.

Do not assume the current direct `/file` helper is generic for every MVC write. It is safe for today's file upload path because it knows the exact transaction shape it is constructing.

If the new feature is still "file upload", route it through `uploadLargeFileToChain(...)` instead of reimplementing the sponsor flow.

---

## 11. Quick checklist

- [ ] Use sponsor only for eligible direct MVC uploads.
- [ ] Respect `chain.mvcSponsorUploadEnabled`.
- [ ] Prefer `uploadLargeFileToChain(...)` over raw sponsor calls.
- [ ] If sponsor is disabled, do not create or call the sponsor client.
- [ ] On success, read `result.feeAssist.used` and `savedFee`.
- [ ] On failure, inspect `error.data.feeAssist` before deciding what to show the user.
- [ ] Do not pre-deduct user miner fee in sponsor-mode transaction drafts.
