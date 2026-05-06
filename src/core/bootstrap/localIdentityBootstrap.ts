import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import {
  DEFAULT_DERIVATION_PATH,
  deriveIdentity,
  derivePrivateKeyHex,
  type DerivedIdentity,
} from '../identity/deriveIdentity';
import type { SecretStore } from '../secrets/secretStore';
import type { Signer } from '../signing/signer';
import {
  type RuntimeIdentityRecord,
  type RuntimeStateStore,
} from '../state/runtimeStateStore';
import type {
  BootstrapCreateRequest,
  BootstrapCreateResult,
  BootstrapCreateStep,
  BootstrapSubsidyInput,
} from './createMetabot';
import type {
  BootstrapRequestSubsidyStep,
  BootstrapSubsidyContext,
  BootstrapSubsidyResult,
} from './requestSubsidy';
import type {
  BootstrapSyncResult,
  BootstrapSyncStep,
  BootstrapSyncContext,
} from './syncIdentityToChain';
import {
  requestMvcGasSubsidy,
  type RequestMvcGasSubsidyOptions,
  type RequestMvcGasSubsidyResult,
} from '../subsidy/requestMvcGasSubsidy';

const DEFAULT_METABOT_ID = 1;
const DEFAULT_SYNC_STEP_DELAY_MS = 3_000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildIdentityRecord(input: {
  name: string;
  metabotId: number;
  createdAt: number;
  identity: DerivedIdentity;
}): RuntimeIdentityRecord {
  return {
    metabotId: input.metabotId,
    name: input.name,
    createdAt: input.createdAt,
    path: input.identity.path,
    publicKey: input.identity.publicKey,
    chatPublicKey: input.identity.chatPublicKey,
    mvcAddress: input.identity.mvcAddress,
    btcAddress: input.identity.btcAddress,
    dogeAddress: input.identity.dogeAddress,
    metaId: input.identity.metaId,
    globalMetaId: input.identity.globalMetaId,
    subsidyState: 'pending',
    subsidyError: null,
    syncState: 'pending',
    syncError: null,
    namePinId: null,
    chatPublicKeyPinId: null,
  };
}

async function updateIdentityRecord(
  runtimeStateStore: RuntimeStateStore,
  updater: (currentIdentity: RuntimeIdentityRecord) => RuntimeIdentityRecord
): Promise<RuntimeIdentityRecord> {
  let nextIdentity: RuntimeIdentityRecord | null = null;
  await runtimeStateStore.updateState((currentState) => {
    if (!currentState.identity) {
      throw new Error('Local MetaBot identity is missing from runtime state.');
    }
    nextIdentity = updater(currentState.identity);
    return {
      ...currentState,
      identity: nextIdentity,
    };
  });
  if (!nextIdentity) {
    throw new Error('Failed to update runtime identity state.');
  }
  return nextIdentity;
}

async function readSubsidyInput(
  secretStore: SecretStore,
  metabot: RuntimeIdentityRecord
): Promise<BootstrapSubsidyInput> {
  const secrets = await secretStore.readIdentitySecrets();
  return {
    mvcAddress: normalizeText(secrets?.mvcAddress) || metabot.mvcAddress,
    mnemonic: normalizeText(secrets?.mnemonic) || undefined,
    path: normalizeText(secrets?.path) || metabot.path || DEFAULT_DERIVATION_PATH,
  };
}

export function isIdentityBootstrapReady(identity: RuntimeIdentityRecord | null): boolean {
  if (!identity) return false;
  if (identity.subsidyState !== 'claimed') return false;
  return identity.syncState === 'synced' || identity.syncState === 'partial';
}

