import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  deleteIdentityProfile,
  listIdentityProfiles,
  upsertIdentityProfile,
} from '../identity/identityProfiles';
import type { IdentityProfileRecord } from '../identity/identityProfiles';
import {
  ensureProfileWorkspace,
  resolveIdentityCreateProfileHome,
} from '../identity/profileWorkspace';
import { resolveMetabotPaths } from '../state/paths';
import { createLlmBindingStore } from '../llm/llmBindingStore';
import { createLlmRuntimeStore } from '../llm/llmRuntimeStore';
import { createFileSecretStore } from '../secrets/fileSecretStore';
import type { LocalIdentitySecrets } from '../secrets/secretStore';
import { createRuntimeStateStore } from '../state/runtimeStateStore';
import {
  isLlmProvider,
  normalizeLlmBinding,
} from '../llm/llmTypes';
import type {
  LlmBinding,
  LlmBindingRole,
  LlmProvider,
  LlmRuntime,
} from '../llm/llmTypes';
import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';

const DEFAULT_ROLE = 'I am a helpful AI assistant.';
const DEFAULT_SOUL = 'Friendly and professional.';
const DEFAULT_GOAL = 'Help users accomplish their tasks effectively.';
const MAX_AVATAR_BYTES = 200 * 1024;
const CHAIN_SYNC_DELAY_MS = 3_000;
const BIO_FIELDS = new Set(['role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider']);

