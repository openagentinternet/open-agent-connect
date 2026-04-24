export declare function createChainEvolutionReader(input: {
    chainApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
}): {
    fetchMetadataRows(): Promise<Array<{
        pinId: string;
        payload: unknown;
    }>>;
    readMetadataPinById(pinId: string): Promise<unknown | null>;
    readArtifactBodyByUri(uri: string): Promise<unknown>;
};
