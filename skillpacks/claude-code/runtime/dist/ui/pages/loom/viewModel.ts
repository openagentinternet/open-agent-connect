import type {
  LoomDashboardColumnId,
  LoomDashboardStateTone,
  LoomDashboardTimelineEventKind,
} from '../../../core/loom/dashboardTypes';

type PlainObject = Record<string, unknown>;

export interface LoomCopyLabelViewModel {
  label: string;
  copyValue: string;
}

export interface LoomMetricViewModel {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'warning';
}

export interface LoomBotViewModel {
  displayName: string;
  initials: string;
  fallbackLabel: string;
  globalMetaId: string;
  address: string;
  avatarUri: string | null;
  role: string;
}

export interface LoomActorViewModel {
  profileSlug: string;
  displayLabel: string;
  globalMetaId: LoomCopyLabelViewModel;
  address: LoomCopyLabelViewModel | null;
}

export interface LoomCardViewModel {
  taskPinId: string;
  taskPin: LoomCopyLabelViewModel;
  title: string;
  state: string;
  stateLabel: string;
  stateTone: LoomDashboardStateTone;
  columnId: LoomDashboardColumnId;
  requester: LoomBotViewModel;
  developer: LoomBotViewModel | null;
  bountyLabel: string;
  repoLabel: string;
  tags: string[];
  latestStatusSummary: string;
  prUrl: string;
  paymentTxId: LoomCopyLabelViewModel | null;
  warningCount: number;
  warningLabel: string;
  warningTone: 'neutral' | 'warning';
  actionLabel: string;
  updatedAt: number;
  createdAt: number;
}

export interface LoomColumnViewModel {
  id: LoomDashboardColumnId;
  title: string;
  cards: LoomCardViewModel[];
}

export interface LoomTimelineEventViewModel {
  id: string;
  kind: string;
  title: string;
  summary: string;
  timestamp: number;
  pin: LoomCopyLabelViewModel | null;
  tone: 'neutral' | 'warning';
}

export interface LoomWarningViewModel {
  code: string;
  message: string;
  protocol: string;
  timestamp: number;
  pin: LoomCopyLabelViewModel;
  tone: 'warning';
}

export interface LoomClaimViewModel {
  pin: LoomCopyLabelViewModel;
  active: boolean;
  message: string;
  timestamp: number;
  developer: LoomBotViewModel;
}

export interface LoomDetailViewModel {
  taskPinId: string;
  taskPin: LoomCopyLabelViewModel;
  title: string;
  state: string;
  stateLabel: string;
  columnId: LoomDashboardColumnId;
  requirement: string;
  criteria: string;
  requester: LoomBotViewModel;
  claims: LoomClaimViewModel[];
  warnings: LoomWarningViewModel[];
  timeline: LoomTimelineEventViewModel[];
}

export interface LoomDashboardViewModel {
  actor: LoomActorViewModel;
  summary: {
    metrics: LoomMetricViewModel[];
    newestActivityLabel: string;
  };
  columns: LoomColumnViewModel[];
  cards: LoomCardViewModel[];
  details: LoomDetailViewModel[];
  emptyState: {
    title: string;
    body: string;
  };
  refresh: {
    isStale: boolean;
    tone: 'neutral' | 'warning';
    warningLabel: string;
    updatedLabel: string;
  };
}

const BOARD_COLUMNS: Array<{ id: LoomDashboardColumnId; title: string }> = [
  { id: 'open', title: 'Open' },
  { id: 'claimed', title: 'Claimed' },
  { id: 'working', title: 'Working' },
  { id: 'review', title: 'Review' },
  { id: 'revision', title: 'Revision' },
  { id: 'closed', title: 'Closed' },
];

const TIMELINE_PRIORITY: Record<string, number> = {
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

function asObject(value: unknown): PlainObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PlainObject
    : null;
}

function asArray(value: unknown): PlainObject[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is PlainObject => Boolean(asObject(entry)))
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function dashboardFrom(input: unknown): PlainObject {
  const root = asObject(input);
  if (!root) return {};
  return asObject(root.dashboard) ?? root;
}

function compactLabel(value: string): LoomCopyLabelViewModel | null {
  if (!value) return null;
  if (value.length <= 18) return { label: value, copyValue: value };
  return {
    label: `${value.slice(0, 8)}...${value.slice(-4)}`,
    copyValue: value,
  };
}

