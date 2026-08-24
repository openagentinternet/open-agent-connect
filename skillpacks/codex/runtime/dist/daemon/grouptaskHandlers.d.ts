/**
 * Group Task daemon handler group: builds the production
 * GroupTaskServiceContext (profiles from the manager registry, per-profile
 * mnemonic signers, owner identity signer) and exposes the HTTP handler verbs
 * the /api/grouptask/* routes dispatch to. All business rules live in
 * core/grouptask/service; this file is wiring + input normalization only.
 */
import { type MetabotCommandResult } from '../core/contracts/commandResult';
import { type GroupTaskServiceContext } from '../core/grouptask/service';
import type { GroupTaskTransportOptions } from '../core/grouptask/transport';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { Signer } from '../core/signing/signer';
export interface GroupTaskDaemonHandlers {
    create: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    list: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    detail: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    messages: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    postMessage: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    close: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    reopen: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    kickMember: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    setMemberStatus: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    rename: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    setPinned: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    setArchived: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    invite: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    invites: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    collabs: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    collabMessages: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    health: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    staffingPropose: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    staffingList: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    staffingDecide: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    staffingCreate: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    staffingSearch: (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}
export interface CreateGroupTaskDaemonHandlersInput {
    systemHomeDir: string;
    createSignerForProfileHome: (homeDir: string) => Signer;
    adapters: ChainAdapterRegistry;
    /** Peer chat pubkey resolver; enables OpenTeam private-message envelopes. */
    resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    transport?: GroupTaskTransportOptions;
    log?: (message: string) => void;
}
/** Build the production GroupTaskServiceContext (exported for engine reuse). */
export declare function createGroupTaskServiceContext(input: CreateGroupTaskDaemonHandlersInput): GroupTaskServiceContext;
export declare function createGroupTaskDaemonHandlers(input: CreateGroupTaskDaemonHandlersInput & {
    context?: GroupTaskServiceContext;
}): GroupTaskDaemonHandlers;
