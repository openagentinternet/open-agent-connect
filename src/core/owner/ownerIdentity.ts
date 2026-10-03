// The local human "owner" identity: the person who talks to the Bots. This is
// deliberately NOT a MetaBot Bot profile — it is a single machine-wide MetaID
// wallet (mnemonic -> globalMetaId) stored under `~/.metabot/owner/`, mirroring
// IDBots' single-row `user_identity`. Bots reference it through their
// `ownerGlobalMetaId` binding. The mnemonic is secret material, so the file is
// written 0600 and lives outside `manager/` (the storage-layout spec forbids
// mnemonics there).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { DEFAULT_DERIVATION_PATH, deriveIdentity } from '../identity/deriveIdentity';
import { validateAvatarDataUrl } from '../identity/avatarChainWrite';

const OWNER_FILE_MODE = 0o600;
export const DEFAULT_OWNER_NAME = 'User';

export interface OwnerIdentityRecord {
  version: 1;
  name: string;
  mnemonic: string;
  path: string;
  publicKey: string;
  chatPublicKey: string;
  mvcAddress: string;
  metaId: string;
  globalMetaId: string;
  /** Avatar as an image data URL (PNG/JPEG/WebP/GIF, ≤200KB); absent when unset. */
  avatarDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything except the mnemonic; safe to surface in UI / CLI output. */
export type OwnerIdentityPublic = Omit<OwnerIdentityRecord, 'mnemonic'>;

export class OwnerIdentityError extends Error {
  constructor(
    readonly code: 'owner_exists' | 'owner_missing' | 'invalid_mnemonic' | 'invalid_name' | 'invalid_avatar',
    message: string,
  ) {
    super(message);
    this.name = 'OwnerIdentityError';
  }
}

export function resolveOwnerIdfilePath(systemHomeDir: string): string {
  return path.join(systemHomeDir, '.metabot', 'owner', 'identity.json');
}

export function toOwnerIdentityPublic(record: OwnerIdentityRecord): OwnerIdentityPublic {
  return {
    version: record.version,
    name: record.name,
    path: record.path,
    publicKey: record.publicKey,
    chatPublicKey: record.chatPublicKey,
    mvcAddress: record.mvcAddress,
    metaId: record.metaId,
    globalMetaId: record.globalMetaId,
    ...(record.avatarDataUrl ? { avatarDataUrl: record.avatarDataUrl } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function normalizeOwnerIdentityRecord(value: unknown): OwnerIdentityRecord | null {
  if (!isRecord(value)) return null;
  const mnemonic = readString(value, 'mnemonic');
  const globalMetaId = readString(value, 'globalMetaId');
  const mvcAddress = readString(value, 'mvcAddress');
  if (!mnemonic || !globalMetaId || !mvcAddress) return null;
  return {
    version: 1,
    name: readString(value, 'name') || DEFAULT_OWNER_NAME,
    mnemonic,
    path: readString(value, 'path') || DEFAULT_DERIVATION_PATH,
    publicKey: readString(value, 'publicKey'),
    chatPublicKey: readString(value, 'chatPublicKey'),
    mvcAddress,
    metaId: readString(value, 'metaId'),
    globalMetaId,
    ...(readString(value, 'avatarDataUrl') ? { avatarDataUrl: readString(value, 'avatarDataUrl') } : {}),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

export async function readOwnerIdentity(systemHomeDir: string): Promise<OwnerIdentityRecord | null> {
  try {
    const raw = await fs.readFile(resolveOwnerIdfilePath(systemHomeDir), 'utf8');
    return normalizeOwnerIdentityRecord(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function applyOwnerFileMode(filePath: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(filePath, OWNER_FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL') return;
    throw error;
  }
}

async function writeOwnerIdentityFile(systemHomeDir: string, record: OwnerIdentityRecord): Promise<void> {
  const filePath = resolveOwnerIdfilePath(systemHomeDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    mode: OWNER_FILE_MODE,
  });
  await applyOwnerFileMode(filePath);
}

function cleanName(name: string): string {
  return name.trim();
}

function persistDerived(
  systemHomeDir: string,
  name: string,
  derived: { mnemonic: string; path: string; publicKey: string; chatPublicKey: string; mvcAddress: string; metaId: string; globalMetaId: string },
): OwnerIdentityRecord {
  const now = new Date().toISOString();
  return {
    version: 1,
    name: cleanName(name) || DEFAULT_OWNER_NAME,
    mnemonic: derived.mnemonic,
    path: derived.path,
    publicKey: derived.publicKey,
    chatPublicKey: derived.chatPublicKey,
    mvcAddress: derived.mvcAddress,
    metaId: derived.metaId,
    globalMetaId: derived.globalMetaId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Create a brand-new owner identity (fresh mnemonic). Fails if one exists. */
export async function createOwnerIdentity(systemHomeDir: string, input: { name: string }): Promise<OwnerIdentityRecord> {
  const existing = await readOwnerIdentity(systemHomeDir);
  if (existing) {
    throw new OwnerIdentityError('owner_exists', 'An owner identity already exists on this machine.');
  }
  const derived = await deriveIdentity({});
  const record = persistDerived(systemHomeDir, input.name, derived);
  await writeOwnerIdentityFile(systemHomeDir, record);
  return record;
}

/** Import an owner identity from an existing mnemonic. Fails if one exists. */
export async function importOwnerIdentity(
  systemHomeDir: string,
  input: { name: string; mnemonic: string; path?: string },
): Promise<OwnerIdentityRecord> {
  const existing = await readOwnerIdentity(systemHomeDir);
  if (existing) {
    throw new OwnerIdentityError('owner_exists', 'An owner identity already exists on this machine.');
  }
  const mnemonic = input.mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!bip39.validateMnemonic(mnemonic, wordlist)) {
    throw new OwnerIdentityError('invalid_mnemonic', 'The mnemonic is not a valid BIP39 phrase.');
  }
  const derived = await deriveIdentity({ mnemonic, path: input.path?.trim() || DEFAULT_DERIVATION_PATH });
  const record = persistDerived(systemHomeDir, input.name, derived);
  await writeOwnerIdentityFile(systemHomeDir, record);
  return record;
}

/** Return the existing identity, creating one with a default name when absent. */
export async function ensureOwnerIdentity(systemHomeDir: string, input: { name?: string } = {}): Promise<OwnerIdentityRecord> {
  const existing = await readOwnerIdentity(systemHomeDir);
  if (existing) return existing;
  return createOwnerIdentity(systemHomeDir, { name: input.name ?? DEFAULT_OWNER_NAME });
}

/** Rename the existing owner identity. */
export async function renameOwnerIdentity(systemHomeDir: string, name: string): Promise<OwnerIdentityRecord> {
  const current = await readOwnerIdentity(systemHomeDir);
  if (!current) {
    throw new OwnerIdentityError('owner_missing', 'No owner identity exists on this machine.');
  }
  const nextName = cleanName(name);
  if (!nextName) {
    throw new OwnerIdentityError('invalid_name', 'Name must not be empty.');
  }
  const record: OwnerIdentityRecord = { ...current, name: nextName, updatedAt: new Date().toISOString() };
  await writeOwnerIdentityFile(systemHomeDir, record);
  return record;
}

/**
 * Update the owner profile fields (name and/or avatar). An empty avatar data
 * URL clears the stored avatar. Callers that publish on-chain write the chain
 * FIRST and call this only after the publish succeeded (chain-first ordering,
 * same as the Bot profile update handler).
 */
export async function updateOwnerIdentityProfile(
  systemHomeDir: string,
  input: { name?: string; avatarDataUrl?: string },
): Promise<OwnerIdentityRecord> {
  const current = await readOwnerIdentity(systemHomeDir);
  if (!current) {
    throw new OwnerIdentityError('owner_missing', 'No owner identity exists on this machine.');
  }
  let nextName = current.name;
  if (input.name !== undefined) {
    nextName = cleanName(input.name);
    if (!nextName) {
      throw new OwnerIdentityError('invalid_name', 'Name must not be empty.');
    }
  }
  let avatarDataUrl = current.avatarDataUrl;
  if (input.avatarDataUrl !== undefined) {
    const nextAvatar = input.avatarDataUrl.trim();
    const validation = validateAvatarDataUrl(nextAvatar);
    if (!validation.valid) {
      throw new OwnerIdentityError('invalid_avatar', validation.error ?? 'Invalid avatar.');
    }
    avatarDataUrl = nextAvatar || undefined;
  }
  const record: OwnerIdentityRecord = {
    ...current,
    name: nextName,
    updatedAt: new Date().toISOString(),
  };
  if (avatarDataUrl) {
    record.avatarDataUrl = avatarDataUrl;
  } else {
    delete record.avatarDataUrl;
  }
  await writeOwnerIdentityFile(systemHomeDir, record);
  return record;
}

/** Reveal the stored mnemonic (for the backup view). */
export async function revealOwnerMnemonic(systemHomeDir: string): Promise<string> {
  const current = await readOwnerIdentity(systemHomeDir);
  if (!current) {
    throw new OwnerIdentityError('owner_missing', 'No owner identity exists on this machine.');
  }
  return current.mnemonic;
}

/** Delete the owner identity (logout). */
export async function deleteOwnerIdentity(systemHomeDir: string): Promise<void> {
  try {
    await fs.unlink(resolveOwnerIdfilePath(systemHomeDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
