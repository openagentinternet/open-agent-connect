'use strict'
import Signature from '../crypto/signature.js';
import Script from '../script/index.js';
import Output from './output.js';
import BufferReader from '../encoding/bufferreader.js';
import BufferWriter from '../encoding/bufferwriter.js';
import Hash from '../crypto/hash.js';
import ECDSA from '../crypto/ecdsa.js';
import $ from '../util/preconditions.js';
import _ from '../util/_.js';

var SIGHASH_SINGLE_BUG = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex')
var EMPTY_HASH = Buffer.alloc(32, 0)

/**
 * Represents a Sighash utility for cryptographic signature operations.
 * @constructor
 */
function Sighash() {

}

/**
 * Returns a buffer with the which is hashed with sighash that needs to be signed
 * for OP_CHECKSIG.
 *
 * @name Signing.sighash
 * @param {Transaction} transaction the transaction to sign
 * @param {number} sighashType the type of the hash
 * @param {number} inputNumber the input index for the signature
 * @param {Script} subscript the script that will be signed
 * @param {satoshisBN} input's amount (for  ForkId signatures)
 *
 */
Sighash.sighashPreimage = function (transaction, sighashType, inputNumber) {
  // Check that all inputs have an output, prevent shallow transaction
  _.each(transaction.inputs, function (input) {
    $.checkState(input.output instanceof Output, 'input.output must be an instance of Output')
  })

  // Validate sighash type
  var baseType = sighashType & 0x1f
  $.checkArgument(
    baseType >= Signature.SIGHASH_ALL && baseType <= Signature.SIGHASH_SINGLE,
    'invalid sighash type'
  )
  $.checkArgument(inputNumber < transaction.inputs.length, 'inputNumber must be less than the number of inputs')

  var hasAnyoneCanPay = (sighashType & Signature.SIGHASH_ANYONECANPAY) !== 0
  var isNone = baseType === Signature.SIGHASH_NONE
  var isSingle = baseType === Signature.SIGHASH_SINGLE

  var nVersion
  var prevouts = []
  var spentScriptHash
  var spentDataHash
  var spentAmount
  var sequence
  var spentAmounts = []
  var spentScriptHashes = []
  var spentDataHashes = []
  var sequences = []
  var outputs = []
  var inputIndex
  var nLockTime
  var sighashTypeBuf

  const getSeparatedScript = function (script) {
    const separatedScript = new Script(script)
    separatedScript.removeCodeseparators()
    return separatedScript
  }

  // all inputs - only process if not ANYONECANPAY
  if (!hasAnyoneCanPay) {
    _.each(transaction.inputs, function (input) {
      prevouts.push(input.toPrevout())
      spentAmounts.push(new BufferWriter().writeUInt64LEBN(input.output.satoshisBN).toBuffer())
      spentScriptHashes.push(Hash.sha256(getSeparatedScript(input.output.script).toBuffer()))
      spentDataHashes.push(Hash.sha256(input.output.data))
      sequences.push(new BufferWriter().writeUInt32LE(input.sequenceNumber).toBuffer())
    })
  }

  // current input
  spentScriptHash = Hash.sha256(getSeparatedScript(transaction.inputs[inputNumber].output.script).toBuffer())
  spentDataHash = Hash.sha256(transaction.inputs[inputNumber].output.data)
  spentAmount = new BufferWriter().writeUInt64LEBN(transaction.inputs[inputNumber].output.satoshisBN).toBuffer()
  sequence = new BufferWriter().writeUInt32LE(transaction.inputs[inputNumber].sequenceNumber).toBuffer()
  inputIndex = new BufferWriter().writeUInt32LE(inputNumber).toBuffer()
  sighashTypeBuf = new BufferWriter().writeUInt32LE(sighashType).toBuffer()

  // outputs - depends on sighash type
  if (!isNone && !isSingle) {
    // ALL: hash all outputs
    _.each(transaction.outputs, function (output) {
      outputs.push(output.toBufferWriter(true).toBuffer())
    })
  } else if (isSingle && inputNumber < transaction.outputs.length) {
    // SINGLE: only hash the output at the same index
    outputs.push(transaction.outputs[inputNumber].toBufferWriter(true).toBuffer())
  }
  // NONE: outputs array stays empty

  // tx.version
  nVersion = new BufferWriter().writeUInt32LE(transaction.version).toBuffer()
  // tx.nLockTime
  nLockTime = new BufferWriter().writeUInt32LE(transaction.nLockTime).toBuffer()

  let bw = new BufferWriter()

  bw.write(nVersion)

  // hashPrevouts - empty if ANYONECANPAY
  if (hasAnyoneCanPay) {
    bw.write(EMPTY_HASH)
  } else {
    bw.write(Hash.sha256sha256(Buffer.concat([...prevouts])))
  }

  // inputIndex (ANYONECANPAY: 0, otherwise: actual inputIndex)
  // Note: When ANYONECANPAY is set, inputIndex is forced to 0 per Layer protocol spec,
  // but the outpoint below still contains the actual input's prevout. This is intentional:
  // - inputIndex=0 allows the signature to be valid regardless of input position in the tx
  // - outpoint identifies which specific UTXO is being spent (required for validation)
  // This follows BIP-341/342 Taproot sighash semantics adapted for Layer.
  var nInForPreimage = hasAnyoneCanPay ? 0 : inputNumber
  bw.write(new BufferWriter().writeUInt32LE(nInForPreimage).toBuffer())

  // outpoint (current input's prevout: txHash + outputIndex)
  // Always uses actual input's prevout, even with ANYONECANPAY (see note above)
  bw.write(transaction.inputs[inputNumber].toPrevout())

  bw.write(spentScriptHash)
  bw.write(spentDataHash)
  bw.write(spentAmount)
  bw.write(sequence)

  // hashSpentAmounts, hashSpentScriptHashes, hashSpentDataHashes - empty if ANYONECANPAY
  if (hasAnyoneCanPay) {
    bw.write(EMPTY_HASH)
    bw.write(EMPTY_HASH)
    bw.write(EMPTY_HASH)
  } else {
    bw.write(Hash.sha256sha256(Buffer.concat([...spentAmounts])))
    bw.write(Hash.sha256sha256(Buffer.concat([...spentScriptHashes])))
    bw.write(Hash.sha256sha256(Buffer.concat([...spentDataHashes])))
  }

  // hashSequences - empty if ANYONECANPAY or SINGLE or NONE
  if (hasAnyoneCanPay || isSingle || isNone) {
    bw.write(EMPTY_HASH)
  } else {
    bw.write(Hash.sha256sha256(Buffer.concat([...sequences])))
  }

  // hashOutputs - depends on sighash type
  if (isNone) {
    // NONE: empty hash
    bw.write(EMPTY_HASH)
  } else if (isSingle) {
    // SINGLE: hash only the output at same index, or empty if no corresponding output
    if (inputNumber < transaction.outputs.length) {
      bw.write(Hash.sha256sha256(Buffer.concat([...outputs])))
    } else {
      bw.write(EMPTY_HASH)
    }
  } else {
    // ALL: hash all outputs
    bw.write(Hash.sha256sha256(Buffer.concat([...outputs])))
  }

  // inputIndex moved after hashPrevouts
  bw.write(nLockTime)
  bw.write(sighashTypeBuf)

  return bw.toBuffer()
}

