/// <reference types="node" />
export declare function toHex(data: Uint8Array | Buffer | number[], addPrefix?: boolean): string;
export declare function fromHex(data: string): Buffer;
export declare function stripHexPrefix(hex: string): string;
export declare function isHexPrefixed(hex: string): boolean;
