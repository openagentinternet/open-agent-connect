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
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFlagValue, readJsonFile, readStdinText } from './helpers';
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
    // The mnemonic is a master secret. argv values land in shell history and
    // process listings, so the stdin and request-file channels are the
    // recommended paths; exactly one channel may be provided.
    const nameFlag = readFlagValue(args, '--name');
    const pathFlag = readFlagValue(args, '--path');
    const mnemonicFlag = readFlagValue(args, '--mnemonic');
    const mnemonicFromStdin = hasFlag(args, '--mnemonic-stdin');
    const requestFile = readFlagValue(args, '--request-file');
    const channelCount = [mnemonicFlag !== null, mnemonicFromStdin, requestFile !== null].filter(Boolean).length;
    if (channelCount > 1) {
      return commandFailed('conflicting_flags', 'Provide exactly one mnemonic channel: --mnemonic-stdin, --request-file, or --mnemonic.');
    }
    if (channelCount === 0) {
      return commandFailed('missing_mnemonic', 'Missing mnemonic. Use --mnemonic-stdin (recommended) or --request-file <json>; --mnemonic <words> also works but lands in shell history.');
    }
    let payload: Record<string, unknown> = {};
    if (requestFile) {
      try {
        payload = await readJsonFile(context, requestFile);
      } catch (error) {
        return commandFailed('invalid_request_file', error instanceof Error ? error.message : String(error));
      }
    }
    let mnemonic: string;
    if (mnemonicFlag !== null) {
      if (!mnemonicFlag.trim()) {
        return commandFailed('missing_mnemonic', 'The --mnemonic value is empty.');
      }
      mnemonic = mnemonicFlag;
    } else if (mnemonicFromStdin) {
      mnemonic = (await readStdinText(context.stdin)).trim();
      if (!mnemonic) {
        return commandFailed('missing_mnemonic', 'No mnemonic received on stdin. Pipe or type the BIP39 words and end with EOF (Ctrl-D).');
      }
    } else {
      mnemonic = typeof payload.mnemonic === 'string' ? payload.mnemonic.trim() : '';
      if (!mnemonic) {
        return commandFailed('invalid_request_file', 'Request file must include a non-empty "mnemonic".');
      }
    }
    const name = nameFlag ?? (typeof payload.name === 'string' ? payload.name : '');
    const derivationPath = pathFlag
      ?? (typeof payload.path === 'string' && payload.path.trim() ? payload.path.trim() : undefined);
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
