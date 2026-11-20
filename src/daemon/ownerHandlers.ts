/**
 * Daemon-side root-owner handler group: the /api/owner/* verbs backing the
 * `metabot owner *` CLI surface (trust tiers P1). Thin ports over
 * core/owner/rootOwnerIdentity plus the device->owner binding publish
 * (core/owner/deviceOwnerBinding): the write that needs chain access
 * (`bindDevice`) runs daemon-side where the adapters and the traffic sponsor
 * hook live; the CRUD verbs are local file operations.
 */

import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import {
  publishDeviceOwnerBinding,
} from '../core/owner/deviceOwnerBinding';
import { OWNER_BINDING_PATH } from '../core/owner/ownerBinding';
import {
  readOwnerIdentity,
  type OwnerIdentityRecord,
} from '../core/owner/ownerIdentity';
import { createOwnerSigner } from '../core/owner/ownerSigner';
import {
  createRootOwnerIdentity,
  importRootOwnerIdentity,
  loadRootOwnerIdentity,
  renameRootOwnerIdentity,
  revealRootOwnerMnemonic,
  RootOwnerIdentityError,
  toRootOwnerIdentityPublic,
} from '../core/owner/rootOwnerIdentity';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import { createTrustCacheStore } from '../core/trust/trustCacheStore';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import type { ResolveSponsorWritePin } from '../core/signing/localMnemonicSigner';
import type { Signer } from '../core/signing/signer';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface OwnerDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/owner/`. */
  systemHomeDir: string;
  /** Chain adapters for the device signer used by `bindDevice`. */
  adapters?: ChainAdapterRegistry;
  /** MVC traffic (代付) sponsor hook for the device signer; absent = self-pay. */
  resolveSponsorWritePin?: ResolveSponsorWritePin;
  /** Test seam: full override of the device signer construction. */
  createSigner?: (identity: OwnerIdentityRecord) => Signer;
  /** Subsidy seam for `bindDevice`; defaults to the real MVC gas subsidy service. */
  requestSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
  /**
   * Device→owner binding state for the `who` read (trust tiers UI): 'bound'
   * when the device identity's /info/owner pin names the root owner,
   * 'unbound' when it does not, 'unknown' when it cannot be read.
   */
  deviceBindingStatus?: () => Promise<'bound' | 'unbound' | 'unknown'>;
}

function rootOwnerFailure(error: unknown): MetabotCommandResult<never> {
  if (error instanceof RootOwnerIdentityError) {
    return commandFailed(error.code, error.message);
  }
  return commandFailed('root_owner_failed', error instanceof Error ? error.message : String(error));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createOwnerDaemonHandlers(
  input: OwnerDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['owner']> {
  const systemHomeDir = input.systemHomeDir;
  return {
    who: async () => {
      const record = await loadRootOwnerIdentity(systemHomeDir);
      let deviceBinding: 'bound' | 'unbound' | 'unknown' | null = null;
      if (record && input.deviceBindingStatus) {
        deviceBinding = await input.deviceBindingStatus().catch(() => 'unknown' as const);
      }
      return commandSuccess({
        identity: record ? toRootOwnerIdentityPublic(record) : null,
        ...(deviceBinding ? { deviceBinding } : {}),
      });
    },

    create: async (rawInput) => {
      try {
        const record = await createRootOwnerIdentity(systemHomeDir, { name: normalizeText(rawInput?.name) });
        // The mnemonic is shown exactly once, same as the device identity create.
        return commandSuccess({ identity: toRootOwnerIdentityPublic(record), mnemonic: record.mnemonic });
      } catch (error) {
        return rootOwnerFailure(error);
      }
    },

    import: async (rawInput) => {
      const mnemonic = normalizeText(rawInput?.mnemonic);
      if (!mnemonic) {
        return commandFailed('missing_mnemonic', 'mnemonic is required.');
      }
      const derivationPath = normalizeText(rawInput?.path) || undefined;
      try {
        const record = await importRootOwnerIdentity(systemHomeDir, {
          name: normalizeText(rawInput?.name),
          mnemonic,
          ...(derivationPath ? { path: derivationPath } : {}),
        });
        return commandSuccess({ identity: toRootOwnerIdentityPublic(record), mnemonic: record.mnemonic });
      } catch (error) {
        return rootOwnerFailure(error);
      }
    },

    rename: async (rawInput) => {
      const name = normalizeText(rawInput?.name);
      if (!name) {
        return commandFailed('missing_name', 'name is required.');
      }
      try {
        const record = await renameRootOwnerIdentity(systemHomeDir, name);
        return commandSuccess({ identity: toRootOwnerIdentityPublic(record) });
      } catch (error) {
        return rootOwnerFailure(error);
      }
    },

    reveal: async () => {
      try {
        const mnemonic = await revealRootOwnerMnemonic(systemHomeDir);
        return commandSuccess({ mnemonic });
      } catch (error) {
        return rootOwnerFailure(error);
      }
    },

    /**
     * Sign the device->owner binding with the ROOT OWNER key and publish the
     * /info/owner pin FROM the device identity (traffic-sponsored first,
     * subsidy-funded self-pay fallback). Idempotent payload-hash dedup makes
     * a re-bind after an already-published binding a no-op downstream.
     */
    bindDevice: async () => {
      try {
        const device = await readOwnerIdentity(systemHomeDir).catch(() => null);
        if (!device) {
          return commandFailed(
            'device_identity_missing',
            'No device identity exists on this machine. It is auto-created during onboarding; finish onboarding first.',
          );
        }
        const rootOwner = await loadRootOwnerIdentity(systemHomeDir);
        if (!rootOwner) {
          return commandFailed(
            'root_owner_missing',
            'No root owner identity exists on this machine. Create one with `metabot owner create` or import it with `metabot owner import --mnemonic-stdin` first.',
          );
        }
        const signer = input.createSigner
          ? input.createSigner(device)
          : input.adapters
            ? createOwnerSigner({
              systemHomeDir,
              owner: device,
              adapters: input.adapters,
              ...(input.resolveSponsorWritePin ? { resolveSponsorWritePin: input.resolveSponsorWritePin } : {}),
            })
            : null;
        if (!signer) {
          return commandFailed('chain_unavailable', 'Chain publish is not configured in this daemon.');
        }
        const result = await publishDeviceOwnerBinding({
          device,
          rootOwner,
          signer,
          ...(input.requestSubsidy ? { requestSubsidy: input.requestSubsidy } : {}),
        });
        // The published pin changes the device's root-owner resolution, but
        // the shared trust cache may still hold the pre-bind "self-root"
        // entry for up to its TTL — drop it so the Settings deviceBinding
        // status and the next enforcement read re-resolve immediately
        // (best-effort: a cache failure must not fail the bind result).
        await createTrustCacheStore(systemHomeDir)
          .invalidate(device.globalMetaId)
          .catch(() => {});
        return commandSuccess({
          ownerBinding: {
            device: device.globalMetaId,
            owner: rootOwner.globalMetaId,
            path: OWNER_BINDING_PATH,
            pinId: result.chainWrite.pinId,
          },
          subsidy: result.subsidy,
          chainWrites: [result.chainWrite],
        });
      } catch (error) {
        return commandFailed(
          'device_owner_bind_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
