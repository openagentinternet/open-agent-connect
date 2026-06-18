"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBrowserPageDefinition = buildBrowserPageDefinition;
const browser_1 = require("@openagentinternet/agent-browser-ui/browser");
const OAC_BROWSER_SCRIPT_ADAPTERS = `
if (typeof endpointWithActor === 'function' && typeof browserEndpoints === 'object') {
  browserSettingsEndpoint = function browserSettingsEndpoint() {
    return endpointWithActor(browserEndpoints.settings);
  };
}
`;
function buildBrowserPageDefinition() {
    const definition = (0, browser_1.buildBrowserPageDefinition)();
    return {
        ...definition,
        script: `${definition.script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`,
    };
}
