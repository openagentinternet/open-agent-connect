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
