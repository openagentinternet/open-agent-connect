'use strict';

import _ from '../util/_.js';
import PrivateKey from '../privatekey.js';
import PublicKey from '../publickey.js';
import Address from '../address.js';
import BufferWriter from '../encoding/bufferwriter.js';
import ECDSA from '../crypto/ecdsa.js';
import Signature from '../crypto/signature.js';
import Hash from '../crypto/hash.js';
import JSUtil from '../util/js.js';
import $ from '../util/preconditions.js';


/**
 * Creates a Message instance from a string or Buffer.
 * @constructor
 * @param {string|Buffer} message - The message content as either a string or Buffer
 * @throws {Error} Will throw if message is not a string or Buffer
 * @returns {Message} A new Message instance containing the message buffer
 */
function Message(message) {
  if (!(this instanceof Message)) {
    return new Message(message);
  }

  $.checkArgument(
    _.isString(message) || Buffer.isBuffer(message),
    'First argument should be a string or Buffer',
  );

  if (_.isString(message)) {
    this.messageBuffer = Buffer.from(message);
  }

  if (Buffer.isBuffer(message)) {
    this.messageBuffer = message;
  }
  return this;
}

/**
 * Signs a message with the given private key.
 * @param {string|Buffer} message - The message to sign.
 * @param {PrivateKey} privateKey - The private key used for signing.
 * @returns {Message} The signed message instance.
 */
Message.sign = function (message, privateKey) {
  return new Message(message).sign(privateKey);
};

Message.verify = function (message, address, signature) {
  return new Message(message).verify(address, signature);
};

Message.MAGIC_BYTES = Buffer.from('Bitcoin Signed Message:\n');

/**
 * Calculates the magic hash for the message by concatenating magic bytes prefixes
 * with the message buffer and computing a double SHA-256 hash.
 * @returns {Buffer} The resulting 32-byte hash.
 */
Message.prototype.magicHash = function magicHash() {
  var prefix1 = BufferWriter.varintBufNum(Message.MAGIC_BYTES.length);
  var prefix2 = BufferWriter.varintBufNum(this.messageBuffer.length);
  var buf = Buffer.concat([prefix1, Message.MAGIC_BYTES, prefix2, this.messageBuffer]);
  var hash = Hash.sha256sha256(buf);
  return hash;
};

/**
 * Signs the message with the provided private key.
 * @private
 * @param {PrivateKey} privateKey - The private key instance to sign with.
 * @returns {Buffer} The signature generated using ECDSA.
 * @throws {Error} If the first argument is not a PrivateKey instance.
 */
Message.prototype._sign = function _sign(privateKey) {
  $.checkArgument(
    privateKey instanceof PrivateKey,
    'First argument should be an instance of PrivateKey',
  );
  var hash = this.magicHash();
  return ECDSA.signWithCalcI(hash, privateKey);
};

/**
 * Will sign a message with a given bitcoin private key.
 *
 * @param {PrivateKey} privateKey - An instance of PrivateKey
 * @returns {String} A base64 encoded compact signature
 */
Message.prototype.sign = function sign(privateKey) {
  var signature = this._sign(privateKey);
  return signature.toCompact().toString('base64');
};

/**
 * Verifies the message signature using the provided public key.
 * @param {PublicKey} publicKey - The public key to verify against
 * @param {Signature} signature - The signature to verify
 * @returns {boolean} True if signature is valid, false otherwise
 * @throws {Error} If arguments are not valid PublicKey/Signature instances
 */
Message.prototype._verify = function _verify(publicKey, signature) {
  $.checkArgument(
    publicKey instanceof PublicKey,
    'First argument should be an instance of PublicKey',
  );
  $.checkArgument(
    signature instanceof Signature,
    'Second argument should be an instance of Signature',
  );
  var hash = this.magicHash();
  var verified = ECDSA.verify(hash, signature, publicKey);
  if (!verified) {
    this.error = 'The signature was invalid';
  }
  return verified;
};

/**
 * Will return a boolean of the signature is valid for a given bitcoin address.
 * If it isn't the specific reason is accessible via the "error" member.
 *
 * @param {Address|String} bitcoinAddress - A bitcoin address
 * @param {String} signatureString - A base64 encoded compact signature
 * @returns {Boolean}
 */
Message.prototype.verify = function verify(bitcoinAddress, signatureString) {
  $.checkArgument(bitcoinAddress);
  $.checkArgument(signatureString && _.isString(signatureString));

  if (_.isString(bitcoinAddress)) {
    bitcoinAddress = Address.fromString(bitcoinAddress);
  }
  var signature = Signature.fromCompact(Buffer.from(signatureString, 'base64'));

  // recover the public key
  var ecdsa = new ECDSA();
  ecdsa.hashbuf = this.magicHash();
  ecdsa.sig = signature;
  var publicKey = ecdsa.toPublicKey();

  var signatureAddress = Address.fromPublicKey(publicKey.toBuffer(), bitcoinAddress.network);

  // check that the recovered address and specified address match
  if (bitcoinAddress.toString() !== signatureAddress.toString()) {
    this.error = 'The signature did not match the message digest';
    return false;
  }

  return this._verify(publicKey, signature);
};

/**
 * Instantiate a message from a message string
 *
 * @param {String} str - A string of the message
 * @returns {Message} A new instance of a Message
 */
Message.fromString = function (str) {
  return new Message(str);
};

/**
 * Instantiate a message from JSON
 *
 * @param {String} json - An JSON string or Object with keys: message
 * @returns {Message} A new instance of a Message
 */
Message.fromJSON = function fromJSON(json) {
  if (JSUtil.isValidJSON(json)) {
    json = JSON.parse(json);
  }
  return Message.fromObject(json);
};


/**
 * Converts the message to a plain object with hex representation.
 * @returns {Object} An object containing the hex string of the message buffer.
 */
Message.prototype.toObject = function toObject() {
  return {
    messageHex: this.messageBuffer.toString('hex'),
  };
};

/**
 * Creates a Message instance from an object containing a hex-encoded message.
 * @param {Object} obj - The source object containing the message data.
 * @param {string} obj.messageHex - Hex-encoded message string.
 * @returns {Message} A new Message instance created from the decoded buffer.
 */
Message.fromObject = function (obj) {
  let messageBuffer = Buffer.from(obj.messageHex, 'hex');
  return new Message(messageBuffer);
};


/**
 * Converts the Message instance to a JSON string representation.
 * @returns {string} The JSON string representation of the Message object.
 */
Message.prototype.toJSON = function toJSON() {
  return JSON.stringify(this.toObject());
};


/**
 * Converts the message buffer to a string representation.
 * @returns {string} The string representation of the message buffer.
 */
Message.prototype.toString = function () {
  return this.messageBuffer.toString();
};


/**
 * Custom inspect method for Message instances.
 * @returns {string} String representation in format '<Message: [content]>'.
 */
Message.prototype.inspect = function () {
  return '<Message: ' + this.toString() + '>';
};

export default Message;
