export = UnspentOutput;
/**
 * Represents an unspent output information: its script, associated amount and address,
 * transaction id and output index.
 *
 * @constructor
 * @param {object} data
 * @param {string} data.txid the previous transaction id
 * @param {string=} data.txId alias for `txid`
 * @param {number} data.vout the index in the transaction
 * @param {number=} data.outputIndex alias for `vout`
 * @param {string|Script} data.scriptPubKey the script that must be resolved to release the funds
 * @param {string|Script=} data.script alias for `scriptPubKey`
 * @param {number} data.amount amount of bitcoins associated
 * @param {number=} data.satoshis alias for `amount`, but expressed in satoshis (1 OPCAT = 1e8 satoshis)
 * @param {string|Address=} data.address the associated address to the script, if provided
 */
declare function UnspentOutput(data: {
    txid: string;
    txId?: string | undefined;
    vout: number;
    outputIndex?: number | undefined;
    scriptPubKey: string | Script;
    script?: (string | Script) | undefined;
    amount: number;
    satoshis?: number | undefined;
    address?: (string | Address) | undefined;
}): UnspentOutput;
declare class UnspentOutput {
    /**
     * Represents an unspent output information: its script, associated amount and address,
     * transaction id and output index.
     *
     * @constructor
     * @param {object} data
     * @param {string} data.txid the previous transaction id
     * @param {string=} data.txId alias for `txid`
     * @param {number} data.vout the index in the transaction
     * @param {number=} data.outputIndex alias for `vout`
     * @param {string|Script} data.scriptPubKey the script that must be resolved to release the funds
     * @param {string|Script=} data.script alias for `scriptPubKey`
     * @param {number} data.amount amount of bitcoins associated
     * @param {number=} data.satoshis alias for `amount`, but expressed in satoshis (1 OPCAT = 1e8 satoshis)
     * @param {string|Address=} data.address the associated address to the script, if provided
     */
    constructor(data: {
        txid: string;
        txId?: string | undefined;
        vout: number;
        outputIndex?: number | undefined;
        scriptPubKey: string | Script;
        script?: (string | Script) | undefined;
        amount: number;
        satoshis?: number | undefined;
        address?: (string | Address) | undefined;
    });
    /**
     * Provide an informative output when displaying this object in the console
     * @returns string
     */
    inspect(): string;
    /**
     * String representation: just "txid:index"
     * @returns string
     */
    toString(): string;
    /**
     * Returns a plain object (no prototype or methods) with the associated info for this output
     * @return {object}
     */
    toObject: () => object;
    toJSON(): object;
}
declare namespace UnspentOutput {
    /**
     * Deserialize an UnspentOutput from an object
     * @param {object|string} data
     * @return UnspentOutput
     */
    function fromObject(data: any): UnspentOutput;
}
import Script = require("../script/script.cjs");
import Address = require("../address.cjs");
