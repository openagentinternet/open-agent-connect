"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRegistryBackendFactories = createRegistryBackendFactories;
const platformRegistry_1 = require("../../../platform/platformRegistry");
const claude_1 = require("./claude");
const codex_1 = require("./codex");
const copilot_1 = require("./copilot");
const cursor_1 = require("./cursor");
const gemini_1 = require("./gemini");
const hermes_1 = require("./hermes");
const kimi_1 = require("./kimi");
const kiro_1 = require("./kiro");
const openclaw_1 = require("./openclaw");
const opencode_1 = require("./opencode");
const pi_1 = require("./pi");
const FACTORY_BY_EXECUTOR_KIND = {
    'claude-stream-json': claude_1.claudeBackendFactory,
    'codex-app-server': codex_1.codexBackendFactory,
    'copilot-json': copilot_1.copilotBackendFactory,
    'opencode-json': opencode_1.opencodeBackendFactory,
    'openclaw-json': openclaw_1.openClawBackendFactory,
    'acp-hermes': hermes_1.hermesBackendFactory,
    'gemini-stream-json': gemini_1.geminiBackendFactory,
    'pi-json': pi_1.piBackendFactory,
    'cursor-stream-json': cursor_1.cursorBackendFactory,
    'acp-kimi': kimi_1.kimiBackendFactory,
    'acp-kiro': kiro_1.kiroBackendFactory,
};
function createRegistryBackendFactories() {
    return Object.fromEntries((0, platformRegistry_1.getRuntimePlatforms)().map((platform) => [
        platform.id,
        FACTORY_BY_EXECUTOR_KIND[platform.executor.kind],
    ]));
}
