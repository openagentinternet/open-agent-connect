import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  createOwnerIdentity,
  deleteOwnerIdentity,
  ensureOwnerIdentity,
  importOwnerIdentity,
  OwnerIdentityError,
  readOwnerIdentity,
  renameOwnerIdentity,
  revealOwnerMnemonic,
  toOwnerIdentityPublic,
} from '../../core/owner/ownerIdentity';
import { normalizeSystemHomeDir } from '../../core/state/homeSelection';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

function ownerFailure(error: unknown): MetabotCommandResult<never> {
  if (error instanceof OwnerIdentityError) {
    return commandFailed(error.code, error.message);
  }
  return commandFailed('owner_identity_failed', error instanceof Error ? error.message : String(error));
}

export async function runUserCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const subcommand = args[0];
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);

  if (subcommand === 'who') {
    const record = await readOwnerIdentity(systemHomeDir);
    return commandSuccess({ identity: record ? toOwnerIdentityPublic(record) : null });
  }

  if (subcommand === 'create') {
    const name = readFlagValue(args, '--name') ?? '';
    try {
      const record = await createOwnerIdentity(systemHomeDir, { name });
      return commandSuccess({ identity: toOwnerIdentityPublic(record), mnemonic: record.mnemonic });
    } catch (error) {
      return ownerFailure(error);
    }
  }

  if (subcommand === 'import') {
    const name = readFlagValue(args, '--name') ?? '';
    const mnemonic = readFlagValue(args, '--mnemonic');
    if (!mnemonic) {
      return commandMissingFlag('--mnemonic');
    }
    const derivationPath = readFlagValue(args, '--path') ?? undefined;
    try {
      const record = await importOwnerIdentity(systemHomeDir, { name, mnemonic, path: derivationPath });
      return commandSuccess({ identity: toOwnerIdentityPublic(record), mnemonic: record.mnemonic });
    } catch (error) {
      return ownerFailure(error);
    }
  }

  if (subcommand === 'ensure') {
    const name = readFlagValue(args, '--name') ?? undefined;
    const before = await readOwnerIdentity(systemHomeDir);
    try {
      const record = await ensureOwnerIdentity(systemHomeDir, { name });
      return commandSuccess({ identity: toOwnerIdentityPublic(record), created: before === null });
    } catch (error) {
      return ownerFailure(error);
    }
  }

  if (subcommand === 'rename') {
    const name = readFlagValue(args, '--name');
    if (!name) {
      return commandMissingFlag('--name');
    }
    try {
      const record = await renameOwnerIdentity(systemHomeDir, name);
      return commandSuccess({ identity: toOwnerIdentityPublic(record) });
    } catch (error) {
      return ownerFailure(error);
    }
  }

  if (subcommand === 'reveal') {
    try {
      const mnemonic = await revealOwnerMnemonic(systemHomeDir);
      return commandSuccess({ mnemonic });
    } catch (error) {
      return ownerFailure(error);
    }
  }

  if (subcommand === 'delete') {
    await deleteOwnerIdentity(systemHomeDir);
    return commandSuccess({ deleted: true });
  }

  return commandUnknownSubcommand(`user ${args.join(' ')}`.trim());
}