Sighash.getLowSSighashPreimage = function(tx, sigtype, inputIndex) {
  var i = 0;
  do {
    var preimage = Sighash.sighashPreimage(tx, sigtype, inputIndex);

    var sighash = Hash.sha256sha256(preimage);

    if (_.isPositiveNumber(sighash.readUInt8()) && _.isPositiveNumber(sighash.readUInt8(31))) {
      return preimage;
    }

    tx.nLockTime++;
  } while (i < Number.MAX_SAFE_INTEGER);
}


/**
 * Returns a buffer of length 32 bytes with the hash that needs to be signed
 * for OP_CHECKSIG.
 *
 * @name Signing.sighash
 * @param {Transaction} transaction the transaction to sign
 * @param {number} sighashType the type of the hash
 * @param {number} inputNumber the input index for the signature
 *
 */
Sighash.sighash = function (transaction, sighashType, inputNumber) {
  var preimage = Sighash.sighashPreimage(transaction, sighashType, inputNumber)
  if (preimage.compare(SIGHASH_SINGLE_BUG) === 0) return preimage
  var ret = Hash.sha256sha256(preimage)
  ret = new BufferReader(ret).readReverse()
  return ret
}
/**
 * Create a signature
 *
 * @name Signing.sign
 * @param {Transaction} transaction
 * @param {PrivateKey} privateKey
 * @param {number} sighash
 * @param {number} inputIndex
 * @return {Signature}
 */
Sighash.sign = function (transaction, privateKey, sighashType, inputIndex) {
  var hashbuf = Sighash.sighash(transaction, sighashType, inputIndex)

  var sig = ECDSA.sign(hashbuf, privateKey, 'little').set({
    nhashtype: sighashType
  })
  return sig
}

/**
 * Verify a signature
 *
 * @name Signing.verify
 * @param {Transaction} transaction
 * @param {Signature} signature
 * @param {PublicKey} publicKey
 * @param {number} inputIndex
 * @param {Script} subscript
 * @param {satoshisBN} input's amount
 * @param {flags} verification flags
 * @return {boolean}
 */
Sighash.verify = function (transaction, signature, publicKey, inputIndex) {
  $.checkArgument(!_.isUndefined(transaction))
  $.checkArgument(!_.isUndefined(signature) && !_.isUndefined(signature.nhashtype))
  var hashbuf = Sighash.sighash(transaction, signature.nhashtype, inputIndex)
  return ECDSA.verify(hashbuf, signature, publicKey, 'little')
}

/**
 * @namespace Signing
 */
export default Sighash;