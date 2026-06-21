import { o as ToCBOR, W as Writer } from './options-Tr9xj9hl.js';
import './sorts.js';

declare enum NAN_SIZE {
    /** Only used for bigint constructor, means use the size of the bigint. */
    NATURAL = -2,
    /** Size not known, use the preferred size. */
    UNKNOWN = -1,
    F16 = 2,
    F32 = 4,
    F64 = 8
}
/**
 * Wrapper for NaN with payload.  Note: the CBOR data model is always f64.
 * All of the size mechanics here are ONLY for getting EDN encoding indicators
 * correct.
 */
declare class NAN extends Number implements ToCBOR {
    #private;
    /**
     * Create a boxed NaN.
     *
     * @param bytes Full CBOR encoding of the NaN, including leading MT/AI byte.
     */
    constructor(bytes: Uint8Array);
    /**
     * Create a boxed NaN from constituent parts.
     *
     * @param payload Integer with absolute value < 2**52 - 1.  If negative,
     *   sign will be promoted to the float, and the absolute value will be used
     *   as the payload.
     * @param quiet True if quiet.
     * @param size Encoded size of the resulting CBOR bytes, as from encoding
     *   indicator. 1 = 3 bytes, 2 = 5 bytes, 3 = 9 bytes.  -1 (the default)
     *   means to use the payload to pick the minimum size.
     */
    constructor(payload: number, quiet?: boolean, size?: NAN_SIZE);
    /**
     * Create a boxed NaN from a raw integer equivalent.
     *
     * @param raw Raw integer, such as 0x7e00n.  Can be 16-, 32- or 64-bits wide,
     *   but the exponent bits must be set correctly.
     * @param ignored This parameter is ignored in bigint mode.
     * @param size Use NAN_SIZE.NATURAL to copy the bigint size.
     */
    constructor(raw: bigint, ignored?: boolean, size?: NAN_SIZE);
    /**
     * Get the CBOR bytes for this NaN.
     */
    get bytes(): Uint8Array;
    /**
     * Is the quiet bit set?
     */
    get quiet(): boolean;
    /**
     * If negative -1, otherwise 1.  Should never be 0, since you should use
     * a real NaN or Infinity for those.
     */
    get sign(): number;
    /**
     * Payload, as in IEEE754-2019.
     */
    get payload(): number;
    /**
     * Full 64-bit encoding, with sign and quiet bit intact.
     */
    get raw(): bigint;
    /**
     * Encoding indicator, based on the preferred size.
     */
    get encodingIndicator(): string;
    /**
     * The desired encoding size (2, 4, or 8).
     */
    get size(): NAN_SIZE;
    /**
     * How many bytes should this NaN be encoded as in prefrerred encoding?
     */
    get preferredSize(): NAN_SIZE;
    /**
     * Is this currrently configured for preferred encoding?
     */
    get isShortestEncoding(): boolean;
    /**
     * Write to a CBOR stream.
     * @param w Writer.
     */
    toCBOR(w: Writer): undefined;
    /**
     * Convert to a string in the given radix.
     *
     * @param radix Base for output.  Valid values: 2, 8, 10, and 16.
     * @returns String in the selected radix, with the correct radix prefix if
     *   radix is not 10.
     */
    toString(radix?: number): string;
}
/**
 * Parse a big endian float16 from a buffer.
 *
 * @param buf Buffer to read from.
 * @param offset Offset into buf to start reading 2 octets.
 * @param rejectSubnormals Throw if the result is subnormal.
 * @returns Parsed float.
 * @throws Unwanted subnormal.
 */
declare function parseHalf(buf: Uint8Array, offset?: number, rejectSubnormals?: boolean): number;
/**
 * Return a big-endian unsigned integer that has the same internal layout
 * as the given number as a float16, if it fits.  Otherwise returns null.
 *
 * @param half The number to convert to a half-precision float.  Must fit into
 *   at least a float32.
 * @returns Number on success, otherwise null.  Make sure to check with
 *   `=== null`, in case this returns 0, which is valid.
 */
declare function halfToUint(half: number): number | null;
/**
 * Flush subnormal numbers to 0/-0.
 *
 * @param n Number.
 * @returns Normalized number.
 */
declare function flushToZero(n: number): number;
/**
 * Does the given buffer contain a bigEndian IEEE754 float that is subnormal?
 * If so, throw an error.
 *
 * @param buf 2, 4, or 8 bytes for float16, float32, or float64.
 * @throws Bad input or subnormal.
 */
declare function checkSubnormal(buf: Uint8Array): void;

export { NAN, NAN_SIZE, checkSubnormal, flushToZero, halfToUint, parseHalf };
