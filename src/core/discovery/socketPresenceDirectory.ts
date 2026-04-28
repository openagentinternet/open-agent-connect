const DEFAULT_SOCKET_PRESENCE_API_BASE = 'https://api.idchat.io';
const DEFAULT_SOCKET_PRESENCE_SIZE = 20;
const MAX_SOCKET_PRESENCE_SIZE = 100;

interface SocketPresenceEnvelope {
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

interface SocketPresenceUserInfo {
  name?: unknown;
  bio?: unknown;
}

interface SocketPresenceUserRow {
  globalMetaId?: unknown;
  lastSeenAt?: unknown;
  lastSeenAgoSeconds?: unknown;
  deviceCount?: unknown;
  userInfo?: unknown;
}

export interface OnlineMetaBotDirectoryItem {
  globalMetaId: string;
  lastSeenAt: number;
  lastSeenAgoSeconds: number;
  deviceCount: number;
  online: true;
  name: string;
  goal: string;
}

export interface ReadOnlineMetaBotsFromSocketPresenceOptions {
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  limit?: number;
}

export interface ReadOnlineMetaBotsFromSocketPresenceResult {
  source: 'socket_presence';
  total: number;
  onlineWindowSeconds: number | null;
  bots: OnlineMetaBotDirectoryItem[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (Number.isFinite(parsed)) {
    return Math.max(0, parsed);
  }
  return fallback;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = normalizeText(value);
  return (normalized || DEFAULT_SOCKET_PRESENCE_API_BASE).replace(/\/$/, '');
}

function normalizeListSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SOCKET_PRESENCE_SIZE;
  }
  return Math.min(
    MAX_SOCKET_PRESENCE_SIZE,
    Math.max(1, Math.floor(value as number))
  );
}

function normalizeBioGoal(bio: unknown): string {
  const bioStr = normalizeText(bio);
  if (!bioStr) return '';
  try {
    const parsed = JSON.parse(bioStr) as Record<string, unknown>;
    return normalizeText(parsed.goal);
  } catch {
    return bioStr;
  }
}

function normalizeUserRow(row: SocketPresenceUserRow): OnlineMetaBotDirectoryItem | null {
  const globalMetaId = normalizeText(row.globalMetaId);
  if (!globalMetaId) {
    return null;
  }

  const userInfo = row.userInfo && typeof row.userInfo === 'object'
    ? row.userInfo as SocketPresenceUserInfo
    : {} as SocketPresenceUserInfo;

  return {
    globalMetaId,
    lastSeenAt: normalizeInteger(row.lastSeenAt),
    lastSeenAgoSeconds: normalizeInteger(row.lastSeenAgoSeconds),
    deviceCount: normalizeInteger(row.deviceCount),
    online: true,
    name: normalizeText(userInfo.name),
    goal: normalizeBioGoal(userInfo.bio),
  };
}

function parseOnlineUsersEnvelope(
  payload: unknown,
): ReadOnlineMetaBotsFromSocketPresenceResult {
  const envelope = (payload ?? {}) as SocketPresenceEnvelope;
  const code = normalizeInteger(envelope.code, Number.NaN);
  if (code !== 0) {
    throw new Error('socket_presence_semantic_error');
  }

  const data = envelope.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : {};
  const rows = Array.isArray(data.list) ? data.list : [];
  const bots = rows
    .map((entry) => normalizeUserRow(entry as SocketPresenceUserRow))
    .filter((entry): entry is OnlineMetaBotDirectoryItem => entry !== null);

  const windowSeconds = data.onlineWindowSeconds;
  const onlineWindowSeconds = typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
    ? Math.max(0, Math.floor(windowSeconds))
    : null;

  return {
    source: 'socket_presence',
    total: normalizeInteger(data.total, bots.length),
    onlineWindowSeconds,
    bots,
  };
}

export async function readOnlineMetaBotsFromSocketPresence(
  options: ReadOnlineMetaBotsFromSocketPresenceOptions = {},
): Promise<ReadOnlineMetaBotsFromSocketPresenceResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const size = normalizeListSize(options.limit);
  const url = new URL(`${normalizeApiBaseUrl(options.apiBaseUrl)}/group-chat/socket/online-users`);
  url.searchParams.set('cursor', '0');
  url.searchParams.set('size', String(size));
  url.searchParams.set('withUserInfo', 'true');

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`socket_presence_http_${response.status}`);
  }

  const payload = await response.json() as unknown;
  const parsed = parseOnlineUsersEnvelope(payload);

  return {
    ...parsed,
    bots: parsed.bots.slice(0, size),
  };
}
