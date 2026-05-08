'use strict';

var inherits = require('inherits');

var $ = require('../../util/preconditions.cjs');

var Hash = require('../../crypto/hash.cjs');
var Input = require('./input.cjs');
var Output = require('../output.cjs');
var Sighash = require('../sighash.cjs');
var Script = require('../../script/index.cjs');
var Signature = require('../../crypto/signature.cjs');
var TransactionSignature = require('../signature.cjs');

/**
 * Represents a special kind of input of PayToPublicKeyHash kind.
 * @constructor
 */
function PublicKeyHashInput() {
  Input.apply(this, arguments);
}
inherits(PublicKeyHashInput, Input);

/**
 * @param {Transaction} transaction - the transaction to be signed
 * @param {PrivateKey} privateKey - the private key with which to sign the transaction
 * @param {number} index - the index of the input in the transaction input vector
 * @param {number} [sigtype] - the type of signature, defaults to Signature.SIGHASH_ALL
 * @param {Buffer} [hashData] - the precalculated hash of the public key associated with the privateKey provided
 * @return {Array} of objects that can be
 */
PublicKeyHashInput.prototype.getSignatures = function (
  transaction,
  privateKey,
  index,
  sigtype,
  hashData,
) {
  $.checkState(this.output instanceof Output);
  hashData = hashData || Hash.sha256ripemd160(privateKey.publicKey.toBuffer());
  sigtype = sigtype || Signature.SIGHASH_ALL;

  if (hashData.equals(this.output.script.getPublicKeyHash())) {
    return [
      new TransactionSignature({
        publicKey: privateKey.publicKey,
        prevTxId: this.prevTxId,
        outputIndex: this.outputIndex,
        inputIndex: index,
        signature: Sighash.sign(
          transaction,
          privateKey,
          sigtype,
          index,
        ),
        sigtype: sigtype,
      }),
    ];
  }
  return [];
};


/**
 * Adds a signature to the input and updates the script.
 * @param {Transaction} transaction - The transaction to validate against.
 * @param {TransactionSignature} signature - The signature object containing publicKey, signature (DER format), and sigtype.
 * @returns {PublicKeyHashInput} Returns the instance for chaining.
 * @throws {Error} Throws if the signature is invalid.
 */
PublicKeyHashInput.prototype.addSignature = function (transaction, signature) {
  $.checkState(this.isValidSignature(transaction, signature), 'Signature is invalid');

  this.setScript(
    Script.buildPublicKeyHashIn(
      signature.publicKey,
      signature.signature.toDER(),
      signature.sigtype,
    ),
  );
  return this;
};

/**
 * Clear the input's signature
 * @return {PublicKeyHashInput} this, for chaining
 */
PublicKeyHashInput.prototype.clearSignatures = function () {
  this.setScript(Script.empty());
  return this;
};

/**
 * Query whether the input is signed
 * @return {boolean}
 */
PublicKeyHashInput.prototype.isFullySigned = function () {
  return this.script.isPublicKeyHashIn();
};

// 32   txid
// 4    output index
// --- script ---
// 1    script size (VARINT)
// 1    signature size (OP_PUSHDATA)
// <=72 signature (DER + SIGHASH type)
// 1    public key size (OP_PUSHDATA)
// 65   uncompressed public key
//
// 4    sequence number
/**
 * The maximum allowed size (in bytes) for a public key hash script.
 * @constant
 */
PublicKeyHashInput.SCRIPT_MAX_SIZE = 140;

/**
 * Estimates the byte size of this public key hash input.
 * @returns {number} The estimated size in bytes (base input size + max script size).
 * @private
 */
PublicKeyHashInput.prototype._estimateSize = function () {
  return Input.BASE_SIZE + PublicKeyHashInput.SCRIPT_MAX_SIZE;
};

module.exports = PublicKeyHashInput;
