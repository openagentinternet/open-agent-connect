// Per-Bot role + owner binding state, stored at
// `.runtime/state/bot-role.json` following the dshLlm.ts precedent.
// `botType` implements the IDBots twin/worker split (at most one twin per
// machine, enforced by twinRole.ts); `ownerGlobalMetaId` binds the Bot to its
// owner's GlobalMetaID (local binding; the signed on-chain /info/owner pin is
// a later round).
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';

export type MetabotBotType = 'twin' | 'worker';

export interface BotRoleInfo {
  botType?: MetabotBotType | null;
  ownerGlobalMetaId?: string | null;
}

export function normalizeBotType(value: unknown): MetabotBotType | null {
  return value === 'twin' || value === 'worker' ? value : null;
}

export function normalizeOptionalGlobalMetaId(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeBotRoleInfo(value: unknown): BotRoleInfo {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    botType: normalizeBotType(record.botType),
    ownerGlobalMetaId: normalizeOptionalGlobalMetaId(record.ownerGlobalMetaId),
  };
}

function hasAnyBotRoleValue(info: BotRoleInfo): boolean {
  return Boolean(info.botType || info.ownerGlobalMetaId);
}

/** Field patch view: only keys present on the input are patched (null clears). */
export function botRolePatchFromInput(input: BotRoleInfo): BotRoleInfo {
  const patch: BotRoleInfo = {};
  if (input.botType !== undefined) patch.botType = input.botType;
  if (input.ownerGlobalMetaId !== undefined) patch.ownerGlobalMetaId = input.ownerGlobalMetaId;
  return patch;
}

export function hasBotRolePatch(patch: BotRoleInfo): boolean {
  return patch.botType !== undefined || patch.ownerGlobalMetaId !== undefined;
}

export function mergeBotRoleInfo(current: BotRoleInfo, patch: BotRoleInfo): BotRoleInfo {
  return {
    botType: patch.botType !== undefined ? patch.botType : (current.botType ?? null),
    ownerGlobalMetaId: patch.ownerGlobalMetaId !== undefined
      ? patch.ownerGlobalMetaId
      : (current.ownerGlobalMetaId ?? null),
  };
}

export async function readBotRoleInfo(filePath: string): Promise<BotRoleInfo> {
  try {
    return normalizeBotRoleInfo(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { botType: null, ownerGlobalMetaId: null };
    }
    throw error;
  }
}

/** Sync variant of readBotRoleInfo for the sync home-selection path. */
export function readBotRoleInfoSync(filePath: string): BotRoleInfo {
  try {
    return normalizeBotRoleInfo(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { botType: null, ownerGlobalMetaId: null };
    }
    throw error;
  }
}

export async function writeBotRoleInfo(filePath: string, info: BotRoleInfo): Promise<void> {
  const next = normalizeBotRoleInfo(info);
  if (!hasAnyBotRoleValue(next)) {
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
