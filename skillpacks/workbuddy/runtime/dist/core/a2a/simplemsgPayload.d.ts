export interface SimplemsgDisplayContent {
    content: string;
    contentType: string;
}
export declare function readSimplemsgPayloadContentType(value: unknown): string;
export declare function normalizeSimplemsgDisplayContent(input: {
    content: unknown;
    contentType?: unknown;
    payloadContentType?: unknown;
}): SimplemsgDisplayContent;
