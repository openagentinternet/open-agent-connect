import { Option } from './monads';
import { u64, u32, u128 } from './integer';
export declare class RuneId {
    readonly block: u64;
    readonly tx: u32;
    constructor(block: u64, tx: u32);
    static new(block: u64, tx: u32): Option<RuneId>;
    static sort(runeIds: RuneId[]): RuneId[];
    delta(next: RuneId): Option<[u128, u128]>;
    next(block: u128, tx: u128): Option<RuneId>;
    toString(): string;
    static fromString(s: string): RuneId;
}
//# sourceMappingURL=runeid.d.ts.map