export declare const METAAPP_PUBLIC_BASE_URL = "https://openagentinternet.org/browser/metaapp";
export declare function pickMetaAppViewPinId(pinId: string, firstPinId?: unknown): string;
export declare function buildMetaAppUri(pinId: string, firstPinId?: unknown): string;
export declare function buildMetaAppBrowserPath(pinId: string, firstPinId?: unknown): string;
export declare function buildMetaAppCanonicalUrl(pinId: string, firstPinId?: unknown): string;
export declare function buildMetaAppShareBundle(pinId: string): {
    pinId: string;
    metawebUrl: string;
    suggestedBuzz: string;
};
export declare function buildMetaAppBuzzRequest(input: {
    pinId: string;
    message?: string;
}): {
    content: string;
    contentType: 'text/plain;utf-8';
    quotePin: string;
};
export declare function buildMetaAppCommentWrite(input: {
    pinId: string;
    comment: string;
}): {
    operation: 'create';
    path: '/protocols/paycomment';
    contentType: 'application/json';
    payload: string;
};
