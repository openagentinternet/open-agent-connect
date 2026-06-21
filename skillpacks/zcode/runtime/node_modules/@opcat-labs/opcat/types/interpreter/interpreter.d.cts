export = Interpreter;
/**
 * Bitcoin transactions contain scripts. Each input has a script called the
 * scriptSig, and each output has a script called the scriptPubkey. To validate
 * an input, the input's script is concatenated with the referenced output script,
 * and the result is executed. If at the end of execution the stack contains a
 * "true" value, then the transaction is valid.
 *
 * The primary way to use this class is via the verify function.
 * e.g., Interpreter().verify( ... );
 * @constructor
 * @param {Object} [obj] - Optional object to initialize the interpreter with.
 * @returns {Interpreter} A new Interpreter instance.
 */
declare function Interpreter(obj?: any): Interpreter;
declare class Interpreter {
    /**
     * Bitcoin transactions contain scripts. Each input has a script called the
     * scriptSig, and each output has a script called the scriptPubkey. To validate
     * an input, the input's script is concatenated with the referenced output script,
     * and the result is executed. If at the end of execution the stack contains a
     * "true" value, then the transaction is valid.
     *
     * The primary way to use this class is via the verify function.
     * e.g., Interpreter().verify( ... );
     * @constructor
     * @param {Object} [obj] - Optional object to initialize the interpreter with.
     * @returns {Interpreter} A new Interpreter instance.
     */
    constructor(obj?: any);
    /**
     * Verifies a Script by executing it and returns true if it is valid.
     * This function needs to be provided with the scriptSig and the scriptPubkey
     * separately.
     * @param {Script} scriptSig - the script's first part (corresponding to the tx input)
     * @param {Script} scriptPubkey - the script's last part (corresponding to the tx output)
     * @param {Transaction=} tx - the Transaction containing the scriptSig in one input (used
     *    to check signature validity for some opcodes like OP_CHECKSIG)
     * @param {number} nin - index of the transaction input containing the scriptSig verified.
     * @param {number} flags - evaluation flags. See Interpreter.SCRIPT_* constants
     * @param {number} satoshisBN - amount in satoshis of the input to be verified (when FORKID signhash is used)
     *
     * Translated from bitcoind's VerifyScript
     */
    verify(scriptSig: Script, scriptPubkey: Script, tx?: Transaction | undefined, nin: number, flags: number, satoshisBN: number): boolean;
    errstr: any;
    /**
     * Initializes the interpreter instance with default values.
     * Sets up empty stacks, resets program counter and execution flags,
     * and initializes state tracking variables for script execution.
     */
    initialize(): void;
    stack: any;
    altstack: any;
    pc: any;
    pbegincodehash: any;
    nOpCount: any;
    vfExec: any;
    vfElse: any;
    flags: any;
    nonTopLevelReturnAfterGenesis: boolean;
    returned: boolean;
    /**
     * Updates the interpreter's state with provided values.
     * @param {Object} obj - Object containing properties to update
     * @param {Buffer} [obj.script] - Script buffer
     * @param {Object} [obj.tx] - Transaction object
     * @param {boolean} [obj.nin] - Non-input flag
     * @param {BN} [obj.satoshisBN] - Satoshis as BN.js instance
     * @param {Array} [obj.stack] - Main stack
     * @param {Array} [obj.altstack] - Alternate stack
     * @param {number} [obj.pc] - Program counter
     * @param {number} [obj.pbegincodehash] - Begin code hash position
     * @param {number} [obj.nOpCount] - Operation count
     * @param {Array} [obj.vfExec] - Execution flags
     * @param {Array} [obj.vfElse] - Else flags
     * @param {string} [obj.errstr] - Error string
     * @param {number} [obj.flags] - Interpreter flags
     */
    set(obj: {
        script?: Buffer;
        tx?: any;
        nin?: boolean;
        satoshisBN?: BN;
        stack?: any[];
        altstack?: any[];
        pc?: number;
        pbegincodehash?: number;
        nOpCount?: number;
        vfExec?: any[];
        vfElse?: any[];
        errstr?: string;
        flags?: number;
    }): void;
    script: any;
    tx: any;
    nin: any;
    satoshisBN: any;
    /**
     * Returns a subset of the script starting from the most recent OP_CODESEPARATOR.
     * @returns {Script} A new Script instance containing the sliced chunks.
     */
    subscript(): Script;
    /**
     * Checks if a signature encoding is valid according to the interpreter's flags.
     * - For empty signatures: always valid (used for compact invalid signatures in CHECK(MULTI)SIG)
     * - With DERSIG/STRICTENC flags: validates DER encoding and strict encoding rules
     * - With LOW_S flag: ensures signature uses low S value
     * - With STRICTENC flag: validates defined hash type
     * @param {Buffer} buf - The signature buffer to validate
     * @returns {boolean} True if valid, false otherwise (sets errstr on failure)
     */
    checkSignatureEncoding(buf: Buffer): boolean;
    /**
     * Checks if the provided public key buffer is valid according to strict encoding rules.
     * Sets an error message if validation fails under SCRIPT_VERIFY_STRICTENC flag.
     * @param {Buffer} buf - The public key buffer to validate.
     * @returns {boolean} True if valid, false otherwise (with error string set).
     */
    checkPubkeyEncoding(buf: Buffer): boolean;
    /**
     * Checks if a signature encoding is valid for OP_CHECKSIGFROMSTACK.
     * Unlike checkSignatureEncoding, this expects pure DER signatures without sighash type.
     * @param {Buffer} buf - The signature buffer to validate
     * @returns {boolean} True if valid, false otherwise (sets errstr on failure)
     */
    checkDataSigSignatureEncoding(buf: Buffer): boolean;
    /**
     * Evaluates a script by executing each opcode step-by-step.
     * Performs size checks on the script and stacks before execution.
     *
     * Based on bitcoind's EvalScript function, with the inner loop moved to `Interpreter.prototype.step()`
     * bitcoind commit: b5d1b1092998bc95313856d535c632ea5a8f9104
     * @param {string} scriptType - The type of script being evaluated
     * @returns {boolean} True if evaluation succeeds, false if any error occurs
     * @throws {Error} If an unknown error occurs during evaluation
     */
    evaluate(scriptType: string): boolean;
    private _callbackStep;
    private _callbackStack;
    /**
     * Checks a locktime parameter with the transaction's locktime.
     * There are two times of nLockTime: lock-by-blockheight and lock-by-blocktime,
     * distinguished by whether nLockTime < LOCKTIME_THRESHOLD = 500000000
     *
     * See the corresponding code on bitcoin core:
     * https://github.com/bitcoin/bitcoin/blob/ffd75adce01a78b3461b3ff05bcc2b530a9ce994/src/script/interpreter.cpp#L1129
     *
     * @param {BN} nLockTime the locktime read from the script
     * @return {boolean} true if the transaction's locktime is less than or equal to
     *                   the transaction's locktime
     */
    checkLockTime(nLockTime: BN): boolean;
    /**
     * Checks a sequence parameter with the transaction's sequence.
     * @param {BN} nSequence the sequence read from the script
     * @return {boolean} true if the transaction's sequence is less than or equal to
     *                   the transaction's sequence
     */
    checkSequence(nSequence: BN): boolean;
    /**
     * Executes a single step in the script interpreter.
     *
     * This method processes the current opcode in the script, performs the corresponding operation,
     * and updates the stack or interpreter state accordingly. It handles various opcode types including
     * stack operations, arithmetic, bitwise logic, cryptographic operations, and control flow.
     *
     * Based on the inner loop of bitcoind's EvalScript function
     * bitcoind commit: b5d1b1092998bc95313856d535c632ea5a8f9104
     * @param {string} scriptType - The type of script being executed (e.g., scriptPubkey, scriptSig).
     * @returns {boolean} Returns `true` if the step executed successfully, or `false` if an error occurred.
     *                   Errors are stored in `this.errstr`.
     */
    step(scriptType: string): boolean;
}
declare namespace Interpreter {
    function getTrue(): Buffer;
    function getFalse(): Buffer;
    /**
     * Validates pure DER signature encoding (without sighash type).
     * Used for OP_CHECKSIGFROMSTACK which expects signatures without trailing sighash byte.
     * @param {Buffer} buf - The buffer containing the signature to verify
     * @returns {boolean} True if the signature is valid DER-encoded, false otherwise
     */
    function isDER(buf: Buffer): boolean;
    let MAX_SCRIPT_ELEMENT_SIZE: number;
    let MAXIMUM_ELEMENT_SIZE: number;
    let LOCKTIME_THRESHOLD: number;
    let LOCKTIME_THRESHOLD_BN: BN;
    let SCRIPT_VERIFY_NONE: number;
    let SCRIPT_VERIFY_STRICTENC: number;
    let SCRIPT_VERIFY_DERSIG: number;
    let SCRIPT_VERIFY_LOW_S: number;
    let SCRIPT_VERIFY_NULLDUMMY: number;
    let SCRIPT_VERIFY_SIGPUSHONLY: number;
    let SCRIPT_VERIFY_MINIMALDATA: number;
    let SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_NOPS: number;
    let SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY: number;
    let SCRIPT_VERIFY_CHECKSEQUENCEVERIFY: number;
    let SCRIPT_VERIFY_NULLFAIL: number;
    let SCRIPT_VERIFY_COMPRESSED_PUBKEYTYPE: number;
    let SCRIPT_ENABLE_MONOLITH_OPCODES: number;
    let SCRIPT_ENABLE_MAGNETIC_OPCODES: number;
    let SEQUENCE_LOCKTIME_DISABLE_FLAG: number;
    let SEQUENCE_LOCKTIME_TYPE_FLAG: number;
    let SEQUENCE_LOCKTIME_MASK: number;
    let MAX_SCRIPT_SIZE: number;
    let MAX_OPCODE_COUNT: number;
    let DEFAULT_FLAGS: number;
    /**
     * Casts a buffer to a boolean value.
     * Returns true if any byte in the buffer is non-zero (except for the special case of negative zero).
     * Returns false if all bytes are zero or if the last byte is 0x80 (negative zero case).
     * @param {Buffer} buf - The input buffer to check
     * @returns {boolean} The boolean representation of the buffer
     */
    function castToBool(buf: Buffer): boolean;
    /**
     * Checks if a buffer is minimally encoded (see https://github.com/bitcoincashorg/spec/blob/master/may-2018-reenabled-opcodes.md#op_bin2num) as a number.
     * @param {Buffer} buf - The buffer to check.
     * @param {number} [nMaxNumSize=Interpreter.MAXIMUM_ELEMENT_SIZE] - Maximum allowed size for the buffer.
     * @returns {boolean} True if the buffer is minimally encoded, false otherwise.
     * @private
     */
    function _isMinimallyEncoded(buf: Buffer, nMaxNumSize?: number): boolean;
    /**
     * Minimally encodes a buffer by removing unnecessary trailing zeros.
     *
     * This function implements minimal encoding rules for script numbers:
     * - Empty buffer remains empty
     * - Last byte must not be 0x00 or 0x80 unless necessary
     * - Single zero byte encodes as empty buffer
     * - Preserves sign bit when trimming
     *
     * @param {Buffer} buf - The input buffer to encode
     * @returns {Buffer} Minimally encoded buffer (may be empty)
     */
    function _minimallyEncode(buf: Buffer): Buffer;
}
import Script = require("../script/script.cjs");
import Transaction = require("../transaction/transaction.cjs");
import BN = require("../bn.cjs");
