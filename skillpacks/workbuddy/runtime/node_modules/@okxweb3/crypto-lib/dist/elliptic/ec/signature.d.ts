export = Signature;
declare function Signature(curve: any, options: any, enc: any): Signature;
declare class Signature {
    constructor(curve: any, options: any, enc: any);
    r: any;
    s: any;
    recoveryParam: any;
    curve: any;
    byteLength: any;
    _importDER(data: any, enc: any): boolean;
    toDER(enc: any): any;
    toBytes(): any;
}
