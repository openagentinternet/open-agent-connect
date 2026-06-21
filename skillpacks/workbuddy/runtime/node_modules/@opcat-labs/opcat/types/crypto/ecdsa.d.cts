export = ECDSA;
/**
 * Creates an ECDSA instance.
 * @constructor
 * @param {Object} [obj] - Optional object containing properties to initialize the instance.
 */
declare function ECDSA(obj?: any): ECDSA;
declare class ECDSA {
    /**
     * Creates an ECDSA instance.
     * @constructor
     * @param {Object} [obj] - Optional object containing properties to initialize the instance.
     */
    constructor(obj?: any);
    /**
     * Updates the ECDSA instance properties with provided values.
     * @param {Object} obj - Object containing properties to update
     * @param {Buffer} [obj.hashbuf] - Hash buffer
     * @param {string} [obj.endian] - Endianness of hashbuf
     * @param {PrivateKey} [obj.privkey] - Private key
     * @param {PublicKey} [obj.pubkey] - Public key (derived from privkey if not provided)
     * @param {Signature} [obj.sig] - Signature
     * @param {BigInteger} [obj.k] - Random number k
     * @param {boolean} [obj.verified] - Verification status
     * @returns {ECDSA} Returns the updated ECDSA instance
     */
    set(obj: {
        hashbuf?: Buffer;
        endian?: string;
        privkey?: PrivateKey;
        pubkey?: PublicKey;
        sig?: Signature;
        k?: BigInteger;
        verified?: boolean;
    }): ECDSA;
    hashbuf: any;
    endian: any;
    privkey: any;
    pubkey: any;
    sig: any;
    k: any;
    verified: any;
    /**
     * Converts the private key to a public key and stores it in the `pubkey` property.
     */
    privkey2pubkey(): void;
    /**
     * Calculates the recovery factor (i) for ECDSA signature verification.
     * Iterates through possible recovery factors (0-3) to find the one that
     * reconstructs the correct public key from the signature.
     *
     * @returns {ECDSA} Returns the instance with updated signature properties if successful.
     * @throws {Error} Throws if no valid recovery factor is found after all iterations.
     */
    calci(): ECDSA;
    /**
     * Generates a random value `k` for ECDSA signing.
     * The value is generated within the range (0, N) where N is the curve order.
     * The generated `k` is stored in the instance and returned for chaining.
     */
    randomK(): this;
    /**
     * Generates a deterministic K value for ECDSA signing as per RFC 6979.
     * See:
     *  https://tools.ietf.org/html/rfc6979#section-3.2
     * Handles invalid r/s cases by incrementing badrs counter and regenerating K.
     * @param {number} [badrs=0] - Counter for invalid r/s cases (default: 0)
     * @returns {ECDSA} Returns the ECDSA instance for chaining
     */
    deterministicK(badrs?: number): ECDSA;
    /**
     * Converts an ECDSA signature to its corresponding public key.
     *
     * The method follows the ECDSA public key recovery process:
     * 1. Validates the recovery parameter `i` (must be 0-3)
     * 2. Derives the public key point Q using the formula: Q = r⁻¹(sR - eG)
     * 3. Validates the derived curve point
     *
     * see:
     *  https://bitcointalk.org/index.php?topic=6430.0
     *  http://stackoverflow.com/questions/19665491/how-do-i-get-an-ecdsa-public-key-from-just-a-bitcoin-signature-sec1-4-1-6-k
     * @returns {PublicKey} The recovered public key
     * @throws {Error} If recovery parameter is invalid or derived point is invalid
     */
    toPublicKey(): PublicKey;
    /**
     * Validates an ECDSA signature and returns an error message if invalid.
     * Checks:
     * - hashbuf is a 32-byte buffer
     * - r and s values are within valid range
     * - Signature verification against public key
     * @returns {string|boolean} Error message if invalid, false if valid
     */
    sigError(): string | boolean;
    /**
     * Finds a valid ECDSA signature (r, s) for the given private key `d` and message hash `e`.
     * Uses deterministic k-value generation if initial attempts fail.
     *
     * @param {BN} d - Private key as a big number.
     * @param {BN} e - Message hash as a big number.
     * @returns {Object} Signature object with properties `r` and `s` (big numbers).
     * @throws Will throw if unable to find valid signature after multiple attempts.
     */
    _findSignature(d: BN, e: BN): any;
    /**
     * Signs a message using ECDSA.
     *
     * @param {Buffer} hashbuf - 32-byte buffer containing the hash of the message to sign.
     * @param {PrivateKey} privkey - Private key used for signing.
     * @returns {ECDSA} Returns the instance for chaining.
     * @throws {Error} Throws if parameters are invalid or hashbuf is not a 32-byte buffer.
     */
    sign(): ECDSA;
    /**
     * Signs the message using a randomly generated k value.
     *
     * @returns The signature object containing r and s values.
     */
    signRandomK(): ECDSA;
    /**
     * Converts the ECDSA instance to a JSON string representation.
     * Includes hash buffer, private key, public key, signature, and k value if present.
     * Each property is converted to a string format (hex for hashbuf, toString() for others).
     * @returns {string} JSON string containing the ECDSA instance properties
     */
    toString(): string;
    /**
     * Verifies the ECDSA signature and updates the `verified` property.
     * @returns {ECDSA} The current instance for chaining.
     */
    verify(): ECDSA;
}
declare namespace ECDSA {
    /**
     * Creates an ECDSA instance from a JSON string representation.
     * @param {string} str - JSON string containing ECDSA parameters.
     * @returns {ECDSA} New ECDSA instance initialized with parsed data.
     */
    function fromString(str: string): ECDSA;
    /**
     * Converts the signature `s` value to its low-S form to comply with BIP 62.
     * This prevents signature malleability by ensuring `s` is not greater than half the curve order.
     * @param {BN} s - The signature `s` value as a big number.
     * @returns {BN} The low-S normalized value.
     * @static
     */
    function toLowS(s: BN): BN;
    /**
     * Signs a message hash using ECDSA with the given private key.
     * @param {Buffer} hashbuf - The hash of the message to sign
     * @param {PrivateKey} privkey - The private key to sign with
     * @param {string} [endian] - Endianness of the input/output (optional)
     * @returns {Signature} The ECDSA signature
     */
    function sign(hashbuf: Buffer, privkey: PrivateKey, endian?: string): Signature;
    /**
     * Signs a hash buffer with a private key and calculates the 'i' value.
     * @param {Buffer} hashbuf - The hash buffer to sign.
     * @param {Buffer} privkey - The private key used for signing.
     * @param {string} [endian] - The endianness of the input data (optional).
     * @returns {Buffer} The resulting signature.
     * @static
     */
    function signWithCalcI(hashbuf: Buffer, privkey: Buffer, endian?: string): Buffer;
    /**
     * Signs a message hash using ECDSA with a randomly generated K value.
     * @param {Buffer} hashbuf - The message hash to sign.
     * @param {Buffer} privkey - The private key used for signing.
     * @param {string} [endian] - The endianness of the input/output (default: 'big').
     * @returns {Buffer} The generated ECDSA signature.
     * @static
     */
    function signRandomK(hashbuf: Buffer, privkey: Buffer, endian?: string): Buffer;
    /**
     * Verifies an ECDSA signature against a hash and public key.
     * @param {Buffer} hashbuf - The hash buffer to verify against.
     * @param {Signature} sig - The signature to verify.
     * @param {PublicKey} pubkey - The public key to verify with.
     * @param {string} [endian] - The endianness of the input data (optional).
     * @returns {boolean} True if the signature is valid, false otherwise.
     * @static
     */
    function verify(hashbuf: Buffer, sig: Signature, pubkey: PublicKey, endian?: string): boolean;
}
import PublicKey = require("../publickey.cjs");
import Signature = require("./signature.cjs");
import BN = require("../bn.cjs");
