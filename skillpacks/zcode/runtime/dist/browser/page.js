"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBrowserPageHtml = renderBrowserPageHtml;
const browser_1 = require("@openagentinternet/agent-browser-ui/browser");
const app_1 = require("./app");
function renderBrowserPageHtml(definition, _languagePreference) {
    // Default to OAC's own page definition (not ABC's vanilla one): it injects the
    // OAC bridge adapters via buildBrowserPageDefinition(). Callers that pass an
    // explicit definition (e.g. tests) keep full control.
    return (0, browser_1.renderBrowserPageHtml)(definition ?? (0, app_1.buildBrowserPageDefinition)());
}
