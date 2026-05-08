export = BN;
/**
 * BN (Big Number) constructor.
 * Creates a new BN instance or returns the existing one if input is already a BN.
 * @param {number|BN} number - The number to initialize with (or existing BN instance)
 * @param {number|string} [base=10] - Numeric base (10, 16, etc) or endianness ('le', 'be')
 * @param {string} [endian='be'] - Endianness ('le' for little-endian, 'be' for big-endian)
 * @constructor
 */
declare function BN(number: number | BN, base?: number | string, endian?: string): number | BN;
declare class BN {
    /**
     * BN (Big Number) constructor.
     * Creates a new BN instance or returns the existing one if input is already a BN.
     * @param {number|BN} number - The number to initialize with (or existing BN instance)
     * @param {number|string} [base=10] - Numeric base (10, 16, etc) or endianness ('le', 'be')
     * @param {string} [endian='be'] - Endianness ('le' for little-endian, 'be' for big-endian)
     * @constructor
     */
    constructor(number: number | BN, base?: number | string, endian?: string);
    negative: number;
    words: any[] | number[];
    length: number;
    red: any;
    _init(number: any, base: any, endian: any): void | this;
    private _initNumber;
    _initArray(number: any, base: any, endian: any): this;
    _parseHex(number: any, start: any): void;
    _parseBase(number: any, base: any, start: any): void;
    copy(dest: any): void;
    clone(): BN;
    _expand(size: any): this;
    strip(): this;
    _normSign(): this;
    inspect(): string;
    toString(base: any, padding: any): string;
    toNumber(): any;
    toJSON(): string;
    toBuffer(endian: any, length: any): any;
    toArray(endian: any, length: any): any;
    toArrayLike(ArrayType: any, endian: any, length: any): any;
    _countBits(w: any): number;
    _zeroBits(w: any): number;
    bitLength(): number;
    zeroBits(): number;
    byteLength(): number;
    toTwos(width: any): any;
    fromTwos(width: any): any;
    isNeg(): boolean;
    neg(): BN;
    ineg(): this;
    iuor(num: any): this;
    ior(num: any): this;
    or(num: any): any;
    uor(num: any): any;
    iuand(num: any): this;
    iand(num: any): this;
    and(num: any): any;
    uand(num: any): any;
    iuxor(num: any): this;
    ixor(num: any): this;
    xor(num: any): any;
    uxor(num: any): any;
    inotn(width: any): this;
    notn(width: any): BN;
    setn(bit: any, val: any): this;
    iadd(num: any): any;
    add(num: any): any;
    isub(num: any): any;
    sub(num: any): any;
    mulTo(num: any, out: any): any;
    mul(num: any): any;
    mulf(num: any): any;
    imul(num: any): any;
    imuln(num: any): this;
    muln(num: any): BN;
    sqr(): any;
    isqr(): any;
    pow(num: any): BN;
    iushln(bits: any): this;
    ishln(bits: any): this;
    iushrn(bits: any, hint: any, extended: any): this;
    ishrn(bits: any, hint: any, extended: any): this;
    shln(bits: any): BN;
    ushln(bits: any): BN;
    shrn(bits: any): BN;
    ushrn(bits: any): BN;
    testn(bit: any): boolean;
    imaskn(bits: any): this;
    maskn(bits: any): BN;
    iaddn(num: any): any;
    _iaddn(num: any): this;
    isubn(num: any): any;
    addn(num: any): any;
    subn(num: any): any;
    iabs(): this;
    abs(): BN;
    _ishlnsubmul(num: any, mul: any, shift: any): this;
    _wordDiv(num: any, mode: any): {
        div: BN;
        mod: BN;
    };
    divmod(num: any, mode: any, positive: any): any;
    div(num: any): any;
    mod(num: any): any;
    umod(num: any): any;
    divRound(num: any): any;
    modn(num: any): number;
    idivn(num: any): this;
    divn(num: any): BN;
    egcd(p: any): {
        a: BN;
        b: BN;
        gcd: any;
    };
    _invmp(p: any): BN;
    gcd(num: any): any;
    invm(num: any): any;
    isEven(): boolean;
    isOdd(): boolean;
    andln(num: any): number;
    bincn(bit: any): this;
    isZero(): boolean;
    cmpn(num: any): number;
    cmp(num: any): number;
    ucmp(num: any): number;
    gtn(num: any): boolean;
    gt(num: any): boolean;
    gten(num: any): boolean;
    gte(num: any): boolean;
    ltn(num: any): boolean;
    lt(num: any): boolean;
    lten(num: any): boolean;
    lte(num: any): boolean;
    eqn(num: any): boolean;
    eq(num: any): boolean;
    toRed(ctx: any): any;
    fromRed(): any;
    _forceRed(ctx: any): this;
    forceRed(ctx: any): this;
    redAdd(num: any): any;
    redIAdd(num: any): any;
    redSub(num: any): any;
    redISub(num: any): any;
    redShl(num: any): any;
    redMul(num: any): any;
    redIMul(num: any): any;
    redSqr(): any;
    redISqr(): any;
    redSqrt(): any;
    redInvm(): any;
    redNeg(): any;
    redPow(num: any): any;
}
declare namespace BN {
    export { BN };
    export let wordSize: number;
    export function isBN(num: any): boolean;
    export function max(left: any, right: any): any;
    export function min(left: any, right: any): any;
    export function red(num: any): Red;
    export function _prime(name: any): any;
    export function mont(num: any): Mont;
}
declare function Red(m: any): void;
declare class Red {
    constructor(m: any);
    m: any;
    prime: any;
    _verify1(a: any): void;
    _verify2(a: any, b: any): void;
    imod(a: any): any;
    neg(a: any): any;
    add(a: any, b: any): any;
    iadd(a: any, b: any): any;
    sub(a: any, b: any): any;
    isub(a: any, b: any): any;
    shl(a: any, num: any): any;
    imul(a: any, b: any): any;
    mul(a: any, b: any): any;
    isqr(a: any): any;
    sqr(a: any): any;
    sqrt(a: any): any;
    invm(a: any): any;
    pow(a: any, num: any): any;
    convertTo(num: any): any;
    convertFrom(num: any): any;
}
declare function Mont(m: any): void;
declare class Mont {
    constructor(m: any);
    shift: any;
    r: BN;
    r2: any;
    rinv: BN;
    minv: any;
    convertTo(num: any): any;
    convertFrom(num: any): any;
    imul(a: any, b: any): any;
    mul(a: any, b: any): any;
    invm(a: any): any;
}
