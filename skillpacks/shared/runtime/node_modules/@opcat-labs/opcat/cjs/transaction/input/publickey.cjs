'use strict';

var inherits = require('inherits');

var $ = require('../../util/preconditions.cjs');

var Input = require('./input.cjs');
var Output = require('../output.cjs');
var Sighash = require('../sighash.cjs');
var Script = require('../../script/index.cjs');
var Signature = require('../../crypto/signature.cjs');
var TransactionSignature = require('../signature.cjs');

/**
 * Represents a special kind of input of PayToPublicKey kind.
 * @constructor
 */
function PublicKeyInput() {
  Input.apply(this, arguments);
}
inherits(PublicKeyInput, Input);

/**
 * @param {Transaction} transaction - the transaction to be signed
 * @param {PrivateKey} privateKey - the private key with which to sign the transaction
 * @param {number} index - the index of the input in the transaction input vector
 * @param {number} [sigtype] - the type of signature, defaults to Signature.SIGHASH_ALL
 * @return {Array} of objects that can be
 */
PublicKeyInput.prototype.getSignatures = function (transaction, privateKey, index, sigtype) {
  $.checkState(this.output instanceof Output);
  sigtype = sigtype || Signature.SIGHASH_ALL;
  var publicKey = privateKey.toPublicKey();
  if (publicKey.toString() === this.output.script.getPublicKey().toString('hex')) {
    return [
      new TransactionSignature({
        publicKey: publicKey,
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
 * Adds a signature to the public key input after validating it.
 * @param {Object} transaction - The transaction to validate against.
 * @param {TransactionSignature} signature - The signature object containing signature data and type.
 * @returns {PublicKeyInput} Returns the instance for chaining.
 * @throws {Error} Throws if the signature is invalid.
 */
PublicKeyInput.prototype.addSignature = function (transaction, signature) {
  $.checkState(this.isValidSignature(transaction, signature), 'Signature is invalid');
  this.setScript(Script.buildPublicKeyIn(signature.signature.toDER(), signature.sigtype));
  return this;
};


/**
 * Clears all signatures from this input by setting an empty script.
 * @returns {PublicKeyInput} The instance for chaining.
 */
PublicKeyInput.prototype.clearSignatures = function () {
  this.setScript(Script.empty());
  return this;
};


/**
 * Checks if the public key input is fully signed by verifying the script contains a public key.
 * @returns {boolean} True if the script contains a public key, false otherwise.
 */
PublicKeyInput.prototype.isFullySigned = function () {
  return this.script.isPublicKeyIn();
};

// 32   txid
// 4    output index
// ---
// 1    script size (VARINT)
// 1    signature size (OP_PUSHDATA)
// <=72 signature (DER + SIGHASH type)
// ---
// 4    sequence number
/**
 * The maximum allowed size (in bytes) for a public key script in a transaction input.
 * @constant {number}
 */
PublicKeyInput.SCRIPT_MAX_SIZE = 74;

/**
 * Estimates the byte size required for this public key input.
 * @returns {number} The estimated size in bytes (base input size + max script size).
 * @private
 */
PublicKeyInput.prototype._estimateSize = function () {
  return Input.BASE_SIZE + PublicKeyInput.SCRIPT_MAX_SIZE;
};

module.exports = PublicKeyInput;