export interface MetabotProfileFull extends IdentityProfileRecord {
  role: string;
  soul: string;
  goal: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface CreateMetabotInput {
  name: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface CreateMetabotFromIdentityInput extends CreateMetabotInput {
  homeDir: string;
  globalMetaId: string;
  mvcAddress: string;
}

export interface UpdateMetabotInfoInput {
  name?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface SyncMetabotInfoToChainOptions {
  delayMs?: number;
  operation?: 'create' | 'modify';
}

export interface MetabotWalletInfo {
  slug: string;
  name: string;
  addresses: {
    btc: string;
    mvc: string;
  };
}

export interface MetabotMnemonicBackup {
  slug: string;
  name: string;
  words: string[];
}

export interface DeleteMetabotProfileResult {
  profile: IdentityProfileRecord;
  removedExecutorSessions: string[];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAvatarPath(homeDir: string): string {
  return path.join(path.resolve(homeDir), 'avatar.txt');
}

function avatarMimeType(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;,]+);base64,/i);
  return match?.[1]?.toLowerCase() ?? 'image/png';
}

function isSafeLocalFileStem(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return path.basename(value) === value;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content.trim()}\n`, 'utf8');
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  try {
    return (await fs.readFile(filePath, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function validateAvatarDataUrl(dataUrl: string, maxBytes = MAX_AVATAR_BYTES): { valid: boolean; error?: string } {
  const normalized = normalizeText(dataUrl);
  if (!normalized) {
    return { valid: true };
  }
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(normalized)) {
    return {
      valid: false,
      error: 'Avatar must be a PNG, JPEG, WebP, or GIF data URL.',
    };
  }
  if (estimateDataUrlBytes(normalized) > maxBytes) {
    return {
      valid: false,
      error: `Avatar must be ${maxBytes} bytes or smaller.`,
    };
  }
  return { valid: true };
}

function validateProvider(value: unknown): LlmProvider | null {
  if (value === null) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!isLlmProvider(normalized) || normalized === 'custom') {
    throw new Error(`Unsupported LLM provider: ${normalized}`);
  }
  return normalized;
}

function selectRuntimeForProvider(runtimes: LlmRuntime[], provider: LlmProvider): LlmRuntime {
  const candidates = runtimes.filter((runtime) => (
    runtime.provider === provider && runtime.health !== 'unavailable'
  ));
  const runtime = candidates.find((entry) => entry.health === 'healthy') ?? candidates[0];
  if (!runtime) {
    throw new Error(`No available runtime found for provider: ${provider}`);
  }
  return runtime;
}

function buildBindingId(slug: string, runtimeId: string, role: LlmBindingRole): string {
  const safeRuntime = runtimeId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `lb_${slug}_${safeRuntime}_${role}`;
}

function buildProviderBinding(input: {
  slug: string;
  runtime: LlmRuntime;
  role: 'primary' | 'fallback';
  existing?: LlmBinding;
  now: string;
}): LlmBinding {
  const createdAt = input.existing?.createdAt ?? input.now;
  return {
    id: input.existing?.id ?? buildBindingId(input.slug, input.runtime.id, input.role),
    metaBotSlug: input.slug,
    llmRuntimeId: input.runtime.id,
    role: input.role,
    priority: 0,
    enabled: true,
    lastUsedAt: input.existing?.lastUsedAt,
    createdAt,
    updatedAt: input.now,
  };
}

function sortRoleBindings(bindings: LlmBinding[]): LlmBinding[] {
  return [...bindings].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return left.id.localeCompare(right.id);
  });
}

function selectVisibleRoleBinding(bindings: LlmBinding[]): LlmBinding | undefined {
  return sortRoleBindings(bindings.filter((binding) => binding.enabled)).at(0)
    ?? sortRoleBindings(bindings).at(0);
}

async function readProfileProviderBindings(profile: IdentityProfileRecord): Promise<{
  primaryProvider: LlmProvider | null;
  fallbackProvider: LlmProvider | null;
}> {
  const paths = resolveMetabotPaths(profile.homeDir);
  const runtimeState = await createLlmRuntimeStore(paths).read();
  const bindingState = await createLlmBindingStore(paths).read();
  const runtimeById = new Map(runtimeState.runtimes.map((runtime) => [runtime.id, runtime]));

  const providerForRole = (role: 'primary' | 'fallback'): LlmProvider | null => {
    const binding = selectVisibleRoleBinding(bindingState.bindings.filter((entry) => (
      entry.metaBotSlug === profile.slug && entry.role === role && entry.enabled
    )));
    if (!binding) return null;
    return runtimeById.get(binding.llmRuntimeId)?.provider ?? null;
  };

  return {
    primaryProvider: providerForRole('primary'),
    fallbackProvider: providerForRole('fallback'),
  };
}

async function buildMetabotProfileFull(profile: IdentityProfileRecord): Promise<MetabotProfileFull> {
  const paths = resolveMetabotPaths(profile.homeDir);
  const [role, soul, goal, avatarDataUrl, providerBindings] = await Promise.all([
    readTextFile(paths.roleMdPath),
    readTextFile(paths.soulMdPath),
    readTextFile(paths.goalMdPath),
    readTextFile(resolveAvatarPath(profile.homeDir)),
    readProfileProviderBindings(profile),
  ]);

  return {
    ...profile,
    role,
    soul,
    goal,
    ...(avatarDataUrl ? { avatarDataUrl } : {}),
    primaryProvider: providerBindings.primaryProvider,
    fallbackProvider: providerBindings.fallbackProvider,
  };
}

export async function listMetabotProfiles(systemHomeDir: string): Promise<MetabotProfileFull[]> {
  const profiles = await listIdentityProfiles(systemHomeDir);
  const fullProfiles = await Promise.all(profiles.map((profile) => buildMetabotProfileFull(profile)));
  return fullProfiles.sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function getMetabotProfile(systemHomeDir: string, slug: string): Promise<MetabotProfileFull | null> {
  const normalizedSlug = normalizeText(slug);
  if (!normalizedSlug) return null;
  const profiles = await listIdentityProfiles(systemHomeDir);
  const profile = profiles.find((entry) => entry.slug === normalizedSlug);
  return profile ? buildMetabotProfileFull(profile) : null;
}

export async function createMetabotProfile(
  systemHomeDir: string,
  input: CreateMetabotInput,
): Promise<MetabotProfileFull> {
  const name = normalizeText(input.name);
  if (!name) {
    throw new Error('MetaBot name is required.');
  }
  const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
  if (avatar !== undefined) {
    const validation = validateAvatarDataUrl(avatar);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }
  const profiles = await listIdentityProfiles(systemHomeDir);
  const resolvedHome = resolveIdentityCreateProfileHome({
    systemHomeDir,
    requestedName: name,
    profiles,
  });
  if (resolvedHome.status !== 'resolved') {
    throw new Error(resolvedHome.message);
  }

  await ensureProfileWorkspace({
    homeDir: resolvedHome.homeDir,
    name,
  });
  const paths = resolveMetabotPaths(resolvedHome.homeDir);
  await Promise.all([
    writeTextFile(paths.roleMdPath, normalizeText(input.role) || DEFAULT_ROLE),
    writeTextFile(paths.soulMdPath, normalizeText(input.soul) || DEFAULT_SOUL),
    writeTextFile(paths.goalMdPath, normalizeText(input.goal) || DEFAULT_GOAL),
  ]);
  if (avatar) {
    await writeTextFile(resolveAvatarPath(resolvedHome.homeDir), avatar);
  }

  const profile = await upsertIdentityProfile({
    systemHomeDir,
    name,
    homeDir: resolvedHome.homeDir,
  });
  return buildMetabotProfileFull(profile);
}

export function buildMetabotProfileDraftFromIdentity(input: CreateMetabotFromIdentityInput): MetabotProfileFull {
  const name = normalizeText(input.name);
  const homeDir = path.resolve(normalizeText(input.homeDir));
  const globalMetaId = normalizeText(input.globalMetaId);
  const mvcAddress = normalizeText(input.mvcAddress);
  if (!name) {
    throw new Error('MetaBot name is required.');
  }
  if (!homeDir || !globalMetaId || !mvcAddress) {
    throw new Error('A chained MetaBot profile requires homeDir, globalMetaId, and mvcAddress.');
  }
  const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
  if (avatar !== undefined) {
    const validation = validateAvatarDataUrl(avatar);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }
  const slug = path.basename(homeDir);
  return {
    name,
    slug,
    aliases: [slug],
    homeDir,
    globalMetaId,
    mvcAddress,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    role: normalizeText(input.role) || DEFAULT_ROLE,
    soul: normalizeText(input.soul) || DEFAULT_SOUL,
    goal: normalizeText(input.goal) || DEFAULT_GOAL,
    ...(avatar ? { avatarDataUrl: avatar } : {}),
    primaryProvider: input.primaryProvider === undefined ? null : validateProvider(input.primaryProvider),
    fallbackProvider: input.fallbackProvider === undefined ? null : validateProvider(input.fallbackProvider),
  };
}

export async function createMetabotProfileFromIdentity(
  systemHomeDir: string,
  input: CreateMetabotFromIdentityInput,
): Promise<MetabotProfileFull> {
  const draft = buildMetabotProfileDraftFromIdentity(input);

  await ensureProfileWorkspace({
    homeDir: draft.homeDir,
    name: draft.name,
  });
  const paths = resolveMetabotPaths(draft.homeDir);
  await Promise.all([
    writeTextFile(paths.roleMdPath, draft.role),
    writeTextFile(paths.soulMdPath, draft.soul),
    writeTextFile(paths.goalMdPath, draft.goal),
  ]);
  if (draft.avatarDataUrl) {
    await writeTextFile(resolveAvatarPath(draft.homeDir), draft.avatarDataUrl);
  }

  const profile = await upsertIdentityProfile({
    systemHomeDir,
    name: draft.name,
    homeDir: draft.homeDir,
    globalMetaId: draft.globalMetaId,
    mvcAddress: draft.mvcAddress,
  });
  const fullProfile = await buildMetabotProfileFull(profile);
  const writeProviderBindings = await buildProviderBindingWrite({
    profile: fullProfile,
    primaryProvider: input.primaryProvider === undefined ? undefined : draft.primaryProvider ?? null,
    fallbackProvider: input.fallbackProvider === undefined ? undefined : draft.fallbackProvider ?? null,
  });
  if (writeProviderBindings) {
    await writeProviderBindings();
  }
  return buildMetabotProfileFull(profile);
}

export async function getMetabotWalletInfo(systemHomeDir: string, slug: string): Promise<MetabotWalletInfo> {
  const profile = await getMetabotProfile(systemHomeDir, slug);
  if (!profile) {
    throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
  }
  const secretStore = createFileSecretStore(profile.homeDir);
  const [secrets, runtimeState] = await Promise.all([
    secretStore.readIdentitySecrets<LocalIdentitySecrets>(),
    createRuntimeStateStore(profile.homeDir).readState(),
  ]);
  const identity = runtimeState.identity;
  return {
    slug: profile.slug,
    name: profile.name,
    addresses: {
      btc: normalizeText(secrets?.btcAddress) || normalizeText(identity?.btcAddress),
      mvc: normalizeText(secrets?.mvcAddress) || normalizeText(identity?.mvcAddress) || profile.mvcAddress,
    },
  };
}

export async function getMetabotMnemonicBackup(systemHomeDir: string, slug: string): Promise<MetabotMnemonicBackup> {
  const profile = await getMetabotProfile(systemHomeDir, slug);
  if (!profile) {
    throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
  }
  const secrets = await createFileSecretStore(profile.homeDir).readIdentitySecrets<LocalIdentitySecrets>();
  const mnemonic = normalizeText(secrets?.mnemonic);
  if (!mnemonic) {
    throw new Error('Mnemonic backup is unavailable for this MetaBot.');
  }
  return {
    slug: profile.slug,
    name: profile.name,
    words: mnemonic.split(/\s+/).filter(Boolean),
  };
}

async function deleteLlmExecutorSessionsForSlug(profile: IdentityProfileRecord): Promise<string[]> {
  const paths = resolveMetabotPaths(profile.homeDir);
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(paths.llmExecutorSessionsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return removed;
    }
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.endsWith('.json')) return;
    const filePath = path.join(paths.llmExecutorSessionsRoot, entry);
    let parsed: { sessionId?: unknown; metaBotSlug?: unknown } | null = null;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { sessionId?: unknown; metaBotSlug?: unknown };
    } catch {
      return;
    }
    if (normalizeText(parsed.metaBotSlug) !== profile.slug) return;
    const entrySessionId = entry.replace(/\.json$/, '');
    const parsedSessionId = normalizeText(parsed.sessionId);
    const sessionId = isSafeLocalFileStem(parsedSessionId)
      ? parsedSessionId
      : entrySessionId;
    await fs.rm(filePath, { force: true });
    if (isSafeLocalFileStem(sessionId)) {
      await fs.rm(path.join(paths.llmExecutorTranscriptsRoot, `${sessionId}.log`), { force: true });
    }
    removed.push(sessionId);
  }));
  return removed.sort();
}

export async function deleteMetabotProfile(
  systemHomeDir: string,
  slug: string,
): Promise<DeleteMetabotProfileResult> {
  const profile = await getMetabotProfile(systemHomeDir, slug);
  if (!profile) {
    throw new Error(`MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
  }

  const removedExecutorSessions = await deleteLlmExecutorSessionsForSlug(profile);
  await fs.rm(profile.homeDir, { recursive: true, force: true });
  const deleted = await deleteIdentityProfile({
    systemHomeDir,
    slug: profile.slug,
  });
  if (!deleted) {
    throw new Error(`MetaBot profile not found: ${profile.slug}`);
  }

  return {
    profile: deleted,
    removedExecutorSessions,
  };
}

