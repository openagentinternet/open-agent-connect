/// <reference types="node" />
import { Option } from './monads';
import { u128 } from './integer';
import { FixedArray } from './utils';
export declare enum Tag {
    BODY = 0,
    FLAGS = 2,
    RUNE = 4,
    PREMINE = 6,
    CAP = 8,
    AMOUNT = 10,
    HEIGHT_START = 12,
    HEIGHT_END = 14,
    OFFSET_START = 16,
    OFFSET_END = 18,
    MINT = 20,
    POINTER = 22,
    CENOTAPH = 126,
    DIVISIBILITY = 1,
    SPACERS = 3,
    SYMBOL = 5,
    NOP = 127
}
export declare namespace Tag {
    function take<N extends number, T extends {}>(tag: Tag, fields: Map<u128, u128[]>, n: N, withFn: (values: FixedArray<u128, N>) => Option<T>): Option<T>;
    function encode(tag: Tag, values: u128[]): Buffer;
    function encodeOptionInt(tag: Tag, value: Option<number | bigint>): Buffer;
}
//# sourceMappingURL=tag.d.ts.map