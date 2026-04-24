/// <reference types="node" />
import { Option } from '../monads';
import { SeekBuffer } from '../seekbuffer';
import { u64 } from './u64';
import { u32 } from './u32';
import { u8 } from './u8';
/**
 * A little utility type used for nominal typing.
 *
 * See {@link https://michalzalecki.com/nominal-typing-in-typescript/}
 */
type BigTypedNumber<T> = bigint & {
    /**
     * # !!! DO NOT USE THIS PROPERTY IN YOUR CODE !!!
     * ## This is just used to make each `BigTypedNumber` alias unique for Typescript and doesn't actually exist.
     * @ignore
     * @private
     * @readonly
     * @type {undefined}
     */
    readonly __kind__: T;
};
/**
 * ## 128-bit unsigned integer
 *
 * - **Value Range:** `0` to `340282366920938463463374607431768211455`
 * - **Size in bytes:** `16`
 * - **Web IDL type:** `bigint`
 * - **Equivalent C type:** `uint128_t`
 */
export type u128 = BigTypedNumber<'u128'>;
export declare const U128_MAX_BIGINT = 340282366920938463463374607431768211455n;
/**
 * Convert Number or BigInt to 128-bit unsigned integer.
 * @param num - The Number or BigInt to convert.
 * @returns - The resulting 128-bit unsigned integer (BigInt).
 */
export declare function u128(num: number | bigint): u128;
export declare namespace u128 {
    const MAX: u128;
    function checkedAdd(x: u128, y: u128): Option<u128>;
    function checkedAddThrow(x: u128, y: u128): u128;
    function checkedSub(x: u128, y: u128): Option<u128>;
    function checkedSubThrow(x: u128, y: u128): u128;
    function checkedMultiply(x: u128, y: u128): Option<u128>;
    function saturatingAdd(x: u128, y: u128): u128;
    function saturatingMultiply(x: u128, y: u128): u128;
    function saturatingSub(x: u128, y: u128): u128;
    function decodeVarInt(seekBuffer: SeekBuffer): Option<u128>;
    function tryDecodeVarInt(seekBuffer: SeekBuffer): u128;
    function encodeVarInt(value: u128): Buffer;
    function tryIntoU64(n: u128): Option<u64>;
    function tryIntoU32(n: u128): Option<u32>;
    function tryIntoU8(n: u128): Option<u8>;
}
export declare function getAllU128(buffer: Buffer): Generator<u128>;
export {};
//# sourceMappingURL=u128.d.ts.map