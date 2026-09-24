/**
 * Daemon-side owner-identity handler group: the /api/user/* verbs. Thin ports
 * of the `metabot user *` CLI command handlers (src/cli/commands/user.ts)
 * onto core/owner/ownerIdentity — the owner identity is machine-wide (no
 * `from` actor selection), and the mnemonic only ever leaves the daemon
 * through the guarded reveal verb, exactly like the CLI reveal.
 */
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface UserDaemonHandlersInput {
    /** The machine-wide system home that owns `~/.metabot/owner/identity.json`. */
    systemHomeDir: string;
}
export declare function createUserDaemonHandlers(input: UserDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['user']>;
