/// <reference types="node" />
export declare class SeekBuffer {
    private buffer;
    seekIndex: number;
    constructor(buffer: Buffer);
    readUInt8(): number | undefined;
    isFinished(): boolean;
}
//# sourceMappingURL=seekbuffer.d.ts.map