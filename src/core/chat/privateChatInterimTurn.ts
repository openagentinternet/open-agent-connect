import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Host-issued "turn ticket" for bot-initiated interim private-chat messages
 * (IDBots send_private_chat parity, adapted to OAC's single-shot reply
 * runner: local runtimes execute skills as shell commands, so the controlled
 * send surface is a CLI command gated by a ticket file instead of an MCP
 * tool).
 *
 * Before each reply turn with a chat workspace, the reply runner writes
 * `.oac-private-chat-turn.json` into the workspace. It locks the recipient
 * to the turn's peer, caps how many interim updates the turn may deliver,
 * and expires shortly after the turn. `metabot chat interim --turn-file …`
 * validates and consumes the ticket before sending, so interim messaging
 * stays: turn-scoped, single-recipient, quota-capped, and time-boxed.
 */

export const PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME = '.oac-private-chat-turn.json';

export const DEFAULT_INTERIM_MESSAGE_QUOTA = 3;
export const MAX_INTERIM_MESSAGE_LENGTH = 600;
export const PRIVATE_CHAT_TURN_CONTEXT_TTL_MS = 15 * 60_000;

export const CHAT_INTERIM_EXTENSION = 'chatInterim';

export interface PrivateChatTurnContext {
  version: 1;
  conversationId: string;
  peerGlobalMetaId: string;
  remaining: number;
  issuedAt: number;
  expiresAt: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export function privateChatTurnContextPath(workspaceDir: string): string {
  return path.join(workspaceDir, PRIVATE_CHAT_TURN_CONTEXT_FILE_NAME);
}

/** Issues (overwrites) the ticket for a fresh reply turn. */
export async function writePrivateChatTurnContext(input: {
  workspaceDir: string;
  conversationId: string;
  peerGlobalMetaId: string;
  now?: number;
  ttlMs?: number;
  quota?: number;
}): Promise<PrivateChatTurnContext> {
  const now = input.now ?? Date.now();
  const ttlMs = Number.isFinite(input.ttlMs) && (input.ttlMs as number) > 0
    ? (input.ttlMs as number)
    : PRIVATE_CHAT_TURN_CONTEXT_TTL_MS;
  const quota = Number.isFinite(input.quota) && (input.quota as number) > 0
    ? Math.floor(input.quota as number)
    : DEFAULT_INTERIM_MESSAGE_QUOTA;
  const context: PrivateChatTurnContext = {
    version: 1,
    conversationId: normalizeText(input.conversationId),
    peerGlobalMetaId: normalizeText(input.peerGlobalMetaId),
    remaining: quota,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  if (!context.conversationId || !context.peerGlobalMetaId) {
    throw new Error('Private-chat turn ticket requires conversationId and peerGlobalMetaId.');
  }
  await fs.mkdir(input.workspaceDir, { recursive: true });
  await writeJsonFileAtomically(privateChatTurnContextPath(input.workspaceDir), context);
  return context;
}

export async function readPrivateChatTurnContext(
  turnFilePath: string,
): Promise<PrivateChatTurnContext | null> {
  try {
    const raw = await fs.readFile(turnFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed
      && parsed.version === 1
      && typeof parsed.conversationId === 'string'
      && typeof parsed.peerGlobalMetaId === 'string'
      && Number.isFinite(parsed.remaining)
      && Number.isFinite(parsed.expiresAt)
    ) {
      return {
        version: 1,
        conversationId: (parsed.conversationId as string).trim(),
        peerGlobalMetaId: (parsed.peerGlobalMetaId as string).trim(),
        remaining: Math.floor(parsed.remaining as number),
        issuedAt: Number.isFinite(parsed.issuedAt) ? Math.floor(parsed.issuedAt as number) : 0,
        expiresAt: Math.floor(parsed.expiresAt as number),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export type PrivateChatTurnQuotaResult =
  | { ok: true; context: PrivateChatTurnContext }
  | { ok: false; error: 'ticket_not_found' | 'ticket_expired' | 'ticket_exhausted' };

/**
 * Validates the ticket and atomically spends one interim slot. The recipient
 * comes from the ticket (never from the caller), so a spent or forged file
 * cannot redirect a send.
 */
export async function consumePrivateChatTurnQuota(input: {
  turnFilePath: string;
  now?: number;
}): Promise<PrivateChatTurnQuotaResult> {
  const now = input.now ?? Date.now();
  const context = await readPrivateChatTurnContext(input.turnFilePath);
  if (!context) return { ok: false, error: 'ticket_not_found' };
  if (context.expiresAt <= now) return { ok: false, error: 'ticket_expired' };
  if (context.remaining <= 0) return { ok: false, error: 'ticket_exhausted' };
  const consumed: PrivateChatTurnContext = {
    ...context,
    remaining: context.remaining - 1,
  };
  try {
    await writeJsonFileAtomically(input.turnFilePath, consumed);
  } catch {
    return { ok: false, error: 'ticket_not_found' };
  }
  return { ok: true, context: consumed };
}

/** Normalizes candidate interim text: trimmed, length-capped, no close markers. */
export function normalizeInterimMessageText(value: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return { ok: false, error: 'interim text is required' };
  if (text.length > MAX_INTERIM_MESSAGE_LENGTH) {
    return { ok: false, error: `interim text must be at most ${MAX_INTERIM_MESSAGE_LENGTH} characters` };
  }
  const finalLine = text.split(/\r?\n/u).reverse().find((line) => line.trim()) ?? '';
  if (/^(?:bye|goodbye)[.!。！]?$/iu.test(finalLine.trim())) {
    return { ok: false, error: 'interim updates must not carry a close marker' };
  }
  return { ok: true, text };
}
