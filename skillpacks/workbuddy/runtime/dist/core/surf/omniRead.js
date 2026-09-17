"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMNI_READ_TOOL_DESCRIPTION = exports.OMNI_READ_ACTIONS = exports.OMNI_READ_MAX_RESULT_CHARS = void 0;
exports.runOmniReadAction = runOmniReadAction;
const MANAPI_BASE = 'https://manapi.metaid.io';
const METAFILE_INDEXER_BASE = 'https://file.metaid.io/metafile-indexer';
const SHOWNOW_BASE = 'https://show.now/man';
const MAN_BASE = 'https://man.metaid.io';
/** Keep large indexer payloads from flooding the conversation. */
exports.OMNI_READ_MAX_RESULT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 10_000;
exports.OMNI_READ_ACTIONS = [
    'user_info',
    'search_users',
    'buzz_newest',
    'buzz_recommended',
    'buzz_hot',
    'buzz_search',
    'buzz_info',
    'notifications',
    'followers',
    'following',
    'pin',
    'pin_version',
    'pin_list',
    'metaid_list',
    'block_list',
    'mempool_list',
    'pins_by_path',
    'pins_by_metaid',
    'pins_by_address',
    'pin_content',
    'file_info',
    'file_latest',
    'files_by_creator',
    'files_by_metaid',
    'files_by_extension',
    'indexer_status',
    'indexer_stats',
    'global_counts',
];
/** Code-unit-safe truncation (surrogate pairs never split). */
function truncateUtf16Units(text, maxUnits) {
    if (text.length <= maxUnits)
        return text;
    let cut = maxUnits;
    const last = text.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff)
        cut -= 1;
    return text.slice(0, Math.max(0, cut));
}
function formatData(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (text.length > exports.OMNI_READ_MAX_RESULT_CHARS) {
        return `${truncateUtf16Units(text, exports.OMNI_READ_MAX_RESULT_CHARS)}\n...(truncated, narrow the query with cursor/size)`;
    }
    return text;
}
/**
 * Build an indexer URL. `path` is resolved against the base (which may carry a
 * path prefix like /metafile-indexer); query entries that are undefined or
 * empty are dropped, everything else is URL-encoded by URLSearchParams.
 */