export function createLocalMetabotStep(input: {
  runtimeStateStore: RuntimeStateStore;
  secretStore: SecretStore;
  now?: () => number;
  generateMnemonic?: () => string;
  deriveIdentityFn?: (options: { mnemonic: string; path: string }) => Promise<DerivedIdentity>;
  derivePrivateKeyHexFn?: (options: { mnemonic: string; path: string }) => Promise<string>;
}): BootstrapCreateStep<BootstrapCreateRequest, RuntimeIdentityRecord> {
  const now = input.now ?? (() => Date.now());
  const generateMnemonicFn = input.generateMnemonic ?? (() => generateMnemonic(wordlist));
  const deriveIdentityFn = input.deriveIdentityFn ?? ((options) => deriveIdentity(options));
  const derivePrivateKeyHexFn = input.derivePrivateKeyHexFn ?? ((options) => derivePrivateKeyHex(options));

  return async (request): Promise<BootstrapCreateResult<RuntimeIdentityRecord>> => {
    const existingState = await input.runtimeStateStore.readState();
    if (existingState.identity) {
      return {
        metabot: existingState.identity,
        subsidyInput: await readSubsidyInput(input.secretStore, existingState.identity),
      };
    }

    const mnemonic = generateMnemonicFn();
    const identity = await deriveIdentityFn({
      mnemonic,
      path: DEFAULT_DERIVATION_PATH,
    });
    const identityRecord = buildIdentityRecord({
      name: request.name,
      metabotId: DEFAULT_METABOT_ID,
      createdAt: now(),
      identity,
    });

    await input.secretStore.writeIdentitySecrets({
      mnemonic,
      path: identity.path,
      privateKeyHex: await derivePrivateKeyHexFn({
        mnemonic,
        path: identity.path,
      }),
      publicKey: identity.publicKey,
      chatPublicKey: identity.chatPublicKey,
      mvcAddress: identity.mvcAddress,
      btcAddress: identity.btcAddress,
      dogeAddress: identity.dogeAddress,
      metaId: identity.metaId,
      globalMetaId: identity.globalMetaId,
    });
    await input.runtimeStateStore.writeState({
      ...existingState,
      identity: identityRecord,
    });

    return {
      metabot: identityRecord,
      subsidyInput: {
        mvcAddress: identity.mvcAddress,
        mnemonic,
        path: identity.path,
      },
    };
  };
}

export function createMetabotSubsidyStep(input: {
  runtimeStateStore: RuntimeStateStore;
  requestMvcGasSubsidy?: (
    options: RequestMvcGasSubsidyOptions
  ) => Promise<RequestMvcGasSubsidyResult>;
}): BootstrapRequestSubsidyStep<BootstrapCreateRequest, RuntimeIdentityRecord> {
  const requestSubsidy = input.requestMvcGasSubsidy ?? ((options) => requestMvcGasSubsidy(options));

  return async (
    context: BootstrapSubsidyContext<BootstrapCreateRequest, RuntimeIdentityRecord>
  ): Promise<BootstrapSubsidyResult> => {
    if (context.metabot.subsidyState === 'claimed') {
      return {
        success: true,
      };
    }

    const mvcAddress = normalizeText(context.subsidyInput?.mvcAddress) || context.metabot.mvcAddress;
    if (!mvcAddress) {
      const failed = {
        success: false,
        error: 'Local MVC address is missing for the subsidy request.',
      };
      await updateIdentityRecord(input.runtimeStateStore, (currentIdentity) => ({
        ...currentIdentity,
        subsidyState: 'failed',
        subsidyError: failed.error,
      }));
      return failed;
    }
    const mnemonic = normalizeText(context.subsidyInput?.mnemonic);
    if (!mnemonic) {
      const failed = {
        success: false,
        error: 'Local mnemonic is missing, so the MVC subsidy reward step cannot be completed.',
      };
      await updateIdentityRecord(input.runtimeStateStore, (currentIdentity) => ({
        ...currentIdentity,
        subsidyState: 'failed',
        subsidyError: failed.error,
      }));
      return failed;
    }

    const subsidyResult = await requestSubsidy({
      mvcAddress,
      mnemonic,
      path: normalizeText(context.subsidyInput?.path) || context.metabot.path,
    });

    await updateIdentityRecord(input.runtimeStateStore, (currentIdentity) => ({
      ...currentIdentity,
      subsidyState: subsidyResult.success ? 'claimed' : 'failed',
      subsidyError: subsidyResult.success ? null : (subsidyResult.error ?? 'MVC subsidy request failed.'),
    }));

    return subsidyResult;
  };
}

