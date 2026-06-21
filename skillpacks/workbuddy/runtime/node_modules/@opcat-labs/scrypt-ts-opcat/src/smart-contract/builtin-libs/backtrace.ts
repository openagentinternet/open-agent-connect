import { method, prop } from '../decorators.js';
import { assert } from '../fns/assert.js';
import { SmartContractLib } from '../smartContractLib.js';
import { ByteString } from '../types/index.js';
import { BacktraceInfo, TxHashPreimage } from '../types/structs.js';
import { TxUtils } from './txUtils.js';
import { TX_INPUT_BYTE_LEN, TX_OUTPUT_BYTE_LEN, TX_OUTPUT_SATOSHI_BYTE_LEN, TX_OUTPUT_SCRIPT_HASH_LEN } from '../consts.js';
import { slice, toByteString } from '../fns/byteString.js';
import { StdUtils } from './stdUtils.js';
import { TxHashPreimageUtils } from './txHashPreimageUtils.js';


/**
 * Represents the response data for verifying a transaction in the chain.
 * Contains the previous script and outpoint information needed for verification.
 */
export type ChainTxVerifyResponse = {
  prevPrevScript: ByteString;
  prevPrevOutpoint: ByteString;
};

/**
 * Library for verifying backtraces all the way to the genesis point.
 * @category Library
 * @onchain
 */
export class Backtrace extends SmartContractLib {
  /**
   * SHA256 hash of the Genesis contract script (including header).
   * Used to validate that prevPrevScript is the Genesis contract when tracing back to genesis outpoint.
   *
   * ## How this hash is generated
   * This is the SHA256 hash of the Genesis contract's full locking script, including:
   * - Contract header (name, version metadata)
   * - Compiled bytecode
   *
   * To verify or regenerate: `sha256(toByteString(new Genesis().lockingScript.toHex()))`
   *
   * ## Important
   * If the Genesis contract is updated, this hash MUST be updated accordingly.
   * Use the test in genesis.test.ts to verify this hash remains correct.
   *
   * @see packages/scrypt-ts-opcat/test/local-test/genesis.test.ts - GENESIS_SCRIPT_HASH validation tests
   */
  @prop()
  static readonly GENESIS_SCRIPT_HASH: ByteString = toByteString('6712360d7ad09ba9a59cd236aab61db7183c8d881c74ea029debd1f6b26711f8');

  /**
   * Verifies that the transaction hash preimage matches the previous transaction hash
   * from the outpoint in SHPreimage.
   *
   * @param txHashPreimage - The transaction hash preimage to verify
   * @param t_outpoint - The outpoint from SHPreimage (36 bytes: txHash + outputIndex)
   * @throws Will throw an error if the hashes don't match
   */
  @method()
  static checkPrevTxHashPreimage(
    txHashPreimage: TxHashPreimage,
    t_outpoint: ByteString,
  ): void {
    const txHash = TxHashPreimageUtils.getTxHashFromTxHashPreimage(txHashPreimage);
    assert(txHash == slice(t_outpoint, 0n, 32n), 'prevTxHash mismatch');
  }
  /**
   * Back-to-genesis backtrace verification for a contract which can be backtraced to the genesis outpoint.
   * It will be a valid backtraceInfo if the prevPrevOutpoint is the genesis outpoint or the prevPrevScript is the selfScript.
   *
   * ## Multiple Genesis Support
   * A single transaction can create multiple Genesis outputs at different indices (output[0], output[1], etc.).
   * Each Genesis output can be spent separately to deploy a different contract, with each contract having
   * its own unique genesisOutpoint. This allows batch creation of Genesis contracts in one transaction
   * while maintaining independent contract lineages.
   *
   * ```
   *                         Genesis Creation Tx
   *                        +-------------------+
   *                        |    output[0]      |---> Genesis_0 (outpoint: txid:0)
   *   UTXOs -------------->|    output[1]      |---> Genesis_1 (outpoint: txid:1)
   *                        |    output[2]      |---> Genesis_2 (outpoint: txid:2)
   *                        +-------------------+
   *                                 |
   *          +----------------------+----------------------+
   *          |                      |                      |
   *          v                      v                      v
   *   +-------------+        +-------------+        +-------------+
   *   | Deploy Tx A |        | Deploy Tx B |        | Deploy Tx C |
   *   +-------------+        +-------------+        +-------------+
   *   | spend Gen_0 |        | spend Gen_1 |        | spend Gen_2 |
   *   | output[0]:  |        | output[0]:  |        | output[0]:  |
   *   | Contract_A  |        | Contract_B  |        | Contract_C  |
   *   +-------------+        +-------------+        +-------------+
   *          |                      |                      |
   *          v                      v                      v
   *   genesisOutpoint:       genesisOutpoint:       genesisOutpoint:
   *      txid:0                 txid:1                 txid:2
   * ```
   *
   * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx informations
   * @param t_genesisOutpoint expected genesis outpoint of the contract which usually is a contract property and trustable
   * @param t_selfScript expected self locking script, i.e. this.ctx.spentScript, of the currect spending UTXO context which is trustable
   * @param t_prevTxInputList input list of the prevTx which should be trustable
   */
  @method()
  static verifyFromOutpoint(
    backtraceInfo: BacktraceInfo,
    t_prevOutputIndex: bigint,
    t_genesisOutpoint: ByteString,
    t_selfScript: ByteString,
    t_prevTxInputList: ByteString,
  ): void {
    const res = Backtrace.verifyChainTxs(backtraceInfo, t_prevTxInputList);
    // When at genesis outpoint, verify the prevPrevScript (scriptHash) matches the Genesis contract
    if (res.prevPrevOutpoint === t_genesisOutpoint) {
      assert(
        res.prevPrevScript == Backtrace.GENESIS_SCRIPT_HASH,
        `prevPrevScript does not match Genesis contract script`,
      );
      assert(t_prevOutputIndex == 0n, 'prevOutputIndex must be 0 for genesis validation');
    }
    assert(
      res.prevPrevOutpoint == t_genesisOutpoint || res.prevPrevScript == t_selfScript,
      `can not backtrace to the genesis outpoint`,
    );
  }

