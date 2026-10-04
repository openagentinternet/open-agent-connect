/**
 * Daemon-side owner-identity handler group: the /api/user/* verbs. Thin ports
 * of the `metabot user *` CLI command handlers (src/cli/commands/user.ts)
 * onto core/owner/ownerIdentity — the owner identity is machine-wide (no
 * `from` actor selection), and the mnemonic only ever leaves the daemon
 * through the guarded reveal verb, exactly like the CLI reveal.
 */
import { type OwnerIdentityRecord } from '../core/owner/ownerIdentity';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { ResolveSponsorWritePin } from '../core/signing/localMnemonicSigner';
import type { Signer } from '../core/signing/signer';
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
}
export declare function createUserDaemonHandlers(input: UserDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['user']>;