export function createLocalIdentitySyncStep(input: {
  runtimeStateStore: RuntimeStateStore;
  signer: Pick<Signer, 'writePin'>;
  wait?: (ms: number) => Promise<void>;
  stepDelayMs?: number;
}): BootstrapSyncStep<BootstrapCreateRequest, RuntimeIdentityRecord> {
  const wait = input.wait ?? (async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  const stepDelayMs = input.stepDelayMs ?? DEFAULT_SYNC_STEP_DELAY_MS;

  return async (
    context: BootstrapSyncContext<BootstrapCreateRequest, RuntimeIdentityRecord>
  ): Promise<BootstrapSyncResult> => {
    if (!context.subsidy.success) {
      const error = context.subsidy.error ?? 'MVC subsidy must succeed before syncing identity to chain.';
      await updateIdentityRecord(input.runtimeStateStore, (currentIdentity) => ({
        ...currentIdentity,
        syncState: 'failed',
        syncError: error,
      }));
      return {
        success: false,
        error,
        canSkip: false,
      };
    }

    let currentState = await input.runtimeStateStore.readState();
    const currentIdentity = currentState.identity;
    const chainWrites: BootstrapSyncResult['chainWrites'] = [];
    if (!currentIdentity) {
      return {
        success: false,
        error: 'Local MetaBot identity is missing from runtime state.',
        canSkip: false,
      };
    }

    if (currentIdentity.syncState === 'synced') {
      return {
        success: true,
        chainWrites,
      };
    }

    if (!currentIdentity.namePinId) {
      try {
        const nameResult = await input.signer.writePin({
          operation: 'create',
          path: '/info/name',
          contentType: 'text/plain',
          payload: currentIdentity.name || context.request.name || 'MetaBot',
          network: 'mvc',
        });
        chainWrites.push(nameResult);
        currentState = await input.runtimeStateStore.updateState((nextState) => ({
          ...nextState,
          identity: nextState.identity
            ? {
                ...nextState.identity,
                namePinId: nameResult.pinId,
                syncState: 'pending',
                syncError: null,
              }
            : nextState.identity,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateIdentityRecord(input.runtimeStateStore, (identity) => ({
          ...identity,
          syncState: 'failed',
          syncError: message,
        }));
        return {
          success: false,
          error: message,
          canSkip: false,
        };
      }

      if (stepDelayMs > 0) {
        await wait(stepDelayMs);
      }
    }

    const identityForChat = currentState.identity;
    if (!identityForChat) {
      return {
        success: false,
        error: 'Local MetaBot identity is missing from runtime state.',
        canSkip: false,
      };
    }

    if (identityForChat.chatPublicKeyPinId) {
      await updateIdentityRecord(input.runtimeStateStore, (identity) => ({
        ...identity,
        syncState: 'synced',
        syncError: null,
      }));
      return {
        success: true,
        chainWrites,
      };
    }

    const chatPublicKey = normalizeText(identityForChat.chatPublicKey);
    if (!chatPublicKey) {
      const error = 'Chat public key is empty.';
      await updateIdentityRecord(input.runtimeStateStore, (identity) => ({
        ...identity,
        syncState: 'partial',
        syncError: error,
      }));
      return {
        success: false,
        error,
        canSkip: true,
        chainWrites,
      };
    }

    try {
      const chatResult = await input.signer.writePin({
        operation: 'create',
        path: '/info/chatpubkey',
        contentType: 'text/plain',
        payload: chatPublicKey,
        network: 'mvc',
      });
      chainWrites.push(chatResult);
      await updateIdentityRecord(input.runtimeStateStore, (identity) => ({
        ...identity,
        chatPublicKeyPinId: chatResult.pinId,
        syncState: 'synced',
        syncError: null,
      }));
      return {
        success: true,
        chainWrites,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateIdentityRecord(input.runtimeStateStore, (identity) => ({
        ...identity,
        syncState: 'partial',
        syncError: message,
      }));
      return {
        success: false,
        error: message,
        canSkip: true,
        chainWrites,
      };
    }
  };
}