function buildUrl(base, path, query) {
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === '')
                continue;
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function toInt(value) {
    const n = Number(value);
    return Number.isInteger(n) ? n : undefined;
}
async function fetchJson(url, deps) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchText(url, deps) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: { accept: 'text/plain, application/json' },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
    }
    finally {
        clearTimeout(timer);
    }
}
/** Execute one omni_read action. Never throws — failures return isError text. */
async function runOmniReadAction(rawArgs, deps = {}) {
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
    const action = asString(args.action);
    const fail = (message) => ({ text: message, isError: true });
    const ok = (text) => ({ text, isError: false });
    try {
        switch (action) {
            case 'user_info': {
                const candidates = [];
                if (asString(args.metaid))
                    candidates.push(['metaid', asString(args.metaid)]);
                if (asString(args.address))
                    candidates.push(['address', asString(args.address)]);
                if (asString(args.globalmetaid))
                    candidates.push(['globalmetaid', asString(args.globalmetaid)]);
                if (candidates.length !== 1) {
                    return fail('omni_read user_info requires exactly one of metaid, address, or globalmetaid.');
                }
                const [idType, idValue] = candidates[0];
                const encoded = encodeURIComponent(idValue);
                const primaryUrl = buildUrl(METAFILE_INDEXER_BASE, `api/v1/info/${idType}/${encoded}`);
                try {
                    return ok(formatData(await fetchJson(primaryUrl, deps)));
                }
                catch (primaryError) {
                    // The manapi fallback has no globalmetaid endpoint.
                    if (idType === 'globalmetaid')
                        throw primaryError;
                    const fallbackUrl = buildUrl(MANAPI_BASE, `api/info/${idType}/${encoded}`);
                    try {
                        return ok(formatData(await fetchJson(fallbackUrl, deps)));
                    }
                    catch (fallbackError) {
                        const pm = primaryError instanceof Error ? primaryError.message : String(primaryError);
                        const fm = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                        return fail(`omni_read user_info failed: metafile-indexer: ${pm}; manapi fallback: ${fm}`);
                    }
                }
            }
            case 'search_users': {
                const keyword = asString(args.keyword);
                if (!keyword)
                    return fail('omni_read search_users requires keyword.');
                const url = buildUrl(METAFILE_INDEXER_BASE, 'api/v1/info/search', {
                    keyword,
                    keytype: asString(args.keytype) || undefined,
                    limit: toInt(args.limit) ?? 10,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'buzz_newest': {
                const url = buildUrl(SHOWNOW_BASE, 'social/buzz/newest', {
                    lastId: asString(args.lastId) || undefined,
                    size: toInt(args.size),
                    metaid: asString(args.metaid) || undefined,
                    followed: toInt(args.followed),
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'buzz_recommended': {
                const url = buildUrl(SHOWNOW_BASE, 'social/buzz/recommended', {
                    lastId: asString(args.lastId) || undefined,
                    size: toInt(args.size),
                    userAddress: asString(args.userAddress) || undefined,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'buzz_hot': {
                const size = toInt(args.size);
                if (size !== undefined && size > 50) {
                    return fail('omni_read buzz_hot size must be <= 50.');
                }
                const url = buildUrl(SHOWNOW_BASE, 'social/buzz/hot', {
                    lastId: asString(args.lastId) || undefined,
                    size,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'buzz_search': {
                const key = asString(args.key);
                if (!key)
                    return fail('omni_read buzz_search requires key.');
                const url = buildUrl(SHOWNOW_BASE, 'social/buzz/search', {
                    lastId: asString(args.lastId) || undefined,
                    size: toInt(args.size),
                    key,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'buzz_info': {
                const pinId = asString(args.pinId);
                if (!pinId)
                    return fail('omni_read buzz_info requires pinId.');
                const url = buildUrl(SHOWNOW_BASE, 'social/buzz/info', { pinId });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'notifications': {
                const address = asString(args.address);
                if (!address)
                    return fail('omni_read notifications requires address.');
                // The "notifcation" spelling is the backend's; keep it verbatim.
                // Served by the MAN indexer: manapi answers this route with a
                // perpetual empty list for every address, while man.metaid.io
                // returns real notifications with the identical shape.
                const url = buildUrl(MAN_BASE, 'api/notifcation/list', {
                    address,
                    size: toInt(args.size),
                    lastId: asString(args.lastId) || undefined,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'followers':
            case 'following': {
                const metaid = asString(args.metaid);
                if (!metaid)
                    return fail(`omni_read ${action} requires metaid.`);
                const endpoint = action === 'followers' ? 'followerList' : 'followingList';
                const url = buildUrl(MAN_BASE, `api/metaid/${endpoint}/${encodeURIComponent(metaid)}`, {
                    cursor: asString(args.cursor) || '0',
                    size: toInt(args.size),
                    followDetail: 'true',
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pin': {
                const pinId = asString(args.pinId);
                if (!pinId)
                    return fail('omni_read pin requires pinId.');
                const url = buildUrl(MANAPI_BASE, `api/pin/${encodeURIComponent(pinId)}`);
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pin_version': {
                const pinId = asString(args.pinId);
                if (!pinId)
                    return fail('omni_read pin_version requires pinId.');
                const ver = toInt(args.ver);
                if (ver === undefined || ver < 0) {
                    return fail('omni_read pin_version requires ver (int, 0 = initial version).');
                }
                const url = buildUrl(MANAPI_BASE, `api/pin/ver/${encodeURIComponent(pinId)}/${ver}`);
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pin_list':
            case 'metaid_list':
            case 'block_list':
            case 'mempool_list': {
                const segment = action.replace('_list', '');
                const url = buildUrl(MANAPI_BASE, `api/${segment}/list`, {
                    page: toInt(args.page),
                    size: toInt(args.size),
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pins_by_path': {
                const path = asString(args.path);
                if (!path)
                    return fail('omni_read pins_by_path requires path (e.g. /protocols/simplebuzz).');
                const size = toInt(args.size);
                if (size !== undefined && (size < 1 || size > 100)) {
                    return fail('omni_read pins_by_path size must be between 1 and 100.');
                }
                const url = buildUrl(MANAPI_BASE, 'api/pin/path/list', {
                    path,
                    size,
                    cursor: asString(args.cursor) || undefined,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pins_by_metaid': {
                const metaid = asString(args.metaid);
                if (!metaid)
                    return fail('omni_read pins_by_metaid requires metaid.');
                const url = buildUrl(MANAPI_BASE, `api/metaid/pin/list/${encodeURIComponent(metaid)}`, {
                    path: asString(args.path) || undefined,
                    size: toInt(args.size),
                    cursor: asString(args.cursor) || undefined,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pins_by_address': {
                const address = asString(args.address);
                if (!address)
                    return fail('omni_read pins_by_address requires address.');
                const path = asString(args.path);
                if (!path)
                    return fail('omni_read pins_by_address requires path.');
                const url = buildUrl(MANAPI_BASE, `api/address/pin/list/${encodeURIComponent(address)}`, {
                    path,
                    size: toInt(args.size),
                    cursor: asString(args.cursor) || undefined,
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'pin_content': {
                const pinId = asString(args.pinId);
                if (!pinId)
                    return fail('omni_read pin_content requires pinId.');
                const url = buildUrl(MANAPI_BASE, `content/${encodeURIComponent(pinId)}`);
                const body = await fetchText(url, deps);
                const text = body.length > exports.OMNI_READ_MAX_RESULT_CHARS
                    ? `${truncateUtf16Units(body, exports.OMNI_READ_MAX_RESULT_CHARS)}\n...(truncated, narrow the query with cursor/size)`
                    : body;
                return ok(text);
            }
            case 'file_info': {
                const pinId = asString(args.pinId);
                if (!pinId)
                    return fail('omni_read file_info requires pinId.');
                const url = buildUrl(METAFILE_INDEXER_BASE, `api/v1/files/${encodeURIComponent(pinId)}`);
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'file_latest': {
                const firstPinId = asString(args.firstPinId);
                if (!firstPinId)
                    return fail('omni_read file_latest requires firstPinId.');
                const url = buildUrl(METAFILE_INDEXER_BASE, `api/v1/files/latest/${encodeURIComponent(firstPinId)}`);
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'files_by_creator': {
                const address = asString(args.address);
                if (!address)
                    return fail('omni_read files_by_creator requires address.');
                const url = buildUrl(METAFILE_INDEXER_BASE, `api/v1/files/creator/${encodeURIComponent(address)}`, {
                    cursor: asString(args.cursor) || undefined,
                    size: toInt(args.size),
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'files_by_metaid': {
                const metaid = asString(args.metaid);
                if (!metaid)
                    return fail('omni_read files_by_metaid requires metaid.');
                const url = buildUrl(METAFILE_INDEXER_BASE, `api/v1/files/metaid/${encodeURIComponent(metaid)}`, {
                    cursor: asString(args.cursor) || undefined,
                    size: toInt(args.size),
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'files_by_extension': {
                const extension = asString(args.extension);
                if (!extension)
                    return fail('omni_read files_by_extension requires extension (e.g. .jpg).');
                const metaid = asString(args.metaid);
                const path = metaid
                    ? `api/v1/files/metaid/${encodeURIComponent(metaid)}/extension`
                    : 'api/v1/files/extension';
                const url = buildUrl(METAFILE_INDEXER_BASE, path, {
                    extension,
                    timestamp: asString(args.timestamp) || undefined,
                    size: toInt(args.size),
                });
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'indexer_status': {
                const url = buildUrl(METAFILE_INDEXER_BASE, 'api/v1/status');
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'indexer_stats': {
                const url = buildUrl(METAFILE_INDEXER_BASE, 'api/v1/stats');
                return ok(formatData(await fetchJson(url, deps)));
            }
            case 'global_counts': {
                const url = buildUrl(MANAPI_BASE, 'debug/count');
                return ok(formatData(await fetchJson(url, deps)));
            }
            default:
                return fail(`omni_read does not support action "${String(action)}".`);
        }
    }
    catch (error) {
        return fail(`omni_read ${String(action)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** The tool description (surf sessions and future hosts reuse it verbatim). */
exports.OMNI_READ_TOOL_DESCRIPTION = [
    'Read-only raw MetaID/MetaWeb indexer queries over HTTP.',
    'Users: action "user_info" with exactly one of metaid | address | globalmetaid (metafile-indexer first, falls back to manapi for metaid/address); "search_users" with keyword plus optional keytype metaid|name and limit (default 10).',
    'Social/buzz: "buzz_newest" (lastId, size, metaid, followed 0/1), "buzz_recommended" (lastId, size, userAddress), "buzz_hot" (lastId, size <= 50), "buzz_search" (key required), "buzz_info" (pinId required); "notifications" (address required, size, lastId; lastId returns entries NEWER than that id, not a page-down cursor; answers to YOUR questions are NOT included — poll get_question_answers per own question pin); "followers"/"following" (metaid required, cursor default 0, size).',
    'Pins: "pin" (pinId), "pin_version" (pinId + ver int, 0 = initial), "pin_list"/"metaid_list"/"block_list"/"mempool_list" (page, size), "pins_by_path" (path required, e.g. /protocols/simplebuzz, size 1-100, cursor), "pins_by_metaid" (metaid required, optional path), "pins_by_address" (address + path required), "pin_content" (pinId, returns the raw content body).',
    'Metafile index: "file_info" (pinId), "file_latest" (firstPinId), "files_by_creator" (address), "files_by_metaid" (metaid), "files_by_extension" (extension like .jpg required, optional metaid/timestamp/size); plus "indexer_status", "indexer_stats", "global_counts".',
    'Paged actions echo lastId/cursor in the response; pass it back for the next page. All parameters are URL-encoded automatically.',
    'Prefer search_metaweb for knowledge search and search_social_posts for full-text social search when those fit; omni_read is the low-level fallback returning raw indexer JSON. It never writes on-chain.',
].join(' ');
