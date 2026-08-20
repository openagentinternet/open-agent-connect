// Scoped memory domain model, ported from IDBots src/main/memory/memoryScope.ts.
// A memory entry belongs to exactly one scope: the owner (local user), a
// contact (one external person, anchored by GlobalMetaID), or a conversation
// (one external group/shared context).
export type MemoryScopeKind = 'owner' | 'contact' | 'conversation';
// 'self_identity' = the bot's own dream-time "who am I" entry (protected,
// one per bot); 'work_review' = dream-time summary of one piece of work and
// the counterparty's evaluation; 'value_boundary' = abstract, paradigm-level
// rule the bot distilled from its experiences (its self-grown code of
// conduct). All three are written exclusively by the dream consolidation
// service with origin='dream'.
export type MemoryUsageClass = 'profile_fact' | 'preference' | 'operational_preference' | 'self_identity' | 'work_review' | 'value_boundary';
export type MemoryVisibility = 'local_only' | 'external_safe';
export type MemoryOrigin = 'conversation' | 'dream';

export interface MemoryScope {
  kind: MemoryScopeKind;
  key: string;
}

export interface MemoryScopeSelectorInputLike {
  scope?: MemoryScope | null;
  scopeKind?: MemoryScopeKind | null;
  scopeKey?: string | null;
}

export const OWNER_SCOPE_KEY = 'owner:self';

/**
 * Channels that mean "the local human's own UI session". Anything else is an
 * external channel and follows the contact/conversation privacy rules.
 * 'cowork_ui' kept for IDBots port parity.
 */
export const LOCAL_MEMORY_CHANNELS = new Set(['cowork_ui', 'dsh', '']);

export function isLocalMemoryChannel(channel?: string | null): boolean {
  return LOCAL_MEMORY_CHANNELS.has(normalizeScopeChannel(channel));
}

function normalizeScopePart(value?: string | null): string {
  return String(value ?? '').trim();
}

export function normalizeScopeChannel(channel?: string | null): string {
  return normalizeScopePart(channel).replace(/\s+/g, '_').toLowerCase();
}

export function normalizeScopeIdentity(value?: string | null): string {
  // Preserve caller-provided casing because some upstream IDs may be case-sensitive.
  return normalizeScopePart(value);
}

export function createOwnerMemoryScope(): MemoryScope {
  return {
    kind: 'owner',
    key: OWNER_SCOPE_KEY,
  };
}

export function buildContactScopeKey(input: {
  sourceChannel?: string | null;
  peerGlobalMetaId?: string | null;
}): string | null {
  const channel = normalizeScopeChannel(input.sourceChannel);
  const peerGlobalMetaId = normalizeScopeIdentity(input.peerGlobalMetaId);
  if (!channel || !peerGlobalMetaId) {
    return null;
  }
  return `${channel}:peer:${peerGlobalMetaId}`;
}

/**
 * Reverse of `buildContactScopeKey`: extracts the peer identity from a
 * contact scope key of the form `<channel>:peer:<peerGlobalMetaId>`.
 * Returns null when the key does not follow the contact shape.
 */
export function parseContactScopeKey(scopeKey?: string | null): {
  sourceChannel: string | null;
  peerGlobalMetaId: string | null;
} | null {
  const key = normalizeScopeIdentity(scopeKey);
  if (!key) {
    return null;
  }
  const peerMarkerIndex = key.indexOf(':peer:');
  if (peerMarkerIndex <= 0) {
    return null;
  }
  const sourceChannel = key.slice(0, peerMarkerIndex);
  const peerGlobalMetaId = key.slice(peerMarkerIndex + ':peer:'.length);
  if (!sourceChannel || !peerGlobalMetaId) {
    return null;
  }
  return {
    sourceChannel,
    peerGlobalMetaId,
  };
}

export function createContactMemoryScope(input: {
  sourceChannel?: string | null;
  peerGlobalMetaId?: string | null;
}): MemoryScope | null {
  const key = buildContactScopeKey(input);
  if (!key) {
    return null;
  }
  return {
    kind: 'contact',
    key,
  };
}

export function buildConversationScopeKey(input: {
  sourceChannel?: string | null;
  externalConversationId?: string | null;
}): string | null {
  const channel = normalizeScopeChannel(input.sourceChannel);
  const externalConversationId = normalizeScopeIdentity(input.externalConversationId);
  if (!channel || !externalConversationId) {
    return null;
  }
  return `${channel}:conversation:${externalConversationId}`;
}

export function createConversationMemoryScope(input: {
  sourceChannel?: string | null;
  externalConversationId?: string | null;
}): MemoryScope | null {
  const key = buildConversationScopeKey(input);
  if (!key) {
    return null;
  }
  return {
    kind: 'conversation',
    key,
  };
}

export function normalizeMemoryScopeSelector(input: MemoryScopeSelectorInputLike): MemoryScope | null {
  const scope = input.scope ?? null;
  const scopeKind = input.scopeKind ?? null;
  const scopeKey = normalizeScopeIdentity(input.scopeKey);

  if (scope) {
    const normalizedScope: MemoryScope = {
      kind: scope.kind,
      key: normalizeScopeIdentity(scope.key),
    };
    if (scopeKind && scopeKind !== normalizedScope.kind) {
      throw new Error('Conflicting memory scope selector kind');
    }
    if (scopeKey && scopeKey !== normalizedScope.key) {
      throw new Error('Conflicting memory scope selector key');
    }
    return normalizedScope;
  }

  if (!scopeKind && !scopeKey) {
    return null;
  }
  if (!scopeKind || !scopeKey) {
    throw new Error('Both scopeKind and scopeKey are required when scope is omitted');
  }

  return {
    kind: scopeKind,
    key: scopeKey,
  };
}
