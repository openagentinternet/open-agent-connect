"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExportStore = createExportStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("./paths");
function sanitizeExportName(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('Export name is required');
    }
    return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-');
}
async function ensureExportLayout(paths) {
    await node_fs_1.promises.mkdir(paths.exportsRoot, { recursive: true });
}
async function writeExportFile(filePath, content) {
    await node_fs_1.promises.writeFile(filePath, content, 'utf8');
    return filePath;
}
function createExportStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    return {
        paths,
        async ensureLayout() {
            await ensureExportLayout(paths);
            return paths;
        },
        async writeJson(name, value) {
            await ensureExportLayout(paths);
            const filePath = node_path_1.default.join(paths.exportsRoot, `${sanitizeExportName(name)}.json`);
            return writeExportFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
        },
        async writeMarkdown(name, content) {
            await ensureExportLayout(paths);
            const filePath = node_path_1.default.join(paths.exportsRoot, `${sanitizeExportName(name)}.md`);
            return writeExportFile(filePath, content.endsWith('\n') ? content : `${content}\n`);
        }
    };
}
