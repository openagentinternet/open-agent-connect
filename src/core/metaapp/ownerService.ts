import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import {
  buildMetaAppCreateWrite,
  buildMetaAppModifyWrite,
  buildMetaAppProtocolPayload,
  buildMetaAppRevokeWrite,
} from './appsProtocol';
import { normalizeMetaAppPinId } from './pinId';
import { buildMetaAppCanonicalUrl } from './share';

export interface MetaAppOwnerActor {
  from?: string;
  homeDir: string;
  mvcAddress: string;
  writePin: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface MetaAppOwnerListDeps {
  manClient: {
    listByAddress: (input: { address: string; cursor?: string; size: number }) => Promise<Record<string, unknown>>;
  };
}

function requireConfirm(input: Record<string, unknown>, action: string): MetabotCommandResult<never> | null {
  return input.confirm === true
    ? null
    : commandFailed('confirmation_required', `MetaAPP ${action} requires --confirm.`);
}

function requirePinIdFromWrite(write: Record<string, unknown>): string {
  const pinId = normalizeMetaAppPinId(write.pinId);
  if (!pinId) {
    throw new Error('MetaAPP chain write did not return pinId.');
  }
  return pinId;
}

export async function listOwnerMetaApps(
  actor: MetaAppOwnerActor,
  input: { cursor?: string; size?: number } & MetaAppOwnerListDeps,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const size = Number.isFinite(input.size) && Number(input.size) > 0 ? Math.trunc(Number(input.size)) : 12;
  const result = await input.manClient.listByAddress({
    address: actor.mvcAddress,
    cursor: input.cursor || '',
    size,
  });
  return commandSuccess(result);
}

export async function publishMetaAppPayload(
  actor: MetaAppOwnerActor,
  input: Record<string, unknown>,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const missing = requireConfirm(input, 'publish');
  if (missing) return missing;
  const payload = buildMetaAppProtocolPayload(input);
  const write = buildMetaAppCreateWrite(payload);
  const chainWrite = await actor.writePin({ ...write, network: input.network });
  const pinId = requirePinIdFromWrite(chainWrite);
  return commandSuccess({
    pinId,
    chainWrite,
    metaappUri: `metaapp://${pinId}`,
    metawebUrl: buildMetaAppCanonicalUrl(pinId),
  });
}

export async function updateMetaAppPayload(
  actor: MetaAppOwnerActor,
  input: Record<string, unknown>,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const missing = requireConfirm(input, 'update');
  if (missing) return missing;
  const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
  const payload = buildMetaAppProtocolPayload(input);
  const write = buildMetaAppModifyWrite(targetPinId, payload);
  const chainWrite = await actor.writePin({ ...write, network: input.network });
  const pinId = requirePinIdFromWrite(chainWrite);
  return commandSuccess({
    pinId,
    targetPinId,
    chainWrite,
    metaappUri: `metaapp://${pinId}`,
    metawebUrl: buildMetaAppCanonicalUrl(pinId),
  });
}

export async function deleteMetaAppPin(
  actor: MetaAppOwnerActor,
  input: Record<string, unknown>,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const missing = requireConfirm(input, 'delete');
  if (missing) return missing;
  const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
  const write = buildMetaAppRevokeWrite(targetPinId);
  const chainWrite = await actor.writePin({ ...write, network: input.network });
  const pinId = requirePinIdFromWrite(chainWrite);
  return commandSuccess({
    revokedPinId: targetPinId,
    pinId,
    chainWrite,
  });
}
