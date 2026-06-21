
var Input = require('./input.cjs');

var PublicKeyInput = require('./publickey.cjs');
var PublicKeyHashInput = require('./publickeyhash.cjs');
var MultiSigInput = require('./multisig.cjs');


/**
 * Attaches the PublicKeyInput class to the Input namespace.
 * @memberof Input
 * @name PublicKey
 * @alias PublicKeyInput
 */
Input.PublicKey = PublicKeyInput;


/**
 * Attaches the PublicKeyHashInput class to the Input namespace.
 * @memberof Input
 * @name PublicKeyHash
 * @alias PublicKeyHashInput
 */
Input.PublicKeyHash = PublicKeyHashInput;
/**
 * Attaches the PublicKeyHashInput class to the Input namespace.
 * @memberof Input
 * @name MultiSig
 * @alias MultiSigInput
 */
Input.MultiSig = MultiSigInput;


module.exports = Input