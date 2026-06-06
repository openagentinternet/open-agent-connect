import type {
  BrowserProofSummary,
  BrowserResolveResult,
  BrowserTrustedAction,
  BrowserVerificationState,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function recordField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function verificationState(value: unknown): BrowserVerificationState {
  return value === 'verified' || value === 'partial' || value === 'unverified'
    ? value
    : 'unverified';
}

function shortGlobalMetaId(globalMetaId: string): string {
  if (globalMetaId.length <= 14) {
    return globalMetaId;
  }
  return `${globalMetaId.slice(0, 8)}...${globalMetaId.slice(-4)}`;
}

function onlineState(value: unknown): boolean | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = stringField(value, 'state').toLowerCase();
  if (state === 'online') {
    return true;
  }
  if (state === 'offline') {
    return false;
  }
  return null;
}

function proofSummary(value: unknown, fallbackState: BrowserVerificationState): BrowserProofSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const summary: BrowserProofSummary = {
    verificationState: verificationState(value.verificationState) === 'unverified'
      ? fallbackState
      : verificationState(value.verificationState),
  };
  const txid = stringField(value, 'txid');
  const pinId = stringField(value, 'pinId');
  const protocolPath = stringField(value, 'protocolPath');
  const contentHash = stringField(value, 'contentHash');
  const publisherGlobalMetaId = stringField(value, 'publisherGlobalMetaId');
  if (txid) summary.txid = txid;
  if (pinId) summary.pinId = pinId;
  if (protocolPath) summary.protocolPath = protocolPath;
  if (contentHash) summary.contentHash = contentHash;
  if (publisherGlobalMetaId) summary.publisherGlobalMetaId = publisherGlobalMetaId;
  summary.details = value;
  return summary;
}

function pickProof(homepage: Record<string, unknown>, state: BrowserVerificationState): BrowserProofSummary | undefined {
  const proofs = recordField(homepage, 'proofs');
  const identity = proofSummary(proofs.identity, state);
  if (identity) {
    return identity;
  }

  const profileProofs = Array.isArray(proofs.profile) ? proofs.profile : [];
  for (const candidate of profileProofs) {
    const summary = proofSummary(candidate, state);
    if (summary) {
      return summary;
    }
  }

  const services = Array.isArray(homepage.services) ? homepage.services : [];
  for (const service of services) {
    if (!isRecord(service)) {
      continue;
    }
    const summary = proofSummary(service.proof, state);
    if (summary) {
      return summary;
    }
  }

  return undefined;
}

function normalizeAction(value: unknown): BrowserTrustedAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringField(value, 'id');
  const label = stringField(value, 'label');
  const kind = stringField(value, 'kind') as BrowserTrustedAction['kind'];
  if (!id || !label || !['private-chat', 'service-list', 'service-call', 'copy', 'proof', 'creator'].includes(kind)) {
    return null;
  }

  const action: BrowserTrustedAction = { id, label, kind };
  if (typeof value.enabled === 'boolean') action.enabled = value.enabled;
  if (typeof value.requiresUsingIdentity === 'boolean') action.requiresUsingIdentity = value.requiresUsingIdentity;
  const uri = stringField(value, 'uri');
  const serviceId = stringField(value, 'serviceId');
  if (uri) action.uri = uri;
  if (serviceId) action.serviceId = serviceId;
  if (isRecord(value.payload)) action.payload = value.payload;
  return action;
}

function mergeActions(rawActions: unknown, normalizedUri: string): BrowserTrustedAction[] {
  const actions = new Map<string, BrowserTrustedAction>();
  const homepageActions = Array.isArray(rawActions) ? rawActions : [];
  for (const rawAction of homepageActions) {
    const action = normalizeAction(rawAction);
    if (action) {
      actions.set(action.id, action);
    }
  }

  for (const action of [
    { id: 'message', label: 'Message', kind: 'private-chat' as const, enabled: true, requiresUsingIdentity: true },
    { id: 'services', label: 'Services', kind: 'service-list' as const, enabled: true, requiresUsingIdentity: true },
    { id: 'copy-uri', label: 'Copy URI', kind: 'copy' as const, enabled: true, uri: normalizedUri },
  ]) {
    if (!actions.has(action.id)) {
      actions.set(action.id, action);
    }
  }

  return [...actions.values()];
}

export function buildBotPageResolveResult(input: {
  uri: string;
  normalizedUri: string;
  homepage: Record<string, unknown>;
  resolverUrl: string;
}): BrowserResolveResult {
  const canonical = recordField(input.homepage, 'canonical');
  const profile = recordField(input.homepage, 'profile');
  const homepageInfo = recordField(input.homepage, 'homepage');
  const proofs = recordField(input.homepage, 'proofs');
  const source = recordField(input.homepage, 'source');
  const globalMetaId = stringField(input.homepage, 'globalMetaId') || stringField(canonical, 'globalMetaId');
  const state = verificationState(proofs.verificationState);
  const title = stringField(profile, 'name') || stringField(homepageInfo, 'title') || shortGlobalMetaId(globalMetaId);

  return {
    uri: input.uri,
    normalizedUri: input.normalizedUri,
    resourceType: 'bot',
    title,
    owner: {
      kind: 'bot',
      globalMetaId,
      metaid: stringField(canonical, 'metaid') || undefined,
      address: stringField(canonical, 'address') || undefined,
      name: title,
      avatar: stringField(profile, 'avatar') || undefined,
      online: onlineState(input.homepage.presence),
      verificationState: state,
    },
    renderer: {
      type: 'bot-page',
      contentType: 'application/vnd.oac.bot-homepage+json',
      data: input.homepage,
    },
    status: {
      state: 'resolved',
      verificationState: state,
      message: 'Bot Page resolved.',
    },
    proof: pickProof(input.homepage, state),
    source: {
      resolver: stringField(source, 'resolver') || 'metaso-p2p',
      url: input.resolverUrl,
      fetchedAt: numberField(source, 'fetchedAt'),
      stale: typeof source.stale === 'boolean' ? source.stale : undefined,
      schemaVersion: stringField(input.homepage, 'schemaVersion') || undefined,
      raw: input.homepage,
    },
    actions: mergeActions(input.homepage.actions, input.normalizedUri),
  };
}
