export = Signature;
/**
 * Creates a new Signature instance from BN values or an object.
 * @constructor
 * @param {BN|Object} r - Either a BN instance for the r value or an object containing r and s properties.
 * @param {BN} [s] - The s value (required if r is a BN instance).
 */
declare function Signature(r: BN | any, s?: BN): Signature;
declare class Signature {
    /**
     * Creates a new Signature instance from BN values or an object.
     * @constructor
     * @param {BN|Object} r - Either a BN instance for the r value or an object containing r and s properties.
     * @param {BN} [s] - The s value (required if r is a BN instance).
     */
    constructor(r: BN | any, s?: BN);
    /**
     * Sets signature properties from an object.
     * @param {Object} obj - Object containing signature properties
     * @param {Buffer} [obj.r] - r value
     * @param {Buffer} [obj.s] - s value
     * @param {number} [obj.i] - Public key recovery parameter (0-3)
     * @param {boolean} [obj.compressed] - Whether recovered pubkey is compressed
     * @param {number} [obj.nhashtype] - Hash type
     * @returns {Signature} Returns the signature instance for chaining
     */
    set(obj: {
        r?: Buffer;
        s?: Buffer;
        i?: number;
        compressed?: boolean;
        nhashtype?: number;
    }): Signature;
    r: any;
    s: any;
    i: any;
    compressed: any;
    nhashtype: any;
    /**
     * Converts the signature to a compact format.
     * @param {number} [i] - The recovery ID (0, 1, 2, or 3). Defaults to the instance's `i` value.
     * @param {boolean} [compressed] - Whether the signature is compressed. Defaults to the instance's `compressed` value.
     * @returns {Buffer} - The compact signature as a Buffer (1 byte recovery ID + 32 bytes r + 32 bytes s).
     * @throws {Error} - If `i` is not 0, 1, 2, or 3.
     */
    toCompact(i?: number, compressed?: boolean): Buffer;
    /**
     * Converts the signature to DER format.
     * Handles negative values by prepending a zero byte if necessary.
     *
     * @returns {Buffer} The DER-encoded signature.
     */
    toBuffer: () => Buffer;
    toDER(): Buffer;
    /**
     * Converts the signature to a hexadecimal string representation.
     * @returns {string} The DER-encoded signature in hexadecimal format.
     */
    toString(): string;
    /**
     * Checks if the signature's S value is within the valid range (low-S).
     * See also ECDSA signature algorithm which enforces this.
     * See also BIP 62, "low S values in signatures"
     * @returns {boolean} True if S is between 1 and the upper bound (0x7F...A0), false otherwise.
     */
    hasLowS(): boolean;
    /**
     * Checks if the signature has a defined hashtype.
     * - Validates that nhashtype is a natural number
     * - Accepts with or without Signature.SIGHASH_ANYONECANPAY by ignoring the bit
     * - Verifies the hashtype is between SIGHASH_ALL and SIGHASH_SINGLE
     * @returns {boolean} True if the hashtype is valid, false otherwise
     */
    hasDefinedHashtype(): boolean;
    /**
     * Converts the signature to transaction format by concatenating the DER-encoded signature
     * with the hash type byte.
     * @returns {Buffer} The signature in transaction format (DER + hash type byte).
     */
    toTxFormat(): Buffer;
}
declare namespace Signature {
    /**
     * Creates a Signature instance from a compact ECDSA signature buffer.
     * @param {Buffer} buf - The compact signature buffer (65 bytes).
     * @returns {Signature} The parsed signature object.
     * @throws {Error} If the input is invalid (not a Buffer, wrong length, or invalid recovery param).
     * @static
     */
    export function fromCompact(buf: Buffer): Signature;
    export function fromDER(buf: Buffer, strict?: boolean): Signature;
    export function fromBuffer(buf: Buffer, strict?: boolean): Signature;
    /**
     * Converts a transaction-format signature buffer to a Signature object.
     * @param {Buffer} buf - The signature buffer in transaction format (DER + hash type byte)
     * @returns {Signature} The parsed Signature object with nhashtype property set
     * @static
     */
    export function fromTxFormat(buf: Buffer): Signature;
    /**
     * Creates a Signature instance from a hex-encoded string.
     * @param {string} str - Hex-encoded signature string
     * @returns {Signature} Signature instance parsed from DER format
     * @static
     */
    export function fromString(str: string): Signature;
    /**
     * Parses a DER formatted signature buffer into its components.
     * In order to mimic the non-strict DER encoding of OpenSSL, set strict = false.
     * @param {Buffer} buf - The DER formatted signature buffer to parse
     * @param {boolean} [strict=true] - Whether to perform strict length validation
     * @returns {Object} An object containing the parsed signature components:
     *   - header: The DER header byte (0x30)
     *   - length: The total length of the signature components
     *   - rheader: The R component header byte (0x02)
     *   - rlength: The length of the R component
     *   - rneg: Whether R is negative
     *   - rbuf: The R component buffer
     *   - r: The R component as a BN
     *   - sheader: The S component header byte (0x02)
     *   - slength: The length of the S component
     *   - sneg: Whether S is negative
     *   - sbuf: The S component buffer
     *   - s: The S component as a BN
     * @throws {Error} If the buffer is not valid DER format or length checks fail
     * @static
     */
    export function parseDER(buf: Buffer, strict?: boolean): any;
    /**
     * This function is translated from bitcoind's IsDERSignature and is used in
     * the script interpreter.  This "DER" format actually includes an extra byte,
     * the nhashtype, at the end. It is really the tx format, not DER format.
     *
     * A canonical signature exists of: [30] [total len] [02] [len R] [R] [02] [len S] [S] [hashtype]
     * Where R and S are not negative (their first byte has its highest bit not set), and not
     * excessively padded (do not start with a 0 byte, unless an otherwise negative number follows,
     * in which case a single 0 byte is necessary and even required).
     *
     * See https://bitcointalk.org/index.php?topic=8392.msg127623#msg127623
     *
     * @param {Buffer} buf - The buffer containing the signature to verify
     * @returns {boolean} True if the signature is valid DER-encoded, false otherwise
     * @static
     */
    export function isTxDER(buf: Buffer): boolean;
    export let SIGHASH_ALL: number;
    export let SIGHASH_NONE: number;
    export let SIGHASH_SINGLE: number;
    export let SIGHASH_ANYONECANPAY: number;
    import ALL = SIGHASH_ALL;
    export { ALL };
    import NONE = SIGHASH_NONE;
    export { NONE };
    import SINGLE = SIGHASH_SINGLE;
    export { SINGLE };
    export let ANYONECANPAY_ALL: number;
    export let ANYONECANPAY_NONE: number;
    export let ANYONECANPAY_SINGLE: number;
}
import BN = require("../bn.cjs");