  /**
   * Back-to-genesis backtrace verification for a contract which can be backtraced to the genesis script.
   * It will be a valid backtraceInfo if the prevPrevScript is the genesis script or the selfScript.
   * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx informations
   * @param t_genesisScript expected genensis locking script which usually is a contract property and trustable
   * @param t_selfScript expected self locking script, i.e. this.ctx.spentScript, of the current spending UTXO context and is trustable
   * @param t_prevTxInputList input list of the prevTx which should be trustable
   */
  @method()
  static verifyFromScript(
    backtraceInfo: BacktraceInfo,
    t_genesisScript: ByteString,
    t_selfScript: ByteString,
    t_prevTxInputList: ByteString,
  ): void {
    const res = Backtrace.verifyChainTxs(backtraceInfo, t_prevTxInputList);
    assert(
      res.prevPrevScript == t_genesisScript || res.prevPrevScript == t_selfScript,
      `can not backtrace to the genesis script`,
    );
  }

  /**
   * Tx chain verification to ensure:
   *   1. the current spending UTXO is the output of prevTx
   *   2. the specific input of prevTx is the output of prevPrevTx
   * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx preimages
   * @param t_prevTxInputList input list of the prevTx which should be trustable
   * @returns locking script and outpoint of the specified output of prevPrevTx
   */
  @method()
  static verifyChainTxs(
    backtraceInfo: BacktraceInfo,
    t_prevTxInputList: ByteString,
  ): ChainTxVerifyResponse {
    // check if the passed prevTxInput and prevTxInputIndexVal are matched
    assert(
      slice(
        t_prevTxInputList,
        backtraceInfo.prevTxInputIndex * TX_INPUT_BYTE_LEN,
        (backtraceInfo.prevTxInputIndex + 1n) * TX_INPUT_BYTE_LEN
      ) ==
      TxUtils.mergeInput(backtraceInfo.prevTxInput),
      'prevTxInput does not match prevTxInputList at specified index',
    );
    // check if prevTxHash of passed prevTxInput and prevPrevTx are matched
    const prevPrevTxHash = backtraceInfo.prevTxInput.prevTxHash;
    assert(
      prevPrevTxHash ==
        TxHashPreimageUtils.getTxHashFromTxHashPreimage(backtraceInfo.prevPrevTxPreimage),
      'prevPrevTxHash mismatch: prevTxInput.prevTxHash does not match prevPrevTxPreimage hash',
    );
    // all fields in backtraceInfo have been verified
    const prevPrevScript =
      slice(
        backtraceInfo.prevPrevTxPreimage.outputList,
        backtraceInfo.prevTxInput.prevOutputIndex * TX_OUTPUT_BYTE_LEN + TX_OUTPUT_SATOSHI_BYTE_LEN,
        (backtraceInfo.prevTxInput.prevOutputIndex) * TX_OUTPUT_BYTE_LEN + TX_OUTPUT_SATOSHI_BYTE_LEN + TX_OUTPUT_SCRIPT_HASH_LEN
      );
    const prevPrevOutpoint =
      prevPrevTxHash + StdUtils.uint32ToByteString(backtraceInfo.prevTxInput.prevOutputIndex);
    return { prevPrevScript, prevPrevOutpoint };
  }
}
