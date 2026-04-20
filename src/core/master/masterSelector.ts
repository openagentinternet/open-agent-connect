import type { MasterDirectoryItem } from './masterTypes';

export interface MasterSelectorInput {
  hostMode: string;
  preferredDisplayName?: string | null;
  preferredMasterKind?: string | null;
  preferredMasterPinId?: string | null;
  preferredProviderGlobalMetaId?: string | null;
  trustedMasters?: string[];
  onlineOnly?: boolean;
  candidates: MasterDirectoryItem[];
}

export type MasterSelectionFailureCode =
  | 'master_not_found'
  | 'master_offline'
  | 'master_host_mode_mismatch';

export interface MasterSelectionResult {
  selectedMaster: MasterDirectoryItem | null;
  failureCode: MasterSelectionFailureCode | null;
  failureMessage: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComparableText(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function supportsHostMode(entry: MasterDirectoryItem, hostMode: string): boolean {
  const normalizedHost = normalizeComparableText(hostMode);
  if (!normalizedHost) {
    return true;
  }
  const entryHostModes = normalizeStringArray(entry.hostModes).map((value) => normalizeComparableText(value));
  return entryHostModes.length === 0 || entryHostModes.includes(normalizedHost);
}

function matchesPreferredDisplayName(entry: MasterDirectoryItem, preferredDisplayName: string): boolean {
  const preferred = normalizeComparableText(preferredDisplayName);
  if (!preferred) {
    return false;
  }

  const displayName = normalizeComparableText(entry.displayName);
  const serviceName = normalizeComparableText(entry.serviceName);
  return displayName === preferred
    || serviceName === preferred
    || displayName.includes(preferred)
    || serviceName.includes(preferred);
}

function computeSelectionScore(input: {
  entry: MasterDirectoryItem;
  preferredDisplayName: string | null;
  preferredMasterKind: string | null;
  preferredMasterPinId: string | null;
  preferredProviderGlobalMetaId: string | null;
  trustedMasters: Set<string>;
}): [number, number, number, number, number, number, number, number] {
  const entryPinId = normalizeText(input.entry.masterPinId);
  const entryProviderGlobalMetaId = normalizeText(input.entry.providerGlobalMetaId);
  const displayName = normalizeComparableText(input.entry.displayName);
  const serviceName = normalizeComparableText(input.entry.serviceName);
  const preferredDisplayName = normalizeComparableText(input.preferredDisplayName);
  const preferredMasterKind = normalizeComparableText(input.preferredMasterKind);
  const exactPinMatch = Number(Boolean(input.preferredMasterPinId) && entryPinId === input.preferredMasterPinId);
  const exactProviderMatch = Number(Boolean(input.preferredProviderGlobalMetaId)
    && entryProviderGlobalMetaId === input.preferredProviderGlobalMetaId);
  const exactDisplayNameMatch = preferredDisplayName
    ? Number(displayName === preferredDisplayName || serviceName === preferredDisplayName)
    : 0;
  const partialDisplayNameMatch = preferredDisplayName
    ? Number(displayName.includes(preferredDisplayName) || serviceName.includes(preferredDisplayName))
    : 0;
  const sameMasterKind = preferredMasterKind
    ? Number(normalizeComparableText(input.entry.masterKind) === preferredMasterKind)
    : 0;
  const trusted = Number(input.trustedMasters.has(entryPinId));
  const official = Number(input.entry.official === true);
  const online = Number(input.entry.online === true);

  return [
    exactPinMatch,
    exactProviderMatch,
    exactDisplayNameMatch,
    partialDisplayNameMatch,
    sameMasterKind,
    trusted,
    official,
    online,
  ];
}

export function rankMasterCandidates(input: MasterSelectorInput): MasterDirectoryItem[] {
  const preferredDisplayName = normalizeText(input.preferredDisplayName) || null;
  const preferredMasterKind = normalizeText(input.preferredMasterKind) || null;
  const preferredMasterPinId = normalizeText(input.preferredMasterPinId) || null;
  const preferredProviderGlobalMetaId = normalizeText(input.preferredProviderGlobalMetaId) || null;
  const trustedMasters = new Set(normalizeStringArray(input.trustedMasters));
  const onlineOnly = input.onlineOnly === true;

  let candidates = input.candidates.filter((entry) => (
    entry.available !== false
    && supportsHostMode(entry, input.hostMode)
    && (!onlineOnly || entry.online === true)
  ));

  const hasExplicitTarget = Boolean(preferredMasterPinId || preferredProviderGlobalMetaId || preferredDisplayName);

  if (preferredMasterPinId) {
    candidates = candidates.filter((entry) => normalizeText(entry.masterPinId) === preferredMasterPinId);
  }
  if (preferredProviderGlobalMetaId) {
    candidates = candidates.filter((entry) => normalizeText(entry.providerGlobalMetaId) === preferredProviderGlobalMetaId);
  }
  if (preferredDisplayName) {
    const matched = candidates.filter((entry) => matchesPreferredDisplayName(entry, preferredDisplayName));
    if (matched.length === 0) {
      return [];
    }
    candidates = matched;
  }
  if (!hasExplicitTarget && preferredMasterKind) {
    const matched = candidates.filter((entry) => normalizeComparableText(entry.masterKind) === normalizeComparableText(preferredMasterKind));
    if (matched.length === 0) {
      return [];
    }
    candidates = matched;
  }

  return [...candidates].sort((left, right) => {
    const leftScore = computeSelectionScore({
      entry: left,
      preferredDisplayName,
      preferredMasterKind,
      preferredMasterPinId,
      preferredProviderGlobalMetaId,
      trustedMasters,
    });
    const rightScore = computeSelectionScore({
      entry: right,
      preferredDisplayName,
      preferredMasterKind,
      preferredMasterPinId,
      preferredProviderGlobalMetaId,
      trustedMasters,
    });

    for (let index = 0; index < leftScore.length; index += 1) {
      if (rightScore[index] !== leftScore[index]) {
        return rightScore[index] - leftScore[index];
      }
    }

    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
}

export function selectMasterCandidate(input: MasterSelectorInput): MasterDirectoryItem | null {
  return resolveMasterCandidate(input).selectedMaster;
}

export function resolveMasterCandidate(input: MasterSelectorInput): MasterSelectionResult {
  const preferredDisplayName = normalizeText(input.preferredDisplayName) || null;
  const preferredMasterKind = normalizeText(input.preferredMasterKind) || null;
  const preferredMasterPinId = normalizeText(input.preferredMasterPinId) || null;
  const preferredProviderGlobalMetaId = normalizeText(input.preferredProviderGlobalMetaId) || null;
  const onlineOnly = input.onlineOnly === true;
  const hasExplicitTarget = Boolean(preferredMasterPinId || preferredProviderGlobalMetaId || preferredDisplayName);
  const available = input.candidates.filter((entry) => entry.available !== false);

  if (available.length === 0) {
    return {
      selectedMaster: null,
      failureCode: 'master_not_found',
      failureMessage: 'No eligible Master was found in the current directory.',
    };
  }

  const explicitMatches = hasExplicitTarget
    ? available.filter((entry) => (
        (!preferredMasterPinId || normalizeText(entry.masterPinId) === preferredMasterPinId)
        && (!preferredProviderGlobalMetaId || normalizeText(entry.providerGlobalMetaId) === preferredProviderGlobalMetaId)
        && (!preferredDisplayName || matchesPreferredDisplayName(entry, preferredDisplayName))
      ))
    : available;

  if (hasExplicitTarget && explicitMatches.length === 0) {
    return {
      selectedMaster: null,
      failureCode: 'master_not_found',
      failureMessage: 'The requested Master could not be found in the current directory.',
    };
  }

  const hostMatched = explicitMatches.filter((entry) => supportsHostMode(entry, input.hostMode));
  if (hostMatched.length === 0) {
    return {
      selectedMaster: null,
      failureCode: 'master_host_mode_mismatch',
      failureMessage: 'No eligible Master supports the current host mode.',
    };
  }

  const onlineMatched = onlineOnly
    ? hostMatched.filter((entry) => entry.online === true)
    : hostMatched;
  if (onlineOnly && onlineMatched.length === 0) {
    return {
      selectedMaster: null,
      failureCode: 'master_offline',
      failureMessage: 'The matched Master is currently offline.',
    };
  }

  if (!hasExplicitTarget && preferredMasterKind) {
    const kindMatched = onlineMatched.filter((entry) => (
      normalizeComparableText(entry.masterKind) === normalizeComparableText(preferredMasterKind)
    ));
    if (kindMatched.length === 0) {
      return {
        selectedMaster: null,
        failureCode: 'master_not_found',
        failureMessage: 'No eligible Master matched the requested Master kind.',
      };
    }
  }

  const selected = rankMasterCandidates(input)[0] ?? null;
  if (!selected) {
    return {
      selectedMaster: null,
      failureCode: 'master_not_found',
      failureMessage: 'No eligible Master matched the current selection request.',
    };
  }

  return {
    selectedMaster: selected,
    failureCode: null,
    failureMessage: null,
  };
}
