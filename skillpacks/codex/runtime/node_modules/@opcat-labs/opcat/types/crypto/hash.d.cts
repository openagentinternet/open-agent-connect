export = Hash;
/**
 * Represents a hash utility class.
 * @constructor
 */
declare function Hash(): Hash;
declare class Hash {
}
declare namespace Hash {
    /**
     * A SHA or SHA1 hash, which is always 160 bits or 20 bytes long.
     *
     * See:
     * https://en.wikipedia.org/wiki/SHA-1
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function sha1(buf: Buffer): Buffer;
    namespace sha1 {
        let blocksize: number;
    }
    /**
     * A SHA256 hash, which is always 256 bits or 32 bytes long.
     *
     * See:
     * https://www.movable-type.co.uk/scripts/sha256.html
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function sha256(buf: Buffer): Buffer;
    namespace sha256 {
        let blocksize_1: number;
        export { blocksize_1 as blocksize };
    }
    /**
     * A double SHA256 hash, which is always 256 bits or 32 bytes bytes long. This
     * hash function is commonly used inside Bitcoin, particularly for the hash of a
     * block and the hash of a transaction.
     *
     * See:
     * https://www.movable-type.co.uk/scripts/sha256.html
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function sha256sha256(buf: Buffer): Buffer;
    /**
     * A RIPEMD160 hash, which is always 160 bits or 20 bytes long.
     *
     * See:
     * https://en.wikipedia.org/wiki/RIPEMD
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function ripemd160(buf: Buffer): Buffer;
    /**
     * A RIPEMD160 hash of a SHA256 hash, which is always 160 bits or 20 bytes long.
     * This value is commonly used inside Bitcoin, particularly for Bitcoin
     * addresses.
     *
     * See:
     * https://en.wikipedia.org/wiki/RIPEMD
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function sha256ripemd160(buf: Buffer): Buffer;
    /**
     * A SHA512 hash, which is always 512 bits or 64 bytes long.
     *
     * See:
     * https://en.wikipedia.org/wiki/SHA-2
     *
     * @param {Buffer} buf Data, a.k.a. pre-image, which can be any size.
     * @returns {Buffer} The hash in the form of a buffer.
     */
    function sha512(buf: Buffer): Buffer;
    namespace sha512 {
        let blocksize_2: number;
        export { blocksize_2 as blocksize };
    }
    /**
     * A way to do HMAC using any underlying hash function. If you ever find that
     * you want to hash two pieces of data together, you should use HMAC instead of
     * just using a hash function. Rather than doing hash(data1 + data2) you should
     * do HMAC(data1, data2). Actually, rather than use HMAC directly, we recommend
     * you use either sha256hmac or sha515hmac provided below.
     *
     * See:
     * https://en.wikipedia.org/wiki/Length_extension_attack
     * https://blog.skullsecurity.org/2012/everything-you-need-to-know-about-hash-length-extension-attacks
     *
     * @param {function} hashf Which hash function to use.
     * @param {Buffer} data Data, which can be any size.
     * @param {Buffer} key Key, which can be any size.
     * @returns {Buffer} The HMAC in the form of a buffer.
     */
    function hmac(hashf: Function, data: Buffer, key: Buffer): Buffer;
    /**
     * A SHA256 HMAC.
     *
     * @param {Buffer} data Data, which can be any size.
     * @param {Buffer} key Key, which can be any size.
     * @returns {Buffer} The HMAC in the form of a buffer.
     */
    function sha256hmac(data: Buffer, key: Buffer): Buffer;
    /**
     * A SHA512 HMAC.
     *
     * @param {Buffer} data Data, which can be any size.
     * @param {Buffer} key Key, which can be any size.
     * @returns {Buffer} The HMAC in the form of a buffer.
     */
    function sha512hmac(data: Buffer, key: Buffer): Buffer;
}
