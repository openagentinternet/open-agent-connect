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
export type u8 = BigTypedNumber<'u8'>;
export declare const U8_MAX_BIGINT = 255n;
export declare function u8(num: number | bigint): u8;
export declare namespace u8 {
    const MAX: u8;
    function checkedAdd(x: u8, y: u8): Option<u8>;
    function checkedSub(x: u8, y: u8): Option<u8>;
}
export {};
//# sourceMappingURL=u8.d.ts.map