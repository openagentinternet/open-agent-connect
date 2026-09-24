export interface HubServiceDirectoryEntry {
  key: string;
  servicePinId: string;
  displayName: string;
  description: string;
  providerLabel: string;
  providerName: string;
  providerGmid: string;
  priceLabel: string;
  capabilityLabel: string;
  statusLabel: string;
  statusTone: 'online' | 'recent' | 'offline';
  updatedAtMs: number | null;
  lastSeenAtMs: number | null;
  lastSeenAgoSeconds: number | null;
}

export interface HubServiceDirectoryViewModel {
  countLabel: string;
  entries: HubServiceDirectoryEntry[];
  emptyTitle: string;
  emptyBody: string;
}

export type HubTranslate = (key: string, fallback?: string, replacements?: Record<string, string | number>) => string;

export function buildHubServiceDirectoryViewModel(input: {
  services?: Array<Record<string, unknown>> | null;
  t?: HubTranslate;
}): HubServiceDirectoryViewModel {
  // Localize through the injected translator when the caller provides one (the
  // browser page injects its i18n-backed uiText). Server-side callers (tests,
  // diagnostics) omit `t` and get the byte-identical English defaults.
  const replaceTokens = (template: string, replacements?: Record<string, string | number>): string =>
    Object.keys(replacements || {}).reduce(
      (text, name) => text.split('{' + name + '}').join(String((replacements || {})[name])),
      String(template == null ? '' : template),
    );
  const t: HubTranslate = input.t ?? ((_key, fallback, replacements) => replaceTokens(fallback ?? '', replacements));
  const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  const normalizeTimestamp = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (value >= 1_000_000_000 && value < 1_000_000_000_000) {
      return value * 1000;
    }
    return value;
  };
  const compareText = (left: string, right: string): number =>
    left.localeCompare(right, 'en');
  const services = Array.isArray(input.services) ? input.services : [];
  const seen = new Set<string>();
  const entries: HubServiceDirectoryEntry[] = [];

  for (const service of services) {
    const servicePinId = normalizeText(service.servicePinId);
    const key = servicePinId || normalizeText(service.displayName) || normalizeText(service.providerGlobalMetaId);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const displayName = normalizeText(service.displayName)
      || normalizeText(service.serviceName)
      || t('hub.unnamedService', 'Unnamed MetaBot service');
    const providerName = normalizeText(service.providerName);
    const providerGmid = normalizeText(service.providerGlobalMetaId);
    const providerLabel = providerName && providerGmid
      ? `${providerName}(${providerGmid})`
      : providerGmid || providerName || t('hub.unknownProvider', 'Unknown provider');
    const description = normalizeText(service.description) || t('hub.noDescription', 'No service description published yet.');
    const priceAmount = normalizeText(service.price);
    const priceCurrency = normalizeText(service.currency);
    const capabilityLabel = normalizeText(service.providerSkill)
      || normalizeText(service.serviceName)
      || 'unspecified-capability';
    const online = service.online === true;
    const updatedAtMs = normalizeTimestamp(service.updatedAt);
    const lastSeenAtMs = normalizeTimestamp(service.lastSeenSec ?? service.lastSeenAt ?? service.lastSeen);

    const lastSeenAgoSeconds = typeof service.lastSeenAgoSeconds === 'number' ? service.lastSeenAgoSeconds as number : null;

    entries.push({
      key,
      servicePinId,
      displayName,
      description,
      providerLabel,
      providerName,
      providerGmid,
      priceLabel: [priceAmount, priceCurrency].filter(Boolean).join(' ') || t('hub.priceFree', 'Free / unknown'),
      capabilityLabel,
      statusLabel: online
        ? t('hub.statusOnline', 'Online now')
        : lastSeenAtMs
          ? t('hub.statusRecent', 'Recently seen')
          : t('hub.statusOffline', 'Offline'),
      statusTone: online ? 'online' : lastSeenAtMs ? 'recent' : 'offline',
      updatedAtMs,
      lastSeenAtMs,
      lastSeenAgoSeconds,
    });
  }

  entries.sort((left, right) => {
    if (left.statusTone !== right.statusTone) {
      if (left.statusTone === 'online') return -1;
      if (right.statusTone === 'online') return 1;
      if (left.statusTone === 'recent') return -1;
      if (right.statusTone === 'recent') return 1;
    }

    const leftSeen = left.lastSeenAtMs ?? 0;
    const rightSeen = right.lastSeenAtMs ?? 0;
    if (leftSeen !== rightSeen) {
      return rightSeen - leftSeen;
    }

    const leftUpdated = left.updatedAtMs ?? 0;
    const rightUpdated = right.updatedAtMs ?? 0;
    if (leftUpdated !== rightUpdated) {
      return rightUpdated - leftUpdated;
    }

    return compareText(left.displayName, right.displayName);
  });

  return {
    countLabel: String(entries.length),
    entries,
    emptyTitle: t('hub.emptyTitle', 'No online MetaBot services yet'),
    emptyBody: t('hub.emptyBody', 'The local yellow pages has no visible services right now. Add a directory source or wait for an online MetaBot to publish itself on-chain.'),
  };
}
