export = ABI;
declare function ABI(): void;
declare namespace ABI {
    function eventID(name: any, types: any): Buffer;
    function methodID(name: any, types: any): Buffer;
    function rawEncode(types: any, values: any): Buffer;
    function rawDecode(types: any, data: any): any[];
    function simpleEncode(method: any, ...args: any[]): Buffer;
    function simpleDecode(method: any, data: any): any[];
    function stringify(types: any, values: any): any[];
    function solidityHexValue(type: any, value: any, bitsize: any): any;
    function solidityPack(types: any, values: any): Buffer;
    function soliditySHA3(types: any, values: any): Buffer;
    function soliditySHA256(types: any, values: any): Uint8Array;
    function solidityRIPEMD160(types: any, values: any): Uint8Array;
    function fromSerpent(sig: any): string[];
    function toSerpent(types: any): string;
}
