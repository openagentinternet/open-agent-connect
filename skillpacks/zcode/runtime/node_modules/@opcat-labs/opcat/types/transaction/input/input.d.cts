export = Input;
/**
 * Creates an Input instance from parameters.
 * @constructor
 * @param {Object} params - Input parameters object
 * @param {string|Buffer} params.prevTxId - Previous transaction ID (hex string or Buffer)
 * @param {number} params.outputIndex - Output index in previous transaction
 * @param {Output} [params.output] - Output instance or output parameters
 * @param {number} [params.sequenceNumber] - Sequence number (defaults to DEFAULT_SEQNUMBER)
 * @param {Script|Buffer|string} [params.script] - Script instance, buffer or hex string
 * @returns {Input} New Input instance or initialized instance if params provided.
 */
declare function Input(params: {
    prevTxId: string | Buffer;
    outputIndex: number;
    output?: Output;
    sequenceNumber?: number;
    script?: Script | Buffer | string;
}): Input;
declare class Input {
    /**
     * Creates an Input instance from parameters.
     * @constructor
     * @param {Object} params - Input parameters object
     * @param {string|Buffer} params.prevTxId - Previous transaction ID (hex string or Buffer)
     * @param {number} params.outputIndex - Output index in previous transaction
     * @param {Output} [params.output] - Output instance or output parameters
     * @param {number} [params.sequenceNumber] - Sequence number (defaults to DEFAULT_SEQNUMBER)
     * @param {Script|Buffer|string} [params.script] - Script instance, buffer or hex string
     * @returns {Input} New Input instance or initialized instance if params provided.
     */
    constructor(params: {
        prevTxId: string | Buffer;
        outputIndex: number;
        output?: Output;
        sequenceNumber?: number;
        script?: Script | Buffer | string;
    });
    get script(): any;
    private _fromObject;
    output: Output;
    prevTxId: any;
    outputIndex: any;
    sequenceNumber: any;
    /**
     * Converts the Input instance to a plain object for JSON serialization.
     * Includes prevTxId, outputIndex, sequenceNumber, and script as hex strings.
     * Optionally adds human-readable scriptString if script is valid,
     * and includes the output object if present.
     * @returns {Object} A plain object representation of the Input.
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Serializes the input to a BufferWriter.
     * @param {boolean} hashScriptSig - Whether to hash the script (true) or include it directly (false).
     * @param {BufferWriter} [writer] - Optional BufferWriter instance to write to.
     * @returns {BufferWriter} The BufferWriter containing the serialized input.
     */
    toBufferWriter(hashScriptSig: boolean, writer?: BufferWriter): BufferWriter;
    /**
     * Converts the input to a prevout format (txid + output index) as a buffer.
     * @returns {Buffer} The serialized prevout data.
     */
    toPrevout(): Buffer;
    /**
     * Sets the script for this input.
     * @param {Script|string|Buffer|null} script - Can be a Script object, hex string, human-readable string, Buffer, or null (for empty script)
     * @returns {Input} Returns the Input instance for chaining
     * @throws {TypeError} If script is of invalid type
     */
    setScript(script: Script | string | Buffer | null): Input;
    _script: Script;
    _scriptBuffer: Buffer;
    /**
     * Retrieve signatures for the provided PrivateKey.
     *
     * @param {Transaction} transaction - the transaction to be signed
     * @param {PrivateKey | Array} privateKeys - the private key to use when signing
     * @param {number} inputIndex - the index of this input in the provided transaction
     * @param {number} sigType - defaults to Signature.SIGHASH_ALL
     */
    getSignatures(transaction: Transaction, privateKeys: PrivateKey | any[], inputIndex: number, sigtype: any): TransactionSignature[];
    /**
     * Retrieve preimage for the Input.
     *
     * @param {Transaction} transaction - the transaction to be signed
     * @param {number} inputIndex - the index of this input in the provided transaction
     * @param {number} sigType - defaults to Signature.SIGHASH_ALL
     * @param {boolean} isLowS - true if the sig hash is safe for low s.
     */
    getPreimage(transaction: Transaction, inputIndex: number, sigtype: any, isLowS: boolean): Buffer;
    /**
     * Abstract method that throws an error when invoked. Must be implemented by subclasses
     * to determine if all required signatures are present on this input.
     * @throws {AbstractMethodInvoked} Always throws to indicate abstract method usage
     * @abstract
     */
    isFullySigned(): never;
    /**
     * Checks if the input is final (has maximum sequence number).
     * @returns {boolean} True if the input is final, false otherwise.
     */
    isFinal(): boolean;
    /**
     * Abstract method to add a signature to the transaction input.
     * Must be implemented by concrete input types.
     * @param {Object} transaction - The transaction to sign
     * @param {Object} signature - The signature to add
     * @abstract
     */
    addSignature(_transaction: any, _signature: any): void;
    /**
     * Clears all signatures from the input.
     * @abstract
     */
    clearSignatures(): void;
    /**
     * Verifies if a signature is valid for this input in the given transaction.
     * Note: Temporarily modifies the signature object by setting nhashtype from sigtype.
     *
     * @param {Object} transaction - The transaction to verify against
     * @param {TransactionSignature} signature - Signature object containing signature, publicKey, etc.
     * @returns {boolean} True if the signature is valid, false otherwise
     */
    isValidSignature(transaction: any, signature: TransactionSignature): boolean;
    /**
     * @returns true if this is a coinbase input (represents no input)
     */
    isNull(): boolean;
    private _estimateSize;
}
declare namespace Input {
    export { MAXINT };
    export { DEFAULT_SEQNUMBER };
    export { DEFAULT_LOCKTIME_SEQNUMBER };
    export { DEFAULT_RBF_SEQNUMBER };
    export let BASE_SIZE: number;
    /**
     * Creates an Input instance from a plain JavaScript object.
     * @param {Object} params - Input parameters object
     * @param {string|Buffer} params.prevTxId - Previous transaction ID (hex string or Buffer)
     * @param {number} params.outputIndex - Output index in previous transaction
     * @param {Output} [params.output] - Output instance or output parameters
     * @param {number} [params.sequenceNumber] - Sequence number (defaults to DEFAULT_SEQNUMBER)
     * @param {Script|Buffer|string} [params.script] - Script instance, buffer or hex string
     * @returns {Input} The created Input instance.
     * @throws {Error} Will throw if the argument is not an object.
     */
    export function fromObject(params: {
        prevTxId: string | Buffer;
        outputIndex: number;
        output?: Output;
        sequenceNumber?: number;
        script?: string | Buffer | Script;
    }): Input;
    /**
     * Creates an Input instance from a BufferReader.
     * @param {BufferReader} br - The buffer reader containing input data.
     * @returns {Input} The parsed Input object with properties:
     *   - prevTxId: Reversed 32-byte previous transaction ID.
     *   - outputIndex: LE uint32 output index.
     *   - _scriptBuffer: Var-length script buffer.
     *   - sequenceNumber: LE uint32 sequence number.
     * @note TODO: Return specialized input types (CoinbaseInput, PublicKeyHashInput, etc.).
     * @static
     */
    export function fromBufferReader(br: BufferReader): Input;
}
import Output = require("../output.cjs");
import Script = require("../../script/script.cjs");
import BufferWriter = require("../../encoding/bufferwriter.cjs");
import PrivateKey = require("../../privatekey.cjs");
import TransactionSignature = require("../signature.cjs");
declare var MAXINT: number;
declare var DEFAULT_SEQNUMBER: number;
declare var DEFAULT_LOCKTIME_SEQNUMBER: number;
declare var DEFAULT_RBF_SEQNUMBER: number;
