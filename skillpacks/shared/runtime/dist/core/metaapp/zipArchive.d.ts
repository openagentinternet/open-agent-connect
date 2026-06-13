export declare function writeMetaAppZipArchive(input: {
    sourceDir: string;
    outFile: string;
    exclude?: string[];
}): Promise<{
    filePath: string;
    bytes: number;
    sha256: string;
    entries: string[];
}>;
export declare function extractMetaAppZipArchive(input: {
    archive: Buffer;
    outDir: string;
    maxEntries?: number;
    maxUncompressedBytes?: number;
}): Promise<{
    outDir: string;
    entries: string[];
}>;
