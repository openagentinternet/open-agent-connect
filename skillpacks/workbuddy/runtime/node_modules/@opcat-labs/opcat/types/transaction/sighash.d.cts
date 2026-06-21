export = Sighash;
/**
 * Represents a Sighash utility for cryptographic signature operations.
 * @constructor
 */
declare function Sighash(): void;
declare class Sighash {
}
declare namespace Sighash {
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
    function sighashPreimage(transaction: Transaction, sighashType: number, inputNumber: number): Buffer;
    function getLowSSighashPreimage(tx: any, sigtype: any, inputIndex: any): Buffer;
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
    function sighash(transaction: Transaction, sighashType: number, inputNumber: number): Buffer;
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
    function sign(transaction: Transaction, privateKey: PrivateKey, sighashType: any, inputIndex: number): Signature;
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
    function verify(transaction: Transaction, signature: Signature, publicKey: PublicKey, inputIndex: number): boolean;
}
import Signature = require("../crypto/signature.cjs");
