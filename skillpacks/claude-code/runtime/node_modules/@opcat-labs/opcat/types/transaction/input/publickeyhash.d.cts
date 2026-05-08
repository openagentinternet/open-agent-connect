export = PublicKeyHashInput;
/**
 * Represents a special kind of input of PayToPublicKeyHash kind.
 * @constructor
 */
declare function PublicKeyHashInput(...args: any[]): void;
declare class PublicKeyHashInput {
    /**
     * Represents a special kind of input of PayToPublicKeyHash kind.
     * @constructor
     */
    constructor(...args: any[]);
    /**
     * @param {Transaction} transaction - the transaction to be signed
     * @param {PrivateKey} privateKey - the private key with which to sign the transaction
     * @param {number} index - the index of the input in the transaction input vector
     * @param {number} [sigtype] - the type of signature, defaults to Signature.SIGHASH_ALL
     * @param {Buffer} [hashData] - the precalculated hash of the public key associated with the privateKey provided
     * @return {Array} of objects that can be
     */
    getSignatures(transaction: Transaction, privateKey: PrivateKey, index: number, sigtype?: number, hashData?: Buffer): any[];
    /**
     * Adds a signature to the input and updates the script.
     * @param {Transaction} transaction - The transaction to validate against.
     * @param {TransactionSignature} signature - The signature object containing publicKey, signature (DER format), and sigtype.
     * @returns {PublicKeyHashInput} Returns the instance for chaining.
     * @throws {Error} Throws if the signature is invalid.
     */
    addSignature(transaction: Transaction, signature: TransactionSignature): PublicKeyHashInput;
    /**
     * Clear the input's signature
     * @return {PublicKeyHashInput} this, for chaining
     */
    clearSignatures(): PublicKeyHashInput;
    /**
     * Query whether the input is signed
     * @return {boolean}
     */
    isFullySigned(): boolean;
    private _estimateSize;
}
declare namespace PublicKeyHashInput {
    let SCRIPT_MAX_SIZE: number;
}
import TransactionSignature = require("../signature.cjs");
