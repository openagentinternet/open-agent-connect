import { Option } from './monads';
import { Terms } from './terms';
import { Rune } from './rune';
import { u128, u32, u8 } from './integer';
export declare class Etching {
    readonly divisibility: Option<u8>;
    readonly rune: Option<Rune>;
    readonly spacers: Option<u32>;
    readonly terms: Option<Terms>;
    readonly premine: Option<u128>;
    readonly turbo: boolean;
    readonly symbol: Option<string>;
    constructor(divisibility: Option<u8>, rune: Option<Rune>, spacers: Option<u32>, symbol: Option<string>, terms: Option<Terms>, premine: Option<u128>, turbo: boolean);
    get supply(): Option<u128>;
}
//# sourceMappingURL=etching.d.ts.map