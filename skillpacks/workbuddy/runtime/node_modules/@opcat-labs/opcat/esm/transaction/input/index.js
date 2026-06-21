
import Input from './input.js';
import PublicKeyInput from './publickey.js';
import PublicKeyHashInput from './publickeyhash.js';
import MultiSigInput from './multisig.js';


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


export default Input;