import {
  readOnlineMetaBotsFromSocketPresence,
  type OnlineMetaBotDirectoryItem,
} from './socketPresenceDirectory';
import { normalizeComparableGlobalMetaId } from './serviceDirectory';

const DEFAULT_SOCKET_PRESENCE_LIMIT = 100;

export type SocketPresenceFailureMode = 'throw' | 'assume_service_providers_online';

export interface SocketPresenceProjection {
  online: boolean;
  lastSeenSec: number | null;
  lastSeenAt: number | null;
  lastSeenAgoSeconds: number | null;
  deviceCount: number | null;
  providerName: string;
}

export interface SocketPresenceRecordProjectionOptions {
  fetchImpl?: typeof fetch;
  socketPresenceApiBaseUrl?: string;
  socketPresenceLimit?: number;
  socketPresenceFailureMode?: SocketPresenceFailureMode;
  onlineOnly?: boolean;
}

function normalizeSocketPresenceLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SOCKET_PRESENCE_LIMIT;
  }
  return Math.min(DEFAULT_SOCKET_PRESENCE_LIMIT, Math.max(1, Math.floor(value as number)));
}

function normalizeLastSeenSec(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value > 1e12) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function resolveRecordGlobalMetaId(record: Record<string, unknown>): string {
  return normalizeComparableGlobalMetaId(
    record.providerGlobalMetaId
      ?? record.globalMetaId
      ?? record.providerMetaBot
      ?? record.providerMetabot,
  );
}

function buildOnlineMetaBotIndex(
  bots: OnlineMetaBotDirectoryItem[],
): Map<string, OnlineMetaBotDirectoryItem> {
  const index = new Map<string, OnlineMetaBotDirectoryItem>();
  for (const bot of bots) {
    const globalMetaId = normalizeComparableGlobalMetaId(bot.globalMetaId);
    if (!globalMetaId || index.has(globalMetaId)) {
      continue;
    }
    index.set(globalMetaId, bot);
  }
  return index;
}

function buildSyntheticOnlineBotsFromRecords(
  records: Array<Record<string, unknown>>,
): OnlineMetaBotDirectoryItem[] {
  const nowMs = Date.now();
  const seen = new Set<string>();
  const bots: OnlineMetaBotDirectoryItem[] = [];
  for (const record of records) {
    const globalMetaId = resolveRecordGlobalMetaId(record);
    if (!globalMetaId || seen.has(globalMetaId)) {
      continue;
    }
    seen.add(globalMetaId);
    bots.push({
      globalMetaId,
      lastSeenAt: nowMs,
      lastSeenAgoSeconds: 0,
      deviceCount: 1,
      online: true,
      name: '',
      goal: '',
    });
  }
  return bots;
}

export function decorateRecordsWithOnlineBots<T extends object>(input: {
  records: T[];
  onlineBots: OnlineMetaBotDirectoryItem[];
  onlineOnly?: boolean;
}): Array<T & SocketPresenceProjection> {
  const onlineIndex = buildOnlineMetaBotIndex(input.onlineBots);
  const decorated = input.records.map((record) => {
    const recordObject = record as Record<string, unknown>;
    const globalMetaId = resolveRecordGlobalMetaId(recordObject);
    const onlineBot = globalMetaId ? onlineIndex.get(globalMetaId) : undefined;
    const lastSeenAt = typeof onlineBot?.lastSeenAt === 'number' && Number.isFinite(onlineBot.lastSeenAt)
      ? Math.max(0, Math.floor(onlineBot.lastSeenAt))
      : null;
    return {
      ...record,
      online: Boolean(onlineBot),
      lastSeenSec: normalizeLastSeenSec(lastSeenAt),
      lastSeenAt,
      lastSeenAgoSeconds: typeof onlineBot?.lastSeenAgoSeconds === 'number'
        ? Math.max(0, Math.floor(onlineBot.lastSeenAgoSeconds))
        : null,
      deviceCount: typeof onlineBot?.deviceCount === 'number'
        ? Math.max(0, Math.floor(onlineBot.deviceCount))
        : null,
      providerName: onlineBot?.name ?? '',
    };
  });

  if (input.onlineOnly === true) {
    return decorated.filter((record) => record.online);
  }
  return decorated;
}

export async function decorateRecordsWithSocketPresence<T extends object>(
  records: T[],
  options: SocketPresenceRecordProjectionOptions = {},
): Promise<Array<T & SocketPresenceProjection>> {
  let onlineBots: OnlineMetaBotDirectoryItem[] = [];
  try {
    const onlineDirectory = await readOnlineMetaBotsFromSocketPresence({
      fetchImpl: options.fetchImpl,
      apiBaseUrl: options.socketPresenceApiBaseUrl,
      limit: normalizeSocketPresenceLimit(options.socketPresenceLimit),
    });
    onlineBots = onlineDirectory.bots;
  } catch (error) {
    if (options.socketPresenceFailureMode === 'assume_service_providers_online') {
      onlineBots = buildSyntheticOnlineBotsFromRecords(
        records.map((record) => ({ ...(record as Record<string, unknown>) })),
      );
    } else if (options.onlineOnly === true) {
      throw error;
    }
  }

  return decorateRecordsWithOnlineBots({
    records,
    onlineBots,
    onlineOnly: options.onlineOnly,
  });
}
