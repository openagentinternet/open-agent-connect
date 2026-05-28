export declare function buildMetaAppCanonicalUrl(pinId: string): string;
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
