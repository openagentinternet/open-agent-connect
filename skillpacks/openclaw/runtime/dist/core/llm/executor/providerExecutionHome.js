"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareProviderExecutionHome = prepareProviderExecutionHome;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const platformRegistry_1 = require("../../platform/platformRegistry");
const backend_1 = require("./backends/backend");
async function pathExists(target) {
    try {
        // lstat (not stat) so a dangling symlink still counts as seeded.
        await node_fs_1.promises.lstat(target);
        return true;
    }
    catch {
        return false;
    }
}
async function seedEntry(source, target, warnings) {
    let sourceStat;
    try {
        sourceStat = await node_fs_1.promises.stat(source);
    }
    catch {
        // Missing source entries are skipped: seeding is best-effort.
        return;
    }
    if (await pathExists(target))
        return;
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(target), { recursive: true });
    // Link (not copy) so credential refreshes and config edits in the real home
    // stay visible to managed executions and vice versa. Windows file symlinks
    // need privileges junctions do not have, so fall back to a plain copy.
    try {
        await node_fs_1.promises.symlink(source, target, sourceStat.isDirectory() ? 'junction' : 'file');
        return;
    }
    catch {
        // Fall through to copy.
    }
    try {
        await node_fs_1.promises.cp(source, target, { recursive: true, force: false });
    }
    catch (error) {
        warnings.push(`Failed to seed ${node_path_1.default.basename(target)} into the execution home: ${(0, backend_1.stringifyError)(error)}`);
    }
}
/**
 * Managed executions (bot private-chat replies, surf, dream, scheduled tasks,
 * service orders, ...) run unattended, but CLIs like Kimi Code record every
 * thread in a user-visible session history. For platforms that declare an
 * `executionHome` policy, redirect the CLI's state home to a persistent
 * per-machine directory under the executor root so those sessions never show
 * up in the user's platform UI. The home is seeded with links to the real
 * home's auth/config entries, so the CLI keeps working with the user's
 * credentials and settings.
 *
 * Returns null (no redirection) when:
 * - the provider declares no `executionHome` policy;
 * - the request resumes a caller-owned session (that session lives in the
 *   CLI's real home, so resuming must run against it);
 * - the request already sets the policy's env var (explicit caller override).
 */
async function prepareProviderExecutionHome(input) {
    if (input.resumeSessionId)
        return null;
    if (!(0, platformRegistry_1.isRuntimePlatformId)(input.provider))
        return null;
    const policy = (0, platformRegistry_1.getRuntimePlatformDefinition)(input.provider).runtime.executionHome;
    if (!policy)
        return null;
    const callerValue = input.requestEnv?.[policy.envName];
    if (typeof callerValue === 'string' && callerValue.trim())
        return null;
    const home = node_path_1.default.join(input.homesRoot, input.provider);
    const baseEnv = input.baseEnv ?? process.env;
    const configuredHome = baseEnv[policy.envName]?.trim();
    const sourceHome = configuredHome
        || (policy.defaultSourceHome ? node_path_1.default.join(node_os_1.default.homedir(), policy.defaultSourceHome) : '');
    await node_fs_1.promises.mkdir(home, { recursive: true });
    const warnings = [];
    if (sourceHome && node_path_1.default.resolve(sourceHome) !== node_path_1.default.resolve(home)) {
        for (const seedPath of policy.seedPaths ?? []) {
            await seedEntry(node_path_1.default.join(sourceHome, seedPath), node_path_1.default.join(home, seedPath), warnings);
        }
    }
    return { env: { [policy.envName]: home }, home, warnings };
}
