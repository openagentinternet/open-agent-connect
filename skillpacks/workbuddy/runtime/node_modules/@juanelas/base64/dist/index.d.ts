/// <reference types="node" />
/**
 * Base64url for both node.js and brwser javascript. It can work with ArrayBuffer|TypedArray|Buffer
 *
 * @remarks Bowser code obtained from https://github.com/panva/jose/blob/main/src/runtime/browser/base64url.ts
 * @packageDocumentation
 */
/**
 * A TypedArray object describes an array-like view of an underlying binary data buffer.
 */
type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
/**
 * Base64Url encoding of a buffer input or a string (UTF16 in browsers, UTF8 in node)
 * @param input
 * @param urlsafe - if true Base64 URL encoding is used ('+' and '/' are replaced by '-', '_')
 * @param padding - if false, padding (trailing '=') is removed
 * @returns a string with the base64-encoded representation of the input
 */
declare function encode(input: ArrayBufferLike | TypedArray | Buffer | string, urlsafe?: boolean, padding?: boolean): string;
/**
 * Base64url decoding (binary output) of base64url-encoded string
 * @param base64 - a base64 string
 * @param stringOutput - if true a UTF16 (browser) or UTF8 (node) string is returned
 * @returns a buffer or unicode string
 */
declare function decode(base64: string): Uint8Array;
declare function decode(base64: string, stringOutput: undefined): Uint8Array;
declare function decode(base64: string, stringOutput: false): Uint8Array;
declare function decode(base64: string, stringOutput: true): string;
declare function decode(base64: string, stringOutput: boolean): Uint8Array | string;

export { type TypedArray, decode, encode };
