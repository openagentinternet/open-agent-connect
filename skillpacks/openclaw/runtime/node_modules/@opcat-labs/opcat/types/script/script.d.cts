export = Script;
/**
 * A bitcoin transaction script. Each transaction's inputs and outputs
 * has a script that is evaluated to validate it's spending.
 *
 * See https://en.bitcoin.it/wiki/Script
 *
 * @constructor
 * @param {Object|string|Buffer} [from] optional data to populate script
 */
declare function Script(from?: any | string | Buffer): Script;
declare class Script {
    /**
     * A bitcoin transaction script. Each transaction's inputs and outputs
     * has a script that is evaluated to validate it's spending.
     *
     * See https://en.bitcoin.it/wiki/Script
     *
     * @constructor
     * @param {Object|string|Buffer} [from] optional data to populate script
     */
    constructor(from?: any | string | Buffer);
    buffer: Buffer;
    /**
     * Sets the script content from an object.
     * @param {Object} obj - The source object containing either chunks array or buffer.
     * @param {Array} [obj.chunks] - Optional array of chunks to create script from.
     * @param {Buffer} [obj.buffer] - Optional buffer containing script data.
     * @returns {Script} Returns the script instance for chaining.
     * @throws Will throw if argument is invalid (not object or missing required buffer).
     */
    set(obj: {
        chunks?: any[];
        buffer?: Buffer;
    }): Script;
    /**
     * Returns the underlying buffer of the script.
     * @returns {Buffer} The script's buffer data.
     */
    toBuffer(): Buffer;
    /**
     * Gets a portion of the script's buffer as a new buffer.
     * @param {number} [start] - The beginning index of the specified portion of the buffer.
     * @param {number} [end] - The end index of the specified portion of the buffer.
     * @returns {Buffer} A new Buffer that contains the specified portion of the original buffer.
     */
    slice(start?: number, end?: number): Buffer;
    get chunks(): any;
    get length(): number;
    private _chunkToString;
    /**
     * Converts the script chunks to ASM (Assembly) format string representation.
     * Iterates through each chunk and appends its ASM string representation.
     * @returns {string} The ASM formatted string (excluding the first character).
     */
    toASM(): string;
    /**
     * Converts the script's chunks to a string representation.
     * Iterates through each chunk and appends its string representation,
     * then removes the leading character from the result.
     * @returns {string} The concatenated string of all chunks.
     */
    toString(): string;
    /**
     * Converts the script's buffer to a hexadecimal string.
     * @returns {string} Hex-encoded representation of the script buffer.
     */
    toHex(): string;
    /**
     * Custom inspect method for Script instances.
     * @returns {string} String representation of the Script object in format '<Script: [content]>'.
     */
    inspect(): string;
    /**
     * Checks if the script is a standard public key hash output script (P2PKH).
     * @returns {boolean} True if the script matches the P2PKH pattern:
     * - OP_DUP
     * - OP_HASH160
     * - 20-byte hash
     * - OP_EQUALVERIFY
     * - OP_CHECKSIG
     */
    isPublicKeyHashOut(): boolean;
    /**
     * Checks if the script contains a valid public key hash.
     * @returns {boolean} True if the script has exactly 2 chunks (signature and public key),
     *                   the signature starts with 0x30, and the public key has a valid version
     *                   and length (65 bytes for versions 0x04/0x06/0x07, 33 bytes for 0x02/0x03).
     */
    isPublicKeyHashIn(): boolean;
    /**
     * Gets the public key from a script output.
     * @returns {Buffer} The public key buffer.
     * @throws {Error} If the script is not a public key output.
     */
    getPublicKey(): Buffer;
    /**
     * Retrieves the PublicKeyHash from a script output.
     * @returns {Buffer} The PublicKeyHash buffer.
     * @throws {Error} If the script output is not a PublicKeyHash output.
     */
    getPublicKeyHash(): Buffer;
    /**
     * Checks if the script is a standard public key output script.
     * @returns {boolean} True if the script matches the standard public key output format:
     *                    - Contains exactly 2 chunks
     *                    - First chunk is a valid public key buffer (65 bytes for uncompressed, 33 bytes for compressed)
     *                    - Second chunk is OP_CHECKSIG opcode
     */
    isPublicKeyOut(): boolean;
    /**
     * Checks if the script contains a valid public key signature.
     * @returns {boolean} True if the script has exactly one chunk that starts with 0x30 (DER signature marker), false otherwise.
     */
    isPublicKeyIn(): boolean;
    /**
     * Checks if the script is a multisig output script.
     * @returns {boolean} True if the script matches the multisig output pattern:
     * - Has more than 3 chunks
     * - First chunk is a small integer opcode
     * - Middle chunks are all buffers
     * - Second-to-last chunk is a small integer opcode
     * - Last chunk is OP_CHECKMULTISIG
     */
    isMultisigOut(): boolean;
    /**
     * Decodes a multisig output script into its components.
     * @returns {Object} An object containing:
     *   - m {number} The required number of signatures (m-of-n)
     *   - n {number} The total number of public keys
     *   - pubkeys {Buffer[]} Array of public keys involved in the multisig
     */
    decodeMultisigOut(): any;
    /**
     * Checks if the script is a multisig input script.
     * @returns {boolean} True if the script is a valid multisig input (starts with OP_0 and has valid DER signatures).
     */
    isMultisigIn(): boolean;
    /**
     * Checks if the script is a data-only output script (OP_RETURN followed by push-only data).
     * @returns {boolean} True if the script is a valid data-only output, false otherwise.
     */
    isDataOut(): boolean;
    /**
     * Checks if the script is a safe data output script.
     * A safe data output script must start with OP_FALSE followed by a valid data output script.
     * @returns {boolean} True if the script is a safe data output, false otherwise.
     */
    isSafeDataOut(): boolean;
    /**
     * Retrieve the associated data for this script.
     * In the case of a pay to public key hash, return the hash.
     * In the case of safe OP_RETURN data, return an array of buffers
     * In the case of a standard deprecated OP_RETURN, return the data
     * @returns {Buffer}
     */
    getData(): Buffer;
    /**
     * Checks if the script consists only of push operations (OP_0 to OP_16) or data push operations (OP_PUSHDATA1/2/4).
     * @returns {boolean} True if all chunks are push operations, false otherwise.
     */
    isPushOnly(): boolean;
    /**
     * @returns {object} The Script type if it is a known form,
     * or Script.UNKNOWN if it isn't
     */
    classify(): object;
    /**
     * @returns {object} The Script type if it is a known form,
     * or Script.UNKNOWN if it isn't
     */
    classifyOutput(): object;
    /**
     * @returns {object} The Script type if it is a known form,
     * or Script.UNKNOWN if it isn't
     */
    classifyInput(): object;
    /**
     * @returns {boolean} if script is one of the known types
     */
    isStandard(): boolean;
    /**
     * Adds a script element at the start of the script.
     * @param {*} obj a string, number, Opcode, Buffer, or object to add
     * @returns {Script} this script instance
     */
    prepend(obj: any): Script;
    /**
     * Compares this script with another script for equality.
     * @param {Script} script - The script to compare with.
     * @returns {boolean} True if the scripts have identical buffer contents, false otherwise.
     * @throws {Error} If the provided argument is not a Script instance.
     */
    equals(script: Script): boolean;
    /**
     * Adds a script element to the end of the script.
     * @param {Object} obj - The object to add.
     * @returns {Script} Returns the script instance for chaining.
     */
    add(obj: any): Script;
    private _addByType;
    private _insertAtPosition;
    /**
     * Adds an opcode to the script.
     * @param {number|Opcode|string} opcode - The opcode to add (can be a number, Opcode instance, or string).
     * @param {boolean} [prepend=false] - Whether to prepend the opcode (true) or append it (false).
     * @returns {Script} Returns the script instance for chaining.
     * @throws {errors.Script.InvalidOpcode} Throws if the opcode value exceeds 255.
     */
    _addOpcode(opcode: number | Opcode | string, prepend?: boolean): Script;
    /**
     * Adds a buffer to the script with appropriate opcode based on buffer length.
     * Handles different buffer sizes by using corresponding pushdata opcodes.
     * @param {Buffer} buf - The buffer to add to the script
     * @param {boolean} [prepend] - Whether to prepend the buffer (default: append)
     * @returns {Script} Returns the script instance for chaining
     * @throws {Error} If buffer length exceeds maximum allowed size (2^32)
     */
    _addBuffer(buf: Buffer, prepend?: boolean): Script;
    /**
     * Creates a shallow copy of the Script instance.
     * @returns {Script} A new Script instance with the same buffer content.
     */
    clone(): Script;
    /**
     * Removes all OP_CODESEPARATOR opcodes from the script chunks.
     * Updates the script buffer with the filtered chunks and clears the cache.
     * @returns {Script} The modified script instance for chaining.
     */
    removeCodeseparators(): Script;
    /**
     * If the script does not contain any OP_CODESEPARATOR, Return all scripts
     * If the script contains any OP_CODESEPARATOR, the scriptCode is the script but removing everything up to and including the last executed OP_CODESEPARATOR before the signature checking opcode being executed
     * @param {n} The {n}th codeseparator in the script
     *
     * @returns {Script} Subset of script starting at the {n}th codeseparator
     */
    subScript(n: any): Script;
    /**
     * Gets address information for the script.
     * For input scripts, returns input address info.
     * For output scripts, returns output address info.
     * For general scripts, tries output address info first, falls back to input if not available.
     * @returns {Object} Address information object
     */
    getAddressInfo(): any;
    /**
     * Gets the output address information from the script.
     * @returns {Object|boolean} An object containing the hash buffer and address type if the script is a public key hash output, otherwise false.
     * @property {Buffer} info.hashBuffer - The hash buffer of the address.
     * @property {number} info.type - The type of the address (Address.PayToPublicKeyHash).
     */
    _getOutputAddressInfo(): any | boolean;
    private _getInputAddressInfo;
    /**
     * Converts the script to an Address object for the specified network.
     * @param {string|Network} [network] - optianal, the network name or identifier.
     * @returns {Address} The derived Address object.
     * @throws {errors.Script.CantDeriveAddress} If address information cannot be derived from the script.
     */
    toAddress(network?: string | Network): Address;
    /**
     * Finds and deletes a matching script chunk from the current script.
     * Analogous to bitcoind's FindAndDelete. Find and delete equivalent chunks,
     * typically used with push data chunks.  Note that this will find and delete
     * not just the same data, but the same data with the same push data op as
     * produced by default. i.e., if a pushdata in a tx does not use the minimal
     * pushdata op, then when you try to remove the data it is pushing, it will not
     * be removed, because they do not use the same pushdata op.
     * @param {Script} script - The script chunk to find and delete.
     * @returns {Script} The modified script instance after deletion.
     */
    findAndDelete(script: Script): Script;
    /**
     * Checks if a script chunk uses the minimal push operation possible.
     *
     * @param {number} i - Index of the chunk to check
     * @returns {boolean} True if the chunk uses minimal push operation, false otherwise
     *
     * The function verifies if the chunk could have been represented with:
     * - OP_0 for empty buffer
     * - OP_1 to OP_16 for single-byte values 1-16
     * - OP_1NEGATE for 0x81
     * - Direct push for buffers ≤75 bytes
     * - OP_PUSHDATA1 for buffers ≤255 bytes
     * - OP_PUSHDATA2 for buffers ≤65535 bytes
     */
    checkMinimalPush(i: number): boolean;
    private _decodeOP_N;
    /**
     * Counts the number of signature operations in the script.
     * @param {boolean} [accurate=true] - Whether to count accurately for OP_CHECKMULTISIG(VERIFY).
     * @returns {number} The total count of signature operations.
     */
    getSignatureOperationsCount(accurate?: boolean): number;
}
declare namespace Script {
    /**
     * Creates a Script instance from a Buffer.
     * @param {Buffer} buffer - The buffer containing the script data.
     * @returns {Script} A new Script instance with the provided buffer.
     * @throws {Error} Throws if the input is not a Buffer.
     */
    function fromBuffer(buffer: Buffer): Script;
    /**
     * Creates a Script instance from an array of opcode chunks.
     * Handles different pushdata opcodes (OP_PUSHDATA1, OP_PUSHDATA2, OP_PUSHDATA4)
     * by writing appropriate length prefixes before the buffer data.
     * @param {Array} chunks - Array of opcode chunks containing opcodenum and optional buf/len
     * @returns {Script} A new Script instance with compiled buffer
     */
    function fromChunks(chunks: any[]): Script;
    /**
     * Creates a Script instance from ASM (Assembly) formatted string.
     * @param {string} str - ASM formatted string to decode
     * @returns {Script} Script instance created from decoded ASM
     */
    function fromASM(str: string): Script;
    /**
     * Creates a Script instance from a hex string.
     * @param {string} str - Hex string to convert to Script.
     * @returns {Script} New Script instance created from the hex string.
     */
    function fromHex(str: string): Script;
    /**
     * Converts a string representation of a script into a Script object.
     * Handles hex strings, empty strings, and space-separated opcode tokens.
     * For pushdata operations (OP_PUSHDATA1/2/4), validates format and length.
     * Throws errors for invalid script formats or data lengths.
     * @param {string} str - The script string to parse (hex or opcode tokens)
     * @returns {Script} The constructed Script object
     * @throws {Error} When script format is invalid or data lengths don't match
     */
    function fromString(str: string): Script;
    namespace types {
        let UNKNOWN: string;
        let PUBKEY_OUT: string;
        let PUBKEY_IN: string;
        let PUBKEYHASH_OUT: string;
        let PUBKEYHASH_IN: string;
        let SCRIPTHASH_OUT: string;
        let SCRIPTHASH_IN: string;
        let MULTISIG_OUT: string;
        let MULTISIG_IN: string;
        let DATA_OUT: string;
        let SAFE_DATA_OUT: string;
    }
    namespace outputIdentifiers {
        let PUBKEY_OUT_1: any;
        export { PUBKEY_OUT_1 as PUBKEY_OUT };
        let PUBKEYHASH_OUT_1: any;
        export { PUBKEYHASH_OUT_1 as PUBKEYHASH_OUT };
        let MULTISIG_OUT_1: any;
        export { MULTISIG_OUT_1 as MULTISIG_OUT };
        let DATA_OUT_1: any;
        export { DATA_OUT_1 as DATA_OUT };
        let SAFE_DATA_OUT_1: any;
        export { SAFE_DATA_OUT_1 as SAFE_DATA_OUT };
    }
    namespace inputIdentifiers {
        let PUBKEY_IN_1: any;
        export { PUBKEY_IN_1 as PUBKEY_IN };
        let PUBKEYHASH_IN_1: any;
        export { PUBKEYHASH_IN_1 as PUBKEYHASH_IN };
        let MULTISIG_IN_1: any;
        export { MULTISIG_IN_1 as MULTISIG_IN };
    }
    /**
     * Builds a multisig output script from given public keys and threshold.
     * @param {Array} publicKeys - Array of public keys to include in the multisig
     * @param {number} threshold - Minimum number of signatures required
     * @param {Object} [opts] - Optional parameters
     * @param {boolean} [opts.noSorting] - If true, skips sorting of public keys
     * @returns {Script} The constructed multisig script
     */
    function buildMultisigOut(publicKeys: any[], threshold: number, opts?: {
        noSorting?: boolean;
    }): Script;
    /**
     * A new Multisig input script for the given public keys, requiring m of those public keys to spend
     *
     * @param {PublicKey[]} pubkeys list of all public keys controlling the output
     * @param {number} threshold amount of required signatures to spend the output
     * @param {Array} signatures and array of signature buffers to append to the script
     * @param {Object=} opts
     * @param {boolean=} opts.noSorting don't sort the given public keys before creating the script (false by default)
     * @param {Script=} opts.cachedMultisig don't recalculate the redeemScript
     *
     * @returns {Script}
     */
    function buildMultisigIn(pubkeys: PublicKey[], threshold: number, signatures: any[], opts?: any): Script;
    /**
     * Builds a standard P2PKH (Pay-to-Public-Key-Hash) script for a given recipient.
     * @param {PublicKey|Address|string} to - Recipient's public key, address, or address string
     * @returns {Script} A P2PKH script with the format: OP_DUP OP_HASH160 \<pubKeyHash\> OP_EQUALVERIFY OP_CHECKSIG
     * @throws {Error} If 'to' argument is undefined or invalid type
     */
    function buildPublicKeyHashOut(to: string | Address | PublicKey): Script;
    /**
     * Builds a standard P2PK (Pay-to-Public-Key) script output.
     * @param {PublicKey} pubkey - The public key to create the script for
     * @returns {Script} A new script containing the public key and OP_CHECKSIG opcode
     */
    function buildPublicKeyOut(pubkey: PublicKey): Script;
    /**
     * @returns {Script} a new OP_RETURN script with data
     * @param {string|Buffer|Array} data - the data to embed in the output - it is a string, buffer, or array of strings or buffers
     * @param {string} encoding - the type of encoding of the string(s)
     */
    function buildDataOut(data: string | any[] | Buffer, encoding: string): Script;
    /**
     * @returns {Script} a new OP_RETURN script with data
     * @param {string|Buffer|Array} data - the data to embed in the output - it is a string, buffer, or array of strings or buffers
     * @param {string} encoding - the type of encoding of the string(s)
     */
    function buildSafeDataOut(data: string | any[] | Buffer, encoding: string): Script;
    /**
     * Builds a scriptSig (a script for an input) that signs a public key output script.
     *
     * @param {Signature|Buffer} signature - a Signature object, or the signature in DER canonical encoding
     * @param {number} [sigtype] - the type of the signature (defaults to SIGHASH_ALL)
     */
    function buildPublicKeyIn(signature: Buffer | Signature, sigtype?: number): Script;
    /**
     * Builds a scriptSig (a script for an input) that signs a public key hash
     * output script.
     *
     * @param {Buffer|string|PublicKey} publicKey
     * @param {Signature|Buffer} signature - a Signature object, or the signature in DER canonical encoding
     * @param {number} [sigtype] - the type of the signature (defaults to SIGHASH_ALL)
     */
    function buildPublicKeyHashIn(publicKey: string | Buffer | PublicKey, signature: Buffer | Signature, sigtype?: number): Script;
    /**
     * Creates and returns an empty Script instance.
     * @returns {Script} A new empty Script object.
     */
    function empty(): Script;
    /**
     * Creates a Script from an address.
     * @param {Address|string} address - The address to convert to a script.
     * @returns {Script} A Pay-to-PublicKeyHash (P2PKH) script for the given address.
     * @throws {errors.Script.UnrecognizedAddress} If the address type is not supported.
     */
    function fromAddress(address: string | Address): Script;
}
import Opcode = require("../opcode.cjs");
import Address = require("../address.cjs");
import PublicKey = require("../publickey.cjs");
import Signature = require("../crypto/signature.cjs");
