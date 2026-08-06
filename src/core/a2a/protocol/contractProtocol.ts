/**
 * A2A collaboration contract protocol encoding.
 *
 * Wire format for contract messages carried in simplemsg content, mirroring the
 * order protocol syntax:
 *
 *   [CONTRACT_PROPOSE:<contractId>] {"contract":{...}}
 *   [CONTRACT_CONFIRM:<contractId>] accepted, spec entries 1-3 locked
 *
 * The propose message carries the full contract record as a JSON payload so the
 * peer can adopt the shared spec baseline without a second round trip. All other
 * tags reference the contract by id and carry plain text.
 */

import type { A2AContractRecord } from '../contractEngine';

export type A2AContractProtocolTag =
  | 'CONTRACT_PROPOSE'
  | 'CONTRACT_CONFIRM'
  | 'CONTRACT_OBJECTION'
  | 'CONTRACT_INSUFFICIENT'
  | 'CONTRACT_DELIVERY'
  | 'CONTRACT_ACCEPT'
  | 'CONTRACT_REOPEN'
  | 'CONTRACT_BYE';

export interface ParsedContractProtocolMessage {
  tag: A2AContractProtocolTag;
  contractId: string;
  content: string;
  payload?: Record<string, unknown> | null;
}

export interface ParsedContractProposeMessage {
  contractId: string;
  contract: A2AContractRecord;
  content: string;
}

const CONTRACT_ID_RE = /^[a-z0-9][a-z0-9._-]{5,63}$/i;
const CONTRACT_TAG_RE = /^\[(CONTRACT_[A-Za-z]+)(?::([A-Za-z0-9][A-Za-z0-9._-]{5,63}))?\]/i;

export function normalizeContractProtocolTag(value: unknown): A2AContractProtocolTag | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  switch (normalized) {
    case 'CONTRACT_PROPOSE':
      return 'CONTRACT_PROPOSE';
    case 'CONTRACT_CONFIRM':
      return 'CONTRACT_CONFIRM';
    case 'CONTRACT_OBJECTION':
      return 'CONTRACT_OBJECTION';
    case 'CONTRACT_INSUFFICIENT':
      return 'CONTRACT_INSUFFICIENT';
    case 'CONTRACT_DELIVERY':
      return 'CONTRACT_DELIVERY';
    case 'CONTRACT_ACCEPT':
      return 'CONTRACT_ACCEPT';
    case 'CONTRACT_REOPEN':
      return 'CONTRACT_REOPEN';
    case 'CONTRACT_BYE':
      return 'CONTRACT_BYE';
    default:
      return null;
  }
}

export function normalizeContractProtocolId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return CONTRACT_ID_RE.test(normalized) ? normalized : '';
}

function buildContractProtocolPrefix(tag: A2AContractProtocolTag, contractId: unknown): string {
  const normalizedId = normalizeContractProtocolId(contractId);
  return normalizedId ? `[${tag}:${normalizedId}]` : `[${tag}]`;
}

export function buildContractProtocolMessage(
  tag: A2AContractProtocolTag,
  contractId: unknown,
  content: string,
): string {
  const text = typeof content === 'string' ? content.trim() : '';
  const prefix = buildContractProtocolPrefix(tag, contractId);
  return text ? `${prefix} ${text}` : prefix;
}

export function buildContractProposeMessage(contract: A2AContractRecord): string {
  const prefix = buildContractProtocolPrefix('CONTRACT_PROPOSE', contract.contractId);
  return `${prefix} ${JSON.stringify({ contract })}`;
}

export function parseContractProtocolMessage(content: unknown): ParsedContractProtocolMessage | null {
  const text = typeof content === 'string' ? content.trim() : '';
  const match = text.match(CONTRACT_TAG_RE);
  if (!match) {
    return null;
  }
  const tag = normalizeContractProtocolTag(match[1]);
  if (!tag) {
    return null;
  }
  const contractId = normalizeContractProtocolId(match[2]);
  if (!contractId) {
    return null;
  }
  const rest = text.slice(match[0].length).trim();
  let payload: Record<string, unknown> | null = null;
  if (rest.startsWith('{')) {
    try {
      const parsed = JSON.parse(rest) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
  }
  return { tag, contractId, content: rest, payload };
}

export function parseContractProposeMessage(content: unknown): ParsedContractProposeMessage | null {
  const parsed = parseContractProtocolMessage(content);
  if (!parsed || parsed.tag !== 'CONTRACT_PROPOSE') {
    return null;
  }
  const payload = parsed.payload;
  const contract = payload?.contract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return null;
  }
  return {
    contractId: parsed.contractId,
    contract: contract as A2AContractRecord,
    content: parsed.content,
  };
}
