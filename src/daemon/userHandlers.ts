/**
 * Daemon-side owner-identity handler group: the /api/user/* verbs. Thin ports
 * of the `metabot user *` CLI command handlers (src/cli/commands/user.ts)
 * onto core/owner/ownerIdentity — the owner identity is machine-wide (no
 * `from` actor selection), and the mnemonic only ever leaves the daemon
 * through the guarded reveal verb, exactly like the CLI reveal.
 */

import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import {
  createOwnerIdentity,
  deleteOwnerIdentity,
  importOwnerIdentity,
  OwnerIdentityError,
  readOwnerIdentity,
  renameOwnerIdentity,
  revealOwnerMnemonic,
  toOwnerIdentityPublic,
  updateOwnerIdentityProfile,
  type OwnerIdentityRecord,
} from '../core/owner/ownerIdentity';
import { createOwnerSigner } from '../core/owner/ownerSigner';
import {
  createOwnerOnboardingRunner,
  markOwnerOnboardingOptedOut,
  readOwnerOnboardingStatus,
  resetOwnerOnboardingAfterManualIdentity,
  type OwnerOnboardingRunner,
} from '../core/owner/ownerOnboarding';
import {
  buildOwnerProfileChainWrites,
  writeOwnerProfileChainRequests,
} from '../core/owner/ownerProfilePublish';
import { validateAvatarDataUrl } from '../core/identity/avatarChainWrite';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { ChainWriteResult } from '../core/chain/writePin';
import type { ResolveSponsorWritePin } from '../core/signing/localMnemonicSigner';
import type { Signer } from '../core/signing/signer';
import type { TrafficAccountService } from '../core/traffic/trafficAccountService';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface UserDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/owner/identity.json`. */
  systemHomeDir: string;
  /** Chain adapters for the owner profile publish signer (`update` verb). */
  adapters?: ChainAdapterRegistry;
  /** MVC traffic (代付) sponsor hook for the owner signer; absent = self-pay. */
  resolveSponsorWritePin?: ResolveSponsorWritePin;
  /** Test seam: full override of the owner signer construction. */
  createSigner?: (owner: OwnerIdentityRecord) => Signer;
  /** Test seam: inter-write delay override for the chain publish. */
  chainWriteDelayMs?: number;
  /** Traffic account service backing the onboarding runner fallback. */
  trafficAccountService?: Pick<TrafficAccountService, 'ensureTrafficAccount' | 'claimFreeGrant'>;
  /** Shared owner-onboarding runner (run verb); constructed on demand when omitted. */
  ownerOnboardingRunner?: OwnerOnboardingRunner;
}

function ownerFailure(error: unknown): MetabotCommandResult<never> {
  if (error instanceof OwnerIdentityError) {
    return commandFailed(error.code, error.message);
  }
  return commandFailed('owner_identity_failed', error instanceof Error ? error.message : String(error));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createUserDaemonHandlers(
  input: UserDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['user']> {
  const systemHomeDir = input.systemHomeDir;
  return {
    who: async () => {
      const record = await readOwnerIdentity(systemHomeDir);
      return commandSuccess({ identity: record ? toOwnerIdentityPublic(record) : null });
    },

    create: async (rawInput) => {
      try {
        const record = await createOwnerIdentity(systemHomeDir, { name: normalizeText(rawInput?.name) });
        // An explicit create re-arms onboarding (clears any opt-out tombstone)
        // so the account/grant steps still converge on the next daemon start.
        await resetOwnerOnboardingAfterManualIdentity(systemHomeDir).catch(() => undefined);
        // The mnemonic is shown exactly once, same as the CLI create/import.
        return commandSuccess({ identity: toOwnerIdentityPublic(record), mnemonic: record.mnemonic });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    import: async (rawInput) => {
      const mnemonic = normalizeText(rawInput?.mnemonic);
      if (!mnemonic) {
        return commandFailed('missing_mnemonic', 'mnemonic is required.');
      }
      const derivationPath = normalizeText(rawInput?.path) || undefined;
      try {
        const record = await importOwnerIdentity(systemHomeDir, {
          name: normalizeText(rawInput?.name),
          mnemonic,
          ...(derivationPath ? { path: derivationPath } : {}),
        });
        await resetOwnerOnboardingAfterManualIdentity(systemHomeDir).catch(() => undefined);
        return commandSuccess({ identity: toOwnerIdentityPublic(record), mnemonic: record.mnemonic });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    rename: async (rawInput) => {
      const name = normalizeText(rawInput?.name);
      if (!name) {
        return commandFailed('missing_name', 'name is required.');
      }
      try {
        const record = await renameOwnerIdentity(systemHomeDir, name);
        return commandSuccess({ identity: toOwnerIdentityPublic(record) });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    /**
     * Name/avatar profile save with on-chain publish, chain-first like the
     * Bot profile update: the changed /info/name + /info/avatar pins are
     * written by the owner signer first, and only then does the local record
     * update — so a saved profile always matches the chain.
     */
    update: async (rawInput) => {
      const current = await readOwnerIdentity(systemHomeDir);
      if (!current) {
        return commandFailed('owner_missing', 'No owner identity exists on this machine.');
      }
      const hasName = typeof rawInput?.name === 'string';
      const hasAvatar = typeof rawInput?.avatarDataUrl === 'string';
      const name = hasName ? normalizeText(rawInput.name) : undefined;
      if (hasName && !name) {
        return commandFailed('missing_name', 'name is required.');
      }
      const avatarDataUrl = hasAvatar ? (rawInput.avatarDataUrl as string).trim() : undefined;
      if (avatarDataUrl !== undefined) {
        const validation = validateAvatarDataUrl(avatarDataUrl);
        if (!validation.valid) {
          return commandFailed('invalid_avatar', validation.error ?? 'Invalid avatar.');
        }
      }
      if (name === undefined && avatarDataUrl === undefined) {
        return commandFailed('missing_update', 'name or avatarDataUrl is required.');
      }

      const nameChanged = name !== undefined && name !== current.name;
      const avatarChanged = avatarDataUrl !== undefined && avatarDataUrl !== (current.avatarDataUrl ?? '');
      if (!nameChanged && !avatarChanged) {
        return commandSuccess({
          identity: toOwnerIdentityPublic(current),
          chainWrites: [] as ChainWriteResult[],
          chainSync: { ok: true },
        });
      }

      const signer = input.createSigner
        ? input.createSigner(current)
        : input.adapters
          ? createOwnerSigner({
            systemHomeDir,
            owner: current,
            adapters: input.adapters,
            ...(input.resolveSponsorWritePin ? { resolveSponsorWritePin: input.resolveSponsorWritePin } : {}),
          })
          : null;
      if (!signer) {
        return commandFailed('chain_unavailable', 'Chain publish is not configured in this daemon.');
      }

      const chainRequests = buildOwnerProfileChainWrites({
        ...(nameChanged && name !== undefined ? { name } : {}),
        ...(avatarChanged && avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
      });
      let chainWrites: ChainWriteResult[] = [];
      try {
        const writeOptions = input.chainWriteDelayMs !== undefined ? { delayMs: input.chainWriteDelayMs } : {};
        chainWrites = await writeOwnerProfileChainRequests(signer, chainRequests, writeOptions);
      } catch (error) {
        return commandFailed(
          'chain_sync_failed',
          `Chain sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        const record = await updateOwnerIdentityProfile(systemHomeDir, {
          ...(nameChanged && name !== undefined ? { name } : {}),
          ...(avatarChanged && avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
        });
        return commandSuccess({
          identity: toOwnerIdentityPublic(record),
          chainWrites,
          chainSync: { ok: true },
        });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    reveal: async () => {
      try {
        const mnemonic = await revealOwnerMnemonic(systemHomeDir);
        return commandSuccess({ mnemonic });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    delete: async () => {
      try {
        await deleteOwnerIdentity(systemHomeDir);
        // Tombstone the onboarding state: auto-provisioning must never
        // resurrect an identity the user deliberately removed.
        await markOwnerOnboardingOptedOut(systemHomeDir);
        return commandSuccess({ deleted: true });
      } catch (error) {
        return ownerFailure(error);
      }
    },

    getOnboarding: async () => {
      try {
        return commandSuccess(await readOwnerOnboardingStatus(systemHomeDir));
      } catch (error) {
        return commandFailed(
          'owner_onboarding_read_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    runOnboarding: async () => {
      const runner = input.ownerOnboardingRunner
        ?? (input.trafficAccountService
          ? createOwnerOnboardingRunner({ systemHomeDir, trafficAccountService: input.trafficAccountService })
          : null);
      if (!runner) {
        return commandFailed('not_implemented', 'Owner onboarding runner is not configured.');
      }
      try {
        const onboarding = await runner.run();
        return commandSuccess({ onboarding });
      } catch (error) {
        return commandFailed(
          'owner_onboarding_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
