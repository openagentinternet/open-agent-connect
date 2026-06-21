/// <reference types="node" />
import { script } from './script';
export declare namespace Instruction {
    function isNumber(instruction: script.Instruction): instruction is number;
    function isBuffer(instruction: script.Instruction): instruction is Buffer;
}
type GrowToSize<T, N extends number, A extends T[]> = A['length'] extends N ? A : GrowToSize<T, N, [...A, T]>;
export type FixedArray<T, N extends number> = GrowToSize<T, N, []>;
export {};
//# sourceMappingURL=utils.d.ts.map