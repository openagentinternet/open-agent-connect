export = KeyPair;
declare function KeyPair(ec: any, options: any): void;
declare class KeyPair {
    constructor(ec: any, options: any);
    ec: any;
    priv: any;
    pub: any;
    validate(): {
        result: boolean;
        reason: string;
    } | {
        result: boolean;
        reason: null;
    };
    getPublic(compact: any, enc: any): any;
    getPrivate(enc: any): any;
    _importPrivate(key: any, enc: any): void;
    _importPublic(key: any, enc: any): void;
    derive(pub: any): any;
    sign(msg: any, enc: any, options: any): any;
    verify(msg: any, signature: any): any;
    inspect(): string;
}
declare namespace KeyPair {
    function fromPublic(ec: any, pub: any, enc: any): KeyPair;
    function fromPrivate(ec: any, priv: any, enc: any): KeyPair;
}
