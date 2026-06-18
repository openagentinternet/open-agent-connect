"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBrowserResource = resolveBrowserResource;
const commandResult_1 = require("../contracts/commandResult");
const agent_browser_core_1 = require("@openagentinternet/agent-browser-core");
const botHomepageClient_1 = require("./botHomepageClient");
const botPageResolver_1 = require("./botPageResolver");
const metaAppResolver_1 = require("./metaAppResolver");
const uri_1 = require("./uri");
function fromBrowserCommandResult(result) {
    if (result.ok) {
        return (0, commandResult_1.commandSuccess)(result.data);
    }
    return (0, commandResult_1.commandFailed)(result.code, result.message, result.data ? { data: result.data } : undefined);
}
async function resolveBrowserResource(input) {
    let parsed;
    try {
        parsed = (0, uri_1.parseBrowserUri)(input.uri);
    }
    catch (error) {
        return (0, commandResult_1.commandFailed)('invalid_browser_uri', error instanceof Error ? error.message : String(error));
    }
    if (parsed.scheme === 'metaid') {
        if (!input.config.metasoP2PBaseUrl.trim()) {
            return (0, commandResult_1.commandFailed)('browser_config_missing', 'Browser metaso-p2p base URL is not configured.');
        }
        const client = (0, botHomepageClient_1.createBotHomepageClient)({
            baseUrl: input.config.metasoP2PBaseUrl,
            fetch: input.fetch,
        });
        const homepage = await client.getByGlobalMetaId(parsed.id);
        if (!homepage.ok) {
            if (homepage.code === 'bot_homepage_not_found') {
                return (0, commandResult_1.commandFailed)('browser_resource_not_found', homepage.message);
            }
            return (0, commandResult_1.commandFailed)('browser_resolve_failed', homepage.message);
        }
        return (0, commandResult_1.commandSuccess)((0, botPageResolver_1.buildBotPageResolveResult)({
            uri: parsed.originalUri,
            normalizedUri: parsed.normalizedUri,
            homepage: homepage.data,
            resolverUrl: homepage.url,
            templateId: input.config.botHomepageTemplateId,
        }));
    }
    if (parsed.scheme === 'map') {
        return fromBrowserCommandResult(await (0, agent_browser_core_1.resolveMapUriToResource)({
            uri: parsed.originalUri,
            fetch: input.fetch,
            manApiBaseUrl: input.config.manApiBaseUrl,
        }));
    }
    if (parsed.scheme === 'metafile') {
        return fromBrowserCommandResult(await (0, agent_browser_core_1.resolveMetafilePinToResource)({
            uri: parsed.originalUri,
            id: parsed.id,
            fetch: input.fetch,
            manApiBaseUrl: input.config.manApiBaseUrl,
            metafileContentBaseUrl: input.config.metafileContentBaseUrl,
        }));
    }
    let record;
    if (input.metaAppResolve) {
        const resolved = await input.metaAppResolve(parsed.id);
        if (!resolved.ok) {
            return resolved;
        }
        record = resolved.data;
    }
    else if (input.metaAppLookup) {
        record = await input.metaAppLookup(parsed.id);
    }
    else {
        record = null;
    }
    if (!record) {
        return (0, commandResult_1.commandFailed)('browser_resource_not_found', 'Resource not found.');
    }
    return (0, commandResult_1.commandSuccess)((0, metaAppResolver_1.buildMetaAppResolveResult)({
        uri: parsed.originalUri,
        normalizedUri: parsed.normalizedUri,
        record,
        fetchedAt: Date.now(),
    }));
}
