/// <reference types="node" />
import { Network } from './network';
import { u128, u32, u64 } from './integer';
export declare class Rune {
    readonly value: u128;
    static readonly STEPS: u128[];
    constructor(value: u128);
    static getMinimumAtHeight(chain: Network, height: u128): Rune;
    get reserved(): boolean;
    get commitment(): Buffer;
    static getReserved(block: u64, tx: u32): Rune;
    toString(): string;
    static fromString(s: string): Rune;
}
//# sourceMappingURL=rune.d.ts.map