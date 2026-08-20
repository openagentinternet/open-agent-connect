// Channel → memory scope resolution, ported from IDBots
// src/main/memory/memoryScopeResolver.ts. Local UI sessions read/write the
// owner scope; direct external channels get a per-contact scope; group/shared
// channels get a per-conversation scope. External sessions additionally read
// only the owner's external-safe operational preferences — never owner
// profile facts.
import {
  createContactMemoryScope,
  createConversationMemoryScope,
  createOwnerMemoryScope,
  isLocalMemoryChannel,
  normalizeScopeChannel,
  type MemoryScope,
} from './memoryScope';

export interface ResolveMemoryScopesInput {
  sourceChannel?: string | null;
  externalConversationId?: string | null;
  peerGlobalMetaId?: string | null;
}

export interface ResolvedMemoryScopes {
  writeScope: MemoryScope;
  readScopes: MemoryScope[];
  ownerReadPolicy: 'none' | 'operational_preference_only' | 'all';
  resolutionReason: 'owner_default' | 'contact_direct' | 'conversation_fallback';
}

const GROUP_OR_SHARED_CHANNEL_HINTS = ['group', 'order', 'shared', 'orchestrator'];
const DIRECT_EXTERNAL_CHANNELS = new Set(['metaweb_private']);
const STRUCTURED_DIRECT_CHANNEL_SUFFIX = ':direct';

function isGroupOrSharedChannel(sourceChannel: string): boolean {
  return GROUP_OR_SHARED_CHANNEL_HINTS.some((hint) => sourceChannel.includes(hint));
}

function isDirectExternalSession(
  sourceChannel: string,
  groupOrShared: boolean
): boolean {
  if (groupOrShared) {
    return false;
  }
  return DIRECT_EXTERNAL_CHANNELS.has(sourceChannel)
    || sourceChannel.endsWith(STRUCTURED_DIRECT_CHANNEL_SUFFIX);
}

function withOwnerOperationalPreferences(writeScope: MemoryScope): ResolvedMemoryScopes {
  return {
    writeScope,
    readScopes: [writeScope],
    ownerReadPolicy: 'operational_preference_only',
    resolutionReason: writeScope.kind === 'contact' ? 'contact_direct' : 'conversation_fallback',
  };
}

function ownerOnlyResolution(): ResolvedMemoryScopes {
  const ownerScope = createOwnerMemoryScope();
  return {
    writeScope: ownerScope,
    readScopes: [ownerScope],
    ownerReadPolicy: 'all',
    resolutionReason: 'owner_default',
  };
}

export function resolveMemoryScopes(input: ResolveMemoryScopesInput): ResolvedMemoryScopes {
  const sourceChannel = normalizeScopeChannel(input.sourceChannel);
  if (isLocalMemoryChannel(sourceChannel)) {
    return ownerOnlyResolution();
  }

  const groupOrShared = isGroupOrSharedChannel(sourceChannel);

  if (isDirectExternalSession(sourceChannel, groupOrShared)) {
    const contactScope = createContactMemoryScope({
      sourceChannel,
      peerGlobalMetaId: input.peerGlobalMetaId,
    });
    if (contactScope) {
      return withOwnerOperationalPreferences(contactScope);
    }
  }

  const conversationScope = createConversationMemoryScope({
    sourceChannel,
    externalConversationId: input.externalConversationId,
  });
  if (conversationScope) {
    return withOwnerOperationalPreferences(conversationScope);
  }

  return ownerOnlyResolution();
}
