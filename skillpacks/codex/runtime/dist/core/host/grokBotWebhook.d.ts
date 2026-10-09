import type { PrivateChatInboundMessage } from '../chat/privateChatTypes';
import { type GrokBotBinding } from './grokBotBinding';
export type GrokBotWebhookDeliveryOutcome = 'delivered' | 'not_configured' | 'failed';
export declare const GROK_BOT_WEBHOOK_TIMEOUT_MS = 15000;
export declare function postGrokBotWebhook(input: {
    binding: GrokBotBinding;
    payload: Record<string, unknown>;
    fetchImpl: typeof fetch;
    timeoutMs: number;
}): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;
/**
 * Deliver one inbound on-chain private-chat message to the Grok Bot assistant
 * bound to this profile, through the routine webhook recorded in the profile's
 * binding. Returns 'not_configured' when no webhook exists (the caller should
 * fall back to the normal local reply path); a single attempt is made
 * otherwise and the outcome is recorded on the binding ledger — no retries.
 */
export declare function deliverGrokBotPrivateChat(input: {
    homeDir: string;
    message: PrivateChatInboundMessage;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
}): Promise<GrokBotWebhookDeliveryOutcome>;
