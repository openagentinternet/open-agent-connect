import { readChainDirectoryWithFallback, type SocketPresenceFailureMode } from './chainDirectoryReader';
import {
  buildOnlineServiceCacheState,
  type OnlineServiceCacheState,
  type OnlineServiceCacheStore,
} from './onlineServiceCache';
import type { RatingDetailStateStore } from '../ratings/ratingDetailState';
import { refreshRatingDetailCacheFromChain } from '../ratings/ratingDetailSync';

export interface RefreshOnlineServiceCacheInput {
  store: OnlineServiceCacheStore;
  ratingDetailStateStore?: RatingDetailStateStore;
  chainApiBaseUrl?: string;
  socketPresenceApiBaseUrl?: string;
  socketPresenceFailureMode?: SocketPresenceFailureMode;
  fetchSeededDirectoryServices?: () => Promise<Array<Record<string, unknown>>>;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  now?: () => number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function enrichServicesWithProviderChatPublicKeys(input: {
  services: Array<Record<string, unknown>>;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
}): Promise<Array<Record<string, unknown>>> {
  if (!input.resolvePeerChatPublicKey) {
    return input.services;
  }
  const chatKeyByProvider = new Map<string, string | null>();
  const enriched = [];
  for (const service of input.services) {
    const providerGlobalMetaId = normalizeText(service.providerGlobalMetaId ?? service.globalMetaId);
    const existingChatKey = normalizeText(service.providerChatPublicKey ?? service.chatPublicKey);
    if (!providerGlobalMetaId || existingChatKey) {
      enriched.push(existingChatKey ? { ...service, providerChatPublicKey: existingChatKey } : service);
      continue;
    }
    if (!chatKeyByProvider.has(providerGlobalMetaId)) {
      try {
        chatKeyByProvider.set(
          providerGlobalMetaId,
          normalizeText(await input.resolvePeerChatPublicKey(providerGlobalMetaId)) || null,
        );
      } catch {
        chatKeyByProvider.set(providerGlobalMetaId, null);
      }
    }
    const providerChatPublicKey = chatKeyByProvider.get(providerGlobalMetaId);
    enriched.push(providerChatPublicKey ? { ...service, providerChatPublicKey } : service);
  }
  return enriched;
}

export async function refreshOnlineServiceCacheFromChain(
  input: RefreshOnlineServiceCacheInput,
): Promise<OnlineServiceCacheState> {
  const current = await input.store.read();
  const directory = await readChainDirectoryWithFallback({
    chainApiBaseUrl: input.chainApiBaseUrl,
    socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
    socketPresenceFailureMode: input.socketPresenceFailureMode,
    onlineOnly: true,
    fetchSeededDirectoryServices: input.fetchSeededDirectoryServices ?? (async () => []),
  });

  if (directory.fallbackUsed && directory.services.length === 0 && current.services.length > 0) {
    return current;
  }

  let ratingDetails: Awaited<ReturnType<RatingDetailStateStore['read']>>['items'] = [];
  if (input.ratingDetailStateStore) {
    const currentRatingState = await input.ratingDetailStateStore.read();
    try {
      const refreshed = await refreshRatingDetailCacheFromChain({
        store: input.ratingDetailStateStore,
        chainApiBaseUrl: input.chainApiBaseUrl,
        now: input.now,
      });
      ratingDetails = refreshed.state.items;
    } catch {
      ratingDetails = currentRatingState.items;
    }
  }

  const services = await enrichServicesWithProviderChatPublicKeys({
    services: directory.services,
    resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
  });

  return input.store.write(buildOnlineServiceCacheState({
    services,
    ratingDetails,
    discoverySource: directory.source,
    fallbackUsed: directory.fallbackUsed,
    now: input.now,
  }));
}
