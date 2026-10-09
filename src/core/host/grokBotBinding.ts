import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listIdentityProfiles, type IdentityProfileRecord } from '../identity/identityProfiles';
import { resolveProfileNameMatch } from '../identity/profileNameResolution';
import { resolveMetabotPaths } from '../state/paths';
import { resolveTwinHomeDir } from '../bot/twinRole';

export const GROK_BOT_HOST_ID = 'grok-bot';

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

export class GrokBotBindingError extends Error {
  code:
    | 'identity_profile_not_found'
    | 'identity_profile_ambiguous'
    | 'active_identity_missing'
    | 'grok_bot_binding_conflict'
    | 'invalid_argument';
  data: Record<string, unknown>;

  constructor(code: GrokBotBindingError['code'], message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GrokBotBindingError';
    this.code = code;
    this.data = data;
  }
}

function normalizeText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return null;
  }
  return new Date(normalized).toISOString();
}

function normalizeWebhook(value: unknown): GrokBotWebhookConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const url = normalizeText(record.url);
  if (!url) {
    return null;
  }
  return {
    url,
    secret: normalizeText(record.secret),
    configuredAt: normalizeIsoTimestamp(record.configuredAt) ?? new Date(0).toISOString(),
  };
}

function normalizeDelivery(value: unknown): GrokBotWebhookDeliveryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const at = normalizeIsoTimestamp(record.at);
  const status = record.status === 'ok' || record.status === 'failed' ? record.status : null;
  if (!at || !status) {
    return null;
  }
  return {
    at,
    status,
    kind: record.kind === 'llm-task' ? 'llm-task' : 'private-chat',
    error: normalizeText(record.error),
  };
}

export function normalizeGrokBotBinding(value: unknown): GrokBotBinding {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    host: GROK_BOT_HOST_ID,
    assistantId: normalizeText(record.assistantId),
    assistantName: normalizeText(record.assistantName),
    boundAt: normalizeIsoTimestamp(record.boundAt),
    webhook: normalizeWebhook(record.webhook),
    lastWebhookDelivery: normalizeDelivery(record.lastWebhookDelivery),
  };
}

export function isGrokBotBindingEmpty(binding: GrokBotBinding): boolean {
  return !binding.assistantId && !binding.assistantName && !binding.webhook && !binding.lastWebhookDelivery;
}

export function isGrokBotBound(binding: GrokBotBinding): boolean {
  return Boolean(binding.assistantId);
}

export interface RedactedGrokBotBinding extends Omit<GrokBotBinding, 'webhook'> {
  webhook: (Omit<GrokBotWebhookConfig, 'secret'> & { secretConfigured: boolean }) | null;
}

/** Command-result view: the bearer token never leaves the local state file. */
export function redactGrokBotBinding(binding: GrokBotBinding): RedactedGrokBotBinding {
  return {
    ...binding,
    webhook: binding.webhook
      ? { url: binding.webhook.url, configuredAt: binding.webhook.configuredAt, secretConfigured: Boolean(binding.webhook.secret) }
      : null,
  };
}

export function grokBotBindingPathForProfile(homeDir: string): string {
  return resolveMetabotPaths(homeDir).grokBotBindingPath;
}

export async function readGrokBotBinding(filePath: string): Promise<GrokBotBinding> {
  try {
    return normalizeGrokBotBinding(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return normalizeGrokBotBinding(null);
    }
    throw error;
  }
}

