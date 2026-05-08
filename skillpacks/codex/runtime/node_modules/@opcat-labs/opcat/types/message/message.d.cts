export = Message;
/**
 * Creates a Message instance from a string or Buffer.
 * @constructor
 * @param {string|Buffer} message - The message content as either a string or Buffer
 * @throws {Error} Will throw if message is not a string or Buffer
 * @returns {Message} A new Message instance containing the message buffer
 */
declare function Message(message: string | Buffer): Message;
declare class Message {
    /**
     * Creates a Message instance from a string or Buffer.
     * @constructor
     * @param {string|Buffer} message - The message content as either a string or Buffer
     * @throws {Error} Will throw if message is not a string or Buffer
     * @returns {Message} A new Message instance containing the message buffer
     */
    constructor(message: string | Buffer);
    messageBuffer: Buffer;
    /**
     * Calculates the magic hash for the message by concatenating magic bytes prefixes
     * with the message buffer and computing a double SHA-256 hash.
     * @returns {Buffer} The resulting 32-byte hash.
     */
    magicHash(): Buffer;
    private _sign;
    /**
     * Will sign a message with a given bitcoin private key.
     *
     * @param {PrivateKey} privateKey - An instance of PrivateKey
     * @returns {String} A base64 encoded compact signature
     */
    sign(privateKey: PrivateKey): string;
    /**
     * Verifies the message signature using the provided public key.
     * @param {PublicKey} publicKey - The public key to verify against
     * @param {Signature} signature - The signature to verify
     * @returns {boolean} True if signature is valid, false otherwise
     * @throws {Error} If arguments are not valid PublicKey/Signature instances
     */
    _verify(publicKey: PublicKey, signature: Signature): boolean;
    error: string;
    /**
     * Will return a boolean of the signature is valid for a given bitcoin address.
     * If it isn't the specific reason is accessible via the "error" member.
     *
     * @param {Address|String} bitcoinAddress - A bitcoin address
     * @param {String} signatureString - A base64 encoded compact signature
     * @returns {Boolean}
     */
    verify(bitcoinAddress: Address | string, signatureString: string): boolean;
    /**
     * Converts the message to a plain object with hex representation.
     * @returns {Object} An object containing the hex string of the message buffer.
     */
    toObject(): any;
    /**
     * Converts the Message instance to a JSON string representation.
     * @returns {string} The JSON string representation of the Message object.
     */
    toJSON(): string;
    /**
     * Converts the message buffer to a string representation.
     * @returns {string} The string representation of the message buffer.
     */
    toString(): string;
    /**
     * Custom inspect method for Message instances.
     * @returns {string} String representation in format '<Message: [content]>'.
     */
    inspect(): string;
}
declare namespace Message {
    /**
     * Signs a message with the given private key.
     * @param {string|Buffer} message - The message to sign.
     * @param {PrivateKey} privateKey - The private key used for signing.
     * @returns {Message} The signed message instance.
     */
    function sign(message: string | Buffer, privateKey: PrivateKey): Message;
    function verify(message: any, address: any, signature: any): boolean;
    let MAGIC_BYTES: Buffer;
    /**
     * Instantiate a message from a message string
     *
     * @param {String} str - A string of the message
     * @returns {Message} A new instance of a Message
     */
    function fromString(str: string): Message;
    /**
     * Instantiate a message from JSON
     *
     * @param {String} json - An JSON string or Object with keys: message
     * @returns {Message} A new instance of a Message
     */
    function fromJSON(json: string): Message;
    /**
     * Creates a Message instance from an object containing a hex-encoded message.
     * @param {Object} obj - The source object containing the message data.
     * @param {string} obj.messageHex - Hex-encoded message string.
     * @returns {Message} A new Message instance created from the decoded buffer.
     */
    function fromObject(obj: {
        messageHex: string;
    }): Message;
}
import PrivateKey = require("../privatekey.cjs");
import PublicKey = require("../publickey.cjs");
import Signature = require("../crypto/signature.cjs");
import Address = require("../address.cjs");
