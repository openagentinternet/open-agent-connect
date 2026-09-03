"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DREAM_GROUP_CHAT_MAX_MESSAGES = void 0;
exports.renderDreamDiaryMarkdown = renderDreamDiaryMarkdown;
exports.readDreamDayGroupTaskSource = readDreamDayGroupTaskSource;
exports.readDreamDaySellerOrders = readDreamDaySellerOrders;
exports.createDreamStore = createDreamStore;
exports.hashDreamFragmentContent = hashDreamFragmentContent;
// Dream consolidation storage layer, ported from IDBots src/main/dreamStore.ts
// onto the file layout (storage v2 amendment 2026-08-20):
// - `.runtime/memory/dream-runs.json`: run records (the idempotency anchor,
//   unique per dream date) + the resumable fragment cache.
// - `.runtime/memory/dream-summaries.json`: structured daily summaries.
// - `memory/YYYY-MM-DD.md`: the human-readable diary mirror.
// Also owns the "what did this bot do on date D" activity query, gathered from
// mirrored DSH transcripts, the on-chain A2A conversation stores, the group-task
// state/message caches, the seller-order list in the runtime state, and the
// per-bot chain history store.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("../chainhistory/store");
const types_1 = require("../grouptask/types");
const transcriptStore_1 = require("./transcriptStore");
let atomicWriteSequence = 0;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeFiniteNumber(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeRun(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const dreamDate = normalizeText(record.dreamDate);
    if (!dreamDate)
        return null;
    const status = record.status;
    return {
        dreamDate,
        status: status === 'running' || status === 'failed' ? status : 'completed',
        attemptCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.attemptCount, 1))),
        llm: normalizeText(record.llm) || null,
        dreamVersion: Math.max(0, Math.floor(normalizeFiniteNumber(record.dreamVersion, 0))),
        error: normalizeText(record.error) || null,
        startedAt: normalizeFiniteNumber(record.startedAt),
        completedAt: record.completedAt === null ? null : normalizeFiniteNumber(record.completedAt),
    };
}
function normalizeFragment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const dreamDate = normalizeText(record.dreamDate);
    const fragmentKey = normalizeText(record.fragmentKey);
    if (!dreamDate || !fragmentKey)
        return null;
    const status = record.status;
    return {
        dreamDate,
        fragmentKey,
        sessionId: normalizeText(record.sessionId),
        chunkIndex: Math.max(0, Math.floor(normalizeFiniteNumber(record.chunkIndex))),
        contentHash: normalizeText(record.contentHash),
        sourceMessageCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.sourceMessageCount))),
        sourceCharCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.sourceCharCount))),
        estimatedInputTokens: Math.max(0, Math.floor(normalizeFiniteNumber(record.estimatedInputTokens))),
        status: status === 'running' || status === 'failed' ? status : 'completed',
        summaryJson: typeof record.summaryJson === 'string' ? record.summaryJson : null,
        llm: normalizeText(record.llm) || null,
        dreamVersion: Math.max(0, Math.floor(normalizeFiniteNumber(record.dreamVersion, 0))),
        error: normalizeText(record.error) || null,
        attemptCount: Math.max(0, Math.floor(normalizeFiniteNumber(record.attemptCount, 1))),
        createdAt: normalizeFiniteNumber(record.createdAt),
        updatedAt: normalizeFiniteNumber(record.updatedAt),
    };
}
function normalizeSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const summaryDate = normalizeText(record.summaryDate);
    const summaryText = typeof record.summaryText === 'string' ? record.summaryText : '';
    if (!summaryDate || !summaryText.trim())
        return null;
    const sections = record.sections && typeof record.sections === 'object' && !Array.isArray(record.sections)
        ? Object.fromEntries(Object.entries(record.sections)
            .filter(([, sectionValue]) => typeof sectionValue === 'string' && sectionValue.trim())
            .map(([key, sectionValue]) => [key, sectionValue.trim()]))
        : {};
    const stats = record.stats && typeof record.stats === 'object' && !Array.isArray(record.stats)
        ? Object.fromEntries(Object.entries(record.stats)
            .filter(([, statValue]) => typeof statValue === 'number' && Number.isFinite(statValue)))
        : {};
    const sessionRefs = Array.isArray(record.sessionRefs)
        ? record.sessionRefs.flatMap((ref) => {
            if (!ref || typeof ref !== 'object' || Array.isArray(ref))
                return [];
            const refRecord = ref;
            const sessionId = normalizeText(refRecord.sessionId);
            if (!sessionId)
                return [];
            return [{
                    sessionId,
                    title: normalizeText(refRecord.title),
                    sessionType: normalizeText(refRecord.sessionType),
                    isOrder: refRecord.isOrder === true,
                }];
        })
        : [];
    return {
        summaryDate,
        summaryText,
        sections,
        stats,
        sessionRefs,
        llm: normalizeText(record.llm) || null,
        createdAt: normalizeFiniteNumber(record.createdAt),
        updatedAt: normalizeFiniteNumber(record.updatedAt),
    };
}
async function readJsonFile(filePath, normalize, empty) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return normalize(JSON.parse(raw));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return empty;
        throw error;
    }
}
async function writeJsonAtomic(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    atomicWriteSequence += 1;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
    try {
        await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tempPath, filePath);
    }
    catch (error) {
        await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
const DREAM_SECTION_LABELS = {
    human: '与人类用户的对话',
    a2a: '与其他 Bot 的对话',
    orders: '服务订单',
    tasks: '定时任务',
    group_tasks: '群任务',
};
/** Render the human-readable diary mirror at `memory/YYYY-MM-DD.md`. */
function renderDreamDiaryMarkdown(summary) {
    const parts = [
        `# ${summary.summaryDate} 梦境日记`,
        '',
        summary.summaryText.trim(),
    ];
    for (const [key, label] of Object.entries(DREAM_SECTION_LABELS)) {
        const section = summary.sections[key];
        if (section?.trim()) {
            parts.push('', `## ${label}`, '', section.trim());
        }
    }
    const statLines = [];
    if (summary.stats.sessionCount !== undefined)
        statLines.push(`- 会话数:${summary.stats.sessionCount}`);
    if (summary.stats.messageCount !== undefined)
        statLines.push(`- 消息数:${summary.stats.messageCount}`);
    if (summary.sessionRefs.length > 0) {
        statLines.push(`- 关联会话:${summary.sessionRefs.map((ref) => ref.sessionId).join(', ')}`);
    }
    if (statLines.length > 0) {
        parts.push('', '## 统计', '', ...statLines);
    }
    return `${parts.join('\n')}\n`;
}
/** Per-chat cap on in-day messages handed to the dream pipeline (IDBots caps
 * the same excerpt at 400; the file port stays tighter). */
exports.DREAM_GROUP_CHAT_MAX_MESSAGES = 200;
/** Epoch-ms field or null; grouptask timestamps are ms, junk/missing → null. */
function timestampMs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
function inDayMs(value, startMs, endMs) {
    const ms = timestampMs(value);
    return ms !== null && ms >= startMs && ms < endMs;
}
/** Best-effort JSON read: missing or corrupt files yield null, never throw. */
async function readJsonOrNull(filePath) {
    try {
        return JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function asRecordArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => (Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)))
        : [];
}
/** Match the grouptask store's message-file name sanitization. */
function sanitizeGroupIdForMessagesFile(groupId) {
    return groupId.replace(/[^0-9a-zA-Z_-]/gu, '_');
}
/** Owner acceptance ratings are 1-5 stars; anything else is junk data. */
function normalizeDreamRating(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    const rating = Math.trunc(value);
    return rating >= 1 && rating <= 5 ? rating : null;
}
/** This profile's role in one task: the chair row wins, else the member row. */
function dreamGroupTaskMemberRole(task, members, slug) {
    if (task.chairSlug === slug)
        return 'chair';
    const member = members.find((entry) => (entry.taskId === task.id && entry.slug === slug && entry.removedAt == null));
    return member?.role === 'chair' ? 'chair' : 'worker';
}
/**
 * Best-effort read of the group-task day source: the chair-side state.json,
 * guest OpenTeam memberships, and the decrypted per-group message caches.
 * Read-only and never throws — missing/corrupt files yield empty collections.
 */
