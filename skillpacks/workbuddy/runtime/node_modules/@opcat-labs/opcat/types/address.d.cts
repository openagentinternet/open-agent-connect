export = Address;
/**
 * Instantiate an address from an address String or Buffer, a public key hash Buffer,
 * or a {@link PublicKey} Buffer.
 *
 * This is an immutable class, and if the first parameter provided to this constructor is an
 * `Address` instance, the same argument will be returned.
 *
 * An address has two key properties: `network` and `type`. The type is either
 * `Address.PayToPublicKeyHash` (value is the `'pubkeyhash'` string).
 * The network is an instance of {@link Network}.
 * You can quickly check whether an address is of a given kind by using the methods
 * `isPayToPublicKeyHash`
 *
 * @example
 * ```javascript
 * // validate that an input field is valid
 * var error = Address.getValidationError(input, 'testnet');
 * if (!error) {
 *   var address = Address(input, 'testnet');
 * } else {
 *   // invalid network or checksum (typo?)
 *   var message = error.messsage;
 * }
 *
 * // get an address from a public key
 * var address = Address(publicKey, 'testnet').toString();
 * ```
 *
 * @param {*} data - The encoded data in various formats
 * @param {Network|String|number} [network] - The network: 'livenet' or 'testnet'
 * @param {string} [type] - The type of address: 'pubkey'
 * @returns {Address} A new valid and frozen instance of an Address
 * @constructor
 */
