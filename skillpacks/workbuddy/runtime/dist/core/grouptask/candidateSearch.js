"use strict";
/**
 * Group-task staffing search (OAC port of IDBots groupTaskCandidateSearch +
 * botSearchService): one list per coarse seat. Merges local worker profiles
 * with the metaso-p2p bot staffing search (POST /api/bots/search), then
 * applies the Twin's impression sediment (capability tags + collaboration
 * facts once Phase 1 Round L lands). Match-first: local wins only as a
 * tie-break within LOCAL_TIE_MARGIN; remote rows stay marked remote; remote
 * failure degrades to local-only with a warning.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_TIE_MARGIN = exports.GROUP_TASK_SEARCH_MAX_LIMIT = exports.GROUP_TASK_SEARCH_DEFAULT_LIMIT = exports.BotSearchError = exports.BOT_SEARCH_CODE_INTERNAL = exports.BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE = exports.BOT_SEARCH_CODE_INVALID = exports.BOT_SEARCH_CODE_OK = exports.BOT_SEARCH_PATH = exports.DEFAULT_BOT_SEARCH_BASE_URL = void 0;
exports.tokenizeOpenTeamQuery = tokenizeOpenTeamQuery;
exports.scoreOpenTeamCandidate = scoreOpenTeamCandidate;
exports.searchBots = searchBots;
exports.fromBotSearchCandidate = fromBotSearchCandidate;
exports.searchRemoteBotsForSeat = searchRemoteBotsForSeat;
exports.resolveSeatSearchQuery = resolveSeatSearchQuery;
exports.collectMatchReasons = collectMatchReasons;
exports.scoreSeatResume = scoreSeatResume;
exports.evaluateImpressionForSeat = evaluateImpressionForSeat;
exports.searchGroupTaskSeatCandidates = searchGroupTaskSeatCandidates;
const staffing_1 = require("./staffing");
// ---------------------------------------------------------------------------
// Query tokenization + local fuzzy scoring (IDBots openTeamService parity)
// ---------------------------------------------------------------------------
function tokenizeOpenTeamQuery(text) {
    const tokens = new Set();
    const parts = String(text ?? '')
        .toLowerCase()
        .split(/[\s,，。;；:：/|]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    for (const part of parts) {
        tokens.add(part);
        // CJK runs (no ASCII letters): add 2-grams so "占卜塔罗" matches a bio
        // containing "占卜塔罗牌" without needing a manual space.
        if (/[一-鿿]/.test(part) && !/[a-z0-9]/.test(part) && part.length > 2) {
            for (let index = 0; index < part.length - 1; index += 1) {
                tokens.add(part.slice(index, index + 2));
            }
        }
    }
    return [...tokens];
}
function scoreOpenTeamCandidate(item, tokens) {
    if (tokens.length === 0)
        return 0;
    const name = (item.name ?? '').toLowerCase();
    const bio = (item.bio ?? '').toLowerCase();
    const skills = (item.chatSkills ?? []).map((skill) => String(skill ?? '').toLowerCase());
    let score = 0;
    for (const token of tokens) {
        const weight = Math.min(4, Math.max(1, token.length));
        if (name.includes(token))
            score += 4 * weight;
        if (skills.some((skill) => skill.includes(token)))
            score += 2 * weight;
        if (bio.includes(token))
            score += weight;
    }
    return score;
}
// ---------------------------------------------------------------------------
// Bot staffing search client (metaso-p2p, POST /api/bots/search)
// ---------------------------------------------------------------------------
exports.DEFAULT_BOT_SEARCH_BASE_URL = 'https://so.metaid.io';
exports.BOT_SEARCH_PATH = '/api/bots/search';
const DEFAULT_TIMEOUT_MS = 10_000;
exports.BOT_SEARCH_CODE_OK = 0;
exports.BOT_SEARCH_CODE_INVALID = 1001;
exports.BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE = 1002;
exports.BOT_SEARCH_CODE_INTERNAL = 1003;
class BotSearchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'BotSearchError';
        this.code = code;
    }
}
exports.BotSearchError = BotSearchError;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function untrustedText(value, maxLen) {
    return text(value).replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
function textList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
function optionalInt(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeReason(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const record = raw;
    const field = text(record.field);
    const token = untrustedText(record.token, 80);
    const weight = Number(record.weight);
    if (!field || !token || !Number.isFinite(weight))
        return null;
    return { field, token, weight };
}
function normalizeGroupTask(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const record = raw;
    const groupId = text(record.groupId);
    if (!groupId)
        return null;
    return {
        groupId,
        title: untrustedText(record.title, 200),
        goal: untrustedText(record.goal, 200),
        joinedAs: text(record.joinedAs) || 'member',
        joinedAt: Number(record.joinedAt) || 0,
        joinPinId: text(record.joinPinId),
        stillMember: record.stillMember === true,
        messageCount: Number(record.messageCount) || 0,
        kind: text(record.kind) || 'group',
    };
}
function normalizeCandidate(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const record = raw;
    const globalMetaId = text(record.globalMetaId);
    if (!globalMetaId)
        return null;
    return {
        globalMetaId,
        metaId: text(record.metaId),
        name: untrustedText(record.name, 80),
        avatarId: text(record.avatarId),
        bio: untrustedText(record.bio, 500),
        role: untrustedText(record.role, 200),
        goal: untrustedText(record.goal, 200),
        chatSkills: textList(record.chatSkills),
        publishedSkills: textList(record.publishedSkills),
        chainName: text(record.chainName),
        hasChatPubkey: record.hasChatPubkey === true,
        hasHomepage: record.hasHomepage === true,
        homepage: text(record.homepage),
        isOnline: record.isOnline === true,
        lastSeenAgoSeconds: optionalInt(record.lastSeenAgoSeconds),
        groupTaskCount: Math.max(0, Math.trunc(Number(record.groupTaskCount) || 0)),
        recentGroupTasks: Array.isArray(record.recentGroupTasks)
            ? record.recentGroupTasks.map(normalizeGroupTask).filter((row) => Boolean(row))
            : [],
        score: Number(record.score) || 0,
        matchReasons: Array.isArray(record.matchReasons)
            ? record.matchReasons.map(normalizeReason).filter((row) => Boolean(row))
            : [],
    };
}
function normalizePage(raw) {
    const record = (raw && typeof raw === 'object' ? raw : {});
    const candidates = Array.isArray(record.candidates)
        ? record.candidates.map(normalizeCandidate).filter((row) => Boolean(row))
        : [];
    return {
        candidates,
        nextCursor: text(record.nextCursor) || null,
        queriedAt: Number(record.queriedAt) || 0,
    };
}
function resolveOptions(options) {
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required for bot search.');
    }
    return {
        baseUrl: (options?.baseUrl ?? exports.DEFAULT_BOT_SEARCH_BASE_URL).replace(/\/+$/, ''),
        fetchImpl,
        timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
}
function buildRequestBody(params) {
    const body = {};
    const query = text(params.query);
    if (query)
        body.query = query;
    const roleHint = text(params.roleHint);
    if (roleHint)
        body.roleHint = roleHint;
    const skills = (params.skills ?? []).map((item) => text(item)).filter(Boolean);
    if (skills.length)
        body.skills = skills;
    if (params.language === 'zh' || params.language === 'en')
        body.language = params.language;
    if (params.onlineOnly !== undefined)
        body.onlineOnly = params.onlineOnly;
    if (params.hasChatPubkey !== undefined)
        body.hasChatPubkey = params.hasChatPubkey;
    const exclude = (params.excludeGlobalMetaIds ?? []).map((item) => text(item)).filter(Boolean);
    if (exclude.length)
        body.excludeGlobalMetaIds = exclude;
    if (typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0) {
        body.limit = params.limit;
    }
    const cursor = text(params.cursor);
    if (cursor)
        body.cursor = cursor;
    return body;
}
/** POST /api/bots/search — ranked, online-aware staffing page. */
async function searchBots(params, options) {
    const { baseUrl, fetchImpl, timeoutMs } = resolveOptions(options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${baseUrl}${exports.BOT_SEARCH_PATH}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
            },
            body: JSON.stringify(buildRequestBody(params)),
        });
        const envelope = await response.json().catch(() => null);
        if (!envelope || typeof envelope !== 'object') {
            throw new Error(`Bot search API returned an invalid response (HTTP ${response.status}).`);
        }
        const code = Number(envelope.code);
        const message = text(envelope.message) || 'unknown error';
        if (code === exports.BOT_SEARCH_CODE_OK) {
            return normalizePage(envelope.data);
        }
        throw new BotSearchError(Number.isInteger(code) ? code : exports.BOT_SEARCH_CODE_INTERNAL, message);
    }
    finally {
        clearTimeout(timer);
    }
}
// ---------------------------------------------------------------------------
// Seat candidate search
// ---------------------------------------------------------------------------
exports.GROUP_TASK_SEARCH_DEFAULT_LIMIT = 10;
exports.GROUP_TASK_SEARCH_MAX_LIMIT = 20;
/** When |local − remote| is within this margin, local sorts first. */
exports.LOCAL_TIE_MARGIN = 4;
const SEAT_QUERY = {
    content: 'content copy writing 文案 内容 介绍 调研',
    design: 'design image video 设计 图像 视频 海报',
    engineering: 'engineering code metaapp publish 工程 代码 开发 发布',
    promotion: 'promotion promo buzz 推广 宣传 运营',
};
function isSeatRole(value) {
    return typeof value === 'string' && staffing_1.GROUP_TASK_SEAT_ROLES.includes(value);
}
function clampLimit(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isInteger(parsed) || parsed <= 0)
        return exports.GROUP_TASK_SEARCH_DEFAULT_LIMIT;
    return Math.min(exports.GROUP_TASK_SEARCH_MAX_LIMIT, parsed);
}
function normalizeGmid(value) {
    const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return trimmed || null;
}
const MATCH_FIELDS = new Set([
    'name',
    'chatSkills',
    'bio',
    'role',
    'goal',
    'groupTaskTitle',
    'groupTaskNote',
    'roleHint',
]);
function asMatchField(value) {
    return MATCH_FIELDS.has(value)
        ? value
        : 'bio';
}
function fromBotSearchCandidate(remote) {
    return {
        globalMetaId: remote.globalMetaId,
        name: remote.name,
        bio: remote.bio,
        role: remote.role,
        goal: remote.goal,
        chatSkills: remote.chatSkills,
        publishedSkills: remote.publishedSkills,
        chainName: remote.chainName,
        isOnline: remote.isOnline,
        lastSeenAgoSeconds: remote.lastSeenAgoSeconds,
        score: remote.score,
        matchReasons: remote.matchReasons.map((reason) => ({
            field: asMatchField(reason.field),
            token: reason.token,
            weight: reason.weight,
        })),
        groupTaskCount: remote.groupTaskCount,
        recentGroupTasks: remote.recentGroupTasks.map((item) => ({
            groupId: item.groupId,
            title: item.title,
            goal: item.goal,
            joinedAs: item.joinedAs,
            joinedAt: item.joinedAt,
            joinPinId: item.joinPinId,
            stillMember: item.stillMember,
            kind: item.kind,
        })),
    };
}
async function searchRemoteBotsForSeat(input, options) {
    const page = await searchBots({
        query: input.query,
        roleHint: input.roleHint,
        skills: input.skills,
        onlineOnly: true,
        hasChatPubkey: true,
        excludeGlobalMetaIds: input.excludeGlobalMetaIds,
        limit: input.limit,
    }, options);
    return page.candidates.map(fromBotSearchCandidate);
}
function resolveSeatSearchQuery(input) {
    const explicit = [text(input.query), ...(input.skills ?? []).map((skill) => text(skill)).filter(Boolean)];
    const roleHint = isSeatRole(input.roleHint) ? input.roleHint : null;
    if (roleHint === 'domain') {
        const domain = text(input.domainLabel);
        if (domain)
            explicit.push(domain);
    }
    else if (roleHint) {
        explicit.push(SEAT_QUERY[roleHint]);
    }
    return explicit.filter(Boolean).join(' ').trim();
}
function collectMatchReasons(item, tokens) {
    const reasons = [];
    const name = (item.name ?? '').toLowerCase();
    const bio = (item.bio ?? '').toLowerCase();
    const role = (item.role ?? '').toLowerCase();
    const goal = (item.goal ?? '').toLowerCase();
    const skills = (item.chatSkills ?? []).map((skill) => String(skill ?? '').toLowerCase());
    for (const token of tokens) {
        const weight = Math.min(4, Math.max(1, token.length));
        if (name.includes(token))
            reasons.push({ field: 'name', token, weight: 4 * weight });
        if (skills.some((skill) => skill.includes(token))) {
            reasons.push({ field: 'chatSkills', token, weight: 2 * weight });
        }
        if (bio.includes(token))
            reasons.push({ field: 'bio', token, weight });
        if (role.includes(token))
            reasons.push({ field: 'role', token, weight: Math.round(0.5 * weight) || 1 });
        if (goal.includes(token))
            reasons.push({ field: 'goal', token, weight: Math.round(0.5 * weight) || 1 });
    }
    return reasons;
}
function scoreSeatResume(item, tokens) {
    const reasons = collectMatchReasons(item, tokens);
    const openTeam = scoreOpenTeamCandidate({ name: item.name ?? '', bio: item.bio ?? '', chatSkills: item.chatSkills ?? [] }, tokens);
    const extra = reasons
        .filter((reason) => reason.field === 'role' || reason.field === 'goal')
        .reduce((sum, reason) => sum + reason.weight, 0);
    return { score: openTeam + extra, reasons };
}
function evaluateImpressionForSeat(snapshot, roleHint) {
    if (!snapshot) {
        return {
            priorCollaboration: false,
            capabilityTags: [],
            lastFact: null,
            verdict: 'unknown',
            note: 'no prior collaboration',
        };
    }
    const tags = snapshot.capabilityTags ?? [];
    const facts = snapshot.collaborationFacts ?? [];
    const lastFact = facts.length > 0 ? facts[facts.length - 1] : null;
    const last = lastFact
        ? { title: lastFact.title, outcome: lastFact.outcome, seatRole: lastFact.seatRole }
        : null;
    const weakExact = roleHint ? `weak:${roleHint}` : null;
    const factOnSeat = Boolean(lastFact
        && roleHint
        && lastFact.seatRole
        && lastFact.seatRole === roleHint);
    if ((weakExact && tags.includes(weakExact))
        || (factOnSeat && (lastFact?.outcome === 'kicked' || lastFact?.outcome === 'deliverable_rejected'))) {
        return {
            priorCollaboration: true,
            capabilityTags: tags,
            lastFact: last,
            verdict: 'block',
            note: lastFact
                ? `blocked: last ${roleHint} fact was ${lastFact.outcome} (${lastFact.title})`
                : `blocked: impression tagged ${weakExact}`,
        };
    }
    if (tags.includes('weak:unspecified') || lastFact?.outcome === 'kicked') {
        return {
            priorCollaboration: true,
            capabilityTags: tags,
            lastFact: last,
            verdict: 'demote',
            note: lastFact
                ? `demoted: last collab ${lastFact.outcome} (${lastFact.title})`
                : 'demoted: unspecified weak tag',
        };
    }
    if (lastFact
        && (lastFact.outcome === 'done' || lastFact.outcome === 'deliverable_accepted')
        && (!roleHint || !lastFact.seatRole || lastFact.seatRole === roleHint)) {
        return {
            priorCollaboration: true,
            capabilityTags: tags,
            lastFact: last,
            verdict: 'boost',
            note: `prior ${lastFact.outcome} on "${lastFact.title}"`,
        };
    }
    if (lastFact?.outcome === 'cancelled') {
        return {
            priorCollaboration: true,
            capabilityTags: tags,
            lastFact: last,
            verdict: 'demote',
            note: `demoted: last collab cancelled (${lastFact.title})`,
        };
    }
    return {
        priorCollaboration: facts.length > 0 || tags.length > 0,
        capabilityTags: tags,
        lastFact: last,
        verdict: 'unknown',
        note: facts.length > 0
            ? `prior collab recorded (${lastFact?.title ?? 'untitled'})`
            : (tags.length > 0 ? `tags: ${tags.join(', ')}` : 'no prior collaboration'),
    };
}
function impressionDelta(verdict) {
    if (verdict === 'boost')
        return 4;
    if (verdict === 'demote')
        return -8;
    return 0;
}
function compareCandidates(left, right) {
    if (Math.abs(left.score - right.score) <= exports.LOCAL_TIE_MARGIN) {
        if (left.source !== right.source)
            return left.source === 'local' ? -1 : 1;
    }
    if (right.score !== left.score)
        return right.score - left.score;
    return left.name.localeCompare(right.name);
}
async function readSnapshot(deps, observer, subject) {
    const observerId = normalizeGmid(observer);
    const subjectId = normalizeGmid(subject);
    if (!observerId || !subjectId || !deps.getImpressionSnapshot)
        return null;
    try {
        return await deps.getImpressionSnapshot(observerId, subjectId);
    }
    catch {
        return null;
    }
}
async function toLocalCandidate(worker, tokens, roleHint, snapshot) {
    if (!worker.enabled || worker.botType === 'twin')
        return null;
    const resume = scoreSeatResume({
        name: worker.name,
        bio: worker.bio ?? '',
        chatSkills: worker.chatSkills,
        role: worker.role ?? '',
        goal: worker.goal ?? '',
    }, tokens);
    if (tokens.length > 0 && resume.score <= 0)
        return null;
    const impression = evaluateImpressionForSeat(snapshot, roleHint);
    return {
        name: worker.name,
        source: 'local',
        slug: worker.slug,
        globalMetaId: worker.globalMetaId ?? undefined,
        bio: worker.bio ?? '',
        role: worker.role ?? '',
        goal: worker.goal ?? '',
        chatSkills: worker.chatSkills,
        enabled: worker.enabled,
        isOnline: true,
        rawScore: resume.score,
        score: resume.score + impressionDelta(impression.verdict),
        matchReasons: resume.reasons,
        impression,
    };
}
function toRemoteCandidate(remote, tokens, roleHint, snapshot) {
    const resume = scoreSeatResume({
        name: remote.name,
        bio: remote.bio,
        chatSkills: remote.chatSkills,
        role: remote.role ?? '',
        goal: remote.goal ?? '',
    }, tokens);
    const rawScore = Number.isFinite(remote.score) ? Number(remote.score) : resume.score;
    const matchReasons = remote.matchReasons?.length ? remote.matchReasons : resume.reasons;
    const impression = evaluateImpressionForSeat(snapshot, roleHint);
    return {
        name: remote.name,
        source: 'remote',
        globalMetaId: remote.globalMetaId,
        bio: remote.bio,
        role: remote.role ?? '',
        goal: remote.goal ?? '',
        chatSkills: remote.chatSkills,
        publishedSkills: remote.publishedSkills,
        isOnline: remote.isOnline,
        lastSeenAgoSeconds: remote.lastSeenAgoSeconds,
        groupTaskCount: remote.groupTaskCount,
        recentGroupTasks: remote.recentGroupTasks,
        rawScore,
        score: rawScore + impressionDelta(impression.verdict),
        matchReasons,
        impression,
    };
}
async function searchGroupTaskSeatCandidates(deps, input = {}) {
    const roleHint = isSeatRole(input.roleHint) ? input.roleHint : null;
    const query = resolveSeatSearchQuery(input);
    if (!query) {
        throw new Error('query or roleHint is required');
    }
    const tokens = tokenizeOpenTeamQuery(query);
    const limit = clampLimit(input.limit);
    const observer = await deps.getObserverGlobalMetaId();
    const warnings = [];
    const workers = await deps.listLocalWorkers();
    const locals = [];
    for (const worker of workers) {
        const snapshot = await readSnapshot(deps, observer, worker.globalMetaId);
        const candidate = await toLocalCandidate(worker, tokens, roleHint, snapshot);
        if (candidate)
            locals.push(candidate);
    }
    let remotes = [];
    try {
        const searchRemote = deps.searchRemote ?? ((remoteInput) => searchRemoteBotsForSeat(remoteInput, deps.botSearch));
        const skills = (input.skills ?? []).map((item) => text(item)).filter(Boolean);
        const remoteQuery = text(input.query) || (roleHint === 'domain' ? text(input.domainLabel) : '');
        const excludeGlobalMetaIds = [
            ...new Set([
                ...(observer ? [observer] : []),
                ...workers.map((worker) => normalizeGmid(worker.globalMetaId)).filter((id) => Boolean(id)),
            ].map((id) => String(id))),
        ];
        const found = await searchRemote({
            query: remoteQuery,
            roleHint: roleHint ?? undefined,
            skills: skills.length ? skills : undefined,
            excludeGlobalMetaIds,
            limit: Math.min(exports.GROUP_TASK_SEARCH_MAX_LIMIT, limit * 2),
        });
        remotes = [];
        for (const remote of found) {
            remotes.push(toRemoteCandidate(remote, tokens, roleHint, await readSnapshot(deps, observer, remote.globalMetaId)));
        }
        const localIds = new Set(locals
            .map((row) => normalizeGmid(row.globalMetaId))
            .filter((id) => Boolean(id)));
        remotes = remotes.filter((row) => {
            const id = normalizeGmid(row.globalMetaId);
            return !id || !localIds.has(id);
        });
    }
    catch (error) {
        const presenceDown = error instanceof BotSearchError && error.code === exports.BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE;
        warnings.push(presenceDown
            ? 'online search failed; local matches only: presence_unavailable'
            : `online search failed; local matches only: ${error instanceof Error ? error.message : String(error)}`);
    }
    const merged = [...locals, ...remotes];
    const blocked = merged.filter((candidate) => candidate.impression.verdict === 'block');
    const hireable = merged
        .filter((candidate) => candidate.impression.verdict !== 'block')
        .sort(compareCandidates)
        .slice(0, limit);
    if (hireable.length === 0 && blocked.length === 0) {
        warnings.push('no resume match for this seat');
    }
    return {
        query,
        roleHint,
        primary: hireable[0] ?? null,
        backup: hireable[1] ?? null,
        candidates: hireable,
        blocked: blocked.sort(compareCandidates),
        warnings,
    };
}
