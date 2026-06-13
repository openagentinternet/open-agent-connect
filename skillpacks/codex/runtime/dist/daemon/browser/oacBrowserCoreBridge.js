"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOacBrowserCoreHostAdapter = createOacBrowserCoreHostAdapter;
const agent_browser_host_contract_1 = require("@openagentinternet/agent-browser-host-contract");
const oacBrowserHostAdapter_1 = require("./oacBrowserHostAdapter");
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function followUpActionFromOac(result) {
    const resultData = record(result.data);
    const href = text(result.localUiUrl);
    const traceId = text(resultData.traceId);
    const route = href ? '' : traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
    if (!href && !route)
        return undefined;
    const action = {
        label: text(result.actionLabel) || 'Open details',
    };
    if (href)
        action.href = href;
    if (route)
        action.route = route;
    return action;
}
function dataRecord(value) {
    const next = record(value);
    return Object.keys(next).length ? next : undefined;
}
function failureCode(result) {
    return text(result.code) || text(result.state) || 'browser_oac_failure';
}
function failureMessage(result) {
    return text(result.message) || 'OAC Browser command failed.';
}
function toBrowserFailure(result) {
    const options = {};
    const action = followUpActionFromOac(result);
    const data = dataRecord(result.data);
    if (action)
        options.action = action;
    if (data)
        options.data = data;
    return (0, agent_browser_host_contract_1.browserFailure)(failureCode(result), failureMessage(result), options);
}
function toBrowserResult(result) {
    if (result.ok)
        return (0, agent_browser_host_contract_1.browserSuccess)(result.data);
    if (result.state === 'waiting') {
        const options = {};
        const pollAfterMs = result.pollAfterMs;
        const action = followUpActionFromOac(result);
        const data = dataRecord(result.data);
        if (typeof pollAfterMs === 'number')
            options.pollAfterMs = pollAfterMs;
        if (action)
            options.action = action;
        if (data)
            options.data = data;
        return (0, agent_browser_host_contract_1.browserWaiting)(failureCode(result), failureMessage(result), options);
    }
    if (result.state === 'manual_action_required') {
        const options = {};
        const action = followUpActionFromOac(result);
        const data = dataRecord(result.data);
        if (action)
            options.action = action;
        if (data)
            options.data = data;
        return (0, agent_browser_host_contract_1.browserManualActionRequired)(failureCode(result), failureMessage(result), options);
    }
    return toBrowserFailure(result);
}
function trustedActionData(value) {
    const data = record(value);
    const href = text(data.href);
    const route = text(data.route);
    const copiedText = text(data.copiedText);
    const message = text(data.message);
    const normalized = {
        ...(href ? { href } : {}),
        ...(route ? { route } : {}),
        ...(copiedText ? { copiedText } : {}),
        ...(message ? { message } : {}),
    };
    return Object.keys(normalized).length ? normalized : undefined;
}
function trustedActionResultFromOac(actionInput, result) {
    if (!result.ok) {
        return toBrowserResult(result);
    }
    const outer = record(result.data);
    const nested = record(outer.data);
    const normalizedData = trustedActionData(Object.keys(nested).length ? nested : outer);
    const response = {
        kind: actionInput.kind,
        handled: true,
    };
    if (normalizedData)
        response.data = normalizedData;
    return (0, agent_browser_host_contract_1.browserSuccess)(response);
}
function copyUriTrustedActionResult(actionInput) {
    const payload = record(actionInput.payload);
    const copiedText = text(payload.uri) || text(payload.currentUri) || text(actionInput.resourceUri);
    return (0, agent_browser_host_contract_1.browserSuccess)({
        kind: 'copy-uri',
        handled: true,
        data: {
            copiedText,
        },
    });
}
function isOacTrustedActionKind(kind) {
    return [
        'private-chat',
        'service-call',
        'open-settings',
        'login',
        'edit-profile',
        'configure-chat',
        'view-messages',
    ].includes(kind);
}
function toOacTrustedActionInput(input) {
    if (!isOacTrustedActionKind(input.kind)) {
        return null;
    }
    return {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        resourceUri: input.resourceUri,
        kind: input.kind,
        ...(input.payload ? { payload: input.payload } : {}),
    };
}
function createOacBrowserCoreHostAdapter(input) {
    const adapter = (0, oacBrowserHostAdapter_1.createOacBrowserHostAdapter)(input);
    return {
        async getRuntime(actorInput) {
            return toBrowserResult(await adapter.getRuntime(actorInput));
        },
        async resolveResource(resolveInput) {
            return toBrowserResult(await adapter.resolveResource(resolveInput));
        },
        async getSettings(actorInput) {
            return toBrowserResult(await adapter.getSettings(actorInput));
        },
        async updateSettings(settingsInput) {
            return toBrowserResult(await adapter.updateSettings(settingsInput));
        },
        async getCache(actorInput) {
            return toBrowserResult(await adapter.getCache(actorInput));
        },
        async clearCache(cacheInput) {
            return toBrowserResult(await adapter.clearCache({ ...cacheInput, scope: cacheInput.scope ?? 'all' }));
        },
        async runTrustedAction(actionInput) {
            if (actionInput.kind === 'copy-uri') {
                return copyUriTrustedActionResult(actionInput);
            }
            const oacActionInput = toOacTrustedActionInput(actionInput);
            if (!oacActionInput) {
                return (0, agent_browser_host_contract_1.browserFailure)('browser_action_not_supported', `Browser trusted action is not supported by OAC: ${actionInput.kind}`);
            }
            const result = await adapter.runTrustedAction(oacActionInput);
            return trustedActionResultFromOac(actionInput, result);
        },
    };
}
