"use strict";
// File-backed traffic (「流量」 account-quota gas credit) state for the machine-wide
// owner identity. Replaces the IDBots kvStore/SQLite persistence with two files
// under `~/.metabot/owner/` (see the storage-layout v2 spec, owner/ section):
//
// - `traffic.json` — mode, apiBase override, cached account record, and the
//   bot-address → account bindings. Atomic write-then-rename, pretty JSON like
//   the other machine-wide stores.
// - `traffic-journal.jsonl` — append-only local spend journal, one JSON row per
//   line, mirroring the IDBots `traffic_spend_journal` columns 1:1 (txId,
//   botAddress, orderId, txSize, sponsoredMinerFee, savedFee, billedBy, kind,
//   createdAt). The 1-based line number is exposed as `id` so readers keep the
//   IDBots id-ASC/DESC ordering semantics. Powers the offline usage fallback
//   and ledger enrichment.
//
// Neither file contains secret material, but both sit next to the owner
// identity, so they are written with owner-only permissions like
// owner/identity.json.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTrafficStorePaths = resolveTrafficStorePaths;
exports.normalizeTrafficPinMode = normalizeTrafficPinMode;
exports.normalizeTrafficFallbackPolicy = normalizeTrafficFallbackPolicy;
exports.normalizeTrafficApiBase = normalizeTrafficApiBase;
exports.createDefaultTrafficFileState = createDefaultTrafficFileState;
exports.createTrafficStore = createTrafficStore;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const TRAFFIC_FILE_MODE = 0o600;
function resolveTrafficStorePaths(systemHomeDir) {
    const ownerRoot = node_path_1.default.join(node_path_1.default.resolve(systemHomeDir), '.metabot', 'owner');
    return {
        ownerRoot,
        trafficPath: node_path_1.default.join(ownerRoot, 'traffic.json'),
        journalPath: node_path_1.default.join(ownerRoot, 'traffic-journal.jsonl'),
    };
}
// ---------------------------------------------------------------------------
// Normalization (ported from IDBots trafficSettings.ts)
// ---------------------------------------------------------------------------
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
function normalizeTrafficPinMode(value) {
    return String(value ?? '').trim().toLowerCase() === 'selfpay' ? 'selfpay' : 'traffic';
}
/** Stored 'strict' is ignored; account-quota mode always falls back to self-pay. */
function normalizeTrafficFallbackPolicy(_value) {
    return 'selfpay';
}
/**
 * Normalize an apiBase override for persistence: trims, strips trailing
 * slashes, '' clears the override. Throws on anything that is not an
 * http(s) URL (callers surface the error and must not persist).
 */
