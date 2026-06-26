import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  deleteIdentityProfile,
  listIdentityProfiles,
  upsertIdentityProfile,
} from '../identity/identityProfiles';
import type { IdentityProfileRecord } from '../identity/identityProfiles';
import { resolveProfileNameConflict } from '../identity/profileNameResolution';
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
  normalizeMetabotHomepage,
  readMetabotHomepage,
  serializeMetabotHomepagePayload,
  writeMetabotHomepage,
  type MetabotHomepage,
} from './metabotHomepage';
import {
  isLlmProvider,
  normalizeLlmBinding,
} from '../llm/llmTypes';
import { normalizeAllowChatSkills } from '../services/chatSkillPolicy';
import {
  buildAvatarChainWriteRequest,
  validateAvatarDataUrl,
} from '../identity/avatarChainWrite';
import type {
  ChainWriteEncoding,
  ChainWritePayload,
} from '../chain/writePin';
import type {
  LlmBinding,
  LlmBindingRole,
  LlmProvider,
  LlmRuntime,
} from '../llm/llmTypes';
import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import {
  buildProfilePublishRecord,
  createProfilePublishStateStore,
  hashProfilePublishPayload,
  type ProfilePublishPayloadInput,
} from './profilePublishState';
import { normalizePublicMetabotPersona } from './metabotPersona';

const CHAIN_SYNC_DELAY_MS = 3_000;
const PROFILE_INFO_FIELDS = new Set(['bio', 'role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider', 'allowChatSkills', 'homepage']);

export { validateAvatarDataUrl } from '../identity/avatarChainWrite';

export interface MetabotProfileFull extends IdentityProfileRecord {
  bio: string;
  role: string;
  soul: string;
  goal: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills: string[];
  homepage?: MetabotHomepage;
}

export interface CreateMetabotInput {
  name: string;
  bio?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills?: string[];
}

export interface CreateMetabotFromIdentityInput extends CreateMetabotInput {
  homeDir: string;
  globalMetaId: string;
  mvcAddress: string;
}

export interface UpdateMetabotInfoInput {
  name?: string;
  bio?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills?: string[];
  homepage?: MetabotHomepage | null;
}

export interface SyncMetabotInfoToChainOptions {
  delayMs?: number;
  operation?: 'create' | 'modify';
  deferPublishStateWrite?: boolean;
}

export interface MetabotInfoPublishTarget extends ProfilePublishPayloadInput {
  encoding: ChainWriteEncoding;
  operation?: 'create' | 'modify' | 'revoke';
  skipIfUnpublished?: boolean;
}

