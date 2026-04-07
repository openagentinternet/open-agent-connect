export const CHAIN_HEARTBEAT_PROTOCOL_PATH = '/protocols/metabot-heartbeat';
export const HEARTBEAT_ONLINE_WINDOW_SEC = 10 * 60;

export interface ChainHeartbeatEntry {
  address: string;
  timestamp: number | null;
  source?: string | null;
  error?: string | null;
}

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isChainHeartbeatSemanticMiss(payload: unknown): boolean {
  const list = (
    (payload as { data?: { list?: unknown } } | null)?.data?.list
    ?? (payload as { list?: unknown } | null)?.list
    ?? (payload as { result?: { list?: unknown } } | null)?.result?.list
  );
  return !Array.isArray(list) || list.length === 0;
}

export function parseHeartbeatTimestamp(payload: unknown): number | null {
  const list = (
    (payload as { data?: { list?: unknown } } | null)?.data?.list
    ?? (payload as { list?: unknown } | null)?.list
    ?? (payload as { result?: { list?: unknown } } | null)?.result?.list
  );
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const item = list[0] as Record<string, unknown>;
  return toNumberOrNull(item?.seenTime ?? item?.seen_time);
}

export function isHeartbeatFresh(timestampSec: number | null, nowMs: number = Date.now()): boolean {
  if (timestampSec == null) return false;
  const nowSec = Math.floor(nowMs / 1000);
  return nowSec - timestampSec <= HEARTBEAT_ONLINE_WINDOW_SEC;
}

export function applyHeartbeatOnlineState<T extends { providerAddress?: unknown }>(
  services: T[],
  heartbeats: ChainHeartbeatEntry[],
  options: { now?: () => number } = {}
): Array<T & { online: boolean; lastSeenSec: number | null }> {
  const heartbeatByAddress = new Map<string, number | null>();
  for (const heartbeat of heartbeats) {
    const address = toSafeString(heartbeat.address);
    if (!address) {
      continue;
    }
    const current = heartbeatByAddress.get(address) ?? null;
    if (current == null || ((heartbeat.timestamp ?? -Infinity) > current)) {
      heartbeatByAddress.set(address, heartbeat.timestamp ?? null);
    }
  }

  const nowMs = options.now ? options.now() : Date.now();
  return services.map((service) => {
    const address = toSafeString(service.providerAddress);
    const lastSeenSec = address ? (heartbeatByAddress.get(address) ?? null) : null;
    return {
      ...service,
      online: isHeartbeatFresh(lastSeenSec, nowMs),
      lastSeenSec,
    };
  });
}

export function filterOnlineChainServices<T extends { providerAddress?: unknown }>(
  services: T[],
  heartbeats: ChainHeartbeatEntry[],
  options: { now?: () => number } = {}
): Array<T & { online: true; lastSeenSec: number | null }> {
  return applyHeartbeatOnlineState(services, heartbeats, options)
    .filter((service): service is T & { online: true; lastSeenSec: number | null } => service.online);
}
