"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOwnerSecretStore = createOwnerSecretStore;
exports.createOwnerSigner = createOwnerSigner;
const localMnemonicSigner_1 = require("../signing/localMnemonicSigner");
const ownerIdentity_1 = require("./ownerIdentity");
/**
 * Read-only SecretStore view over the owner identity record; the signer only
 * ever calls readIdentitySecrets. The owner home (~/.metabot/owner) is NOT a
 * profile home, so resolveMetabotPaths rejects it — the paths stub below
 * exists solely to satisfy the SecretStore interface.
 */
function createOwnerSecretStore(systemHomeDir, owner) {
    const paths = {
        identitySecretsPath: (0, ownerIdentity_1.resolveOwnerIdfilePath)(systemHomeDir),
    };
    return {
        paths,
        ensureLayout: async () => paths,
        readIdentitySecrets: async () => ({ mnemonic: owner.mnemonic, path: owner.path }),
        writeIdentitySecrets: async () => {
            throw new Error('Owner identity secrets are read-only in this context.');
        },
        deleteIdentitySecrets: async () => {
            throw new Error('Owner identity secrets are read-only in this context.');
        },
    };
}
/**
 * Signer over the owner mnemonic. `resolveSponsorWritePin` is the MVC traffic
 * (代付) hook: when present, owner writes bill the traffic account like Bot
 * writes; absent = the owner wallet self-pays.
 */
function createOwnerSigner(input) {
    return (0, localMnemonicSigner_1.createLocalMnemonicSigner)({
        secretStore: createOwnerSecretStore(input.systemHomeDir, input.owner),
        adapters: input.adapters,
        ...(input.resolveSponsorWritePin ? { resolveSponsorWritePin: input.resolveSponsorWritePin } : {}),
    });
}
