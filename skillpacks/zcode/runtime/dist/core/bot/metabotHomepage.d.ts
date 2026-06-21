export type MetabotHomepageRenderer = 'auto' | 'metaapp';
export interface MetabotHomepage {
    uri: string;
    renderer: MetabotHomepageRenderer;
    contentType: string;
}
export declare function normalizeMetabotHomepage(value: unknown): MetabotHomepage | null | undefined;
export declare function sameMetabotHomepage(left: MetabotHomepage | null | undefined, right: MetabotHomepage | null | undefined): boolean;
export declare function readMetabotHomepage(filePath: string): Promise<MetabotHomepage | undefined>;
export declare function writeMetabotHomepage(filePath: string, homepage: MetabotHomepage): Promise<void>;
export declare function serializeMetabotHomepagePayload(homepage: MetabotHomepage): string;
