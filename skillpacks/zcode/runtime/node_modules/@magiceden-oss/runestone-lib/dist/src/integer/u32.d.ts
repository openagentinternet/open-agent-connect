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
export type u32 = BigTypedNumber<'u32'>;
export declare const U32_MAX_BIGINT = 4294967295n;
export declare function u32(num: number | bigint): u32;
export declare namespace u32 {
    const MAX: u32;
    function checkedAdd(x: u32, y: u32): Option<u32>;
    function checkedSub(x: u32, y: u32): Option<u32>;
}
export {};
//# sourceMappingURL=u32.d.ts.map