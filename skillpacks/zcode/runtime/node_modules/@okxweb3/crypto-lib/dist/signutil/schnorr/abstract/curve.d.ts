/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
import { IField } from './modular';
export type AffinePoint<T> = {
    x: T;
    y: T;
} & {
    z?: never;
    t?: never;
};
export interface Group<T extends Group<T>> {
    double(): T;
    negate(): T;
    add(other: T): T;
    subtract(other: T): T;
    equals(other: T): boolean;
    multiply(scalar: bigint): T;
}
export type GroupConstructor<T> = {
    BASE: T;
    ZERO: T;
};
export type Mapper<T> = (i: T[]) => T[];
export declare function wNAF<T extends Group<T>>(c: GroupConstructor<T>, bits: number): {
    constTimeNegate: (condition: boolean, item: T) => T;
    unsafeLadder(elm: T, n: bigint): T;
    precomputeWindow(elm: T, W: number): Group<T>[];
    wNAF(W: number, precomputes: T[], n: bigint): {
        p: T;
        f: T;
    };
    wNAFCached(P: T, precomputesMap: Map<T, T[]>, n: bigint, transform: Mapper<T>): {
        p: T;
        f: T;
    };
};
export type BasicCurve<T> = {
    Fp: IField<T>;
    n: bigint;
    nBitLength?: number;
    nByteLength?: number;
    h: bigint;
    hEff?: bigint;
    Gx: T;
    Gy: T;
    allowInfinityPoint?: boolean;
};
export declare function validateBasic<FP, T>(curve: BasicCurve<FP> & T): Readonly<{
    readonly nBitLength: number;
    readonly nByteLength: number;
} & BasicCurve<FP> & T & {
    p: bigint;
}>;
