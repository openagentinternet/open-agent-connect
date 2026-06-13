"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROWSER_BASE_URL_KEYS = void 0;
exports.createBrowserSettingsSnapshot = createBrowserSettingsSnapshot;
exports.applyBrowserSettingsUpdate = applyBrowserSettingsUpdate;
const configTypes_1 = require("../config/configTypes");
const botHomepageTemplates_1 = require("./botHomepageTemplates");
const config_1 = require("./config");
exports.BROWSER_BASE_URL_KEYS = [
    'metasoP2PBaseUrl',
    'metafileContentBaseUrl',
    'manApiBaseUrl',
    'blockExplorerBaseUrl',
    'walletApiBaseUrl',
];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeBaseUrl(value) {
    return normalizeText(value).replace(/\/+$/, '');
}
function validateHttpBaseUrl(key, value) {
    if (!value) {
        return value;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('unsupported_protocol');
        }
        return parsed.href.replace(/\/+$/, '');
    }
    catch {
        throw new Error(`browser.${key} must be an http(s) base URL.`);
    }
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function createBrowserSettingsSnapshot(input) {
    const defaults = (0, configTypes_1.createDefaultConfig)().browser;
    return {
        browser: { ...input.config.browser },
        effectiveBrowser: { ...(0, config_1.resolveBrowserConfig)(input.config, input.env ?? process.env) },
        defaults: { ...defaults },
        ...(input.configPath ? { configPath: input.configPath } : {}),
    };
}
function applyBrowserSettingsUpdate(current, rawBrowserInput) {
    const browserInput = readObject(rawBrowserInput);
    const defaults = (0, configTypes_1.createDefaultConfig)().browser;
    const nextBrowser = {
        ...current.browser,
    };
    for (const key of exports.BROWSER_BASE_URL_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(browserInput, key)) {
            continue;
        }
        const normalized = validateHttpBaseUrl(key, normalizeBaseUrl(browserInput[key]));
        if (!normalized) {
            const fallback = defaults[key];
            if (fallback) {
                nextBrowser[key] = fallback;
            }
            else {
                delete nextBrowser[key];
            }
        }
        else {
            nextBrowser[key] = normalized;
        }
    }
    if (Object.prototype.hasOwnProperty.call(browserInput, 'botHomepageTemplateId')) {
        const templateId = normalizeText(browserInput.botHomepageTemplateId);
        if (!(0, botHomepageTemplates_1.isBotHomepageTemplateId)(templateId)) {
            throw new Error(`browser.botHomepageTemplateId must be one of ${botHomepageTemplates_1.BOT_HOMEPAGE_TEMPLATES.map((template) => template.id).join(', ')}.`);
        }
        nextBrowser.botHomepageTemplateId = templateId;
    }
    return {
        ...current,
        browser: nextBrowser,
    };
}
