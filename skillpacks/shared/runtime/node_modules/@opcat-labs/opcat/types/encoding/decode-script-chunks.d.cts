export = decodeScriptChunks;
declare function decodeScriptChunks(script: any): ({
    opcodenum: any;
    len: number;
    buf?: undefined;
} | {
    opcodenum: any;
    buf: any;
    len: number;
} | {
    opcodenum: any;
    len?: undefined;
    buf?: undefined;
})[];