async function buildProviderBindingWrite(input: {
  profile: MetabotProfileFull;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}): Promise<(() => Promise<void>) | null> {
  const updates: Array<{ role: 'primary' | 'fallback'; provider: LlmProvider | null }> = [];
  if (input.primaryProvider !== undefined) {
    updates.push({ role: 'primary', provider: input.primaryProvider });
  }
  if (input.fallbackProvider !== undefined) {
    updates.push({ role: 'fallback', provider: input.fallbackProvider });
  }
  if (!updates.length) return null;

  const paths = resolveMetabotPaths(input.profile.homeDir);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  const [runtimeState, bindingState] = await Promise.all([
    runtimeStore.read(),
    bindingStore.read(),
  ]);
  const now = new Date().toISOString();
  let nextBindings = [...bindingState.bindings];

  for (const update of updates) {
    const existing = selectVisibleRoleBinding(nextBindings.filter((binding) => (
      binding.metaBotSlug === input.profile.slug && binding.role === update.role
    )));
    if (update.provider === null) {
      if (existing) {
        nextBindings = nextBindings.filter((binding) => binding.id !== existing.id);
      }
      continue;
    }
    const runtime = selectRuntimeForProvider(runtimeState.runtimes, update.provider);
    const binding = normalizeLlmBinding(buildProviderBinding({
      slug: input.profile.slug,
      runtime,
      role: update.role,
      existing,
      now,
    }));
    if (binding) {
      if (existing) {
        nextBindings = nextBindings.map((entry) => entry.id === existing.id ? binding : entry);
      } else {
        nextBindings.push(binding);
      }
    }
  }

  return async () => {
    await bindingStore.write({
      version: bindingState.version + 1,
      bindings: nextBindings,
    });
  };
}

