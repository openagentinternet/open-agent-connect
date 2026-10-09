export declare const GROK_BOT_HOST_ID = "grok-bot";
export interface GrokBotWebhookConfig {
    url: string;
    /** Bearer token the Grok Bot routine expects; null when it is unauthenticated. */
    secret: string | null;
    configuredAt: string;
}
export interface GrokBotWebhookDeliveryRecord {
    at: string;
    status: 'ok' | 'failed';
    kind: 'private-chat' | 'llm-task';
    error: string | null;
}
export interface GrokBotBinding {
    host: typeof GROK_BOT_HOST_ID;
    assistantId: string | null;
    assistantName: string | null;
    boundAt: string | null;
    webhook: GrokBotWebhookConfig | null;
    lastWebhookDelivery: GrokBotWebhookDeliveryRecord | null;
}
export declare class GrokBotBindingError extends Error {
    code: 'identity_profile_not_found' | 'identity_profile_ambiguous' | 'active_identity_missing' | 'grok_bot_binding_conflict' | 'invalid_argument';
    data: Record<string, unknown>;
    constructor(code: GrokBotBindingError['code'], message: string, data?: Record<string, unknown>);
}
export declare function normalizeGrokBotBinding(value: unknown): GrokBotBinding;
export declare function isGrokBotBindingEmpty(binding: GrokBotBinding): boolean;
export declare function isGrokBotBound(binding: GrokBotBinding): boolean;
export interface RedactedGrokBotBinding extends Omit<GrokBotBinding, 'webhook'> {
    webhook: (Omit<GrokBotWebhookConfig, 'secret'> & {
        secretConfigured: boolean;
    }) | null;
}
/** Command-result view: the bearer token never leaves the local state file. */
export declare function redactGrokBotBinding(binding: GrokBotBinding): RedactedGrokBotBinding;
export declare function grokBotBindingPathForProfile(homeDir: string): string;
export declare function readGrokBotBinding(filePath: string): Promise<GrokBotBinding>;
export declare function writeGrokBotBinding(filePath: string, binding: GrokBotBinding): Promise<void>;
export declare function recordGrokBotWebhookDelivery(filePath: string, delivery: GrokBotWebhookDeliveryRecord): Promise<GrokBotBinding>;
export interface GrokBotBindingStatus {
    host: typeof GROK_BOT_HOST_ID;
    profile: {
        name: string;
        slug: string;
        homeDir: string;
        globalMetaId: string;
    };
    bound: boolean;
    binding: RedactedGrokBotBinding;
}
export declare function getGrokBotBindingStatus(input: {
    systemHomeDir: string;
    from?: string;
}): Promise<GrokBotBindingStatus>;
export declare function bindGrokBotAssistant(input: {
    systemHomeDir: string;
    from?: string;
    assistantId: string;
    assistantName?: string;
    force?: boolean;
}): Promise<GrokBotBindingStatus & {
    action: 'created' | 'updated' | 'unchanged';
}>;
export declare function configureGrokBotWebhook(input: {
    systemHomeDir: string;
    from?: string;
    url?: string;
    secret?: string;
    clear?: boolean;
}): Promise<GrokBotBindingStatus>;
export declare function unbindGrokBotAssistant(input: {
    systemHomeDir: string;
    from?: string;
}): Promise<GrokBotBindingStatus & {
    removed: boolean;
}>;
export interface GrokBotBindingDoctorEntry {
    name: string;
    slug: string;
    globalMetaId: string;
    bound: boolean;
    assistantId: string | null;
    assistantName: string | null;
    webhookConfigured: boolean;
    /** 'ok' only after at least one successful delivery; 'pending' means configured but not yet verified; 'not_configured' means private chat cannot reach the assistant. */
    webhookState: 'ok' | 'failed' | 'pending' | 'not_configured';
    lastWebhookDelivery: GrokBotWebhookDeliveryRecord | null;
    issues: string[];
}
export declare function doctorGrokBotBindings(input: {
    systemHomeDir: string;
}): Promise<{
    host: typeof GROK_BOT_HOST_ID;
    entries: GrokBotBindingDoctorEntry[];
}>;
