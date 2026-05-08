export = PublicKeyInput;
/**
 * Represents a special kind of input of PayToPublicKey kind.
 * @constructor
 */
declare function PublicKeyInput(...args: any[]): void;
declare class PublicKeyInput {
    /**
     * Represents a special kind of input of PayToPublicKey kind.
     * @constructor
     */
    constructor(...args: any[]);
    /**
     * @param {Transaction} transaction - the transaction to be signed
     * @param {PrivateKey} privateKey - the private key with which to sign the transaction
     * @param {number} index - the index of the input in the transaction input vector
     * @param {number} [sigtype] - the type of signature, defaults to Signature.SIGHASH_ALL
     * @return {Array} of objects that can be
     */
    getSignatures(transaction: Transaction, privateKey: PrivateKey, index: number, sigtype?: number): any[];
    /**
     * Adds a signature to the public key input after validating it.
     * @param {Object} transaction - The transaction to validate against.
     * @param {TransactionSignature} signature - The signature object containing signature data and type.
     * @returns {PublicKeyInput} Returns the instance for chaining.
     * @throws {Error} Throws if the signature is invalid.
     */
    addSignature(transaction: any, signature: TransactionSignature): PublicKeyInput;
    /**
     * Clears all signatures from this input by setting an empty script.
     * @returns {PublicKeyInput} The instance for chaining.
     */
    clearSignatures(): PublicKeyInput;
    /**
     * Checks if the public key input is fully signed by verifying the script contains a public key.
     * @returns {boolean} True if the script contains a public key, false otherwise.
     */
    isFullySigned(): boolean;
    private _estimateSize;
}
declare namespace PublicKeyInput {
    let SCRIPT_MAX_SIZE: number;
}
import TransactionSignature = require("../signature.cjs");
