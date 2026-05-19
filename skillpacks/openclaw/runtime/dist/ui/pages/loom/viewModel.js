"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomDashboardViewModel = buildLoomDashboardViewModel;
const BOARD_COLUMNS = [
    { id: 'open', title: 'Open' },
    { id: 'claimed', title: 'Claimed' },
    { id: 'working', title: 'Working' },
    { id: 'review', title: 'Review' },
    { id: 'revision', title: 'Revision' },
    { id: 'closed', title: 'Closed' },
];
const TIMELINE_PRIORITY = {
    task: 0,
    claim: 1,
    status: 2,
    delivery: 3,
    acceptance: 4,
    claim_reject: 5,
    local_workflow: 6,
    invalid_record: 7,
};
const TIMELINE_KINDS = new Set(Object.keys(TIMELINE_PRIORITY));
const STALE_REFRESH_MS = 15 * 60 * 1000;
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => Boolean(asObject(entry)))
        : [];
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function dashboardFrom(input) {
    const root = asObject(input);
    if (!root)
        return {};
    return asObject(root.dashboard) ?? root;
}
function compactLabel(value) {
    if (!value)
        return null;
    if (value.length <= 18)
        return { label: value, copyValue: value };
    return {
        label: `${value.slice(0, 8)}...${value.slice(-4)}`,
        copyValue: value,
    };
}
function requiredCompactLabel(value, fallback = '') {
    const normalized = text(value) || fallback;
    return compactLabel(normalized) ?? { label: '', copyValue: '' };
}
function countLabel(count, singular, plural) {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}
function stateLabel(state) {
    switch (state) {
        case 'open': return 'Open';
        case 'claimed': return 'Claimed';
        case 'in_progress': return 'Working';
        case 'delivered': return 'In review';
        case 'revision_needed': return 'Needs revision';
        case 'accepted_paid': return 'Accepted and paid';
        case 'rejected': return 'Rejected';
        case 'failed': return 'Failed';
        default: return state || 'Unknown';
    }
}
function safeColumnId(value) {
    const id = text(value);
    return BOARD_COLUMNS.some((column) => column.id === id)
        ? id
        : 'open';
}
function safeStateTone(value) {
    const tone = text(value);
    if (['neutral', 'info', 'progress', 'review', 'warning', 'success', 'danger'].includes(tone)) {
        return tone;
    }
    return 'neutral';
}
function botViewModel(value, roleFallback) {
    const bot = asObject(value) ?? {};
    const fallbackLabel = text(bot.fallbackLabel) || `${roleFallback}:unknown`;
    const displayName = text(bot.displayName) || text(bot.name) || fallbackLabel;
    const initials = text(bot.initials) || displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || roleFallback.slice(0, 2).toUpperCase();
    return {
        displayName,
        initials,
        fallbackLabel,
        globalMetaId: text(bot.globalMetaId),
        address: text(bot.address),
        avatarUri: text(bot.avatarUri) || text(bot.avatarUrl) || null,
        role: text(bot.role) || roleFallback,
    };
}
function actorViewModel(value) {
    const actor = asObject(value) ?? {};
    const profileSlug = text(actor.profileSlug);
    const globalMetaId = requiredCompactLabel(actor.globalMetaId);
    const address = compactLabel(text(actor.address));
    const displayLabel = profileSlug || globalMetaId.label || address?.label || 'No active Bot';
    return {
        profileSlug,
        displayLabel,
        globalMetaId,
        address,
    };
}
function bountyLabel(value) {
    const bounty = asObject(value);
    if (!bounty)
        return 'Bounty not set';
    return [text(bounty.amount), text(bounty.currency)].filter(Boolean).join(' ') || 'Bounty not set';
}
function repoLabel(value) {
    const repo = asObject(value);
    if (!repo)
        return 'Repository not set';
    const repoUri = text(repo.repoUri);
    const baseBranch = text(repo.baseBranch);
    let readableRepo = repoUri;
    try {
        const url = new URL(repoUri);
        if (url.hostname.toLowerCase() === 'github.com') {
            const [owner, repoName] = url.pathname
                .split('/')
                .filter(Boolean);
            if (owner && repoName) {
                readableRepo = `${owner}/${repoName.replace(/\.git$/i, '')}`;
            }
        }
    }
    catch {
        readableRepo = repoUri;
    }
    return [readableRepo || 'Repository not set', baseBranch].filter(Boolean).join(' @ ');
}
function actionLabel(actorContext) {
    const actor = asObject(actorContext);
    return actor?.needsMyAction === true ? 'Needs my action' : '';
}
function cardViewModel(value) {
    const card = asObject(value);
    if (!card)
        return null;
    const taskPinId = text(card.taskPinId);
    if (!taskPinId)
        return null;
    const warningCount = numberValue(card.warningCount);
    const paymentTxId = compactLabel(text(card.paymentTxId));
    return {
        taskPinId,
        taskPin: requiredCompactLabel(taskPinId),
        title: text(card.title) || 'Untitled Loom task',
        state: text(card.state),
        stateLabel: stateLabel(text(card.state)),
        stateTone: safeStateTone(card.stateTone),
        columnId: safeColumnId(card.columnId),
        requester: botViewModel(card.requester, 'requester'),
        developer: asObject(card.developer) ? botViewModel(card.developer, 'developer') : null,
        bountyLabel: bountyLabel(card.bounty),
        repoLabel: repoLabel(card.repo),
        tags: stringArray(card.tags),
        latestStatusSummary: text(card.latestStatusSummary),
        prUrl: text(card.prUrl),
        paymentTxId,
        warningCount,
        warningLabel: countLabel(warningCount, 'warning', 'warnings'),
        warningTone: warningCount > 0 ? 'warning' : 'neutral',
        actionLabel: actionLabel(card.actorContext),
        updatedAt: numberValue(card.updatedAt),
        createdAt: numberValue(card.createdAt),
    };
}
function flattenColumnCards(columns) {
    return columns
        .flatMap((column) => asArray(column.cards))
        .map(cardViewModel)
        .filter((card) => Boolean(card));
}
function buildCards(dashboard, columns) {
    const taskCards = asArray(dashboard.tasks)
        .map(cardViewModel)
        .filter((card) => Boolean(card));
    return taskCards.length ? taskCards : flattenColumnCards(columns);
}
function columnsViewModel(dashboard, allCards) {
    const rawColumns = asArray(dashboard.columns);
    const cardsByColumn = new Map();
    for (const column of rawColumns) {
        const id = safeColumnId(column.id);
        const cards = asArray(column.cards)
            .map(cardViewModel)
            .filter((card) => Boolean(card));
        if (cards.length) {
            cardsByColumn.set(id, cards);
        }
    }
    for (const card of allCards) {
        if (!cardsByColumn.has(card.columnId)) {
            cardsByColumn.set(card.columnId, allCards.filter((entry) => entry.columnId === card.columnId));
        }
    }
    return BOARD_COLUMNS.map((column) => ({
        id: column.id,
        title: column.title,
        cards: cardsByColumn.get(column.id) ?? [],
    }));
}
function metric(id, label, value, tone = 'neutral') {
    return {
        id,
        label,
        value: value.toLocaleString('en-US'),
        tone,
    };
}
function summaryViewModel(dashboard, now) {
    const summary = asObject(dashboard.summary) ?? {};
    const rejected = numberValue(summary.rejected);
    const acceptedPaid = numberValue(summary.acceptedPaid);
    const failed = numberValue(summary.failed);
    const invalidRecords = numberValue(summary.invalidRecords);
    return {
        metrics: [
            metric('totalTasks', 'Total tasks', numberValue(summary.totalTasks)),
            metric('needsMyAction', 'Needs my action', numberValue(summary.needsMyAction), numberValue(summary.needsMyAction) > 0 ? 'warning' : 'neutral'),
            metric('open', 'Open', numberValue(summary.open)),
            metric('working', 'Working', numberValue(summary.inProgress)),
            metric('review', 'In review', numberValue(summary.delivered)),
            metric('revision', 'Needs revision', numberValue(summary.revisionNeeded), numberValue(summary.revisionNeeded) > 0 ? 'warning' : 'neutral'),
            metric('closed', 'Closed', acceptedPaid + rejected + failed),
            metric('invalidRecords', 'Invalid records', invalidRecords, invalidRecords > 0 ? 'warning' : 'neutral'),
        ],
        newestActivityLabel: relativeTimeLabel(numberValue(summary.newestActivityAt), now),
    };
}
function relativeTimeLabel(timestamp, now) {
    if (!timestamp)
        return 'Never';
    const ageMs = Math.max(0, now - timestamp);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (ageMs < minuteMs)
        return 'just now';
    if (ageMs < hourMs)
        return `${Math.floor(ageMs / minuteMs)}m ago`;
    if (ageMs < dayMs)
        return `${Math.floor(ageMs / hourMs)}h ago`;
    return `${Math.floor(ageMs / dayMs)}d ago`;
}
function refreshViewModel(dashboard, now) {
    const refresh = asObject(dashboard.refresh) ?? {};
    const updatedAt = numberValue(refresh.updatedAt) || numberValue(dashboard.updatedAt);
    const warning = text(refresh.warning);
    const isStale = Boolean(updatedAt && now - updatedAt > STALE_REFRESH_MS);
    const warningLabel = warning || (isStale ? 'Dashboard data may be stale.' : '');
    return {
        isStale,
        tone: warningLabel || isStale ? 'warning' : 'neutral',
        warningLabel,
        updatedLabel: updatedAt ? relativeTimeLabel(updatedAt, now) : 'Not refreshed yet',
    };
}
function timelineEventViewModel(value) {
    const event = asObject(value);
    if (!event)
        return null;
    const kind = text(event.kind);
    if (!TIMELINE_KINDS.has(kind))
        return null;
    const pinId = text(event.pinId);
    const id = text(event.id) || (pinId ? `${kind}:${pinId}` : '');
    if (!id)
        return null;
    const pin = compactLabel(text(event.pinId));
    return {
        id,
        kind: kind,
        title: text(event.title) || stateLabel(kind),
        summary: text(event.summary),
        timestamp: numberValue(event.timestamp),
        pin,
        tone: kind === 'invalid_record' || text(event.warningCode) ? 'warning' : 'neutral',
    };
}
function sortTimeline(events) {
    return [...events].sort((left, right) => (left.timestamp - right.timestamp
        || (TIMELINE_PRIORITY[left.kind] ?? 99) - (TIMELINE_PRIORITY[right.kind] ?? 99)
        || left.id.localeCompare(right.id, 'en')));
}
function warningViewModel(value) {
    const warning = asObject(value);
    if (!warning)
        return null;
    const pin = compactLabel(text(warning.recordPinId));
    if (!pin)
        return null;
    return {
        code: text(warning.code),
        message: text(warning.message),
        protocol: text(warning.protocol),
        timestamp: numberValue(warning.timestamp),
        pin,
        tone: 'warning',
    };
}
function claimViewModel(value) {
    const claim = asObject(value);
    if (!claim)
        return null;
    const pin = compactLabel(text(claim.pinId));
    if (!pin)
        return null;
    return {
        pin,
        active: claim.active === true,
        message: text(claim.message),
        timestamp: numberValue(claim.timestamp),
        developer: botViewModel(claim.developer, 'developer'),
    };
}
function detailViewModel(value) {
    const detail = asObject(value);
    if (!detail)
        return null;
    const taskPinId = text(detail.taskPinId);
    if (!taskPinId)
        return null;
    const timeline = asArray(detail.timeline)
        .map(timelineEventViewModel)
        .filter((event) => Boolean(event));
    return {
        taskPinId,
        taskPin: requiredCompactLabel(taskPinId),
        title: text(detail.title) || 'Untitled Loom task',
        state: text(detail.state),
        stateLabel: stateLabel(text(detail.state)),
        columnId: safeColumnId(detail.columnId),
        requirement: text(detail.requirement),
        criteria: text(detail.criteria),
        requester: botViewModel(detail.requester, 'requester'),
        claims: asArray(detail.claims)
            .map(claimViewModel)
            .filter((claim) => Boolean(claim)),
        warnings: asArray(detail.warnings)
            .map(warningViewModel)
            .filter((warning) => Boolean(warning)),
        timeline: sortTimeline(timeline),
    };
}
function buildLoomDashboardViewModel(input, now = Date.now()) {
    const dashboard = dashboardFrom(input);
    const rawColumns = asArray(dashboard.columns);
    const cards = buildCards(dashboard, rawColumns);
    const columns = columnsViewModel(dashboard, cards);
    const details = asArray(dashboard.details)
        .map(detailViewModel)
        .filter((detail) => Boolean(detail));
    return {
        actor: actorViewModel(dashboard.actor),
        summary: summaryViewModel(dashboard, now),
        columns,
        cards,
        details,
        emptyState: {
            title: 'No Loom tasks yet',
            body: 'No published task records are visible in the local dashboard cache yet. Refresh the dashboard after a task is published on-chain.',
        },
        refresh: refreshViewModel(dashboard, now),
    };
}