async function readDreamDayGroupTaskSource(paths, input) {
    const root = node_path_1.default.join(paths.runtimeRoot, 'grouptask');
    const { startMs, endMs } = input;
    const state = await readJsonOrNull(node_path_1.default.join(root, 'state.json'));
    const stateRecord = state && typeof state === 'object' && !Array.isArray(state)
        ? state
        : null;
    const tasks = asRecordArray(stateRecord?.tasks)
        .filter((entry) => typeof entry.id === 'number' && typeof entry.title === 'string');
    const members = asRecordArray(stateRecord?.members)
        .filter((entry) => typeof entry.taskId === 'number');
    const openteam = await readJsonOrNull(node_path_1.default.join(root, 'openteam.json'));
    const openteamRecord = openteam && typeof openteam === 'object' && !Array.isArray(openteam)
        ? openteam
        : null;
    const memberships = asRecordArray(openteamRecord?.memberships)
        .filter((entry) => typeof entry.groupId === 'string' && entry.groupId.trim());
    // Message files are named by the sanitized groupId; map back through every
    // locally known group (chair-side tasks first, then guest memberships).
    const groupsByFileKey = new Map();
    for (const task of tasks) {
        const groupId = typeof task.groupId === 'string' ? task.groupId.trim() : '';
        if (!groupId)
            continue;
        const key = sanitizeGroupIdForMessagesFile(groupId);
        if (!groupsByFileKey.has(key))
            groupsByFileKey.set(key, { groupId, task, membership: null });
    }
    for (const membership of memberships) {
        const groupId = membership.groupId.trim();
        const key = sanitizeGroupIdForMessagesFile(groupId);
        if (!groupsByFileKey.has(key))
            groupsByFileKey.set(key, { groupId, task: null, membership });
    }
    let messageFiles = [];
    try {
        messageFiles = (await node_fs_1.promises.readdir(node_path_1.default.join(root, 'messages')))
            .filter((entry) => entry.endsWith('.json'));
    }
    catch {
        messageFiles = [];
    }
    const chats = [];
    for (const fileName of messageFiles) {
        const group = groupsByFileKey.get(fileName.slice(0, -'.json'.length));
        if (!group)
            continue; // Orphan cache: the group is unknown locally.
        const value = await readJsonOrNull(node_path_1.default.join(root, 'messages', fileName));
        const record = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : null;
        const messages = asRecordArray(record?.messages).flatMap((entry) => {
            const occurredSec = timestampMs(entry.chainTimestamp);
            if (occurredSec === null)
                return [];
            const occurredAt = occurredSec * 1000;
            if (occurredAt < startMs || occurredAt >= endMs)
                return [];
            // Suspect rows failed attribution checks upstream; never attribute them.
            if (entry.senderSuspect === true)
                return [];
            const content = typeof entry.content === 'string' ? entry.content : '';
            if (!content.trim())
                return [];
            return [{
                    index: timestampMs(entry.index) ?? 0,
                    pinId: normalizeText(entry.pinId) || null,
                    txId: normalizeText(entry.txId) || null,
                    senderName: normalizeText(entry.senderName) || null,
                    senderGlobalMetaId: normalizeText(entry.senderGlobalMetaId) || null,
                    content,
                    occurredAt,
                }];
        });
        if (messages.length === 0)
            continue;
        messages.sort((left, right) => left.occurredAt - right.occurredAt || left.index - right.index);
        chats.push({ groupId: group.groupId, task: group.task, membership: group.membership, messages });
    }
    chats.sort((left, right) => ((left.messages[0]?.occurredAt ?? 0) - (right.messages[0]?.occurredAt ?? 0)));
    return { tasks, members, chats };
}
/**
 * Best-effort read of the seller orders active inside the day (created or
 * updated in [startMs, endMs)), straight from runtime-state.json. Read-only.
 */
