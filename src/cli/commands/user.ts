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
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readJsonFile } from './helpers';
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

  // Name/avatar profile save with on-chain publish. The write happens in the
  // daemon (it owns the signer and the traffic sponsor hook); the CLI parses
  // --name and/or --request-file ({ name?, avatarDataUrl? }) and forwards.
  if (subcommand === 'update') {
    const requestFile = readFlagValue(args, '--request-file');
    const nameFlag = readFlagValue(args, '--name');
    let input: Record<string, unknown> = {};
    if (requestFile) {
      try {
        input = await readJsonFile(context, requestFile);
      } catch (error) {
        return commandFailed('invalid_request_file', error instanceof Error ? error.message : String(error));
      }
    }
    if (nameFlag) {
      input = { ...input, name: nameFlag };
    }
    const hasName = typeof input.name === 'string' && input.name.trim().length > 0;
    const hasAvatar = typeof input.avatarDataUrl === 'string';
    if (!hasName && !hasAvatar) {
      return commandFailed('missing_update', 'Provide --name <name> or --request-file <json> with name/avatarDataUrl.');
    }
    const handler = context.dependencies.user?.update;
    if (!handler) {
      return commandFailed('not_implemented', 'User update handler is not configured.');
    }
    return handler(input);
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
