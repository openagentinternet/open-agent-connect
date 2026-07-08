export interface MetafileContentUrls {
    accelerateUrl: string;
    contentUrl: string;
    legacyContentUrl: string;
    previewUrl: string;
    downloadUrl: string;
}
export declare function buildMetafileContentUrls(pinId: string): MetafileContentUrls;
export declare function buildMetafileBrowserUrl(pinId: string): string;