declare function Address(data: any, network?: Network | string | number, type?: string): Address;
declare class Address {
    /**
     * Instantiate an address from an address String or Buffer, a public key hash Buffer,
     * or a {@link PublicKey} Buffer.
     *
     * This is an immutable class, and if the first parameter provided to this constructor is an
     * `Address` instance, the same argument will be returned.
     *
     * An address has two key properties: `network` and `type`. The type is either
     * `Address.PayToPublicKeyHash` (value is the `'pubkeyhash'` string).
     * The network is an instance of {@link Network}.
     * You can quickly check whether an address is of a given kind by using the methods
     * `isPayToPublicKeyHash`
     *
     * @example
     * ```javascript
     * // validate that an input field is valid
     * var error = Address.getValidationError(input, 'testnet');
     * if (!error) {
     *   var address = Address(input, 'testnet');
     * } else {
     *   // invalid network or checksum (typo?)
     *   var message = error.messsage;
     * }
     *
     * // get an address from a public key
     * var address = Address(publicKey, 'testnet').toString();
     * ```
     *
     * @param {*} data - The encoded data in various formats
     * @param {Network|String|number} [network] - The network: 'livenet' or 'testnet'
     * @param {string} [type] - The type of address: 'pubkey'
     * @returns {Address} A new valid and frozen instance of an Address
     * @constructor
     */
    constructor(data: any, network?: Network | string | number, type?: string);
    get hashBuffer(): any;
    get network(): any;
    get type(): any;
    private _classifyArguments;
    /**
     * Returns true if an address is of pay to public key hash type
     * @return boolean
     */
    isPayToPublicKeyHash(): boolean;
    /**
     * Will return a buffer representation of the address
     *
     * @returns {Buffer} Bitcoin address buffer
     */
    toBuffer(): Buffer;
    /**
     * Converts the address to a hexadecimal string representation.
     * @returns {string} The hexadecimal string representation of the address.
     */
    toHex(): string;
    /**
     * Converts the address to a publickey hash string representation.
     * @returns {string} The hexadecimal string of the publickey hash buffer.
     */
    toPublickeyHash(): string;
    /**
     * @returns {Object} A plain object with the address information
     */
    toObject: () => any;
    toJSON(): any;
    /**
     * Will return a string formatted for the console
     *
     * @returns {string} Bitcoin address
     */
    inspect(): string;
    /**
     * Will return a the base58 string representation of the address
     *
     * @returns {string} Bitcoin address
     */
    toString(): string;
}
declare namespace Address {
    let PayToPublicKeyHash: string;
    /**
     * @param {Buffer} hash - An instance of a hash Buffer
     * @returns {Object} An object with keys: hashBuffer
     * @private
     */
    function _transformHash(hash: Buffer): any;
    /**
     * Deserializes an address serialized through `Address#toObject()`
     * @param {Object} data
     * @param {string} data.hash - the hash that this address encodes
     * @param {string} data.type - either 'pubkeyhash' or 'scripthash'
     * @param {Network=} data.network - the name of the network associated
     * @return {Address}
     * @private
     */
    function _transformObject(data: {
        hash: string;
        type: string;
        network?: Network;
    }): Address;
    /**
     * Internal function to discover the network and type based on the first data byte
     *
     * @param {Buffer} buffer - An instance of a hex encoded address Buffer
     * @returns {Object} An object with keys: network and type
     * @private
     */
    function _classifyFromVersion(buffer: Buffer): any;
    /**
     * Internal function to transform a bitcoin address buffer
     *
     * @param {Buffer} buffer - An instance of a hex encoded address Buffer
     * @param {string=} network - The network: 'livenet' or 'testnet'
     * @param {string=} type - The type: 'pubkeyhash' or 'scripthash'
     * @returns {Object} An object with keys: hashBuffer, network and type
     * @private
     */
    function _transformBuffer(buffer: Buffer, network?: string, type?: string): any;
    /**
     * Internal function to transform a {@link PublicKey}
     *
     * @param {PublicKey} pubkey - An instance of PublicKey
     * @returns {Object} An object with keys: hashBuffer, type
     * @private
     */
    function _transformPublicKey(pubkey: PublicKey): any;
    /**
     * Internal function to transform a bitcoin cash address string
     *
     * @param {string} data
     * @param {String|Network=} network - either a Network instance, 'livenet', or 'testnet'
     * @param {string=} type - The type: 'pubkeyhash'
     * @returns {Object} An object with keys: hashBuffer, network and type
     * @private
     */
    function _transformString(data: string, network?: any, type?: string): any;
    /**
     * Instantiate an address from a PublicKey buffer
     *
     * @param {Buffer} data - A buffer of the public key
     * @param {String|Network} network - either a Network instance, 'livenet', or 'testnet'
     * @returns {Address} A new valid and frozen instance of an Address
     */
    function fromPublicKey(data: Buffer, network: any): Address;
    /**
     * Instantiate an address from a ripemd160 public key hash
     *
     * @param {Buffer} hash - An instance of buffer of the hash
     * @param {String|Network} network - either a Network instance, 'livenet', or 'testnet'
     * @returns {Address} A new valid and frozen instance of an Address
     */
    function fromPublicKeyHash(hash: Buffer, network: any): Address;
    /**
     * Instantiate an address from a bitcoin address buffer
     *
     * @param {Buffer} buffer - An instance of buffer of the address
     * @param {String|Network=} network - either a Network instance, 'livenet', or 'testnet'
     * @param {string=} type - The type of address: 'pubkey'
     * @returns {Address} A new valid and frozen instance of an Address
     */
    function fromBuffer(buffer: Buffer, network?: any, type?: string): Address;
    /**
     * Creates an Address instance from a hex string.
     * @param {string} hex - The hex string representation of the address.
     * @param {Network} network - The network type (e.g., 'mainnet', 'testnet').
     * @param {AddressType} [type] - Optional address type.
     * @returns {Address} The Address instance created from the hex string.
     */
    function fromHex(hex: string, network: Network, type?: AddressType): Address;
    /**
     * Instantiate an address from an address string
     *
     * @param {string} str - An string of the bitcoin address
     * @param {String|Network=} network - either a Network instance, 'livenet', or 'testnet'
     * @param {string=} type - The type of address: 'pubkey'
     * @returns {Address} A new valid and frozen instance of an Address
     */
    function fromString(str: string, network?: any, type?: string): Address;
    /**
     * Instantiate an address from an Object
     *
     * @param {string} json - An JSON string or Object with keys: hash, network and type
     * @returns {Address} A new valid instance of an Address
     */
    function fromObject(obj: any): Address;
    /**
     * Will return a validation error if exists
     *
     * @example
     * ```javascript
     * // a network mismatch error
     * var error = Address.getValidationError('15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2', 'testnet');
     * ```
     *
     * @param {string} data - The encoded data
     * @param {String|Network} network - either a Network instance, 'livenet', or 'testnet'
     * @param {string} type - The type of address: 'pubkey'
     * @returns {null|Error} The corresponding error message
     */
    function getValidationError(data: string, network: any, type: string): Error;
    /**
     * Will return a boolean if an address is valid
     *
     * @example
     * ```javascript
     * assert(Address.isValid('15vkcKf7gB23wLAnZLmbVuMiiVDc1Nm4a2', 'livenet'));
     * ```
     *
     * @param {string} data - The encoded data
     * @param {String|Network} network - either a Network instance, 'livenet', or 'testnet'
     * @param {string} type - The type of address: 'pubkey'
     * @returns {boolean} The corresponding error message
     */
    function isValid(data: string, network: any, type: string): boolean;
}
