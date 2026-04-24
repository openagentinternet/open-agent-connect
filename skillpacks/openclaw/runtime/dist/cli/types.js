"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCliRuntimeContext = createCliRuntimeContext;
const node_fs_1 = require("node:fs");
function createCliRuntimeContext(context = {}) {
    return {
        stdout: context.stdout ?? process.stdout,
        stderr: context.stderr ?? process.stderr,
        env: context.env ?? process.env,
        cwd: context.cwd ?? process.cwd(),
        readTextFile: context.readTextFile ?? ((filePath) => node_fs_1.promises.readFile(filePath, 'utf8')),
        dependencies: context.dependencies ?? {},
    };
}
