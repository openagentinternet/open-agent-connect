export = MultiSigInput;
/**
 * Represents a MultiSigInput for a transaction.
 * @constructor
 * @param {Object} input - The input object containing publicKeys, threshold, and signatures.
 * @param {Array} pubkeys - Array of public keys (optional, defaults to input.publicKeys).
 * @param {number} threshold - Required number of signatures (optional, defaults to input.threshold).
 * @param {Array} signatures - Array of signatures (optional, defaults to input.signatures).
 * @description Validates that provided public keys match the output script and initializes signatures.
 */
declare function MultiSigInput(input: any, pubkeys: any[], threshold: number, signatures: any[], ...args: any[]): void;
declare class MultiSigInput {
    /**
     * Represents a MultiSigInput for a transaction.
     * @constructor
     * @param {Object} input - The input object containing publicKeys, threshold, and signatures.
     * @param {Array} pubkeys - Array of public keys (optional, defaults to input.publicKeys).
     * @param {number} threshold - Required number of signatures (optional, defaults to input.threshold).
     * @param {Array} signatures - Array of signatures (optional, defaults to input.signatures).
     * @description Validates that provided public keys match the output script and initializes signatures.
     */
    constructor(input: any, pubkeys: any[], threshold: number, signatures: any[], ...args: any[]);
    publicKeys: PublicKey[];
    publicKeyIndex: {};
    threshold: number;
    signatures: any[];
    /**
     * Converts the MultiSigInput instance to a plain object representation.
     * Includes threshold, publicKeys (converted to strings), and serialized signatures.
     * @returns {Object} The plain object representation of the MultiSigInput.
     */
    toObject(...args: any[]): any;
    private _deserializeSignatures;
    private _serializeSignatures;
    /**
     * Gets signatures for a MultiSigInput by signing the transaction with the provided private key.
     * Only signs for public keys that match the private key's public key.
     *
     * @param {Transaction} transaction - The transaction to sign
     * @param {PrivateKey} privateKey - The private key used for signing
     * @param {number} index - The input index
     * @param {number} [sigtype=Signature.SIGHASH_ALL] - The signature type
     * @returns {TransactionSignature[]} Array of transaction signatures
     */
    getSignatures(transaction: Transaction, privateKey: PrivateKey, index: number, sigtype?: number): TransactionSignature[];
    /**
     * Adds a signature to the MultiSigInput if valid and not already fully signed.
     * @param {Object} transaction - The transaction to validate the signature against.
     * @param {Object} signature - The signature object containing publicKey and signature data.
     * @throws {Error} If already fully signed, no matching public key, or invalid signature.
     * @returns {MultiSigInput} Returns the instance for chaining.
     */
    addSignature(transaction: any, signature: any): MultiSigInput;
    /**
     * Updates the multisig input script by rebuilding it with current public keys, threshold, and signatures.
     * @returns {MultiSigInput} Returns the instance for chaining.
     */
    _updateScript(): MultiSigInput;
    /**
     * Creates DER-encoded signatures from the input's signature data.
     * Filters out undefined signatures and converts each valid signature to a Buffer
     * containing the DER-encoded signature followed by its sigtype byte.
     * @returns {Buffer[]} Array of signature Buffers
     */
    _createSignatures(): Buffer[];
    /**
     * Clears all signatures from the MultiSigInput by resetting the signatures array
     * and updating the script. The signatures array length matches the publicKeys array.
     */
    clearSignatures(): void;
    /**
     * Checks if the MultiSigInput is fully signed by comparing the number of signatures
     * with the required threshold.
     * @returns {boolean} True if the input has enough signatures, false otherwise.
     */
    isFullySigned(): boolean;
    /**
     * Returns the number of missing signatures required to meet the threshold.
     * @returns {number} The count of missing signatures.
     */
    countMissingSignatures(): number;
    /**
     * Counts the number of valid signatures in the MultiSigInput.
     * @returns {number} The count of non-null/undefined signatures.
     */
    countSignatures(): number;
    /**
     * Returns an array of public keys that haven't been signed yet in this MultiSigInput.
     * @returns {Array} Array of unsigned public keys
     */
    publicKeysWithoutSignature(): any[];
    /**
     * Verifies a signature for a MultiSigInput transaction.
     *
     * @param {Object} transaction - The transaction to verify.
     * @param {Object} signature - The signature object containing signature data.
     * @param {Buffer} signature.signature - The signature to verify.
     * @param {Buffer} signature.publicKey - The public key corresponding to the signature.
     * @param {number} signature.inputIndex - The index of the input being signed.
     * @param {number} signature.sigtype - The signature type (assigned to nhashtype as a workaround).
     * @returns {boolean} True if the signature is valid, false otherwise.
     */
    isValidSignature(transaction: any, signature: {
        signature: Buffer;
        publicKey: Buffer;
        inputIndex: number;
        sigtype: number;
    }): boolean;
    private _estimateSize;
}
declare namespace MultiSigInput {
    /**
     * Normalizes signatures for a MultiSigInput by matching each public key with its corresponding signature.
     * Filters and validates signatures against the provided public keys and transaction.
     *
     * @param {Object} transaction - The transaction to verify against.
     * @param {Object} input - The input containing prevTxId and outputIndex.
     * @param {number} inputIndex - The index of the input in the transaction.
     * @param {Array<Buffer>} signatures - Array of signature buffers to normalize.
     * @param {Array<PublicKey>} publicKeys - Array of public keys to match signatures against.
     * @returns {Array<TransactionSignature|null>} Array of matched signatures or null for unmatched keys.
     */
    function normalizeSignatures(transaction: any, input: any, inputIndex: number, signatures: Buffer[], publicKeys: PublicKey[]): TransactionSignature[];
    let SIGNATURE_SIZE: number;
}
import PublicKey = require("../../publickey.cjs");
import TransactionSignature = require("../signature.cjs");
