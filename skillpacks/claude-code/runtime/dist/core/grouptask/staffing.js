"use strict";
/**
 * Group-task staffing: decompose → coarse seats → one bot per seat →
 * owner-confirm (unless the triggering wish said "just start") → create.
 *
 * OAC port of the IDBots groupTaskStaffing module (2026-08-22 release,
 * review fixes through 2026-08-24): the pattern tables, the interrogative
 * skip filter, the last-intent owner gate, and the 24 h proposal TTL are
 * ported verbatim so both clients behave identically around a shared slate.
 * Local seats are identified by profile slug (OAC has no numeric metabot
 * ids); remote seats by GlobalMetaId, exactly like the OpenTeam envelope.
 *
 * Research is a basic capability of every seat, not a seat of its own.
 * Match-first; local is a tie-break, not a gate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFFING_PROPOSAL_TTL_MS = exports.GroupTaskStaffingError = exports.GROUP_TASK_HARD_TEAM_SIZE = exports.GROUP_TASK_TYPICAL_TEAM_SIZE = exports.GROUP_TASK_SEAT_ROLES = void 0;
exports.normalizeStaffingPlan = normalizeStaffingPlan;
exports.validateStaffingPlan = validateStaffingPlan;
exports.detectSkipConfirmInWish = detectSkipConfirmInWish;
exports.classifyOwnerStaffingReply = classifyOwnerStaffingReply;
exports.pickTriggeringWishText = pickTriggeringWishText;
exports.isStaffingProposalExpired = isStaffingProposalExpired;
exports.resolveStaffingOwnerGate = resolveStaffingOwnerGate;
exports.splitSessionMessagesForStaffingGate = splitSessionMessagesForStaffingGate;
exports.localSeatSlugs = localSeatSlugs;
exports.remoteSeats = remoteSeats;
exports.buildStaffingSlateText = buildStaffingSlateText;
exports.assertCreateRosterCap = assertCreateRosterCap;
exports.GROUP_TASK_SEAT_ROLES = [
    'content',
    'design',
    'engineering',
    'promotion',
    'domain',
];
exports.GROUP_TASK_TYPICAL_TEAM_SIZE = 5;
exports.GROUP_TASK_HARD_TEAM_SIZE = 8;
class GroupTaskStaffingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'GroupTaskStaffingError';
        this.code = code;
    }
}
exports.GroupTaskStaffingError = GroupTaskStaffingError;
/** Pending / confirmed / skip-authorized slates expire after 24h. */
exports.STAFFING_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const SKIP_CONFIRM_PATTERNS = [
    /不用确认/,
    /不必确认/,
    /不需要确认/,
    /无需确认/,
    /不用问我/,
    /不用等人选/,
    /跳过确认/,
    /直接开群/,
    /直接开始/,
    /直接开吧/,
    /直接开任务/,
    // Command-like "直接开" only — must not match 开发 / 开会 / 开通.
    /(^|[，,。；;！!\s])直接开[。.!！]*$/,
    /自行决定人选/,
    /no need to confirm/i,
    /skip confirmation/i,
    /without confirmation/i,
    /don't ask me/i,
    /do not ask me/i,
    /just start/i,
    /start directly/i,
    /proceed without confirmation/i,
];
const KEEP_ROSTER_PATTERNS = [
    /不换人/,
    /不用换/,
    /不要换/,
    /keep (the )?(roster|team|slate|people)/i,
    /don'?t (swap|replace|change)/i,
];
const REVISE_PATTERNS = [
    /换人/,
    /换成/,
    /换一个/,
    /去掉/,
    /不要\s*\S+/,
    /再找/,
    /换掉/,
    /\breplace\b/i,
    /\bswap\b/i,
    /\bremove\b/i,
    // Bare "drop" / "instead" mis-fire on "ok, use B instead of A".
    /\bdrop\s+(the\s+)?(seat|role|bot|member|candidate|person)\b/i,
];
const CONFIRM_EXACT_PATTERNS = [
    /^(确认|就这样|就这样开|可以开|开吧|开始吧|同意|没问题|好的|好|行|嗯)[。.!！]*$/u,
    /^(ok|okay|yes|yep|go|go ahead|looks good|lgtm|proceed|confirmed?|start)[.!]*$/i,
];
const CONFIRM_PHRASE_PATTERNS = [
    /确认人选/,
    /按这个(名单|人选|班子)/,
    /就这些人/,
    /就这样开/,
    /可以开(群|了|吧)?/,
    /confirmed the (roster|slate|team)/i,
    /looks good,? (start|go|proceed)/i,
];
function isSeatRole(value) {
    return typeof value === 'string' && exports.GROUP_TASK_SEAT_ROLES.includes(value);
}
function trimText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeStaffingPlan(raw) {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : {};
    const stagesRaw = Array.isArray(record.stages) ? record.stages : [];
    const seatsRaw = Array.isArray(record.seats) ? record.seats : [];
    const stages = stagesRaw.map((item, index) => {
        const row = item && typeof item === 'object' ? item : {};
        const role = isSeatRole(row.seatRole) ? row.seatRole : 'content';
        const dependsOn = Array.isArray(row.dependsOn)
            ? row.dependsOn.map((dep) => String(dep ?? '').trim()).filter(Boolean)
            : [];
        return {
            id: trimText(row.id) || `stage-${index + 1}`,
            title: trimText(row.title) || `Stage ${index + 1}`,
            seatRole: role,
            dependsOn,
        };
    });
    const seats = seatsRaw.map((item) => {
        const row = item && typeof item === 'object' ? item : {};
        return {
            role: isSeatRole(row.role) ? row.role : 'content',
            domainLabel: trimText(row.domainLabel) || undefined,
            candidateName: trimText(row.candidateName) || trimText(row.name),
            candidateSlug: trimText(row.candidateSlug) || trimText(row.slug) || undefined,
            candidateGlobalMetaId: trimText(row.candidateGlobalMetaId) || trimText(row.globalmetaid) || undefined,
            source: row.source === 'remote' ? 'remote' : 'local',
            reason: trimText(row.reason),
            backupName: trimText(row.backupName) || undefined,
        };
    });
    return { stages, seats };
}
function seatKey(seat) {
    if (seat.role === 'domain') {
        return `domain:${(seat.domainLabel || 'unspecified').trim().toLowerCase()}`;
    }
    return seat.role;
}
function validateStaffingPlan(plan) {
    const errors = [];
    const warnings = [];
    const seen = new Set();
    for (const [index, seat] of plan.seats.entries()) {
        if (!isSeatRole(seat.role)) {
            errors.push(`seats[${index}].role is not a coarse seat`);
            continue;
        }
        if (seat.role === 'domain' && !seat.domainLabel) {
            errors.push(`seats[${index}] domain seat needs domainLabel (e.g. legal)`);
        }
        if (!seat.candidateName) {
            errors.push(`seats[${index}] needs candidateName`);
        }
        if (seat.source === 'local' && !seat.candidateSlug) {
            errors.push(`seats[${index}] local seat needs candidateSlug`);
        }
        if (seat.source === 'remote' && !seat.candidateGlobalMetaId) {
            errors.push(`seats[${index}] remote seat needs candidateGlobalMetaId`);
        }
        const key = seatKey(seat);
        if (seen.has(key)) {
            errors.push(`duplicate seat ${key}: one bot per coarse role`);
        }
        seen.add(key);
    }
    const teamSize = plan.seats.length + 1;
    if (teamSize > exports.GROUP_TASK_HARD_TEAM_SIZE) {
        errors.push(`team size ${teamSize} exceeds the hard cap of ${exports.GROUP_TASK_HARD_TEAM_SIZE} (including the Twin chair)`);
    }
    if (teamSize > exports.GROUP_TASK_TYPICAL_TEAM_SIZE) {
        warnings.push(`team size ${teamSize} is above the typical cap of ${exports.GROUP_TASK_TYPICAL_TEAM_SIZE}; keep this only when the owner asked for the extra seat`);
    }
    if (plan.stages.some((stage) => stage.title.toLowerCase().includes('research') && stage.seatRole === 'content' && plan.stages.some((other) => other !== stage && other.seatRole === 'content'))) {
        warnings.push('research is a basic capability of every seat — do not split it from content');
    }
    return { ok: errors.length === 0, errors, warnings, teamSize };
}
function isInterrogativeStaffingText(text) {
    const value = text.trim();
    if (!value)
        return false;
    if (/[？?]/.test(value))
        return true;
    if (/吗\s*[。.!！]*$/.test(value))
        return true;
    if (/^(能不能|可不可以|能否)/.test(value))
        return true;
    return false;
}
function detectSkipConfirmInWish(text) {
    const value = String(text ?? '').trim();
    if (!value || isInterrogativeStaffingText(value))
        return false;
    return SKIP_CONFIRM_PATTERNS.some((pattern) => pattern.test(value));
}
function classifyOwnerStaffingReply(text) {
    const value = String(text ?? '').trim();
    if (!value)
        return 'unknown';
    // "好的，不换人" must not fire /换人/ first-match revise.
    if (KEEP_ROSTER_PATTERNS.some((pattern) => pattern.test(value)))
        return 'confirm';
    if (REVISE_PATTERNS.some((pattern) => pattern.test(value)))
        return 'revise';
    if (CONFIRM_EXACT_PATTERNS.some((pattern) => pattern.test(value)))
        return 'confirm';
    if (CONFIRM_PHRASE_PATTERNS.some((pattern) => pattern.test(value)))
        return 'confirm';
    return 'unknown';
}
function pickTriggeringWishText(messages, atOrBeforeMs) {
    const chronological = [...messages].sort((left, right) => left.timestamp - right.timestamp);
    let latest = '';
    for (const message of chronological) {
        if (message.type !== 'user')
            continue;
        if (message.timestamp > atOrBeforeMs)
            continue;
        const content = String(message.content ?? '').trim();
        if (content)
            latest = content;
    }
    return latest;
}
function isStaffingProposalExpired(createdAt, nowMs) {
    return nowMs - createdAt > exports.STAFFING_PROPOSAL_TTL_MS;
}
function resolveStaffingOwnerGate(input) {
    let lastIntent = null;
    for (const reply of input.repliesAfterPropose) {
        const kind = classifyOwnerStaffingReply(reply);
        if (kind === 'revise')
            lastIntent = 'owner_revise';
        else if (kind === 'confirm')
            lastIntent = 'owner_confirmed';
        else if (detectSkipConfirmInWish(reply))
            lastIntent = 'skip_authorized';
    }
    if (lastIntent === 'owner_revise')
        return { allowed: false, decision: 'owner_revise' };
    if (lastIntent === 'owner_confirmed')
        return { allowed: true, decision: 'owner_confirmed' };
    if (lastIntent === 'skip_authorized')
        return { allowed: true, decision: 'skip_authorized' };
    if (detectSkipConfirmInWish(input.triggeringWish) || input.persistedSkip) {
        return { allowed: true, decision: 'skip_authorized' };
    }
    return { allowed: false, decision: 'awaiting_owner' };
}
function splitSessionMessagesForStaffingGate(messages, proposedAtMs) {
    const chronological = [...messages].sort((left, right) => left.timestamp - right.timestamp);
    const repliesAfterPropose = [];
    for (const message of chronological) {
        if (message.type !== 'user')
            continue;
        const content = String(message.content ?? '').trim();
        if (!content)
            continue;
        if (message.timestamp > proposedAtMs)
            repliesAfterPropose.push(content);
    }
    return {
        triggeringWish: pickTriggeringWishText(messages, proposedAtMs),
        repliesAfterPropose,
    };
}
function localSeatSlugs(plan) {
    return [...new Set(plan.seats
            .filter((seat) => seat.source === 'local' && seat.candidateSlug)
            .map((seat) => seat.candidateSlug))];
}
function remoteSeats(plan) {
    return plan.seats.filter((seat) => seat.source === 'remote');
}
function buildStaffingSlateText(input) {
    const language = input.language ?? 'zh';
    const zh = language !== 'en';
    const roleLabel = (seat) => {
        if (seat.role === 'domain')
            return zh ? `领域（${seat.domainLabel || '未标注'}）` : `domain (${seat.domainLabel || 'unspecified'})`;
        const labels = {
            content: ['内容', 'content'],
            design: ['设计', 'design'],
            engineering: ['工程', 'engineering'],
            promotion: ['推广', 'promotion'],
        };
        return zh ? labels[seat.role][0] : labels[seat.role][1];
    };
    const lines = [];
    if (zh) {
        lines.push(`按你的目标「${input.title}」，我拆成 ${input.plan.seats.length} 个粗岗位（调查是每个岗位的基础能力，不单设岗），准备这 ${input.plan.seats.length} 个人（加我一共 ${input.plan.seats.length + 1} 人）：`);
    }
    else {
        lines.push(`For "${input.title}", I split the work into ${input.plan.seats.length} coarse seat(s) (research is a basic capability of every seat). Proposed team: ${input.plan.seats.length} specialist(s) + me as chair = ${input.plan.seats.length + 1}:`);
    }
    for (const seat of input.plan.seats) {
        const origin = seat.source === 'remote'
            ? (zh ? '**在线，非本机**' : '**online, remote**')
            : (zh ? '本机' : 'local');
        const reason = seat.reason ? (zh ? ` · 理由：${seat.reason}` : ` · reason: ${seat.reason}`) : '';
        const backup = seat.backupName
            ? (zh ? `（备选：${seat.backupName}）` : ` (backup: ${seat.backupName})`)
            : '';
        lines.push(`- **${roleLabel(seat)}** — ${seat.candidateName}（${origin}）${backup}${reason}`);
    }
    if (input.plan.stages.length > 0) {
        lines.push('');
        lines.push(zh ? '工序：' : 'Stages:');
        for (const stage of input.plan.stages) {
            lines.push(`- ${stage.title}`);
        }
    }
    if (input.acceptanceCriteria?.trim()) {
        lines.push('');
        lines.push(zh ? `验收：${input.acceptanceCriteria.trim()}` : `Acceptance: ${input.acceptanceCriteria.trim()}`);
    }
    lines.push('');
    if (input.ownerConfirmRequired) {
        lines.push(zh
            ? '请看是否合理。可以说换人、去掉某岗，或回复「确认人选 / 就这样开」。没确认前我不会建群。'
            : 'Please confirm this roster, ask to swap/drop a seat, or say "looks good, start". I will not create the group until you confirm.');
    }
    else {
        lines.push(zh
            ? '你已经说了不用确认人选，我将按这份名单直接开群。'
            : 'You asked to skip roster confirmation; I will create the group with this slate.');
    }
    return lines.join('\n');
}
function assertCreateRosterCap(workerCount) {
    const teamSize = workerCount + 1;
    if (teamSize > exports.GROUP_TASK_HARD_TEAM_SIZE) {
        throw new GroupTaskStaffingError('ROSTER_CAP_EXCEEDED', `Group task roster ${teamSize} exceeds the hard cap of ${exports.GROUP_TASK_HARD_TEAM_SIZE} (including the Twin chair).`);
    }
}