export async function updateMetabotProfile(
  systemHomeDir: string,
  slug: string,
  input: UpdateMetabotInfoInput,
): Promise<MetabotProfileFull> {
  const current = await getMetabotProfile(systemHomeDir, slug);
  if (!current) {
    throw new Error(`MetaBot profile not found: ${slug}`);
  }
  const paths = resolveMetabotPaths(current.homeDir);

  const name = input.name !== undefined ? normalizeText(input.name) : undefined;
  if (input.name !== undefined && !name) {
    throw new Error('MetaBot name is required.');
  }
  const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
  if (avatar) {
    const validation = validateAvatarDataUrl(avatar);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }
  const writeProviderBindings = await buildProviderBindingWrite({
    profile: current,
    primaryProvider: input.primaryProvider === undefined
      ? undefined
      : (() => {
        const provider = validateProvider(input.primaryProvider);
        return provider === (current.primaryProvider ?? null) ? undefined : provider;
      })(),
    fallbackProvider: input.fallbackProvider === undefined
      ? undefined
      : (() => {
        const provider = validateProvider(input.fallbackProvider);
        return provider === (current.fallbackProvider ?? null) ? undefined : provider;
      })(),
  });

  if (name !== undefined && name !== current.name) {
    await upsertIdentityProfile({
      systemHomeDir,
      name,
      homeDir: current.homeDir,
      globalMetaId: current.globalMetaId,
      mvcAddress: current.mvcAddress,
    });
  }

  if (input.role !== undefined) {
    await writeTextFile(paths.roleMdPath, input.role);
  }
  if (input.soul !== undefined) {
    await writeTextFile(paths.soulMdPath, input.soul);
  }
  if (input.goal !== undefined) {
    await writeTextFile(paths.goalMdPath, input.goal);
  }
  if (avatar !== undefined) {
    if (!avatar) {
      await removeFileIfExists(resolveAvatarPath(current.homeDir));
    } else {
      await writeTextFile(resolveAvatarPath(current.homeDir), avatar);
    }
  }

  if (writeProviderBindings) {
    await writeProviderBindings();
  }

  const updated = await getMetabotProfile(systemHomeDir, current.slug);
  if (!updated) {
    throw new Error(`MetaBot profile not found after update: ${current.slug}`);
  }
  return updated;
}