export async function writeGrokBotBinding(filePath: string, binding: GrokBotBinding): Promise<void> {
  const next = normalizeGrokBotBinding(binding);
  if (isGrokBotBindingEmpty(next)) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify({
    ...next,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
}

export async function recordGrokBotWebhookDelivery(
  filePath: string,
  delivery: GrokBotWebhookDeliveryRecord,
): Promise<GrokBotBinding> {
  const current = await readGrokBotBinding(filePath);
  const next = { ...current, lastWebhookDelivery: delivery };
  await writeGrokBotBinding(filePath, next);
  return next;
}

function normalizeWebhookUrl(value: string): string {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new GrokBotBindingError('invalid_argument', `Webhook URL is not a valid URL: ${normalized}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new GrokBotBindingError(
      'invalid_argument',
      'Webhook URL must use https://. The Grok Bot routine webhook is a cloud endpoint; plain http would expose the bearer token.',
    );
  }
  return parsed.toString();
}

async function resolveBindingProfile(input: {
  systemHomeDir: string;
  from?: string;
}): Promise<IdentityProfileRecord> {
  const profiles = await listIdentityProfiles(input.systemHomeDir);
  if (input.from?.trim()) {
    const resolution = resolveProfileNameMatch(input.from, profiles);
    if (resolution.status === 'matched') {
      return resolution.match;
    }
    throw new GrokBotBindingError(
      resolution.status === 'ambiguous' ? 'identity_profile_ambiguous' : 'identity_profile_not_found',
      resolution.message,
      resolution.status === 'ambiguous'
        ? { from: input.from, candidates: resolution.candidates.map((profile) => profile.slug) }
        : { from: input.from },
    );
  }
  const twinHomeDir = await resolveTwinHomeDir(input.systemHomeDir);
  const twinProfile = twinHomeDir
    ? profiles.find((profile) => path.resolve(profile.homeDir) === path.resolve(twinHomeDir))
    : undefined;
  if (!twinProfile) {
    throw new GrokBotBindingError(
      'active_identity_missing',
      'No Twin Bot is available. Pass --from <bot-slug> or create a Bot first.',
    );
  }
  return twinProfile;
}

export interface GrokBotBindingStatus {
  host: typeof GROK_BOT_HOST_ID;
  profile: { name: string; slug: string; homeDir: string; globalMetaId: string };
  bound: boolean;
  binding: RedactedGrokBotBinding;
}

export async function getGrokBotBindingStatus(input: {
  systemHomeDir: string;
  from?: string;
}): Promise<GrokBotBindingStatus> {
  const profile = await resolveBindingProfile(input);
  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(profile.homeDir));
  return {
    host: GROK_BOT_HOST_ID,
    profile: {
      name: profile.name,
      slug: profile.slug,
      homeDir: profile.homeDir,
      globalMetaId: profile.globalMetaId,
    },
    bound: isGrokBotBound(binding),
    binding: redactGrokBotBinding(binding),
  };
}

export async function bindGrokBotAssistant(input: {
  systemHomeDir: string;
  from?: string;
  assistantId: string;
  assistantName?: string;
  force?: boolean;
}): Promise<GrokBotBindingStatus & { action: 'created' | 'updated' | 'unchanged' }> {
  const assistantId = normalizeText(input.assistantId);
  if (!assistantId) {
    throw new GrokBotBindingError('invalid_argument', 'An assistant id is required to bind a Grok Bot assistant.');
  }
  const profile = await resolveBindingProfile(input);
  const filePath = grokBotBindingPathForProfile(profile.homeDir);
  const current = await readGrokBotBinding(filePath);

  // One Grok Bot assistant maps to exactly one OAC profile: refuse to point a
  // second profile at an assistant id another profile already owns.
  if (!input.force && current.assistantId !== assistantId) {
    const profiles = await listIdentityProfiles(input.systemHomeDir);
    for (const candidate of profiles) {
      if (candidate.slug === profile.slug) {
        continue;
      }
      const other = await readGrokBotBinding(grokBotBindingPathForProfile(candidate.homeDir));
      if (other.assistantId === assistantId) {
        throw new GrokBotBindingError(
          'grok_bot_binding_conflict',
          `Grok Bot assistant ${assistantId} is already bound to profile ${candidate.slug}. Stop and confirm with the user instead of sharing one assistant across two identities; pass --force only when the user explicitly asks to move the binding.`,
          { assistantId, ownerSlug: candidate.slug, requestedSlug: profile.slug },
        );
      }
    }
  }

  const assistantName = normalizeText(input.assistantName) ?? current.assistantName;
  const unchanged = current.assistantId === assistantId && current.assistantName === assistantName;
  if (!unchanged) {
    await writeGrokBotBinding(filePath, {
      ...current,
      assistantId,
      assistantName,
      boundAt: current.boundAt ?? new Date().toISOString(),
    });
  }
  const status = await getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
  return {
    ...status,
    action: unchanged ? 'unchanged' : (current.assistantId ? 'updated' : 'created'),
  };
}

export async function configureGrokBotWebhook(input: {
  systemHomeDir: string;
  from?: string;
  url?: string;
  secret?: string;
  clear?: boolean;
}): Promise<GrokBotBindingStatus> {
  const profile = await resolveBindingProfile(input);
  const filePath = grokBotBindingPathForProfile(profile.homeDir);
  const current = await readGrokBotBinding(filePath);
  if (input.clear) {
    await writeGrokBotBinding(filePath, { ...current, webhook: null, lastWebhookDelivery: null });
    return getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
  }
  const url = typeof input.url === 'string' ? normalizeWebhookUrl(input.url) : '';
  if (!url) {
    throw new GrokBotBindingError('invalid_argument', 'Pass --url <https-webhook-url> or --clear.');
  }
  await writeGrokBotBinding(filePath, {
    ...current,
    webhook: {
      url,
      secret: normalizeText(input.secret) ?? current.webhook?.secret ?? null,
      configuredAt: new Date().toISOString(),
    },
    lastWebhookDelivery: null,
  });
  return getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
}

export async function unbindGrokBotAssistant(input: {
  systemHomeDir: string;
  from?: string;
}): Promise<GrokBotBindingStatus & { removed: boolean }> {
  const profile = await resolveBindingProfile(input);
  const filePath = grokBotBindingPathForProfile(profile.homeDir);
  const current = await readGrokBotBinding(filePath);
  const removed = !isGrokBotBindingEmpty(current);
  await writeGrokBotBinding(filePath, normalizeGrokBotBinding(null));
  const status = await getGrokBotBindingStatus({ systemHomeDir: input.systemHomeDir, from: profile.slug });
  return { ...status, removed };
}

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

export async function doctorGrokBotBindings(input: {
  systemHomeDir: string;
}): Promise<{ host: typeof GROK_BOT_HOST_ID; entries: GrokBotBindingDoctorEntry[] }> {
  const profiles = await listIdentityProfiles(input.systemHomeDir);
  const entries: GrokBotBindingDoctorEntry[] = [];
  const ownerByAssistantId = new Map<string, string>();
  for (const profile of profiles) {
    const binding = await readGrokBotBinding(grokBotBindingPathForProfile(profile.homeDir));
    const issues: string[] = [];
    if (binding.assistantId) {
      const owner = ownerByAssistantId.get(binding.assistantId);
      if (owner) {
        issues.push(`assistant id is also bound to profile ${owner}; one assistant must map to exactly one profile`);
      } else {
        ownerByAssistantId.set(binding.assistantId, profile.slug);
      }
      if (!binding.assistantName) {
        issues.push('assistant name is missing; re-run the bind step with --assistant-name');
      }
    }
    let webhookState: GrokBotBindingDoctorEntry['webhookState'] = 'not_configured';
    if (binding.webhook) {
      webhookState = binding.lastWebhookDelivery?.status === 'ok'
        ? 'ok'
        : binding.lastWebhookDelivery?.status === 'failed'
          ? 'failed'
          : 'pending';
      if (binding.lastWebhookDelivery?.status === 'failed') {
        issues.push(`last webhook delivery failed: ${binding.lastWebhookDelivery.error ?? 'unknown error'}`);
      }
    } else if (binding.assistantId) {
      issues.push('webhook is not configured; on-chain private chat cannot reach this assistant');
    }
    entries.push({
      name: profile.name,
      slug: profile.slug,
      globalMetaId: profile.globalMetaId,
      bound: isGrokBotBound(binding),
      assistantId: binding.assistantId,
      assistantName: binding.assistantName,
      webhookConfigured: Boolean(binding.webhook),
      webhookState,
      lastWebhookDelivery: binding.lastWebhookDelivery,
      issues,
    });
  }
  return { host: GROK_BOT_HOST_ID, entries };
}
