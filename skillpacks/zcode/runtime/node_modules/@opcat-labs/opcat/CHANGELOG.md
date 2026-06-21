# @opcat-labs/opcat

## 4.0.0

### Major Changes

- update sighash preimage, fix batch bugs

## 3.4.0

### Minor Changes

- check cat20state in openminter, fix filter utxos

## 3.3.0

### Minor Changes

- feat: add ChangeInfo type with pubkeyhash for change output verification

## 3.2.0

## 3.1.0

### Minor Changes

- remove MempoolProvider, add OpenApiProvider

## 3.0.0

### Major Changes

- feat!: refactor preimage structure and implement checkDataSig

  ### Breaking Changes
  - **SHPreimage type refactored**: All fields restructured from old Tap Sighash format to new SH format
    - New fields: nVersion, hashPrevouts, spentScriptHash, spentDataHash, value, nSequence, hashSpentAmounts, hashSpentScriptHashes, hashSpentDataHashes, hashSequences, hashOutputs, inputIndex, nLockTime, sigHashType
  - **preimage.ts API changes**:
    - Removed: `splitSighashPreimage()`, `toSHPreimageObj()`, `shPreimageToSig()`, `shPreimageGetE()`
    - Removed constants: `PREIMAGE_PREFIX`, `E_PREIMAGE_PREFIX`, `GX`
    - Added: `decodeSHPreimage(preimage)` - decode binary preimage
    - Added: `encodeSHPreimage(shPreimage)` - encode SHPreimage
  - **checkSHPreimage verification flow changed**:
    - Old approach: `ContextUtils.checkSHPreimage()` + `checkSig()`
    - New approach: two-step verification - `checkDataSig()` + `checkSig()`
    - Signature now injected via `_injectedPreimageSig`

  ### New Features
  - **checkDataSig method**: Support for OP_CHECKSIGFROMSTACK (0xba) and OP_CHECKSIGFROMSTACKVERIFY (0xbb)
  - **New signing utility functions**:
    - `signPreimage(preimage, sigHashType)`
    - `signSHPreimage(shPreimage, sigHashType)`
    - `signDataForCheckDataSig(message)`
    - `signSHPreimageForCheckDataSig(shPreimage)`
    - `signData(privateKey, message)` - for Oracle scenarios
    - `signDataWithInternalKey()` - sign with internal key

  ### Migration Guide

  Code using preimage needs to be updated to adapt to the new structure and verification flow.

## 2.1.3

### Patch Changes

- refactor: reuse Interpreter methods for checkDataSig and add signData utility
  - Refactor checkDataSig.ts to use Interpreter.checkDataSigSignatureEncoding() and checkPubkeyEncoding()
  - Add signData(privateKey, message) utility for Oracle scenarios
  - Add signDataWithInternalKey() using INTERNAL_KEY from ContextUtils
  - Add end-to-end contract tests for CheckDataSig
  - Add OP_CHECKSIGFROMSTACK and OP_CHECKSIGFROMSTACKVERIFY opcode tests
  - Add TypeScript type declarations for checkDataSigSignatureEncoding and isDER

## 2.1.2

### Patch Changes

- fix estimate fee return float number

## 2.1.1

### Patch Changes

- fix mempoolProvider getUtxos, fix mempoolProvider getConfirmations

## 2.1.0

### Minor Changes

- back to genesis now trace to genesis contract
- add dryRun for cat-sdk features
- add mergeSendToken feature for cat20
- lots of bugfixes

## 2.0.2

### Patch Changes

- add more exports in cat-sdk

## 2.0.1

### Patch Changes

- fix: handle utxo.txHashPreimage in features

## 2.0.0

### Major Changes

- Release CAT721

## 1.0.3

### Patch Changes

- use standard psbt

## 1.0.2

### Patch Changes

- fix esm, fix change amount, add decodePubFunctionCall

## 1.0.1

### Patch Changes

- add cli project command
