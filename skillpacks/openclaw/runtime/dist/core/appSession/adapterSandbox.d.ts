/**
 * Game Adapter sandbox (docs/08 section 4, docs/09 section 6.6).
 *
 * The adapter runs inside a worker thread with memory resource limits; inside
 * the worker the adapter executes in a `node:vm` context that exposes only the
 * JS standard library. There is no `require`, `process`, `fetch`, `WebSocket`,
 * filesystem, wallet, host bridge, or other-group access in scope, and dynamic
 * code generation (`eval` / `new Function`) is disabled so the vm context
 * cannot reach host primordials. Execution time, output size and JSON
 * serializability are enforced by the host on every call.
 *
 * `adapterHash` is verified by the runtime before loading (see
 * `gamePackage.ts`); this module re-checks the hash of the code it receives so
 * a wrong bundle can never be executed.
 */
export declare function sandboxSha256Hex(value: string): string;
export interface SandboxedAdapter {
    /** Execute one named adapter export with JSON-serializable args. */
    call<T = unknown>(method: string, args?: unknown[]): Promise<T>;
    /** Check whether a named export exists without executing it. */
    hasExport(name: string): Promise<boolean>;
    dispose(): void;
}
export interface AdapterSandboxOptions {
    adapterCode: string;
    adapterHash: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
}
/**
 * Create a sandboxed adapter session. The adapter hash is verified against the
 * code before any execution; a mismatched bundle is rejected.
 */
export declare function createAdapterSandbox(options: AdapterSandboxOptions): SandboxedAdapter;
