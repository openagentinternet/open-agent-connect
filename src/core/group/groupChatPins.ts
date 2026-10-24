/**
 * On-chain group-chat primitives: SimpleGroupJoin and SimpleGroupChat pin
 * writers. OAC port of the IDBots group_chat tool's two on-chain actions:
 *
 * - join  (/protocols/simplegroupjoin): body {groupId, state: 1} with
 *   referrer / k carried only when non-empty (IDBots main.ts joinGroup
 *   tool-path omission form; private groups pass the protocol key field
 *   through from the caller).
 * - send  (/protocols/simplegroupchat): body {groupId, nickName, content,
 *   contentType: 'text/plain', encryption: 'aes', timestamp: <ms>} with
 *   replyPin / channelId / mention carried only when non-empty (IDBots
 *   main.ts sendGroupMessage omission rules). `content` is the ALREADY
 *   ENCRYPTED group message (encryptGroupMessage hex output) — this module
 *   never encrypts, and refuses plaintext-looking content so no caller can
 *   broadcast an unencrypted group message through this path.
 *
 * The nickName is resolved by the daemon from the acting bot's registered
 * identity name (never taken from model input — IDBots incident:
 * sender_name "claude bot"); it lands here as a plain string, '' allowed.
 */
import type { Signer } from '../signing/signer';
import { markdownSelfLink } from '../metaweb/uri';

export const SIMPLE_GROUP_JOIN_PATH = '/protocols/simplegroupjoin';
export const SIMPLE_GROUP_CHAT_PATH = '/protocols/simplegroupchat';
const GROUP_PROTOCOL_VERSION = '1.0';

/** On-chain group id shape: the group's pin id — 64 lowercase hex + "i0". */
export const ON_CHAIN_GROUP_ID_PATTERN = /^[0-9a-f]{64}i0$/;

/** AES ciphertext wire shape: lowercase hex, whole 16-byte blocks (>= 1 block). */
const CIPHERTEXT_HEX_PATTERN = /^[0-9a-f]{32,}$/;

export class GroupChatPublishError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GroupChatPublishError';
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireOnChainGroupId(value: unknown): string {
  const groupId = normalizeText(value);
  if (!ON_CHAIN_GROUP_ID_PATTERN.test(groupId)) {
    throw new GroupChatPublishError(
      'invalid_group_id',
      `Invalid group_id "${groupId}": an on-chain group id is the group's pin id — exactly 64 lowercase hex chars followed by "i0" (66 characters). `
      + 'A bare number such as "65" is the TASK number, not a group id. Do not guess; ask for the real group id.',
    );
  }
  return groupId;
}

/** Reject plaintext-looking content: broadcasting it would leak the message. */
function requireEncryptedContent(value: unknown): string {
  const content = normalizeText(value);
  if (!content) {
    throw new GroupChatPublishError('missing_field', 'send_group_message requires non-empty `content` (the plaintext message; the caller encrypts it with encryptGroupMessage).');
  }
  if (!CIPHERTEXT_HEX_PATTERN.test(content) || content.length % 32 !== 0) {
    throw new GroupChatPublishError(
      'content_not_encrypted',
      'send_group_message `content` must be the AES-encrypted hex produced by encryptGroupMessage(message, groupId) — not plaintext. '
      + 'Writing an unencrypted group payload would leak the message; encrypt first (the group_chat tool does this automatically).',
    );
  }
  return content;
}

export interface JoinGroupChatInput {
  /** On-chain group pin id (64 lowercase hex + "i0"). */
  groupId: string;
  /** Inviter MetaID; empty for open joins. */
  referrer?: string;
  /** Protocol key field; '' for public groups, caller-provided for private. */
  k?: string;
  /** Write network; default mvc. */
  network?: string;
}

export interface JoinGroupChatResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  groupId: string;
}

/** Publish one SimpleGroupJoin pin (state 1). */
export async function joinGroupChat(
  signer: Signer,
  input: JoinGroupChatInput,
): Promise<JoinGroupChatResult> {
  const groupId = requireOnChainGroupId(input.groupId);
  // IDBots main.ts joinGroup tool-path omission form: the base body is
  // exactly {groupId, state: 1}; referrer / k ride only when non-empty
  // (normalize-then-omit), so the pin bytes match the IDBots tool's.
  const body: Record<string, unknown> = { groupId, state: 1 };
  const referrer = normalizeText(input.referrer);
  if (referrer) body.referrer = referrer;
  const k = normalizeText(input.k);
  if (k) body.k = k;
  const chainWrite = await signer.writePin({
    operation: 'create',
    path: SIMPLE_GROUP_JOIN_PATH,
    encryption: '0',
    version: GROUP_PROTOCOL_VERSION,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    network: (typeof input.network === 'string' && input.network.trim()) || 'mvc',
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    groupId,
  };
}

export interface SendGroupChatMessageInput {
  /** On-chain group pin id (64 lowercase hex + "i0"). */
  groupId: string;
  /** The ALREADY ENCRYPTED message (encryptGroupMessage hex output). */
  content: string;
  /** Acting bot's registered name, resolved daemon-side; '' allowed. */
  nickName?: string;
  /** Pin id of the message being replied to; omitted when empty. */
  replyPin?: string;
  /** Channel id within the group; omitted when empty. */
  channelId?: string;
  /** MetaID list to @mention; omitted when empty. */
  mention?: string[];
  /** Write network; default mvc. */
  network?: string;
}

export interface SendGroupChatMessageResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  groupId: string;
}

/** Publish one SimpleGroupChat pin with the encrypted message body. */
export async function sendGroupChatMessage(
  signer: Signer,
  input: SendGroupChatMessageInput,
): Promise<SendGroupChatMessageResult> {
  const groupId = requireOnChainGroupId(input.groupId);
  const content = requireEncryptedContent(input.content);

  const payload: Record<string, unknown> = {
    groupId,
    nickName: normalizeText(input.nickName),
    content,
    contentType: 'text/plain',
    encryption: 'aes',
    timestamp: Date.now(),
  };
  const replyPin = normalizeText(input.replyPin);
  if (replyPin) payload.replyPin = replyPin;
  const channelId = normalizeText(input.channelId);
  if (channelId) payload.channelId = channelId;
  const mention = Array.isArray(input.mention)
    ? input.mention.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  if (mention.length) payload.mention = mention;

  const chainWrite = await signer.writePin({
    operation: 'create',
    path: SIMPLE_GROUP_CHAT_PATH,
    encryption: '0',
    version: GROUP_PROTOCOL_VERSION,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    network: (typeof input.network === 'string' && input.network.trim()) || 'mvc',
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    groupId,
  };
}

/**
 * Human-readable success sheets mirroring the IDBots group_chat
 * formatPinResult titles. The view link follows the MetaWeb URI convention
 * (pin:// — never a Web2 viewer URL). Exposed for tests.
 */
export function formatJoinGroupResult(input: {
  pinId: string;
  txids: string[];
  totalCost: number;
}): string {
  return formatGroupPinResult('Joined group on-chain (SimpleGroupJoin).', input);
}

export function formatSendGroupResult(input: {
  pinId: string;
  txids: string[];
  totalCost: number;
}): string {
  return formatGroupPinResult('Group message sent (SimpleGroupChat).', input);
}

function formatGroupPinResult(
  title: string,
  input: { pinId: string; txids: string[]; totalCost: number },
): string {
  const lines: string[] = [title];
  if (input.pinId) lines.push(`- pinId: ${input.pinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  if (input.pinId) {
    lines.push(`- pin link: ${markdownSelfLink(`pin://${input.pinId}`)}`);
  }
  return lines.join('\n');
}
