export declare const canonJ: (obj: unknown) => Buffer;
export declare const sha256Hex: (data: Buffer | string) => string;
/** Inner hash: sha256 over the result with the top-level "hash" key removed (shallow delete). */
export declare const innerHash: (result: Record<string, unknown>) => string;
/** Outer hash: sha256 over the full result (with the inner hash embedded). */
export declare const outerHash: (result: Record<string, unknown>) => string;
