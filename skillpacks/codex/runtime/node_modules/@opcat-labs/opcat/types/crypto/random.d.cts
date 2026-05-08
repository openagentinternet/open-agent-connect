export = Random;
/**
 * A utility class for generating random values.
 */
declare function Random(): void;
declare namespace Random {
    /**
     * Generates a cryptographically secure random buffer of the specified size.
     * @param {number} size - The number of bytes to generate.
     * @returns {Buffer} A buffer filled with cryptographically secure random bytes.
     */
    function getRandomBuffer(size: number): Buffer;
}
