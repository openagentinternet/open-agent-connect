import { u128 } from './integer';
export declare enum Flag {
    ETCHING = 0,
    TERMS = 1,
    TURBO = 2,
    CENOTAPH = 127
}
export declare namespace Flag {
    function mask(flag: Flag): u128;
    function take(flags: u128, flag: Flag): {
        set: boolean;
        flags: u128;
    };
    function set(flags: u128, flag: Flag): u128;
}
//# sourceMappingURL=flag.d.ts.map