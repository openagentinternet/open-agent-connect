export = TransactionSignature;
/**
 * @desc
 * Wrapper around Signature with fields related to signing a transaction specifically
 *
 * @param {Object|string|TransactionSignature} arg
 * @constructor
 */
declare function TransactionSignature(arg: any | string | TransactionSignature): TransactionSignature;
declare class TransactionSignature {
    /**
     * @desc
     * Wrapper around Signature with fields related to signing a transaction specifically
     *
     * @param {Object|string|TransactionSignature} arg
     * @constructor
     */
    constructor(arg: any | string | TransactionSignature);
    private _fromObject;
    publicKey: PublicKey;
    prevTxId: Buffer;
    outputIndex: number;
    inputIndex: number;
    signature: Signature;
    sigtype: number;
    private _checkObjectArgs;
    /**
     * Serializes a transaction to a plain JS object
     * @return {Object}
     */
    toObject: () => any;
    toJSON(): any;
}
declare namespace TransactionSignature {
    /**
     * Builds a TransactionSignature from an object
     * @param {Object} object
     * @return {TransactionSignature}
     */
    function fromObject(object: any): TransactionSignature;
}
import PublicKey = require("../publickey.cjs");
import Signature = require("../crypto/signature.cjs");
