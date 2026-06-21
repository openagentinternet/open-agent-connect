import { Option } from '../monads';
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
export type u64 = BigTypedNumber<'u64'>;
export declare const U64_MAX_BIGINT = 18446744073709551615n;
export declare function u64(num: number | bigint): u64;
export declare namespace u64 {
    const MAX: u64;
    function checkedAdd(x: u64, y: u64): Option<u64>;
    function checkedSub(x: u64, y: u64): Option<u64>;
}
export {};
//# sourceMappingURL=u64.d.ts.map