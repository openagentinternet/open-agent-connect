export = Mnemonic;
/**
 * This is an immutable class that represents a BIP39 Mnemonic code.
 * See BIP39 specification for more info: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
 * A Mnemonic code is a a group of easy to remember words used for the generation
 * of deterministic wallets. A Mnemonic can be used to generate a seed using
 * an optional passphrase, for later generate a HDPrivateKey.
 *
 * @example
 * // generate a random mnemonic
 * var mnemonic = new Mnemonic();
 * var phrase = mnemonic.phrase;
 *
 * // use a different language
 * var mnemonic = new Mnemonic(Mnemonic.Words.SPANISH);
 * var xprivkey = mnemonic.toHDPrivateKey();
 *
 * @param {Buffer|string|number} [data] - Input data (Buffer for seed, string for phrase, or number for entropy bits)
 * @param {Array} [wordlist] - Optional wordlist for phrase generation/validation
 * @throws {InvalidArgument} If invalid data type provided
 * @throws {Mnemonic.UnknownWordlist} If phrase language can't be detected
 * @throws {Mnemonic.InvalidMnemonic} If phrase is invalid
 * @throws {InvalidArgument} If invalid ENT value (must be >=128 and divisible by 32)
 * @returns {Mnemonic} A new instance of Mnemonic
 * @constructor
 */
declare function Mnemonic(data?: Buffer | string | number, wordlist?: any[]): Mnemonic;
declare class Mnemonic {
    /**
     * This is an immutable class that represents a BIP39 Mnemonic code.
     * See BIP39 specification for more info: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
     * A Mnemonic code is a a group of easy to remember words used for the generation
     * of deterministic wallets. A Mnemonic can be used to generate a seed using
     * an optional passphrase, for later generate a HDPrivateKey.
     *
     * @example
     * // generate a random mnemonic
     * var mnemonic = new Mnemonic();
     * var phrase = mnemonic.phrase;
     *
     * // use a different language
     * var mnemonic = new Mnemonic(Mnemonic.Words.SPANISH);
     * var xprivkey = mnemonic.toHDPrivateKey();
     *
     * @param {Buffer|string|number} [data] - Input data (Buffer for seed, string for phrase, or number for entropy bits)
     * @param {Array} [wordlist] - Optional wordlist for phrase generation/validation
     * @throws {InvalidArgument} If invalid data type provided
     * @throws {Mnemonic.UnknownWordlist} If phrase language can't be detected
     * @throws {Mnemonic.InvalidMnemonic} If phrase is invalid
     * @throws {InvalidArgument} If invalid ENT value (must be >=128 and divisible by 32)
     * @returns {Mnemonic} A new instance of Mnemonic
     * @constructor
     */
    constructor(data?: Buffer | string | number, wordlist?: any[]);
    /**
     * Will generate a seed based on the mnemonic and optional passphrase. Note that
     * this seed is absolutely NOT the seed that is output by .toSeed(). These are
     * two different seeds. The seed you want to put in here, if any, is just some
     * random byte string. Normally you should rely on the .fromRandom() method.
     *
     * @param {String} [passphrase]
     * @returns {Buffer}
     */
    toSeed(passphrase?: string): Buffer;
    /**
     *
     * Generates a HD Private Key from a Mnemonic.
     * Optionally receive a passphrase and bitcoin network.
     *
     * @param {String=} [passphrase]
     * @param {Network|String|number=} [network] - The network: 'livenet' or 'testnet'
     * @returns {HDPrivateKey}
     */
    toHDPrivateKey(passphrase?: string | undefined, network?: (Network | string | number) | undefined): HDPrivateKey;
    /**
     * Will return a the string representation of the mnemonic
     *
     * @returns {String} Mnemonic
     */
    toString(): string;
    /**
     * Will return a string formatted for the console
     *
     * @returns {String} Mnemonic
     */
    inspect(): string;
}
declare namespace Mnemonic {
    /**
     * Creates a new Mnemonic instance with random entropy using the specified wordlist.
     * @param {Array} [wordlist=Mnemonic.Words.ENGLISH] - The wordlist to use for mnemonic generation (defaults to English).
     * @returns {Mnemonic} A new Mnemonic instance with random entropy.
     */
    export function fromRandom(wordlist?: any[]): Mnemonic;
    /**
     * Creates a Mnemonic instance from a mnemonic string.
     * @param {string} mnemonic - The mnemonic phrase string.
     * @param {string} [wordlist=Mnemonic.Words.ENGLISH] - Optional wordlist (defaults to English).
     * @returns {Mnemonic} A new Mnemonic instance.
     */
    export function fromString(mnemonic: string, wordlist?: string): Mnemonic;
    /**
     * Will return a boolean if the mnemonic is valid
     *
     * @example
     *
     * var valid = Mnemonic.isValid('lab rescue lunch elbow recall phrase perfect donkey biology guess moment husband');
     * // true
     *
     * @param {String} mnemonic - The mnemonic string
     * @param {String} [wordlist] - The wordlist used
     * @returns {boolean}
     */
    export function isValid(mnemonic: string, wordlist?: string): boolean;
    /**
     * Internal function to check if a mnemonic belongs to a wordlist.
     *
     * @param {String} mnemonic - The mnemonic string
     * @param {String} wordlist - The wordlist
     * @returns {boolean}
     * @private
     */
    export function _belongsToWordlist(mnemonic: string, wordlist: string): boolean;
    /**
     * Internal function to detect the wordlist used to generate the mnemonic.
     *
     * @param {String} mnemonic - The mnemonic string
     * @returns {Array} the wordlist or null
     * @private
     */
    export function _getDictionary(mnemonic: string): any[];
    /**
     * Will generate a Mnemonic object based on a seed.
     *
     * @param {Buffer} [seed]
     * @param {string} [wordlist]
     * @returns {Mnemonic}
     */
    export function fromSeed(seed?: Buffer, wordlist?: string): Mnemonic;
    /**
     * Internal function to generate a random mnemonic
     *
     * @param {Number} ENT - Entropy size, defaults to 128
     * @param {Array} wordlist - Array of words to generate the mnemonic
     * @returns {String} Mnemonic string
     * @private
     */
    export function _mnemonic(ENT: number, wordlist: any[]): string;
    /**
     * Internal function to generate mnemonic based on entropy
     *
     * @param {Number} entropy - Entropy buffer
     * @param {Array} wordlist - Array of words to generate the mnemonic
     * @returns {String} Mnemonic string
     * @private
     */
    export function _entropy2mnemonic(entropy: number, wordlist: any[]): string;
    /**
     * Internal function to create checksum of entropy
     *
     * @param entropy
     * @returns {string} Checksum of entropy length / 32
     * @private
     */
    export function _entropyChecksum(entropy: any): string;
    export { Words };
    export { pbkdf2 };
}
import HDPrivateKey = require("../hdprivatekey.cjs");
import Words = require("./words/index.cjs");
import pbkdf2 = require("./pbkdf2.cjs");
