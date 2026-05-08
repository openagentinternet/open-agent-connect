import { assert } from '../fns/assert.js';
import {
  TX_INPUT_PREV_TX_HASH_BYTE_LEN,
  TX_INPUT_SCRIPT_HASH_BYTE_LEN,
} from '../consts.js';
import { prop, method } from '../decorators.js';
import { toByteString, len, intToByteString, sha256 } from '../fns/index.js';
import { OpCode } from '../types/opCode.js';
import { SmartContractLib } from '../smartContractLib.js';
import {
  ByteString,
  TxOut,
  TxIn,
  Addr,
  UInt64,
} from '../types/index.js';
import { StdUtils } from './stdUtils.js';



/**
 * Library for parsing and constructing transactions
 * @category Library
 * @onchain
 */
export class TxUtils extends SmartContractLib {
  /** if a output satoshi value is zero */
  @prop()
  static readonly ZERO_SATS: UInt64 = 0n;

  /**
   * Build serialized tx output
   * @param script serialized locking script of the output
   * @param satoshis serialized satoshis of the output
   * @returns serialized tx output in format ByteString
   */
  @method()
  static buildOutput(scriptHash: ByteString, satoshis: UInt64): ByteString {
    return TxUtils.buildDataOutput(scriptHash, satoshis, sha256(toByteString('')));
  }


  /**
 * Build serialized tx output
 * @param script serialized locking script of the output
 * @param satoshis serialized satoshis of the output
 * @returns serialized tx output in format ByteString
 */
  @method()
  static buildDataOutput(scriptHash: ByteString, satoshis: UInt64, dataHash: ByteString): ByteString {
    const scriptHashLen = len(scriptHash);
    const dataHashLen = len(dataHash);
    //const dataLen = len(data);
    assert(scriptHashLen == 32n, "script hash length must be equal to 32");
    assert(dataHashLen == 32n, "data hash length must be equal to 32");
    assert(satoshis > 0n, "satoshis must be greater than 0");
    return TxUtils.satoshisToByteString(satoshis) + scriptHash + dataHash;
  }

  /**
   * Build serialized change output
   * @param change change output to build
   * @returns serialized change output in format ByteString
   */
  @method()
  static buildChangeOutput(change: TxOut): ByteString {
    return change.satoshis > 0n
      ? TxUtils.buildDataOutput(change.scriptHash, change.satoshis, change.dataHash)
      : toByteString('');
  }

  /**
   * Merge tx input into a ByteString
   * @param txInput tx input, must be a segwit input
   * @returns serialized tx input
   */
  @method()
  static mergeInput(txInput: TxIn): ByteString {
    assert(len(txInput.prevTxHash) == TX_INPUT_PREV_TX_HASH_BYTE_LEN);
    assert(len(txInput.scriptHash) == TX_INPUT_SCRIPT_HASH_BYTE_LEN);
    return (
      txInput.prevTxHash +
      StdUtils.uint32ToByteString(txInput.prevOutputIndex) +
      txInput.scriptHash +
      StdUtils.uint32ToByteString(txInput.sequence)
    );
  }

  /**
   * build `OP_RETURN` script from data payload
   * @param {ByteString} data the data payload
   * @returns {ByteString} a ByteString contains the data payload
   */
  @method()
  static buildOpReturnOutput(data: ByteString): ByteString {
    const script = toByteString('6a') + intToByteString(len(data)) + data;
    return TxUtils.satoshisToByteString(TxUtils.ZERO_SATS) + sha256(script) + sha256(toByteString(''));
  }

  /**
   * constructs a P2PKH script from a given PubKeyHash
   * @param {PubKeyHash} pubKeyHash - the recipient's public key hash
   * @returns {ByteString} a `ByteString` representing the P2PKH script
   */
  @method()
  static buildP2PKHScript(addr: Addr): ByteString {
    return (
      toByteString(OpCode.OP_DUP) +
      toByteString(OpCode.OP_HASH160) +
      intToByteString(20n) +
      addr +
      toByteString(OpCode.OP_EQUALVERIFY) +
      toByteString(OpCode.OP_CHECKSIG)
    );
  }

  /**
   * constructs a P2PKH output from a given PubKeyHash and satoshi amount
   * @param {Addr} addr - the recipient's public key hash
   * @param {Int32} amount - the satoshi amount
   * @returns {ByteString} a `ByteString` representing the P2PKH output
   */
  @method()
  static buildP2PKHOutput(amount: UInt64, addr: Addr): ByteString {
    return TxUtils.buildDataOutput(sha256(TxUtils.buildP2PKHScript(addr)), amount, sha256(toByteString('')));
  }

  /**
   * build `OP_FALSE OP_RETURN` script from data payload
   * @param {ByteString} data the data payload
   * @returns {ByteString} a ByteString contains the data payload
   */
  @method()
  static buildOpreturnScript(data: ByteString): ByteString {
    return toByteString(OpCode.OP_FALSE) + toByteString(OpCode.OP_RETURN) + StdUtils.pushData(data);
  }

  /**
   * convert a `UInt64` number to 8 bytes in little-end order.
   * @param {UInt64} n - the satoshi amount
   * @returns {ByteString} a `ByteString`
   */
  @method()
  static satoshisToByteString(n: UInt64): ByteString {
    return StdUtils.uint64ToByteString(n);
  }

  /**
   * convert a `ByteString` to a `UInt64` number
   * @param {ByteString} bs - the satoshi amount
   * @returns {UInt64} a `UInt64`
   */
  @method()
  static byteStringToSatoshis(bs: ByteString): UInt64 {
    assert(len(bs) == 8n, "satoshis must be 8 bytes");
    return StdUtils.fromLEUnsigned(bs);
  }

}