export async function syncMetabotInfoToChain(
  signer: Signer,
  profile: MetabotProfileFull,
  changedFields: string[],
  options: SyncMetabotInfoToChainOptions = {},
): Promise<ChainWriteResult[]> {
  if (!normalizeText(profile.globalMetaId) || changedFields.length === 0) {
    return [];
  }

  const delayMs = options.delayMs ?? CHAIN_SYNC_DELAY_MS;
  const operation = options.operation ?? 'modify';
  const changed = new Set(changedFields);
  const results: ChainWriteResult[] = [];

  if (changed.has('name')) {
    results.push(await signer.writePin({
      operation,
      path: '/info/name',
      encryption: '0',
      version: '1.0',
      contentType: 'application/json',
      payload: JSON.stringify({ name: profile.name }),
      encoding: 'utf-8',
      network: 'mvc',
    }));
  }

  if (changed.has('avatar')) {
    if (results.length > 0) {
      await sleep(delayMs);
    }
    const avatarPayload = normalizeText(profile.avatarDataUrl);
    results.push(await signer.writePin({
      operation,
      path: '/info/avatar',
      encryption: '0',
      version: '1.0',
      contentType: avatarPayload ? avatarMimeType(avatarPayload) : 'text/plain',
      payload: avatarPayload,
      encoding: 'utf-8',
      network: 'mvc',
    }));
  }

  if (changedFields.some((field) => BIO_FIELDS.has(field))) {
    if (results.length > 0) {
      await sleep(delayMs);
    }
    results.push(await signer.writePin({
      operation,
      path: '/info/bio',
      encryption: '0',
      version: '1.0',
      contentType: 'application/json',
      payload: JSON.stringify({
        role: profile.role,
        soul: profile.soul,
        goal: profile.goal,
        primaryProvider: profile.primaryProvider ?? null,
        fallbackProvider: profile.fallbackProvider ?? null,
      }),
      encoding: 'utf-8',
      network: 'mvc',
    }));
  }

  return results;
}
