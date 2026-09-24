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
} from '../core/owner/ownerIdentity';
import type { MetabotDaemonHttpHandlers } from './routes/types';

export interface UserDaemonHandlersInput {
  /** The machine-wide system home that owns `~/.metabot/owner/identity.json`. */
  systemHomeDir: string;
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
        return commandSuccess({ deleted: true });
      } catch (error) {
        return ownerFailure(error);
      }
    },
  };
}