export interface MetabotWalletInfo {
  slug: string;
  name: string;
  addresses: {
    btc: string;
    mvc: string;
    doge: string;
    opcat: string;
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

function isSafeLocalFileStem(value: string): boolean {
  if (!value || value === '.' || value === '..') return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return path.basename(value) === value;
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

async function readChatSkillPolicy(filePath: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { allowChatSkills?: unknown };
    return normalizeAllowChatSkills(parsed?.allowChatSkills);
  } catch {
    return [];
  }
}

async function writeChatSkillPolicy(filePath: string, allowChatSkills: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify({
    allowChatSkills,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
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

function runtimeHealthRank(runtime: LlmRuntime): number {
  if (runtime.health === 'healthy') return 2;
  if (runtime.health === 'degraded') return 1;
  return 0;
}

function runtimeActivityMs(runtime: LlmRuntime): number {
  return Math.max(
    Date.parse(runtime.lastSeenAt) || 0,
    Date.parse(runtime.updatedAt) || 0,
    Date.parse(runtime.createdAt) || 0,
  );
}

function compareRuntimePreference(left: LlmRuntime, right: LlmRuntime): number {
  const healthDelta = runtimeHealthRank(right) - runtimeHealthRank(left);
  if (healthDelta !== 0) return healthDelta;
  const activityDelta = runtimeActivityMs(right) - runtimeActivityMs(left);
  if (activityDelta !== 0) return activityDelta;
  return left.id.localeCompare(right.id);
}

function compareRuntimeActivityPreference(left: LlmRuntime, right: LlmRuntime): number {
  const activityDelta = runtimeActivityMs(right) - runtimeActivityMs(left);
  if (activityDelta !== 0) return activityDelta;
  const healthDelta = runtimeHealthRank(right) - runtimeHealthRank(left);
  if (healthDelta !== 0) return healthDelta;
  return left.id.localeCompare(right.id);
}

function isDefaultSelectableRuntime(runtime: LlmRuntime): boolean {
  return runtime.provider !== 'custom' && runtime.health === 'healthy';
}

export function selectRuntimeForProvider(runtimes: LlmRuntime[], provider: LlmProvider): LlmRuntime {
  const candidates = runtimes.filter((runtime) => (
    runtime.provider === provider && runtime.health === 'healthy'
  )).sort(compareRuntimePreference);
  const runtime = candidates[0];
  if (!runtime) {
    throw new Error(`No available runtime found for provider: ${provider}`);
  }
  return runtime;
}

export function selectDefaultMetabotProviders(input: {
  runtimes: LlmRuntime[];
  preferredProvider?: LlmProvider | null;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}): { primaryProvider?: LlmProvider | null; fallbackProvider?: LlmProvider | null } {
  const availableRuntimes = input.runtimes
    .filter(isDefaultSelectableRuntime)
    .sort(compareRuntimeActivityPreference);
  const availableProviderRows = availableRuntimes.filter((runtime, index, rows) => (
    rows.findIndex((candidate) => candidate.provider === runtime.provider) === index
  ));
  const availableProviders = new Set(availableProviderRows.map((runtime) => runtime.provider));
  const preferredProvider = input.preferredProvider && input.preferredProvider !== 'custom'
    ? input.preferredProvider
    : null;

  let primaryProvider = input.primaryProvider;
  if (primaryProvider === undefined) {
    primaryProvider = preferredProvider && availableProviders.has(preferredProvider)
      ? preferredProvider
      : availableProviderRows[0]?.provider;
  }

  let fallbackProvider = input.fallbackProvider;
  if (fallbackProvider === undefined) {
    fallbackProvider = availableProviderRows.find((runtime) => runtime.provider !== primaryProvider)?.provider;
  }

  return {
    primaryProvider,
    fallbackProvider,
  };
}

async function resolveCreateProviderSelection(input: {
  homeDir: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  preferredProvider?: LlmProvider | null;
}): Promise<{ primaryProvider?: LlmProvider | null; fallbackProvider?: LlmProvider | null }> {
  const runtimeState = await createLlmRuntimeStore(resolveMetabotPaths(input.homeDir)).read();
  return selectDefaultMetabotProviders({
    runtimes: runtimeState.runtimes,
    preferredProvider: input.preferredProvider,
    primaryProvider: input.primaryProvider,
    fallbackProvider: input.fallbackProvider,
  });
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
  const [bio, role, soul, goal, avatarDataUrl, providerBindings, allowChatSkills, homepage] = await Promise.all([
    readTextFile(paths.bioMdPath),
    readTextFile(paths.roleMdPath),
    readTextFile(paths.soulMdPath),
    readTextFile(paths.goalMdPath),
    readTextFile(resolveAvatarPath(profile.homeDir)),
    readProfileProviderBindings(profile),
    readChatSkillPolicy(paths.chatSkillPolicyPath),
    readMetabotHomepage(paths.homepageStatePath),
  ]);
  const persona = normalizePublicMetabotPersona({ role, soul, goal });

  return {
    ...profile,
    bio,
    role: persona.role,
    soul: persona.soul,
    goal: persona.goal,
    ...(avatarDataUrl ? { avatarDataUrl } : {}),
    primaryProvider: providerBindings.primaryProvider,
    fallbackProvider: providerBindings.fallbackProvider,
    allowChatSkills,
    ...(homepage ? { homepage } : {}),
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
  const primaryProvider = input.primaryProvider === undefined ? undefined : validateProvider(input.primaryProvider);
  const fallbackProvider = input.fallbackProvider === undefined ? undefined : validateProvider(input.fallbackProvider);
  const providerSelection = await resolveCreateProviderSelection({
    homeDir: resolvedHome.homeDir,
    primaryProvider,
    fallbackProvider,
  });

  await ensureProfileWorkspace({
    homeDir: resolvedHome.homeDir,
    name,
  });
  const paths = resolveMetabotPaths(resolvedHome.homeDir);
  const persona = normalizePublicMetabotPersona({
    role: input.role,
    soul: input.soul,
    goal: input.goal,
  });
  await Promise.all([
    writeTextFile(paths.bioMdPath, normalizeText(input.bio)),
    writeTextFile(paths.roleMdPath, persona.role),
    writeTextFile(paths.soulMdPath, persona.soul),
    writeTextFile(paths.goalMdPath, persona.goal),
  ]);
  if (avatar) {
    await writeTextFile(resolveAvatarPath(resolvedHome.homeDir), avatar);
  }

  const profile = await upsertIdentityProfile({
    systemHomeDir,
    name,
    homeDir: resolvedHome.homeDir,
  });
  const fullProfile = await buildMetabotProfileFull(profile);
  const writeProviderBindings = await buildProviderBindingWrite({
    profile: fullProfile,
    primaryProvider: providerSelection.primaryProvider,
    fallbackProvider: providerSelection.fallbackProvider,
  });
  if (writeProviderBindings) {
    await writeProviderBindings();
  }
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
    bio: normalizeText(input.bio),
    ...normalizePublicMetabotPersona({
      role: input.role,
      soul: input.soul,
      goal: input.goal,
    }),
    ...(avatar ? { avatarDataUrl: avatar } : {}),
    primaryProvider: input.primaryProvider === undefined ? null : validateProvider(input.primaryProvider),
    fallbackProvider: input.fallbackProvider === undefined ? null : validateProvider(input.fallbackProvider),
    allowChatSkills: input.allowChatSkills === undefined ? [] : normalizeAllowChatSkills(input.allowChatSkills),
  };
}

export async function createMetabotProfileFromIdentity(
  systemHomeDir: string,
  input: CreateMetabotFromIdentityInput,
): Promise<MetabotProfileFull> {
  const providerSelection = await resolveCreateProviderSelection({
    homeDir: input.homeDir,
    primaryProvider: input.primaryProvider === undefined ? undefined : validateProvider(input.primaryProvider),
    fallbackProvider: input.fallbackProvider === undefined ? undefined : validateProvider(input.fallbackProvider),
  });
  const draft = buildMetabotProfileDraftFromIdentity({
    ...input,
    primaryProvider: providerSelection.primaryProvider,
    fallbackProvider: providerSelection.fallbackProvider,
  });

  await ensureProfileWorkspace({
    homeDir: draft.homeDir,
    name: draft.name,
  });
  const paths = resolveMetabotPaths(draft.homeDir);
  await Promise.all([
    writeTextFile(paths.bioMdPath, draft.bio),
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
    primaryProvider: draft.primaryProvider,
    fallbackProvider: draft.fallbackProvider,
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
      btc: normalizeText(secrets?.addresses?.btc) || normalizeText(identity?.addresses?.btc),
      mvc: normalizeText(secrets?.addresses?.mvc) || normalizeText(identity?.addresses?.mvc) || normalizeText(secrets?.mvcAddress) || normalizeText(identity?.mvcAddress) || profile.mvcAddress,
      doge: normalizeText(secrets?.addresses?.doge) || normalizeText(identity?.addresses?.doge),
      opcat: normalizeText(secrets?.addresses?.opcat) || normalizeText(identity?.addresses?.opcat),
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
  if (name !== undefined && name !== current.name) {
    const profiles = await listIdentityProfiles(systemHomeDir);
    const duplicate = resolveProfileNameConflict(name, profiles.filter((profile) => profile.slug !== current.slug));
    if (duplicate.status === 'matched') {
      throw new Error(`MetaBot name already exists: ${name}`);
    }
    if (duplicate.status === 'ambiguous') {
      throw new Error(duplicate.message);
    }
  }
  const avatar = input.avatarDataUrl !== undefined ? normalizeText(input.avatarDataUrl) : undefined;
  if (avatar) {
    const validation = validateAvatarDataUrl(avatar);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }
  const allowChatSkills = input.allowChatSkills === undefined
    ? undefined
    : normalizeAllowChatSkills(input.allowChatSkills);
  const homepage = input.homepage === undefined
    ? undefined
    : normalizeMetabotHomepage(input.homepage);
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
  if (input.bio !== undefined) {
    await writeTextFile(paths.bioMdPath, input.bio);
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
  if (allowChatSkills !== undefined) {
    await writeChatSkillPolicy(paths.chatSkillPolicyPath, allowChatSkills);
  }
  if (homepage !== undefined) {
    if (homepage === null) {
      await removeFileIfExists(paths.homepageStatePath);
    } else {
      await writeMetabotHomepage(paths.homepageStatePath, homepage);
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

function textInfoTarget(input: {
  path: string;
  contentType: string;
  payload: string;
  skipIfUnpublished?: boolean;
}): MetabotInfoPublishTarget {
  return {
    path: input.path,
    contentType: input.contentType,
    payload: input.payload,
    encoding: 'utf-8',
    operation: 'create',
    skipIfUnpublished: input.skipIfUnpublished,
  };
}

function jsonInfoTarget(input: {
  path: string;
  payload: unknown;
  skipIfUnpublished?: boolean;
}): MetabotInfoPublishTarget {
  return textInfoTarget({
    path: input.path,
    contentType: 'application/json',
    payload: typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload),
    skipIfUnpublished: input.skipIfUnpublished,
  });
}

function hasAnyProvider(profile: MetabotProfileFull): boolean {
  return Boolean(profile.primaryProvider || profile.fallbackProvider);
}

function hasAnyPersonaValue(profile: MetabotProfileFull): boolean {
  const persona = normalizePublicMetabotPersona(profile);
  return Boolean(persona.role || persona.soul || persona.goal);
}

function normalizePublishTarget(input: MetabotInfoPublishTarget): MetabotInfoPublishTarget {
  const pathValue = normalizeText(input.path);
  const contentType = normalizeText(input.contentType);
  if (!pathValue || !contentType) {
    throw new Error('Profile info publish targets require path and contentType.');
  }
  const encoding = input.encoding === 'binary' || input.encoding === 'base64' ? input.encoding : 'utf-8';
  const payload: ChainWritePayload = Buffer.isBuffer(input.payload)
    ? Buffer.from(input.payload)
    : String(input.payload ?? '');
  return {
    path: pathValue,
    contentType,
    encoding,
    payload,
    operation: input.operation ?? 'create',
    skipIfUnpublished: input.skipIfUnpublished === true,
  };
}

function normalizePublishTargets(targets: MetabotInfoPublishTarget[]): MetabotInfoPublishTarget[] {
  const normalizedTargets = targets.map((target) => normalizePublishTarget(target));
  const targetByPath = new Map<string, MetabotInfoPublishTarget>();
  for (const target of normalizedTargets) {
    targetByPath.set(target.path, target);
  }
  return [...targetByPath.values()];
}

export function buildMetabotInfoPublishTargets(
  profile: MetabotProfileFull,
  fields: Iterable<string>,
): MetabotInfoPublishTarget[] {
  const changed = new Set([...fields].map((field) => normalizeText(field)).filter(Boolean));
  const targets: MetabotInfoPublishTarget[] = [];

  if (changed.has('name')) {
    targets.push(textInfoTarget({
      path: '/info/name',
      contentType: 'text/plain',
      payload: profile.name,
    }));
  }

  if (changed.has('avatar')) {
    const request = buildAvatarChainWriteRequest({
      operation: 'create',
      avatarDataUrl: profile.avatarDataUrl ?? '',
      network: 'mvc',
    });
    targets.push(normalizePublishTarget({
      path: request.path ?? '/info/avatar',
      contentType: request.contentType ?? 'text/plain',
      payload: request.payload ?? '',
      encoding: request.encoding === 'binary' || request.encoding === 'base64' ? request.encoding : 'utf-8',
      operation: 'create',
    }));
  }

  if (changedFieldsHaveProfileInfo(changed)) {
    const personaChanged = changed.has('persona') || changed.has('role') || changed.has('soul') || changed.has('goal');
    if (changed.has('bio')) {
      targets.push(textInfoTarget({
        path: '/info/bio',
        contentType: 'text/plain',
        payload: profile.bio,
        skipIfUnpublished: !normalizeText(profile.bio),
      }));
    }
    if (personaChanged) {
      const persona = normalizePublicMetabotPersona(profile);
      if (hasAnyPersonaValue(profile)) {
        targets.push(jsonInfoTarget({
          path: '/info/persona',
          payload: persona,
        }));
      } else {
        targets.push(jsonInfoTarget({
          path: '/info/persona',
          payload: '',
          skipIfUnpublished: true,
        }));
      }
    }
    if (changed.has('allowChatSkills')) {
      targets.push(jsonInfoTarget({
        path: '/info/chatSkills',
        payload: {
          allowPrivateChatSkills: normalizeAllowChatSkills(profile.allowChatSkills),
          allowGroupChatSkills: [],
        },
      }));
    }
    if (changed.has('llm') || changed.has('primaryProvider') || changed.has('fallbackProvider')) {
      targets.push(jsonInfoTarget({
        path: '/info/llm',
        payload: {
          primaryProvider: profile.primaryProvider ?? null,
          fallbackProvider: profile.fallbackProvider ?? null,
        },
        skipIfUnpublished: !hasAnyProvider(profile),
      }));
    }
    if (changed.has('homepage')) {
      if (profile.homepage) {
        targets.push(jsonInfoTarget({
          path: '/info/homepage',
          payload: serializeMetabotHomepagePayload(profile.homepage),
        }));
      } else {
        targets.push(jsonInfoTarget({
          path: '/info/homepage',
          payload: '',
        }));
      }
    }
  }

  return normalizePublishTargets(targets);
}

function changedFieldsHaveProfileInfo(changed: Set<string>): boolean {
  return [...changed].some((field) => PROFILE_INFO_FIELDS.has(field) || field === 'persona' || field === 'llm');
}

function isPublishTargetList(
  fieldsOrTargets: string[] | MetabotInfoPublishTarget[],
): fieldsOrTargets is MetabotInfoPublishTarget[] {
  return fieldsOrTargets.length > 0 && typeof fieldsOrTargets[0] !== 'string';
}

function resolvePublishTargets(
  profile: MetabotProfileFull,
  fieldsOrTargets: string[] | MetabotInfoPublishTarget[],
): MetabotInfoPublishTarget[] {
  return isPublishTargetList(fieldsOrTargets)
    ? normalizePublishTargets(fieldsOrTargets)
    : buildMetabotInfoPublishTargets(profile, fieldsOrTargets);
}

export async function recordMetabotInfoPublishResults(
  profile: MetabotProfileFull | { homeDir: string },
  targets: MetabotInfoPublishTarget[],
  results: ChainWriteResult[],
): Promise<void> {
  if (targets.length === 0 || results.length === 0) {
    return;
  }
  const targetByPath = new Map(normalizePublishTargets(targets).map((target) => [target.path, target]));
  const publishResults = results
    .map((result) => {
      const target = targetByPath.get(result.path);
      return target ? { target, result } : null;
    })
    .filter((entry): entry is { target: MetabotInfoPublishTarget; result: ChainWriteResult } => entry !== null);
  if (publishResults.length === 0) {
    return;
  }
  await createProfilePublishStateStore(profile.homeDir).update((currentState) => {
    const nextRecords = { ...currentState.records };
    for (const entry of publishResults) {
      nextRecords[entry.target.path] = buildProfilePublishRecord(entry);
    }
    return {
      version: 1,
      records: nextRecords,
    };
  });
}

export async function syncMetabotInfoToChain(
  signer: Signer,
  profile: MetabotProfileFull,
  fieldsOrTargets: string[] | MetabotInfoPublishTarget[],
  options: SyncMetabotInfoToChainOptions = {},
): Promise<ChainWriteResult[]> {
  const targets = resolvePublishTargets(profile, fieldsOrTargets);
  if (!normalizeText(profile.globalMetaId) || targets.length === 0) {
    return [];
  }

  const delayMs = options.delayMs ?? CHAIN_SYNC_DELAY_MS;
  const infoOperation = 'create';
  const results: ChainWriteResult[] = [];
  const writtenTargets: MetabotInfoPublishTarget[] = [];
  const publishStateStore = createProfilePublishStateStore(profile.homeDir);
  const publishState = await publishStateStore.read();

  async function writeProfileInfo(target: MetabotInfoPublishTarget): Promise<void> {
    if (results.length > 0) {
      await sleep(delayMs);
    }
    const result = await signer.writePin({
      operation: target.operation ?? infoOperation,
      path: target.path,
      encryption: '0',
      version: '1.0',
      contentType: target.contentType,
      payload: target.payload,
      encoding: target.encoding,
      network: 'mvc',
    });
    results.push(result);
    writtenTargets.push(target);
  }

  for (const target of targets) {
    const previous = publishState.records[target.path];
    if (target.skipIfUnpublished && !previous) {
      continue;
    }
    const payloadHash = hashProfilePublishPayload(target);
    if (previous?.payloadHash === payloadHash) {
      continue;
    }
    await writeProfileInfo(target);
  }

  if (!options.deferPublishStateWrite) {
    await recordMetabotInfoPublishResults(profile, writtenTargets, results);
  }

  return results;
}