function requiredCompactLabel(value: unknown, fallback = ''): LoomCopyLabelViewModel {
  const normalized = text(value) || fallback;
  return compactLabel(normalized) ?? { label: '', copyValue: '' };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

function stateLabel(state: string): string {
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

function safeColumnId(value: unknown): LoomDashboardColumnId {
  const id = text(value);
  return BOARD_COLUMNS.some((column) => column.id === id)
    ? id as LoomDashboardColumnId
    : 'open';
}

function safeStateTone(value: unknown): LoomDashboardStateTone {
  const tone = text(value);
  if (['neutral', 'info', 'progress', 'review', 'warning', 'success', 'danger'].includes(tone)) {
    return tone as LoomDashboardStateTone;
  }
  return 'neutral';
}

function botViewModel(value: unknown, roleFallback: string): LoomBotViewModel {
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

function actorViewModel(value: unknown): LoomActorViewModel {
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

function bountyLabel(value: unknown): string {
  const bounty = asObject(value);
  if (!bounty) return 'Bounty not set';
  return [text(bounty.amount), text(bounty.currency)].filter(Boolean).join(' ') || 'Bounty not set';
}

function repoLabel(value: unknown): string {
  const repo = asObject(value);
  if (!repo) return 'Repository not set';
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
  } catch {
    readableRepo = repoUri;
  }
  return [readableRepo || 'Repository not set', baseBranch].filter(Boolean).join(' @ ');
}

function actionLabel(actorContext: unknown): string {
  const actor = asObject(actorContext);
  return actor?.needsMyAction === true ? 'Needs my action' : '';
}

function cardViewModel(value: unknown): LoomCardViewModel | null {
  const card = asObject(value);
  if (!card) return null;
  const taskPinId = text(card.taskPinId);
  if (!taskPinId) return null;
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

function flattenColumnCards(columns: PlainObject[]): LoomCardViewModel[] {
  return columns
    .flatMap((column) => asArray(column.cards))
    .map(cardViewModel)
    .filter((card): card is LoomCardViewModel => Boolean(card));
}

function buildCards(dashboard: PlainObject, columns: PlainObject[]): LoomCardViewModel[] {
  const taskCards = asArray(dashboard.tasks)
    .map(cardViewModel)
    .filter((card): card is LoomCardViewModel => Boolean(card));
  return taskCards.length ? taskCards : flattenColumnCards(columns);
}

function columnsViewModel(dashboard: PlainObject, allCards: LoomCardViewModel[]): LoomColumnViewModel[] {
  const rawColumns = asArray(dashboard.columns);
  const cardsByColumn = new Map<LoomDashboardColumnId, LoomCardViewModel[]>();

  for (const column of rawColumns) {
    const id = safeColumnId(column.id);
    const cards = asArray(column.cards)
      .map(cardViewModel)
      .filter((card): card is LoomCardViewModel => Boolean(card));
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

function metric(id: string, label: string, value: number, tone: 'neutral' | 'warning' = 'neutral'): LoomMetricViewModel {
  return {
    id,
    label,
    value: value.toLocaleString('en-US'),
    tone,
  };
}

function summaryViewModel(dashboard: PlainObject, now: number): LoomDashboardViewModel['summary'] {
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

function relativeTimeLabel(timestamp: number, now: number): string {
  if (!timestamp) return 'Never';
  const ageMs = Math.max(0, now - timestamp);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (ageMs < minuteMs) return 'just now';
  if (ageMs < hourMs) return `${Math.floor(ageMs / minuteMs)}m ago`;
  if (ageMs < dayMs) return `${Math.floor(ageMs / hourMs)}h ago`;
  return `${Math.floor(ageMs / dayMs)}d ago`;
}

function refreshViewModel(dashboard: PlainObject, now: number): LoomDashboardViewModel['refresh'] {
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

function timelineEventViewModel(value: unknown): LoomTimelineEventViewModel | null {
  const event = asObject(value);
  if (!event) return null;
  const kind = text(event.kind);
  if (!TIMELINE_KINDS.has(kind)) return null;
  const pinId = text(event.pinId);
  const id = text(event.id) || (pinId ? `${kind}:${pinId}` : '');
  if (!id) return null;
  const pin = compactLabel(text(event.pinId));
  return {
    id,
    kind: kind as LoomDashboardTimelineEventKind,
    title: text(event.title) || stateLabel(kind),
    summary: text(event.summary),
    timestamp: numberValue(event.timestamp),
    pin,
    tone: kind === 'invalid_record' || text(event.warningCode) ? 'warning' : 'neutral',
  };
}

function sortTimeline(events: LoomTimelineEventViewModel[]): LoomTimelineEventViewModel[] {
  return [...events].sort((left, right) => (
    left.timestamp - right.timestamp
    || (TIMELINE_PRIORITY[left.kind] ?? 99) - (TIMELINE_PRIORITY[right.kind] ?? 99)
    || left.id.localeCompare(right.id, 'en')
  ));
}

function warningViewModel(value: unknown): LoomWarningViewModel | null {
  const warning = asObject(value);
  if (!warning) return null;
  const pin = compactLabel(text(warning.recordPinId));
  if (!pin) return null;
  return {
    code: text(warning.code),
    message: text(warning.message),
    protocol: text(warning.protocol),
    timestamp: numberValue(warning.timestamp),
    pin,
    tone: 'warning',
  };
}

function claimViewModel(value: unknown): LoomClaimViewModel | null {
  const claim = asObject(value);
  if (!claim) return null;
  const pin = compactLabel(text(claim.pinId));
  if (!pin) return null;
  return {
    pin,
    active: claim.active === true,
    message: text(claim.message),
    timestamp: numberValue(claim.timestamp),
    developer: botViewModel(claim.developer, 'developer'),
  };
}

function detailViewModel(value: unknown): LoomDetailViewModel | null {
  const detail = asObject(value);
  if (!detail) return null;
  const taskPinId = text(detail.taskPinId);
  if (!taskPinId) return null;
  const timeline = asArray(detail.timeline)
    .map(timelineEventViewModel)
    .filter((event): event is LoomTimelineEventViewModel => Boolean(event));
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
      .filter((claim): claim is LoomClaimViewModel => Boolean(claim)),
    warnings: asArray(detail.warnings)
      .map(warningViewModel)
      .filter((warning): warning is LoomWarningViewModel => Boolean(warning)),
    timeline: sortTimeline(timeline),
  };
}

export function buildLoomDashboardViewModel(input: unknown, now = Date.now()): LoomDashboardViewModel {
  const dashboard = dashboardFrom(input);
  const rawColumns = asArray(dashboard.columns);
  const cards = buildCards(dashboard, rawColumns);
  const columns = columnsViewModel(dashboard, cards);
  const details = asArray(dashboard.details)
    .map(detailViewModel)
    .filter((detail): detail is LoomDetailViewModel => Boolean(detail));

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
