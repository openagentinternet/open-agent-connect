"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHubServiceDirectoryViewModel = buildHubServiceDirectoryViewModel;
function buildHubServiceDirectoryViewModel(input) {
    const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';
    const normalizeTimestamp = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return null;
        }
        if (value >= 1_000_000_000 && value < 1_000_000_000_000) {
            return value * 1000;
        }
        return value;
    };
    const compareText = (left, right) => left.localeCompare(right, 'en');
    const services = Array.isArray(input.services) ? input.services : [];
    const seen = new Set();
    const entries = [];
    for (const service of services) {
        const servicePinId = normalizeText(service.servicePinId);
        const key = servicePinId || normalizeText(service.displayName) || normalizeText(service.providerGlobalMetaId);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        const displayName = normalizeText(service.displayName)
            || normalizeText(service.serviceName)
            || 'Unnamed MetaBot service';
        const providerName = normalizeText(service.providerName);
        const providerGmid = normalizeText(service.providerGlobalMetaId);
        const providerLabel = providerName && providerGmid
            ? `${providerName}(${providerGmid})`
            : providerGmid || providerName || 'Unknown provider';
        const description = normalizeText(service.description) || 'No service description published yet.';
        const priceAmount = normalizeText(service.price);
        const priceCurrency = normalizeText(service.currency);
        const capabilityLabel = normalizeText(service.providerSkill)
            || normalizeText(service.serviceName)
            || 'unspecified-capability';
        const online = service.online === true;
        const updatedAtMs = normalizeTimestamp(service.updatedAt);
        const lastSeenAtMs = normalizeTimestamp(service.lastSeenSec ?? service.lastSeenAt ?? service.lastSeen);
        const lastSeenAgoSeconds = typeof service.lastSeenAgoSeconds === 'number' ? service.lastSeenAgoSeconds : null;
        entries.push({
            key,
            servicePinId,
            displayName,
            description,
            providerLabel,
            providerName,
            providerGmid,
            priceLabel: [priceAmount, priceCurrency].filter(Boolean).join(' ') || 'Free / unknown',
            capabilityLabel,
            statusLabel: online ? 'Online now' : lastSeenAtMs ? 'Recently seen' : 'Offline',
            statusTone: online ? 'online' : lastSeenAtMs ? 'recent' : 'offline',
            updatedAtMs,
            lastSeenAtMs,
            lastSeenAgoSeconds,
        });
    }
    entries.sort((left, right) => {
        if (left.statusTone !== right.statusTone) {
            if (left.statusTone === 'online')
                return -1;
            if (right.statusTone === 'online')
                return 1;
            if (left.statusTone === 'recent')
                return -1;
            if (right.statusTone === 'recent')
                return 1;
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
        emptyTitle: 'No online MetaBot services yet',
        emptyBody: 'The local yellow pages has no visible services right now. Add a directory source or wait for an online MetaBot to publish itself on-chain.',
    };
}
