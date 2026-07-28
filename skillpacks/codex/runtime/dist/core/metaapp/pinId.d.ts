export declare function normalizeMetaAppPinId(value: unknown): string | null;
export declare function assertMetaAppPinId(value: unknown, label?: string): string;
/** Accepts a bare pinId or a metaapp://<pinId> URI and returns the bare pinId. */
export declare function normalizeMetaAppPinIdOrUri(value: unknown): string | null;