async function readDreamDaySellerOrders(paths, input) {
    const value = await readJsonOrNull(paths.runtimeStatePath);
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    return asRecordArray(record?.sellerOrders)
        .filter((entry) => typeof entry.id === 'string' && entry.id.trim())
        .filter((entry) => (inDayMs(entry.createdAt, input.startMs, input.endMs)
        || inDayMs(entry.updatedAt, input.startMs, input.endMs)));
}
function createDreamStore(paths, deps = {}) {
    const runsPath = paths.memoryDreamRunsPath;
    const summariesPath = paths.memoryDreamSummariesPath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function readRuns() {
        const file = await readJsonFile(runsPath, (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return { version: 1, runs: [], fragments: [] };
            const record = value;
            return {
                version: 1,
                runs: Array.isArray(record.runs)
                    ? record.runs.map(normalizeRun).filter((run) => run !== null)
                    : [],
                fragments: Array.isArray(record.fragments)
                    ? record.fragments.map(normalizeFragment).filter((fragment) => fragment !== null)
                    : [],
            };
        }, { version: 1, runs: [], fragments: [] });
        return file;
    }
    async function readSummaries() {
        return readJsonFile(summariesPath, (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return { version: 1, summaries: [] };
            const record = value;
            return {
                version: 1,
                summaries: Array.isArray(record.summaries)
                    ? record.summaries.map(normalizeSummary).filter((summary) => summary !== null)
                    : [],
            };
        }, { version: 1, summaries: [] });
    }
    return {
        async getRun(dreamDate) {
            const file = await readRuns();
            return file.runs.find((run) => run.dreamDate === dreamDate) ?? null;
        },
        async getRunStates() {
            const file = await readRuns();
            return new Map(file.runs.map((run) => [run.dreamDate, run]));
        },
        async beginRun(dreamDate, llm, dreamVersion) {
            return enqueue(async () => {
                const file = await readRuns();
                const now = Date.now();
                const existing = file.runs.find((run) => run.dreamDate === dreamDate);
                if (existing) {
                    existing.status = 'running';
                    existing.attemptCount += 1;
                    existing.llm = llm;
                    existing.dreamVersion = dreamVersion;
                    existing.error = null;
                    existing.startedAt = now;
                    existing.completedAt = null;
                    await writeJsonAtomic(runsPath, file);
                    return existing;
                }
                const run = {
                    dreamDate,
                    status: 'running',
                    attemptCount: 1,
                    llm,
                    dreamVersion,
                    error: null,
                    startedAt: now,
                    completedAt: null,
                };
                file.runs.push(run);
                await writeJsonAtomic(runsPath, file);
                return run;
            });
        },
        async finishRun(dreamDate, status, error = null) {
            await enqueue(async () => {
                const file = await readRuns();
                const run = file.runs.find((entry) => entry.dreamDate === dreamDate);
                if (!run)
                    return;
                run.status = status;
                run.error = status === 'failed' ? (error ?? 'unknown error') : null;
                run.completedAt = Date.now();
                await writeJsonAtomic(runsPath, file);
            });
        },
        async resetStaleRunningRuns({ staleMs, now }) {
            return enqueue(async () => {
                const file = await readRuns();
                const effectiveNow = now ?? Date.now();
                const cutoff = effectiveNow - Math.max(0, staleMs);
                let reset = 0;
                for (const run of file.runs) {
                    if (run.status !== 'running' || run.startedAt > cutoff)
                        continue;
                    run.status = 'failed';
                    run.error = 'stale running run reset';
                    run.completedAt = effectiveNow;
                    reset += 1;
                }
                if (reset > 0)
                    await writeJsonAtomic(runsPath, file);
                return reset;
            });
        },
        async getFragment(dreamDate, fragmentKey) {
            const file = await readRuns();
            return file.fragments.find((fragment) => (fragment.dreamDate === dreamDate && fragment.fragmentKey === fragmentKey)) ?? null;
        },
        async upsertFragment(fragment) {
            await enqueue(async () => {
                const file = await readRuns();
                const index = file.fragments.findIndex((entry) => (entry.dreamDate === fragment.dreamDate && entry.fragmentKey === fragment.fragmentKey));
                if (index >= 0) {
                    file.fragments[index] = { ...fragment, updatedAt: Date.now() };
                }
                else {
                    file.fragments.push({ ...fragment, createdAt: fragment.createdAt || Date.now(), updatedAt: Date.now() });
                }
                await writeJsonAtomic(runsPath, file);
            });
        },
        async upsertDailySummary(input) {
            return enqueue(async () => {
                const file = await readSummaries();
                const now = Date.now();
                const existing = file.summaries.find((summary) => summary.summaryDate === input.summaryDate);
                if (existing) {
                    existing.summaryText = input.summaryText;
                    existing.sections = input.sections;
                    existing.stats = input.stats;
                    existing.sessionRefs = input.sessionRefs;
                    existing.llm = input.llm;
                    existing.updatedAt = now;
                    await writeJsonAtomic(summariesPath, file);
                    await this.writeDiaryMarkdown(existing);
                    return existing;
                }
                const summary = {
                    ...input,
                    createdAt: now,
                    updatedAt: now,
                };
                file.summaries.push(summary);
                file.summaries.sort((left, right) => right.summaryDate.localeCompare(left.summaryDate));
                await writeJsonAtomic(summariesPath, file);
                await this.writeDiaryMarkdown(summary);
                return summary;
            });
        },
        async listDailySummaries(options = {}) {
            const file = await readSummaries();
            const limit = Math.max(1, Math.min(90, Math.floor(options.limit ?? 30)));
            return file.summaries
                .filter((summary) => !options.before || summary.summaryDate < options.before)
                .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
                .slice(0, limit);
        },
        async searchDailySummaries(options) {
            const file = await readSummaries();
            const query = normalizeText(options.query).toLowerCase();
            const limit = Math.max(1, Math.min(30, Math.floor(options.limit ?? 10)));
            return file.summaries
                .filter((summary) => {
                if (options.dateFrom && summary.summaryDate < options.dateFrom)
                    return false;
                if (options.dateTo && summary.summaryDate > options.dateTo)
                    return false;
                if (!query)
                    return true;
                return summary.summaryText.toLowerCase().includes(query)
                    || Object.values(summary.sections).some((section) => section.toLowerCase().includes(query));
            })
                .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
                .slice(0, limit);
        },
        async getDreamIdentityLatestDate() {
            return deps.getDreamIdentityLatestDate ? deps.getDreamIdentityLatestDate() : null;
        },
        async writeDiaryMarkdown(summary) {
            await node_fs_1.promises.mkdir(paths.workspaceMemoryRoot, { recursive: true });
            const diaryPath = node_path_1.default.join(paths.workspaceMemoryRoot, `${summary.summaryDate}.md`);
            await node_fs_1.promises.writeFile(diaryPath, renderDreamDiaryMarkdown(summary), 'utf8');
        },
        async writeSelfIdentityMarkdown(text) {
            await node_fs_1.promises.mkdir(paths.workspaceMemoryRoot, { recursive: true });
            await node_fs_1.promises.writeFile(paths.memorySelfIdentityPath, `${text.trim()}\n`, 'utf8');
        },
        async gatherActivity({ startMs, endMs }) {
            const sessions = [];
            // Mirrored DSH transcripts: one session per file.
            let transcriptIds = [];
            try {
                transcriptIds = (await node_fs_1.promises.readdir(paths.memoryTranscriptsRoot))
                    .filter((entry) => entry.endsWith('.jsonl'))
                    .map((entry) => entry.slice(0, -'.jsonl'.length));
            }
            catch {
                transcriptIds = [];
            }
            for (const sessionId of transcriptIds) {
                const turns = await (0, transcriptStore_1.readTranscript)(paths, sessionId);
                const dayTurns = turns.filter((turn) => turn.ts >= startMs && turn.ts < endMs);
                if (dayTurns.length === 0)
                    continue;
                const channel = dayTurns[0].channel || 'dsh';
                const peer = dayTurns.find((turn) => turn.peerGlobalMetaId)?.peerGlobalMetaId ?? null;
                sessions.push({
                    sessionId,
                    title: peer ? `${channel} 会话(${peer})` : `${channel} 会话 ${sessionId}`,
                    sessionType: channel === 'dsh' ? 'human' : channel,
                    peerName: peer,
                    isOrder: false,
                    messages: dayTurns.map((turn) => ({
                        type: turn.role,
                        content: turn.text,
                        createdAt: turn.ts,
                    })),
                });
            }
            // On-chain A2A conversations: one session per peer file.
            let a2aFiles = [];
            try {
                a2aFiles = (await node_fs_1.promises.readdir(paths.a2aRoot))
                    .filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
            }
            catch {
                a2aFiles = [];
            }
            for (const fileName of a2aFiles) {
                let conversation = null;
                try {
                    conversation = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(paths.a2aRoot, fileName), 'utf8'));
                }
                catch {
                    continue;
                }
                if (!conversation || !Array.isArray(conversation.messages))
                    continue;
                const dayMessages = conversation.messages.filter((message) => (typeof message?.content === 'string'
                    && message.content.trim()
                    && typeof message.timestamp === 'number'
                    && message.timestamp >= startMs
                    && message.timestamp < endMs));
                if (dayMessages.length === 0)
                    continue;
                const peerName = normalizeText(conversation.peer?.name) || null;
                const peerId = normalizeText(conversation.peer?.globalMetaId) || fileName;
                sessions.push({
                    sessionId: fileName.slice(0, -'.json'.length),
                    title: peerName ? `A2A 私聊(${peerName})` : `A2A 私聊(${peerId})`,
                    sessionType: 'a2a',
                    peerName,
                    isOrder: false,
                    messages: dayMessages.map((message) => ({
                        type: message.direction === 'outgoing' ? 'assistant' : 'user',
                        content: (message.content ?? '').replace(/\s+/g, ' ').trim(),
                        createdAt: message.timestamp ?? 0,
                    })),
                });
            }
            sessions.sort((left, right) => ((left.messages[0]?.createdAt ?? 0) - (right.messages[0]?.createdAt ?? 0)));
            // Group tasks + on-chain group chats + seller orders (IDBots
            // getActivityForDate parity), all best-effort reads of local mirrors.
            const slug = node_path_1.default.basename(paths.profileRoot);
            const groupTaskSource = await readDreamDayGroupTaskSource(paths, { startMs, endMs });
            const dayOrders = await readDreamDaySellerOrders(paths, { startMs, endMs });
            // Same-day message counts per group feed both the chat excerpts and the
            // "still active" task phase (IDBots derives them from the capped chat).
            const dayMessageCountByGroupId = new Map(groupTaskSource.chats.map((chat) => [
                chat.groupId,
                Math.min(chat.messages.length, exports.DREAM_GROUP_CHAT_MAX_MESSAGES),
            ]));
            const groupChats = groupTaskSource.chats.map((chat) => ({
                // Guest groups have no local task row: taskId 0, the membership's
                // title/status, and the guest/worker role.
                taskId: chat.task?.id ?? 0,
                title: chat.task?.title ?? chat.membership?.taskTitle ?? chat.groupId,
                taskStatus: chat.task?.status ?? chat.membership?.status ?? 'executing',
                memberRole: chat.task
                    ? dreamGroupTaskMemberRole(chat.task, groupTaskSource.members, slug)
                    : 'worker',
                messages: chat.messages.slice(0, exports.DREAM_GROUP_CHAT_MAX_MESSAGES).map((message) => ({
                    senderName: message.senderName ?? 'unknown',
                    content: message.content,
                    occurredAt: message.occurredAt,
                })),
            }));
            // Accepted phase: rated or closed inside the day. Active phase: still
            // non-terminal with same-day activity (chat messages or an engine drive).
            const acceptedGroupTasks = [];
            const activeGroupTasks = [];
            for (const task of groupTaskSource.tasks) {
                const groupId = typeof task.groupId === 'string' ? task.groupId.trim() : '';
                const dayMessageCount = groupId ? dayMessageCountByGroupId.get(groupId) : undefined;
                const base = {
                    taskId: task.id,
                    title: task.title,
                    goal: typeof task.goal === 'string' ? task.goal : '',
                    memberRole: dreamGroupTaskMemberRole(task, groupTaskSource.members, slug),
                    status: typeof task.status === 'string' ? task.status : undefined,
                    ...(dayMessageCount !== undefined ? { dayMessageCount } : {}),
                };
                if (inDayMs(task.ratedAt, startMs, endMs) || inDayMs(task.closedAt, startMs, endMs)) {
                    acceptedGroupTasks.push({
                        ...base,
                        rating: normalizeDreamRating(task.rating),
                        ratingComment: normalizeText(task.ratingComment) || null,
                        phase: 'accepted',
                    });
                    continue;
                }
                if (types_1.GROUP_TASK_TERMINAL_STATUSES.has(task.status))
                    continue;
                if ((dayMessageCount ?? 0) === 0 && !inDayMs(task.lastDrivenAt, startMs, endMs))
                    continue;
                activeGroupTasks.push({
                    ...base,
                    rating: null,
                    ratingComment: null,
                    phase: 'active',
                });
            }
            // Chain content history (own writes / full reads): timestamps are epoch
            // milliseconds, so the day window applies directly. The store caps each
            // kind at 50 entries and returns them chronological-ascending. Best
            // effort: a history-store failure must never break a dream run.
            let chainWrites = [];
            let chainReads = [];
            try {
                const chainHistory = (0, store_1.createChainHistoryStore)(paths);
                chainWrites = (await chainHistory.listWritesForDay({ startMs, endMs })).map((record) => ({
                    pinId: record.pinId,
                    path: record.path,
                    operation: record.operation,
                    occurredAtMs: record.occurredAtMs,
                    summary: record.summary,
                    contentText: record.contentText,
                    contentType: record.contentType,
                }));
                chainReads = (await chainHistory.listReadsForDay({ startMs, endMs })).map((record) => ({
                    pinId: record.pinId,
                    path: record.path,
                    protocol: record.protocol,
                    title: record.title,
                    authorGlobalMetaId: record.authorGlobalMetaId,
                    summary: record.summary,
                    contentExcerpt: record.contentExcerpt,
                    savedToKb: record.savedToKb,
                    readCount: record.readCount,
                    lastReadAtMs: record.lastReadAtMs,
                }));
            }
            catch {
                chainWrites = [];
                chainReads = [];
            }
            return {
                sessions,
                // OAC has no scheduled-task feature; the prompt section stays empty.
                taskRuns: [],
                orderCount: dayOrders.length,
                groupTasks: [...acceptedGroupTasks, ...activeGroupTasks],
                groupChats,
                chainWrites,
                chainReads,
            };
        },
    };
}
/** sha256 fingerprint of one fragment's source content (resumability anchor). */
function hashDreamFragmentContent(chunk) {
    return node_crypto_1.default.createHash('sha256').update(JSON.stringify(chunk)).digest('hex');
}
