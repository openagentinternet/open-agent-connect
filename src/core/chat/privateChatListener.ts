import { receivePrivateChat } from './privateChat';

export interface PrivateChatListenerIdentity {
  globalMetaId: string;
  privateKeyHex: string;
  chatPublicKey: string;
}

export interface MetaWebPrivateMessage {
  txId?: string | null;
  pinId?: string | null;
  content?: string | null;
  contentType?: string | null;
  content_type?: string | null;
  timestamp?: number | null;
  replyPin?: string | null;
  fromGlobalMetaId?: string | null;
  toGlobalMetaId?: string | null;
  fromUserInfo?: {
    globalMetaId?: string | null;
    name?: string | null;
    avatar?: string | null;
    chatPublicKey?: string | null;
  } | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function pinIdFromPrivateChatSocketMessage(message: MetaWebPrivateMessage): string | null {
  const pinId = normalizeText(message.pinId);
  if (pinId) return pinId;
  const txId = normalizeText(message.txId);
  return txId ? `${txId}i0` : null;
}

export function senderGlobalMetaIdFromPrivateChatSocketMessage(
  message: MetaWebPrivateMessage,
): string {
  return normalizeText(message.fromUserInfo?.globalMetaId)
    || normalizeText(message.fromGlobalMetaId);
}

export function normalizePrivateChatSocketMessage(data: unknown): MetaWebPrivateMessage | null {
  let parsed: unknown = data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }

  if (Array.isArray(parsed) && parsed.length >= 2) {
    const eventName = normalizeText(parsed[0]);
    const payload = normalizeObject(parsed[1]);
    if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
      return payload as MetaWebPrivateMessage;
    }
    if (eventName === 'WS_RESPONSE_SUCCESS') {
      return normalizeObject(payload?.data) as MetaWebPrivateMessage | null;
    }
    return null;
  }

  const wrapper = normalizeObject(parsed);
  if (!wrapper) {
    return null;
  }

  const eventName = normalizeText(wrapper.M);
  const payload = normalizeObject(wrapper.D);
  if (eventName === 'WS_SERVER_NOTIFY_PRIVATE_CHAT') {
    return payload as MetaWebPrivateMessage;
  }
  if (eventName === 'WS_RESPONSE_SUCCESS') {
    return normalizeObject(payload?.data) as MetaWebPrivateMessage | null;
  }
  return null;
}

export function decryptPrivateChatSocketMessage(
  message: MetaWebPrivateMessage,
  identity: PrivateChatListenerIdentity,
  peerChatPublicKeyOverride: string | null,
): string | null {
  const peerChatPublicKey = normalizeText(message.fromUserInfo?.chatPublicKey)
    || normalizeText(peerChatPublicKeyOverride);
  if (!peerChatPublicKey) {
    return null;
  }

  try {
    const received = receivePrivateChat({
      localIdentity: {
        globalMetaId: identity.globalMetaId,
        privateKeyHex: identity.privateKeyHex,
      },
      peerChatPublicKey,
      payload: {
        fromGlobalMetaId: senderGlobalMetaIdFromPrivateChatSocketMessage(message),
        content: normalizeText(message.content) || null,
        rawData: normalizeText(message.content)
          ? JSON.stringify({ content: normalizeText(message.content) })
          : null,
        replyPinId: normalizeText(message.replyPin),
      },
    });
    return normalizeText(received.plaintext) || null;
  } catch {
    return null;
  }
}
