export interface BotHomepageClientInput {
    baseUrl: string;
    fetch?: typeof fetch;
}
export type BotHomepageClientResult = {
    ok: true;
    data: Record<string, unknown>;
    fetchedAt: number;
    url: string;
} | {
    ok: false;
    code: string;
    message: string;
    status?: number;
    fetchedAt: number;
    url: string;
};
export interface BotHomepageClient {
    getByGlobalMetaId(globalMetaId: string): Promise<BotHomepageClientResult>;
}
export declare function createBotHomepageClient(input: BotHomepageClientInput): BotHomepageClient;
