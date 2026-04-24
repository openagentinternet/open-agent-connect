import { Rune } from './rune';
export declare class SpacedRune {
    readonly rune: Rune;
    readonly spacers: number;
    constructor(rune: Rune, spacers: number);
    static fromString(s: string): SpacedRune;
    toString(): string;
}
//# sourceMappingURL=spacedrune.d.ts.map