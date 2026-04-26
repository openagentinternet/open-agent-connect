"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChatViewerPageDefinition = buildChatViewerPageDefinition;
const viewModel_1 = require("./viewModel");
function buildChatViewerPageDefinition() {
    return {
        page: 'chat-viewer',
        title: 'Private Chat Viewer',
        eyebrow: 'Private Chat',
        heading: 'Private Chat Viewer',
        description: 'Read-only local view of one decrypted MetaBot private conversation.',
        panels: [],
        script: (0, viewModel_1.buildChatViewerScript)(),
    };
}