function normalizeTrafficApiBase(value) {
    const text = String(value ?? '').trim().replace(/\/+$/, '');
    if (!text)
        return '';
    let parsed;
    try {
        parsed = new URL(text);
    }
    catch {
        throw new Error('traffic.apiBase must be a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('traffic.apiBase must use http or https');
    }
    return text;
}
function normalizeAccountRecord(value) {
    const record = readObject(value);
    const accountId = normalizeText(record?.accountId);
    if (!record || !accountId)
        return null;
    return {
        accountId,
        identityAddress: normalizeText(record.identityAddress),
        balanceBytes: toNumber(record.balanceBytes),
        reservedBytes: toNumber(record.reservedBytes),
        grantedBytesTotal: toNumber(record.grantedBytesTotal),
        spentBytesTotal: toNumber(record.spentBytesTotal),
        status: toNumber(record.status),
    };
}
function normalizeBindings(value) {
    const record = readObject(value);
    if (!record)
        return {};
    const result = {};
    for (const [address, entry] of Object.entries(record)) {
        const binding = readObject(entry);
        const accountId = normalizeText(binding?.accountId);
        if (accountId) {
            result[address] = { accountId, boundAt: toNumber(binding?.boundAt) };
        }
    }
    return result;
}
function createDefaultTrafficFileState() {
    return { version: 1, mode: 'traffic', apiBase: '', account: null, bindings: {} };
}
function normalizeTrafficFileState(value) {
    const record = readObject(value);
    if (!record)
        return createDefaultTrafficFileState();
    return {
        version: 1,
        mode: normalizeTrafficPinMode(record.mode),
        apiBase: normalizeText(record.apiBase),
        account: normalizeAccountRecord(record.account),
        bindings: normalizeBindings(record.bindings),
    };
}
function normalizeJournalEntry(value, id) {
    const record = readObject(value);
    if (!record)
        return null;
    const txId = normalizeText(record.txId);
    const botAddress = normalizeText(record.botAddress);
    if (!txId || !botAddress)
        return null;
    return {
        id,
        txId,
        botAddress,
        orderId: normalizeText(record.orderId),
        txSize: toNumber(record.txSize),
        sponsoredMinerFee: toNumber(record.sponsoredMinerFee),
        savedFee: toNumber(record.savedFee),
        billedBy: normalizeText(record.billedBy) === 'traffic' ? 'traffic' : 'quota',
        kind: normalizeText(record.kind),
        createdAt: toNumber(record.createdAt),
    };
}
// ---------------------------------------------------------------------------
// File primitives
// ---------------------------------------------------------------------------
async function applyTrafficFileMode(filePath) {
    if (process.platform === 'win32')
        return;
    try {
        await node_fs_1.promises.chmod(filePath, TRAFFIC_FILE_MODE);
    }
    catch (error) {
        const code = error.code;
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL')
            return;
        throw error;
    }
}
async function writeFileAtomic(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, content, { encoding: 'utf8', mode: TRAFFIC_FILE_MODE });
        await node_fs_1.promises.rename(tempPath, filePath);
        await applyTrafficFileMode(filePath);
    }
    finally {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => { });
    }
}
async function readTrafficFile(paths) {
    await node_fs_1.promises.mkdir(paths.ownerRoot, { recursive: true });
    try {
        const raw = await node_fs_1.promises.readFile(paths.trafficPath, 'utf8');
        return normalizeTrafficFileState(JSON.parse(raw));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return createDefaultTrafficFileState();
        }
        throw error;
    }
}
async function writeTrafficFile(paths, state) {
    await node_fs_1.promises.mkdir(paths.ownerRoot, { recursive: true });
    await writeFileAtomic(paths.trafficPath, `${JSON.stringify(normalizeTrafficFileState(state), null, 2)}\n`);
}
async function readJournalEntries(paths) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(paths.journalPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const entries = [];
    const lines = raw.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            // Skip torn/corrupt lines: a crash can leave a partial final row and the
            // journal must stay readable for the usage fallback either way.
            continue;
        }
        const entry = normalizeJournalEntry(parsed, entries.length + 1);
        if (entry)
            entries.push(entry);
    }
    return entries;
}
function createTrafficStore(systemHomeDir) {
    const paths = resolveTrafficStorePaths(systemHomeDir);
    async function listJournal(input = {}) {
        const botAddress = normalizeText(input.botAddress);
        const limit = Number.isFinite(input.limit) && (input.limit ?? 0) > 0 ? Math.trunc(input.limit) : 100;
        const entries = await readJournalEntries(paths);
        const filtered = botAddress
            ? entries.filter((entry) => entry.botAddress === botAddress)
            : entries;
        return filtered.slice(-limit).reverse();
    }
    return {
        paths,
        async read() {
            return readTrafficFile(paths);
        },
        async write(state) {
            await writeTrafficFile(paths, state);
        },
        async readSettings() {
            const state = await readTrafficFile(paths);
            return {
                mode: state.mode,
                fallbackPolicy: normalizeTrafficFallbackPolicy(),
                apiBase: state.apiBase,
            };
        },
        async writeSettings(input) {
            const current = await readTrafficFile(paths);
            const nextMode = input.mode === undefined ? current.mode : normalizeTrafficPinMode(input.mode);
            // Validate before touching the file: invalid values must not be persisted.
            const nextApiBase = input.apiBase === undefined ? current.apiBase : normalizeTrafficApiBase(input.apiBase);
            await writeTrafficFile(paths, { ...current, mode: nextMode, apiBase: nextApiBase });
            return {
                mode: nextMode,
                fallbackPolicy: normalizeTrafficFallbackPolicy(),
                apiBase: nextApiBase,
            };
        },
        async readAccount() {
            const state = await readTrafficFile(paths);
            return state.account;
        },
        async writeAccount(account) {
            const current = await readTrafficFile(paths);
            await writeTrafficFile(paths, { ...current, account: normalizeAccountRecord(account) });
        },
        async readBindings() {
            const state = await readTrafficFile(paths);
            return state.bindings;
        },
        async writeBinding(botAddress, accountId) {
            const current = await readTrafficFile(paths);
            await writeTrafficFile(paths, {
                ...current,
                bindings: {
                    ...current.bindings,
                    [botAddress]: { accountId, boundAt: Date.now() },
                },
            });
        },
        async appendJournal(entry) {
            const txId = normalizeText(entry.txId);
            const botAddress = normalizeText(entry.botAddress);
            if (!txId || !botAddress)
                return null;
            const row = {
                txId,
                botAddress,
                orderId: normalizeText(entry.orderId),
                txSize: Math.max(0, Math.trunc(toNumber(entry.txSize))),
                sponsoredMinerFee: Math.max(0, Math.trunc(toNumber(entry.sponsoredMinerFee))),
                savedFee: Math.max(0, Math.trunc(toNumber(entry.savedFee))),
                billedBy: entry.billedBy === 'traffic' ? 'traffic' : 'quota',
                kind: normalizeText(entry.kind),
                createdAt: toNumber(entry.createdAt) || Date.now(),
            };
            await node_fs_1.promises.mkdir(paths.ownerRoot, { recursive: true });
            await node_fs_1.promises.appendFile(paths.journalPath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: TRAFFIC_FILE_MODE });
            await applyTrafficFileMode(paths.journalPath);
            return row;
        },
        async readJournal() {
            return readJournalEntries(paths);
        },
        async listJournal(input = {}) {
            return listJournal(input);
        },
        async latestJournalByOrderId(input = {}) {
            const byOrderId = new Map();
            // listJournal is id-DESC: the first row per orderId is the latest.
            for (const entry of await listJournal({ limit: input.limit ?? 1000 })) {
                if (entry.orderId && !byOrderId.has(entry.orderId)) {
                    byOrderId.set(entry.orderId, entry);
                }
            }
            return byOrderId;
        },
        async aggregateDailyUsage(input = {}) {
            const botAddress = normalizeText(input.botAddress);
            const rows = await listJournal({ limit: input.limit ?? 200, botAddress: botAddress || undefined });
            const buckets = new Map();
            for (const entry of rows) {
                const date = new Date(entry.createdAt).toISOString().slice(0, 10);
                const key = `${date}|${entry.botAddress}`;
                const bucket = buckets.get(key) ?? { date, botAddress: entry.botAddress, bytes: 0, txCount: 0 };
                bucket.bytes += entry.txSize;
                bucket.txCount += 1;
                buckets.set(key, bucket);
            }
            return [...buckets.values()];
        },
    };
}
