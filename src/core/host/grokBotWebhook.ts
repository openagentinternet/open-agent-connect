import path from 'node:path';
import type { PrivateChatInboundMessage } from '../chat/privateChatTypes';
import { resolveMetabotPaths } from '../state/paths';
import {
  grokBotBindingPathForProfile,
  readGrokBotBinding,
  recordGrokBotWebhookDelivery,
  type GrokBotBinding,
} from './grokBotBinding';

export type GrokBotWebhookDeliveryOutcome = 'delivered' | 'not_configured' | 'failed';

export const GROK_BOT_WEBHOOK_TIMEOUT_MS = 15_000;

function toIsoTimestamp(timestamp: number): string {
  // Chain timestamps have appeared in both seconds and milliseconds.
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  return new Date(ms).toISOString();
}

function buildPrivateChatPayload(input: {
  homeDir: string;
  message: PrivateChatInboundMessage;
}): Record<string, unknown> {
  const slug = path.basename(resolveMetabotPaths(input.homeDir).profileRoot);
  return {
    type: 'metaweb-private-chat',
    host: 'grok-bot',
    slug,
    fromGlobalMetaId: input.message.fromGlobalMetaId,
    text: input.message.content,
    contentType: input.message.contentType ?? 'text',
    messageId: input.message.messagePinId,
    receivedAt: toIsoTimestamp(input.message.timestamp),
  };
}

async function postWebhook(input: {
  binding: GrokBotBinding;
  payload: Record<string, unknown>;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const webhook = input.binding.webhook;
  if (!webhook) {
    return { ok: false, error: 'webhook not configured' };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (webhook.secret) {
    headers.authorization = `Bearer ${webhook.secret}`;
  }
  let response: Response;
  try {
    response = await input.fetchImpl(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(input.timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // A 2xx only means the Grok Bot routine started a turn, per the platform's
  // webhook semantics; the reply itself lands on-chain later, if the user
  // approves it. Non-2xx is a real delivery failure.
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  return { ok: true };
}

/**
 * Deliver one inbound on-chain private-chat message to the Grok Bot assistant
 * bound to this profile, through the routine webhook recorded in the profile's
 * binding. Returns 'not_configured' when no webhook exists (the caller should
 * fall back to the normal local reply path); a single attempt is made
 * otherwise and the outcome is recorded on the binding ledger — no retries.
 */
export async function deliverGrokBotPrivateChat(input: {
  homeDir: string;
  message: PrivateChatInboundMessage;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}): Promise<GrokBotWebhookDeliveryOutcome> {
  const filePath = grokBotBindingPathForProfile(input.homeDir);
  const binding = await readGrokBotBinding(filePath);
  if (!binding.webhook) {
    return 'not_configured';
  }
  const now = input.now ?? (() => new Date());
  const result = await postWebhook({
    binding,
    payload: buildPrivateChatPayload(input),
    fetchImpl: input.fetchImpl ?? fetch,
    timeoutMs: input.timeoutMs ?? GROK_BOT_WEBHOOK_TIMEOUT_MS,
  });
  await recordGrokBotWebhookDelivery(filePath, {
    at: now().toISOString(),
    status: result.ok ? 'ok' : 'failed',
    kind: 'private-chat',
    error: result.ok ? null : result.error,
  });
  return result.ok ? 'delivered' : 'failed';
}
