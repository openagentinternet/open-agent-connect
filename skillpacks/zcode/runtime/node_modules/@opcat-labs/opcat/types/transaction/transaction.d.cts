export = Transaction;
/**
 * Represents a transaction, a set of inputs and outputs to change ownership of tokens
 * @constructor
 * @param {string|Buffer|Object|Transaction} [serialized] - Optional serialized data to initialize the transaction.
 * Can be a hex string, Buffer, plain object, or another Transaction instance.
 * @throws {errors.InvalidArgument} If invalid serialization format is provided.
 * @property {Array} inputs - Transaction input objects.
 * @property {Array} outputs - Transaction output objects.
 * @property {boolean} sealed - Indicates if transaction is finalized.
 */
declare function Transaction(serialized?: string | Buffer | any | Transaction): import("./transaction.cjs");
declare class Transaction {
    /**
     * Represents a transaction, a set of inputs and outputs to change ownership of tokens
     * @constructor
     * @param {string|Buffer|Object|Transaction} [serialized] - Optional serialized data to initialize the transaction.
     * Can be a hex string, Buffer, plain object, or another Transaction instance.
     * @throws {errors.InvalidArgument} If invalid serialization format is provided.
     * @property {Array} inputs - Transaction input objects.
     * @property {Array} outputs - Transaction output objects.
     * @property {boolean} sealed - Indicates if transaction is finalized.
     */
    constructor(serialized?: string | Buffer | any | Transaction);
    inputs: any[];
    outputs: any[];
    _inputAmount: number;
    _outputAmount: number;
    _inputsMap: Map<any, any>;
    _outputsMap: Map<any, any>;
    _privateKey: Buffer | Buffer[];
    _sigType: number;
    sealed: boolean;
    readonly hash: any;
    readonly id: any;
    get inputAmount(): number;
    get outputAmount(): number;
    private _getHash;
    /**
     * Retrieve a hexa string that can be used with bitcoind's CLI interface
     * (decoderawtransaction, sendrawtransaction)
     *
     * @param {Object|boolean=} unsafe if true, skip all tests. if it's an object,
     *   it's expected to contain a set of flags to skip certain tests:
     * * `disableAll`: disable all checks
     * * `disableLargeFees`: disable checking for fees that are too large
     * * `disableIsFullySigned`: disable checking if all inputs are fully signed
     * * `disableDustOutputs`: disable checking if there are no outputs that are dust amounts
     * * `disableMoreOutputThanInput`: disable checking if the transaction spends more bitcoins than the sum of the input amounts
     * @return {string}
     */
    serialize(unsafe?: (any | boolean) | undefined): string;
    /**
     * Creates a deep clone of the Transaction instance.
     * @returns {Transaction} A new Transaction instance with cloned inputs.
     */
    clone(): Transaction;
    /**
     * Serializes the transaction to a hexadecimal string.
     * This method is aliased as `toString()` and `toHex()` for convenience.
     * @returns {string} Hexadecimal representation of the transaction.
     */
    uncheckedSerialize: () => string;
    toString: () => string;
    toHex(): string;
    /**
     * Retrieve a hexa string that can be used with bitcoind's CLI interface
     * (decoderawtransaction, sendrawtransaction)
     *
     * @param {Object} opts allows to skip certain tests. {@see Transaction#serialize}
     * @return {string}
     */
    checkedSerialize(opts: any): string;
    /**
     * Checks if any output in the transaction has invalid satoshis.
     * @returns {boolean} True if at least one output has invalid satoshis, false otherwise.
     */
    invalidSatoshis(): boolean;
    /**
     * Retrieve a possible error that could appear when trying to serialize and
     * broadcast this transaction.
     *
     * @param {Object} opts allows to skip certain tests. {@see Transaction#serialize}
     * @return {opcat.Error}
     */
    getSerializationError(opts: any): opcat.Error;
    private _hasFeeError;
    private _missingChange;
    private _hasDustOutputs;
    /**
     * Checks if the transaction is missing signatures.
     * @param {Object} opts - Options object.
     * @param {boolean} [opts.disableIsFullySigned] - If true, skips the check.
     * @returns {errors.Transaction.MissingSignatures|undefined} Returns MissingSignatures error if not fully signed, otherwise undefined.
     */
    _isMissingSignatures(opts: {
        disableIsFullySigned?: boolean;
    }): errors.Transaction.MissingSignatures | undefined;
    /**
     * Returns a string representation of the Transaction object for debugging/inspection.
     * The format is: '<Transaction: [serializedData]>' where serializedData comes from uncheckedSerialize().
     * @returns {string} Formatted transaction inspection string.
     */
    inspect(): string;
    /**
     * Converts the transaction to a Buffer.
     * @returns {Buffer} The serialized transaction as a Buffer.
     */
    toBuffer(): Buffer;
    /**
     * Calculates the double SHA-256 hash of the transaction preimage for signature verification.
     * The resulting hash is returned in reverse byte order (little-endian).
     *
     * @param {number} inputIndex - Index of the input being signed
     * @param {number} hashType - SIGHASH type flag
     * @returns {Buffer} The hash result in little-endian format
     */
    hashForSignature(inputIndex: number, hashType: number): Buffer;
    /**
     * Converts the transaction to a hash preimage by serializing it into a buffer.
     * @returns {Buffer} The serialized transaction data as a buffer.
     */
    toTxHashPreimage(): Buffer;
    /**
     * Serializes the transaction to a BufferWriter.
     * @param {boolean} forTxHash - Whether to serialize for transaction hash calculation (excludes some fields)
     * @param {BufferWriter} [writer] - Optional BufferWriter instance to write to
     * @returns {BufferWriter} The BufferWriter containing serialized transaction data
     */
    toBufferWriter(forTxHash: boolean, writer?: BufferWriter): BufferWriter;
    /**
     * Initializes the transaction from a buffer.
     * @param {Buffer} buffer - The buffer containing transaction data.
     * @returns {Transaction} The transaction instance.
     */
    fromBuffer(buffer: Buffer): Transaction;
    /**
     * Reads transaction data from a buffer reader and populates the transaction instance.
     * @param {BufferReader} reader - The buffer reader containing transaction data.
     * @returns {Transaction} The transaction instance with populated data.
     * @throws {Error} If no transaction data is received (reader is finished).
     */
    fromBufferReader(reader: BufferReader): Transaction;
    version: any;
    nLockTime: any;
    /**
     * Converts the Transaction object to a plain JavaScript object (POJO) for serialization.
     * Includes transaction details like hash, version, inputs, outputs, and lock time.
     * Optionally includes change script, change address, change index, and fee if they are defined.
     * @returns {Object} A plain object representation of the transaction.
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Creates a Transaction instance from a plain object or another Transaction.
     * Handles conversion of inputs/outputs and other transaction properties.
     *
     * @param {Object|Transaction} arg - Either a transaction object or Transaction instance
     * @returns {Transaction} The populated Transaction instance
     * @throws {Error} If argument is not an object or Transaction instance
     */
    fromObject(arg: any | Transaction): Transaction;
    _changeIndex: any;
    _changeScript: Script;
    _changeAddress: any;
    _changeData: any;
    _fee: any;
    private _checkConsistency;
    /**
     * Sets nLockTime so that transaction is not valid until the desired date(a
     * timestamp in seconds since UNIX epoch is also accepted)
     * @param {number|Date} time - The lock time as a timestamp (number) or Date object.
     * @throws {Transaction.LockTimeTooEarly} If the time is a number below NLOCKTIME_BLOCKHEIGHT_LIMIT.
     * @returns {Transaction} The transaction instance for chaining.
     */
    lockUntilDate(time: number | Date): Transaction;
    /**
     * Sets the transaction's lock time to a specific block height.
     * Validates the height is within allowed bounds (0 <= height < NLOCKTIME_BLOCKHEIGHT_LIMIT).
     * Updates sequence numbers of inputs to enable lock time if using default sequence.
     * @param {number} height - The block height to lock until (must be non-negative and below limit)
     * @returns {Transaction} Returns the transaction instance for chaining
     * @throws {Transaction.BlockHeightTooHigh} If height exceeds block height limit
     * @throws {Transaction.NLockTimeOutOfRange} If height is negative
     */
    lockUntilBlockHeight(height: number): Transaction;
    /**
     *  Returns a semantic version of the transaction's nLockTime.
     *  @return {Number|Date}
     *  If nLockTime is 0, it returns null,
     *  if it is < 500000000, it returns a block height (number)
     *  else it returns a Date object.
     */
    getLockTime(): number | Date;
    /**
     * Converts a hex string into a transaction buffer and initializes the transaction.
     * @param {string} string - Hex string representation of the transaction data.
     * @returns {Transaction} The transaction instance initialized from the hex string.
     */
    fromString(string: string): Transaction;
    private _newTransaction;
    /**
     * @typedef {Object} Transaction~fromObject
     * @property {string} prevTxId
     * @property {number} outputIndex
     * @property {(Buffer|string|Script)} script
     * @property {number} satoshis
     */
    /**
     * Add an input to this transaction. This is a high level interface
     * to add an input, for more control, use @{link Transaction#addInput}.
     *
     * Can receive, as output information, the output of bitcoind's `listunspent` command,
     * and a slightly fancier format recognized by opcat:
     *
     * ```
     * {
     *  address: 'mszYqVnqKoQx4jcTdJXxwKAissE3Jbrrc1',
     *  txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
     *  outputIndex: 0,
     *  script: Script.empty(),
     *  satoshis: 1020000
     * }
     * ```
     * Where `address` can be either a string or a opcat Address object. The
     * same is true for `script`, which can be a string or a opcat Script.
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @example
     * ```javascript
     * var transaction = new Transaction();
     *
     * // From a pay to public key hash output from bitcoind's listunspent
     * transaction.from({'txid': '0000...', vout: 0, amount: 0.1, scriptPubKey: 'OP_DUP ...'});
     *
     * // From a pay to public key hash output
     * transaction.from({'txId': '0000...', outputIndex: 0, satoshis: 1000, script: 'OP_DUP ...'});
     *
     * ```
     *
     * @param {(Array.<Transaction~fromObject>|Transaction~fromObject)} utxo
     * @param {Array=} pubkeys
     * @param {number=} threshold
     * @returns {Transaction} The transaction instance for chaining.
     */
    from(utxo: any): Transaction;
    private _fromUTXO;
    /**
     * Add an input to this transaction. The input must be an instance of the `Input` class.
     * It should have information about the Output that it's spending, but if it's not already
     * set, three additional parameters, `outputScript`, `satoshis` and `data` can be provided.
     * @param {Input} input - The input to add
     * @param {Script|string} [outputScript] - The output script (required if input doesn't have output)
     * @param {number} [satoshis] - The satoshis amount (required if input doesn't have output)
     * @param {Buffer|string} [data] - Additional data for the output
     * @returns {Transaction} The transaction instance for chaining
     * @throws {errors.Transaction.NeedMoreInfo} If input has no output and missing required params
     */
    addInput(input: Input, outputScript?: Script | string, satoshis?: number, data?: Buffer | string): Transaction;
    /**
     * Add an input to this transaction, without checking that the input has information about
     * the output that it's spending.
     *
     * @param {Input} input
     * @return Transaction this, for chaining
     */
    uncheckedAddInput(input: Input): this;
    /**
     * Returns true if the transaction has enough info on all inputs to be correctly validated
     *
     * @return {boolean}
     */
    hasAllUtxoInfo(): boolean;
    /**
     * Manually set the fee for this transaction. Beware that this resets all the signatures
     * for inputs (in further versions, SIGHASH_SINGLE or SIGHASH_NONE signatures will not
     * be reset).
     *
     * @param {number} amount satoshis to be sent
     * @return {Transaction} this, for chaining
     */
    fee(amount: number): Transaction;
    /**
     * Manually set the fee per KB for this transaction. Beware that this resets all the signatures
     * for inputs (in further versions, SIGHASH_SINGLE or SIGHASH_NONE signatures will not
     * be reset).
     *
     * @param {number} amount satoshis per KB to be sent
     * @return {Transaction} this, for chaining
     */
    feePerKb(amount: number): Transaction;
    _feePerKb: number;
    /**
     * Set the change address for this transaction
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @param {Address} address An address for change to be sent to.
     * @param {Buffer|string} data The data to be stored in the change output.
     * @return {Transaction} this, for chaining
     */
    change(address: Address, data: Buffer | string): Transaction;
    /**
     * Gets the change output from the transaction outputs.
     * @returns {Output|null} The change output object if defined, otherwise null.
     */
    getChangeOutput(): Output | null;
    /**
     * Gets the change address for this transaction.
     * @returns {Address|null} The change address if set, otherwise null.
     */
    getChangeAddress(): Address | null;
    /**
     * Add an output to the transaction.
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @param {(string|Address|Array<Address>)} address
     * @param {number} amount in satoshis
     * @return {Transaction} this, for chaining
     */
    to(address: (string | Address | Array<Address>), amount: number): Transaction;
    /**
     * Add an OP_RETURN output to the transaction.
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @param {Buffer|string} value the data to be stored in the OP_RETURN output.
     *    In case of a string, the UTF-8 representation will be stored
     * @return {Transaction} this, for chaining
     */
    addData(value: Buffer | string): Transaction;
    /**
     * Add an OP_FALSE | OP_RETURN output to the transaction.
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @param {Buffer|string} value the data to be stored in the OP_RETURN output.
     *    In case of a string, the UTF-8 representation will be stored
     * @return {Transaction} this, for chaining
     */
    addSafeData(value: Buffer | string): Transaction;
    /**
     * Add an output to the transaction.
     *
     * @param {Output} output the output to add.
     * @return {Transaction} this, for chaining
     */
    addOutput(output: Output): Transaction;
    /**
     * Remove all outputs from the transaction.
     *
     * @return {Transaction} this, for chaining
     */
    clearOutputs(): Transaction;
    private _addOutput;
    private _getOutputAmount;
    private _getInputAmount;
    private _updateChangeOutput;
    /**
     * Calculates the fee of the transaction.
     *
     * If there's a fixed fee set, return that.
     *
     * If there is no change output set, the fee is the
     * total value of the outputs minus inputs. Note that
     * a serialized transaction only specifies the value
     * of its outputs. (The value of inputs are recorded
     * in the previous transaction outputs being spent.)
     * This method therefore raises a "MissingPreviousOutput"
     * error when called on a serialized transaction.
     *
     * If there's no fee set and no change address,
     * estimate the fee based on size.
     *
     * @return {Number} fee of this transaction in satoshis
     */
    getFee(): number;
    private _estimateFee;
    /**
     * Calculates the unspent value (difference between input and output amounts) of the transaction.
     * @returns {number} The unspent value (input amount minus output amount).
     */
    getUnspentValue(): number;
    private _clearSignatures;
    /**
     * Gets the estimated size of the transaction.
     * @returns {number} The estimated size in bytes.
     */
    getEstimateSize(): number;
    private _estimateSize;
    private _removeOutput;
    /**
     * Removes an output from the transaction at the specified index and updates the change output.
     * @param {number} index - The index of the output to remove.
     */
    removeOutput(index: number): void;
    /**
     * Sort a transaction's inputs and outputs according to BIP69
     *
     * @see {https://github.com/bitcoin/bips/blob/master/bip-0069.mediawiki}
     * @return {Transaction} this
     */
    sort(): Transaction;
    /**
     * Randomize this transaction's outputs ordering. The shuffling algorithm is a
     * version of the Fisher-Yates shuffle.
     *
     * @return {Transaction} this
     */
    shuffleOutputs(): Transaction;
    /**
     * Sort this transaction's outputs, according to a given sorting function that
     * takes an array as argument and returns a new array, with the same elements
     * but with a different order. The argument function MUST NOT modify the order
     * of the original array
     *
     * @param {Function} sortingFunction
     * @return {Transaction} this
     */
    sortOutputs(sortingFunction: Function): Transaction;
    /**
     * Sort this transaction's inputs, according to a given sorting function that
     * takes an array as argument and returns a new array, with the same elements
     * but with a different order.
     *
     * @param {Function} sortingFunction
     * @return {Transaction} this
     */
    sortInputs(sortingFunction: Function): Transaction;
    private _newOutputOrder;
    /**
     * Removes an input from the transaction by either its index or txId/outputIndex pair.
     * @param {string|number} txId - Transaction ID (as hex string) or input index if outputIndex is omitted.
     * @param {number} [outputIndex] - Output index of the input to remove (required if txId is string).
     * @throws {Transaction.InvalidIndex} If input index is out of bounds.
     */
    removeInput(txId: string | number, outputIndex?: number): void;
    /**
     * Sign the transaction using one or more private keys.
     *
     * It tries to sign each input, verifying that the signature will be valid
     * (matches a public key).
     * @param {Buffer|Array<Buffer>} privateKey - Private key(s) to sign the transaction with.
     * @param {number} [sigtype] - Optional signature type.
     * @returns {Transaction} Returns the transaction instance for chaining.
     * @throws {Error} Throws if not all UTXO information is available.
     */
    sign(privateKey: Buffer | Array<Buffer>, sigtype?: number): Transaction;
    /**
     * Generates signatures for all inputs in the transaction using the provided private key.
     * @param {string|PrivateKey} privKey - The private key to sign with (can be string or PrivateKey instance).
     * @param {number} [sigtype=Signature.SIGHASH_ALL] - The signature hash type (defaults to SIGHASH_ALL).
     * @returns {Array} Array of generated signatures for the transaction inputs.
     */
    getSignatures(privKey: string | PrivateKey, sigtype?: number): any[];
    /**
     * Add a signature to the transaction
     *
     * @param {Object} signature
     * @param {number} signature.inputIndex
     * @param {number} signature.sigtype
     * @param {PublicKey} signature.publicKey
     * @param {Signature} signature.signature
     * @return {Transaction} this, for chaining
     */
    applySignature(signature: {
        inputIndex: number;
        sigtype: number;
        publicKey: PublicKey;
        signature: Signature;
    }): Transaction;
    /**
     * Checks if all inputs in the transaction are fully signed.
     * @returns {boolean} True if all inputs have valid signatures, false otherwise.
     * @throws {errors.Transaction.UnableToVerifySignature} If any input has an unrecognized script kind
     *         or insufficient information to verify signatures (common when deserializing transactions).
     */
    isFullySigned(): boolean;
    /**
     * Validates a signature for a transaction input.
     * @param {Object} signature - The signature object to validate.
     * @throws {errors.Transaction.UnableToVerifySignature} If the input script is unrecognized or lacks execution info.
     * @returns {boolean} True if the signature is valid for the specified input.
     */
    isValidSignature(signature: any): boolean;
    /**
     * Verifies a signature for this transaction.
     * @param {Buffer} sig - The signature to verify.
     * @param {Buffer} pubkey - The public key corresponding to the signature.
     * @param {number} nin - The input index being signed.
     * @returns {boolean} True if the signature is valid, false otherwise.
     */
    verifySignature(sig: Buffer, pubkey: Buffer, nin: number): boolean;
    /**
     * Check that a transaction passes basic sanity tests. If not, return a string
     * describing the error. This function contains the same logic as
     * CheckTransaction in bitcoin core.
     *
     * Checks include:
     * - Non-empty inputs and outputs
     * - Valid output satoshis (non-negative, not exceeding MAX_MONEY)
     * - No duplicate inputs
     * - Coinbase script size validation (if coinbase)
     * - Input null checks and verification (if not coinbase and notVerifyInput is false)
     *
     * @param {boolean} [notVerifyInput=false] - Whether to skip input verification
     * @returns {true|string} Returns true if valid, or an error message string if invalid
     */
    verify(notVerifyInput?: boolean): true | string;
    /**
     * Checks if the transaction is a coinbase transaction.
     * A coinbase transaction has exactly one input and that input is null.
     * @returns {boolean} True if the transaction is a coinbase, false otherwise.
     */
    isCoinbase(): boolean;
    /**
     * Sets the input script for a transaction input.
     * @param {number|Object} options - Either an input index number or an options object
     * @param {number} [options.inputIndex=0] - Input index if options is an object
     * @param {string} [options.privateKey] - Private key for signing
     * @param {number} [options.sigtype=Signature.SIGHASH_ALL] - Signature hash type
     * @param {boolean} [options.isLowS=false] - Whether to use low-S signatures
     * @param {Function|Script} unlockScriptOrCallback - Either a script or callback function that returns a script
     * @returns {Transaction} Returns the transaction instance for chaining
     */
    setInputScript(options: number | any, unlockScriptOrCallback: Function | Script): Transaction;
    /**
     * Sets the sequence number for a specific transaction input.
     * @param {number} inputIndex - The index of the input to update.
     * @param {number} sequence - The sequence number to set.
     * @returns {Transaction} Returns the transaction instance for chaining.
     */
    setInputSequence(inputIndex: number, sequence: number): Transaction;
    /**
     * Sets an output at the specified index, either directly or via a callback function.
     * If a callback is provided, it will be invoked with the transaction instance to generate the output value.
     * Automatically updates the change output after setting.
     * @param {number} outputIndex - The index of the output to set
     * @param {any|Function} outputOrcb - The output value or a callback function that returns the output value
     * @returns {Transaction} Returns the transaction instance for chaining
     */
    setOutput(outputIndex: number, outputOrcb: any | Function): Transaction;
    /**
     * Seals the transaction by processing all outputs and inputs.
     * - For each output, executes the registered callback to generate the final output.
     * - Updates the change output if applicable.
     * - For each input, generates and sets the unlock script using the registered callback.
     * - If a private key is provided, signs the transaction.
     * - Marks the transaction as sealed and returns the instance.
     * @returns {Transaction} The sealed transaction instance.
     */
    seal(): Transaction;
    /**
     * Sets the lock time for the transaction.
     * @param {number} nLockTime - The lock time to set.
     * @returns {Transaction} Returns the transaction instance for chaining.
     */
    setLockTime(nLockTime: number): Transaction;
    /**
     * Gets the amount of change (in satoshis) for this transaction.
     * @returns {number} The change amount in satoshis, or 0 if no change exists.
     */
    getChangeAmount(): number;
    /**
     * Gets the estimated fee for the transaction.
     * @returns {number} The estimated fee value.
     */
    getEstimateFee(): number;
    /**
     * Checks if the transaction's fee rate meets or exceeds the expected rate.
     * @param {number} [feePerKb] - Optional fee per KB (in satoshis). Falls back to instance or default fee.
     * @returns {boolean} True if actual fee rate (fee/size) >= expected rate.
     */
    checkFeeRate(feePerKb?: number): boolean;
    /**
     * Serializes the transaction's inputs (prevTxId and outputIndex) into a hex string.
     * @returns {string} Hex-encoded serialized input data.
     */
    prevouts(): string;
    /**
     * Checks if the transaction is sealed.
     * @returns {boolean} True if the transaction is sealed, false otherwise.
     */
    isSealed(): boolean;
    /**
     * Gets the preimage for a transaction input.
     * @param {number} inputIndex - The index of the input to get the preimage for.
     * @param {number} [sigtype=Signature.SIGHASH_ALL] - The signature hash type.
     * @param {boolean} [isLowS=false] - Whether to use low-S signatures.
     * @returns {*} The preimage for the specified input.
     */
    getPreimage(inputIndex: number, sigtype?: number, isLowS?: boolean): Buffer;
    /**
     * Gets the signature(s) for a transaction input.
     * @param {number} inputIndex - Index of the input to sign.
     * @param {Array|Buffer|string} [privateKeys] - Private key(s) to sign with. Defaults to input's privateKey or transaction's _privateKey.
     * @param {number} [sigtypes] - Signature hash type. Defaults to SIGHASH_ALL.
     * @returns {string|Array} - Single signature hex string or array of signatures. Returns empty array if no privateKeys provided.
     */
    getSignature(inputIndex: number, privateKeys?: any[] | Buffer | string, sigtypes?: number): string | any[];
    /**
     * Adds an input to the transaction from a previous transaction's output.
     * @param {Transaction} prevTx - The previous transaction containing the output to spend.
     * @param {number} [outputIndex=0] - The index of the output in the previous transaction.
     * @returns {Transaction} The transaction instance for chaining.
     * @throws {Error} If prevTx is not a valid Transaction.
     */
    addInputFromPrevTx(prevTx: Transaction, outputIndex?: number): Transaction;
    /**
     * Adds a dummy input to the transaction with the specified script and satoshis.
     * The dummy input uses a placeholder script and a fixed previous transaction ID.
     *
     * @param {Script} script - The script to use for the output of the dummy input.
     * @param {number} satoshis - The amount in satoshis for the output of the dummy input.
     * @returns {Transaction} The transaction instance for chaining.
     */
    addDummyInput(script: Script, satoshis: number): Transaction;
    /**
     * Same as change(addresss), but using the address of Transaction.DUMMY_PRIVATEKEY as default change address
     *
     * Beware that this resets all the signatures for inputs (in further versions,
     * SIGHASH_SINGLE or SIGHASH_NONE signatures will not be reset).
     *
     * @return {Transaction} this, for chaining
     */
    dummyChange(): Transaction;
    /**
     * Verifies the script for a specific transaction input.
     * @param {number} inputIndex - Index of the input to verify.
     * @throws {errors.Transaction.Input.MissingInput} If input at given index doesn't exist.
     * @returns {boolean} True if the script verification passes.
     */
    verifyScript(inputIndex: number): boolean;
    /**
     * Verifies the input script for a specific input index in the transaction.
     * @param {number} inputIndex - The index of the input to verify.
     * @returns {boolean} True if the input script is valid, false otherwise.
     */
    verifyInputScript(inputIndex: number): boolean;
    /**
     * Gets the amount of satoshis for a specific transaction input.
     * @param {number} inputIndex - The index of the input to query.
     * @returns {number} The satoshis amount of the specified input.
     * @throws {errors.Transaction.Input.MissingInput} If the input at the specified index doesn't exist.
     */
    getInputAmount(inputIndex: number): number;
    /**
     * Gets the output amount in satoshis for the specified output index.
     * @param {number} outputIndex - The index of the output to retrieve.
     * @returns {number} The output amount in satoshis.
     * @throws {errors.Transaction.MissingOutput} If the output index is invalid.
     */
    getOutputAmount(outputIndex: number): number;
}
declare namespace Transaction {
    export { DUST_AMOUNT, FEE_SECURITY_MARGIN, MAX_MONEY, NLOCKTIME_BLOCKHEIGHT_LIMIT, NLOCKTIME_MAX_VALUE, FEE_PER_KB, DUMMY_PRIVATEKEY, fromString, fromBuffer, fromObject, shallowCopy, Input, Output, Sighash, UnspentOutput, TransactionSignature as Signature, Transaction };
}
import BufferWriter = require("../encoding/bufferwriter.cjs");
import BufferReader = require("../encoding/bufferreader.cjs");
import Script = require("../script/script.cjs");
import Input = require("./input/input.cjs");
import Address = require("../address.cjs");
import Output = require("./output.cjs");
import PrivateKey = require("../privatekey.cjs");
import Signature = require("../crypto/signature.cjs");
declare var DUST_AMOUNT: number;
declare var FEE_SECURITY_MARGIN: number;
declare var MAX_MONEY: number;
declare var NLOCKTIME_BLOCKHEIGHT_LIMIT: number;
declare var NLOCKTIME_MAX_VALUE: number;
declare var FEE_PER_KB: number;
declare var DUMMY_PRIVATEKEY: PrivateKey;
/**
 * Creates a Transaction instance from a raw hexadecimal string.
 * @param {string} rawHex - The hexadecimal string representation of the transaction.
 * @returns {Transaction} A new Transaction instance populated from the input string.
 */
declare function fromString(rawHex: string): Transaction;
/**
 * Creates a Transaction instance from a buffer.
 * @param {Buffer} buffer - The input buffer containing transaction data.
 * @returns {Transaction} A new Transaction instance populated from the buffer.
 */
declare function fromBuffer(buffer: Buffer): Transaction;
/**
 * Creates a Transaction instance from a plain object.
 * @param {Object} obj - The plain object to convert to a Transaction.
 * @returns {Transaction} A new Transaction instance populated from the object.
 */
declare function fromObject(obj: any): Transaction;
/**
 * Create a 'shallow' copy of the transaction, by serializing and deserializing
 * it dropping any additional information that inputs and outputs may have hold
 * @param {Transaction} transaction - The transaction to copy.
 * @returns {Transaction} A new Transaction instance with the same data.
 */
declare function shallowCopy(transaction: Transaction): Transaction;
import Sighash = require("./sighash.cjs");
import UnspentOutput = require("./unspentoutput.cjs");
import TransactionSignature = require("./signature.cjs");
/**
 * ~fromObject
 */
type Transaction = {
    prevTxId: string;
    outputIndex: number;
    script: (Buffer | string | Script);
    satoshis: number;
};
