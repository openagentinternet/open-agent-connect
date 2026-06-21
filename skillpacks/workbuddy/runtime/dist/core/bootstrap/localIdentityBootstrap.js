"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isIdentityBootstrapReady = isIdentityBootstrapReady;
exports.createLocalMetabotStep = createLocalMetabotStep;
exports.createMetabotSubsidyStep = createMetabotSubsidyStep;
exports.createLocalIdentitySyncStep = createLocalIdentitySyncStep;
const bip39_1 = require("@scure/bip39");
const english_1 = require("@scure/bip39/wordlists/english");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const requestMvcGasSubsidy_1 = require("../subsidy/requestMvcGasSubsidy");
const DEFAULT_METABOT_ID = 1;
const DEFAULT_SYNC_STEP_DELAY_MS = 3_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function buildIdentityRecord(input) {
    return {
        metabotId: input.metabotId,
        name: input.name,
        createdAt: input.createdAt,
        path: input.identity.path,
        publicKey: input.identity.publicKey,
        chatPublicKey: input.identity.chatPublicKey,
        addresses: { ...input.identity.addresses },
        mvcAddress: input.identity.mvcAddress,
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
async function updateIdentityRecord(runtimeStateStore, updater) {
    let nextIdentity = null;
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
async function readSubsidyInput(secretStore, metabot) {
    const secrets = await secretStore.readIdentitySecrets();
    return {
        mvcAddress: normalizeText(secrets?.addresses?.mvc) || metabot.mvcAddress,
        mnemonic: normalizeText(secrets?.mnemonic) || undefined,
        path: normalizeText(secrets?.path) || metabot.path || deriveIdentity_1.DEFAULT_DERIVATION_PATH,
    };
}
function isIdentityBootstrapReady(identity) {
    if (!identity)
        return false;
    if (identity.subsidyState !== 'claimed')
        return false;
    return identity.syncState === 'synced' || identity.syncState === 'partial';
}
function createLocalMetabotStep(input) {
    const now = input.now ?? (() => Date.now());
    const generateMnemonicFn = input.generateMnemonic ?? (() => (0, bip39_1.generateMnemonic)(english_1.wordlist));
    const deriveIdentityFn = input.deriveIdentityFn ?? ((options) => (0, deriveIdentity_1.deriveIdentity)(options));
    const derivePrivateKeyHexFn = input.derivePrivateKeyHexFn ?? ((options) => (0, deriveIdentity_1.derivePrivateKeyHex)(options));
    return async (request) => {
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
            path: deriveIdentity_1.DEFAULT_DERIVATION_PATH,
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
            addresses: { ...identity.addresses },
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
function createMetabotSubsidyStep(input) {
    const requestSubsidy = input.requestMvcGasSubsidy ?? ((options) => (0, requestMvcGasSubsidy_1.requestMvcGasSubsidy)(options));
    return async (context) => {
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
function createLocalIdentitySyncStep(input) {
    const wait = input.wait ?? (async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
    const stepDelayMs = input.stepDelayMs ?? DEFAULT_SYNC_STEP_DELAY_MS;
    return async (context) => {
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
        const chainWrites = [];
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
            }
            catch (error) {
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
        }
        catch (error) {
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
