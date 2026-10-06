"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOwnerOnboardingStatePath = resolveOwnerOnboardingStatePath;
exports.normalizeOwnerOnboardingState = normalizeOwnerOnboardingState;
exports.readOwnerOnboardingState = readOwnerOnboardingState;
exports.markOwnerOnboardingOptedOut = markOwnerOnboardingOptedOut;
exports.resetOwnerOnboardingAfterManualIdentity = resetOwnerOnboardingAfterManualIdentity;
exports.readOwnerOnboardingStatus = readOwnerOnboardingStatus;
exports.createOwnerOnboardingRunner = createOwnerOnboardingRunner;
// Zero-touch owner onboarding: every install ends up with a usable "user
// account" without the user knowing what a wallet is. The pipeline mirrors
// the IDBots first-launch provisioning: create the machine-wide owner
// identity (default name "User"), get-or-create the traffic account, claim
// the one-time free traffic grant, request the MVC gas subsidy for the owner
// address, and publish the owner /info/name pin through the traffic sponsor
// (falling back to the subsidy-funded wallet). Progress is journaled to
// `~/.metabot/owner/onboarding.json` (storage-layout v2 amendment) so both
// UIs can show "preparing account / granted" and a later daemon start
// retries only the steps that have not converged. Deleting the owner
// identity tombstones the state (`status: "opted_out"`) so auto-provisioning
// never resurrects an identity the user deliberately removed.
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const requestMvcGasSubsidy_1 = require("../subsidy/requestMvcGasSubsidy");
const trafficAccountService_1 = require("../traffic/trafficAccountService");
const ownerIdentity_1 = require("./ownerIdentity");
const ownerProfilePublish_1 = require("./ownerProfilePublish");
const ownerSigner_1 = require("./ownerSigner");
const ONBOARDING_FILE_MODE = 0o600;
function resolveOwnerOnboardingStatePath(systemHomeDir) {
    return node_path_1.default.join(node_path_1.default.resolve(systemHomeDir), '.metabot', 'owner', 'onboarding.json');
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function readStep(value, allowed, fallback) {
    const text = typeof value === 'string' ? value.trim() : '';
    return allowed.includes(text) ? text : fallback;
}
function normalizeOwnerOnboardingState(value) {
    const record = isRecord(value) ? value : null;
    if (!record)
        return null;
    const steps = isRecord(record.steps) ? record.steps : {};
    const now = new Date().toISOString();
    return {
        version: 1,
        status: readStep(record.status, ['pending', 'ready', 'opted_out'], 'pending'),
        attempts: Number.isFinite(Number(record.attempts)) ? Math.max(0, Math.trunc(Number(record.attempts))) : 0,
        lastAttemptAt: typeof record.lastAttemptAt === 'string' && record.lastAttemptAt ? record.lastAttemptAt : null,
        lastError: typeof record.lastError === 'string' && record.lastError ? record.lastError : null,
        steps: {
            identity: readStep(steps.identity, ['pending', 'done', 'failed'], 'pending'),
            trafficAccount: readStep(steps.trafficAccount, ['pending', 'done', 'failed'], 'pending'),
            freeGrant: readStep(steps.freeGrant, ['pending', 'claimed', 'already_claimed', 'disabled', 'failed'], 'pending'),
            subsidy: readStep(steps.subsidy, ['pending', 'done', 'failed', 'skipped'], 'pending'),
            namePin: readStep(steps.namePin, ['pending', 'done', 'failed', 'skipped'], 'pending'),
        },
        freeGrantBytes: Number.isFinite(Number(record.freeGrantBytes)) && Number(record.freeGrantBytes) > 0
            ? Math.trunc(Number(record.freeGrantBytes))
            : null,
        createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : now,
        updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : now,
    };
}
function createFreshOnboardingState() {
    const now = new Date().toISOString();
    return {
        version: 1,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        steps: {
            identity: 'pending',
            trafficAccount: 'pending',
            freeGrant: 'pending',
            subsidy: 'pending',
            namePin: 'pending',
        },
        freeGrantBytes: null,
        createdAt: now,
        updatedAt: now,
    };
}
async function applyOnboardingFileMode(filePath) {
    if (process.platform === 'win32')
        return;
    try {
        await node_fs_1.promises.chmod(filePath, ONBOARDING_FILE_MODE);
    }
    catch (error) {
        const code = error.code;
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL')
            return;
        throw error;
    }
}
async function writeOnboardingState(systemHomeDir, state) {
    const filePath = resolveOwnerOnboardingStatePath(systemHomeDir);
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
            encoding: 'utf8',
            mode: ONBOARDING_FILE_MODE,
        });
        await node_fs_1.promises.rename(tempPath, filePath);
        await applyOnboardingFileMode(filePath);
    }
    finally {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => { });
    }
}
/** Current onboarding state; null when this machine has never onboarded. */
async function readOwnerOnboardingState(systemHomeDir) {
    try {
        const raw = await node_fs_1.promises.readFile(resolveOwnerOnboardingStatePath(systemHomeDir), 'utf8');
        return normalizeOwnerOnboardingState(JSON.parse(raw));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
/** Tombstone after `user delete`: auto-provisioning must stay off for good. */
async function markOwnerOnboardingOptedOut(systemHomeDir) {
    const current = (await readOwnerOnboardingState(systemHomeDir)) ?? createFreshOnboardingState();
    const next = {
        ...current,
        status: 'opted_out',
        lastError: null,
        updatedAt: new Date().toISOString(),
    };
    await writeOnboardingState(systemHomeDir, next);
    return next;
}
/**
 * Re-arm onboarding after an explicit `user create`/`user import`: the user
 * has opted back in, so the account/grant steps may still converge on the
 * next daemon start. The identity step is already satisfied.
 */
async function resetOwnerOnboardingAfterManualIdentity(systemHomeDir) {
    const next = {
        ...createFreshOnboardingState(),
        steps: {
            identity: 'done',
            trafficAccount: 'pending',
            freeGrant: 'pending',
            subsidy: 'pending',
            namePin: 'pending',
        },
    };
    await writeOnboardingState(systemHomeDir, next);
    return next;
}
/** Read-only snapshot for the /api/user/onboarding status verb and CLI. */
async function readOwnerOnboardingStatus(systemHomeDir) {
    const [onboarding, identity] = await Promise.all([
        readOwnerOnboardingState(systemHomeDir),
        (0, ownerIdentity_1.readOwnerIdentity)(systemHomeDir).catch(() => null),
    ]);
    return { onboarding, identityPresent: identity !== null };
}
function isTerminalGrantState(state) {
    return state === 'claimed' || state === 'already_claimed' || state === 'disabled';
}
function computeOnboardingStatus(state) {
    if (state.status === 'opted_out')
        return 'opted_out';
    if (state.steps.identity !== 'done' || state.steps.trafficAccount !== 'done')
        return 'pending';
    return isTerminalGrantState(state.steps.freeGrant) ? 'ready' : 'pending';
}
function classifyGrantFailure(error) {
    if (error instanceof trafficAccountService_1.TrafficApiError) {
        if (error.errorCode === 'ALREADY_CLAIMED')
            return 'already_claimed';
        if (error.errorCode === 'CAMPAIGN_DISABLED' || error.featureUnavailable)
            return 'disabled';
    }
    return 'failed';
}
/**
 * Idempotent onboarding pipeline. Each daemon start (and the explicit
 * /api/user/onboarding run verb) advances every non-terminal step; failures
 * are recorded and retried on the next run. Concurrent callers share one
 * in-flight execution.
 */
function createOwnerOnboardingRunner(deps) {
    const log = deps.log ?? (() => { });
    let inFlight = null;
    async function execute() {
        const current = (await readOwnerOnboardingState(deps.systemHomeDir)) ?? createFreshOnboardingState();
        if (current.status === 'opted_out') {
            log('skipped: onboarding is opted out on this machine');
            return current;
        }
        const state = {
            ...current,
            steps: { ...current.steps },
            attempts: current.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: null,
        };
        const fail = (step, error) => {
            state.steps[step] = 'failed';
            state.lastError = error instanceof Error ? error.message : String(error);
        };
        // 1. Owner identity (local, cheap, prerequisite for everything else).
        let owner = await (0, ownerIdentity_1.readOwnerIdentity)(deps.systemHomeDir);
        if (!owner) {
            try {
                owner = await (0, ownerIdentity_1.ensureOwnerIdentity)(deps.systemHomeDir, { name: ownerIdentity_1.DEFAULT_OWNER_NAME });
                log(`created owner identity ${owner.globalMetaId}`);
            }
            catch (error) {
                fail('identity', error);
                state.status = computeOnboardingStatus(state);
                await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
                return { ...state };
            }
        }
        state.steps.identity = 'done';
        // 2. Traffic account (server-side get-or-create; also binds owner + bots).
        if (state.steps.trafficAccount !== 'done') {
            try {
                const account = await deps.trafficAccountService.ensureTrafficAccount();
                state.steps.trafficAccount = 'done';
                log(`traffic account ${account.accountId} ready (balance ${account.balanceBytes} bytes)`);
            }
            catch (error) {
                fail('trafficAccount', error);
                state.status = computeOnboardingStatus(state);
                await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
                return { ...state };
            }
        }
        // 3. One-time free traffic grant (best-effort; a disabled or exhausted
        //    campaign must never block the rest of onboarding).
        if (!isTerminalGrantState(state.steps.freeGrant)) {
            try {
                const claim = await deps.trafficAccountService.claimFreeGrant();
                state.steps.freeGrant = 'claimed';
                state.freeGrantBytes = claim.grantBytes > 0 ? claim.grantBytes : state.freeGrantBytes;
                log(`claimed free traffic grant (${claim.grantBytes} bytes)`);
            }
            catch (error) {
                const grantState = classifyGrantFailure(error);
                state.steps.freeGrant = grantState;
                if (grantState === 'failed') {
                    state.lastError = error instanceof Error ? error.message : String(error);
                }
            }
        }
        // 4. MVC gas subsidy for the owner address (idempotent server-side:
        //    "address already rewarded" counts as success). Gates the name pin.
        if (state.steps.subsidy !== 'done') {
            const requestSubsidy = deps.requestMvcGasSubsidy ?? ((options) => (0, requestMvcGasSubsidy_1.requestMvcGasSubsidy)(options));
            const subsidy = await requestSubsidy({
                mvcAddress: owner.mvcAddress,
                mnemonic: owner.mnemonic,
                path: owner.path,
            });
            state.steps.subsidy = subsidy.success ? 'done' : 'failed';
            if (!subsidy.success) {
                state.lastError = subsidy.error ?? 'MVC gas subsidy request failed.';
            }
        }
        // 5. Owner /info/name pin through the traffic sponsor (falls back to the
        //    subsidy-funded wallet), retried on later runs while pending.
        if (state.steps.namePin !== 'done' && state.steps.namePin !== 'skipped') {
            if (state.steps.subsidy !== 'done') {
                state.steps.namePin = 'skipped';
            }
            else {
                const signer = deps.createSigner
                    ? deps.createSigner(owner)
                    : deps.adapters
                        ? (0, ownerSigner_1.createOwnerSigner)({
                            systemHomeDir: deps.systemHomeDir,
                            owner,
                            adapters: deps.adapters,
                            ...(deps.resolveSponsorWritePin ? { resolveSponsorWritePin: deps.resolveSponsorWritePin } : {}),
                        })
                        : undefined;
                if (!signer) {
                    state.steps.namePin = 'skipped';
                }
                else {
                    try {
                        const requests = (0, ownerProfilePublish_1.buildOwnerProfileChainWrites)({ name: owner.name });
                        if (requests.length > 0) {
                            await (0, ownerProfilePublish_1.writeOwnerProfileChainRequests)(signer, requests, { delayMs: deps.chainWriteDelayMs });
                        }
                        state.steps.namePin = 'done';
                        log('published owner /info/name pin');
                    }
                    catch (error) {
                        fail('namePin', error);
                    }
                }
            }
        }
        state.status = computeOnboardingStatus(state);
        await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
        return { ...state };
    }
    return {
        run() {
            if (inFlight)
                return inFlight;
            inFlight = execute().finally(() => {
                inFlight = null;
            });
            return inFlight;
        },
    };
}
