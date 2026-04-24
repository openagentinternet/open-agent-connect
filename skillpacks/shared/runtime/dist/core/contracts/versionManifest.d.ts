export type VersionManifest = {
    schemaVersion: 1;
    packageName: string;
    packageVersion: string;
    compatibility: {
        coreRange: string;
        adapterRange: string;
    };
};
export type RuntimeVersions = {
    coreVersion: string;
    adapterVersion: string;
};
export declare const createVersionManifest: (packageName: string, packageVersion: string, coreRange: string, adapterRange: string) => VersionManifest;
export declare const assertVersionManifestCompatibility: (_manifest: VersionManifest, _runtime: RuntimeVersions) => void;
