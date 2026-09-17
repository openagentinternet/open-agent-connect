/**
 * omni_read — read-only raw MetaID/MetaWeb indexer queries over HTTP. OAC
 * port of the IDBots omniReaderAgentTools tool body (endpoint shapes,
 * including the `/api/notifcation/list` typo, are unchanged; endpoints and
 * params are sourced from the retired metabot-omni-reader skill's
 * references/00-user.md .. 03-file.md).
 *
 * The tool registration (schema, description) lives with the surf turn loop;
 * this module is the executor: `runOmniReadAction` performs one action and
 * returns `{text, isError}` for direct use as a tool result.
 */
/** Keep large indexer payloads from flooding the conversation. */
export declare const OMNI_READ_MAX_RESULT_CHARS = 20000;
export declare const OMNI_READ_ACTIONS: readonly ["user_info", "search_users", "buzz_newest", "buzz_recommended", "buzz_hot", "buzz_search", "buzz_info", "notifications", "followers", "following", "pin", "pin_version", "pin_list", "metaid_list", "block_list", "mempool_list", "pins_by_path", "pins_by_metaid", "pins_by_address", "pin_content", "file_info", "file_latest", "files_by_creator", "files_by_metaid", "files_by_extension", "indexer_status", "indexer_stats", "global_counts"];
export type OmniReadAction = (typeof OMNI_READ_ACTIONS)[number];
export type OmniReadArgs = {
    action: OmniReadAction;
    metaid?: string;
    address?: string;
    globalmetaid?: string;
    keyword?: string;
    keytype?: 'metaid' | 'name';
    limit?: number;
    lastId?: string;
    size?: number;
    followed?: number;
    userAddress?: string;
    key?: string;
    pinId?: string;
    ver?: number;
    page?: number;
    path?: string;
    cursor?: string;
    firstPinId?: string;
    extension?: string;
    timestamp?: string;
};
export type OmniReadResult = {
    text: string;
    isError: boolean;
};
export type OmniReadDeps = {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** Execute one omni_read action. Never throws — failures return isError text. */
export declare function runOmniReadAction(rawArgs: unknown, deps?: OmniReadDeps): Promise<OmniReadResult>;
/** The tool description (surf sessions and future hosts reuse it verbatim). */
export declare const OMNI_READ_TOOL_DESCRIPTION: string;
