"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBrowserPageDefinition = buildBrowserPageDefinition;
const browser_1 = require("@openagentinternet/agent-browser-ui/browser");
const OAC_BROWSER_SCRIPT_ADAPTERS = `
if (
  typeof endpointWithActor === 'function'
  && typeof browserSettingsEndpoint === 'function'
  && browserEndpoints
  && typeof browserEndpoints === 'object'
  && typeof browserEndpoints.settings === 'string'
) {
  browserSettingsEndpoint = function browserSettingsEndpoint() {
    return endpointWithActor(browserEndpoints.settings);
  };
}
`;
const BROWSER_INITIALIZATION_MARKER = `
if (document.readyState === 'loading') {`;
function injectOacBrowserScriptAdapters(script) {
    if (script.includes(BROWSER_INITIALIZATION_MARKER)) {
        return script.replace(BROWSER_INITIALIZATION_MARKER, `${OAC_BROWSER_SCRIPT_ADAPTERS}${BROWSER_INITIALIZATION_MARKER}`);
    }
    return `${script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`;
}
function buildBrowserPageDefinition() {
    const definition = (0, browser_1.buildBrowserPageDefinition)();
    return {
        ...definition,
        script: injectOacBrowserScriptAdapters(definition.script),
    };
}
