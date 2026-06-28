import { type MetabotCommandResult } from '../contracts/commandResult';
export interface MetaAppOwnerActor {
    from?: string;
    homeDir: string;
    mvcAddress: string;
    writePin: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
export interface MetaAppOwnerListDeps {
    manClient: {
        listByAddress: (input: {
            address: string;
            cursor?: string;
            size: number;
        }) => Promise<Record<string, unknown>>;
    };
}
export declare function listOwnerMetaApps(actor: MetaAppOwnerActor, input: {
    cursor?: string;
    size?: number;
} & MetaAppOwnerListDeps): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function publishMetaAppPayload(actor: MetaAppOwnerActor, input: Record<string, unknown>): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function updateMetaAppPayload(actor: MetaAppOwnerActor, input: Record<string, unknown>): Promise<MetabotCommandResult<Record<string, unknown>>>;
export declare function deleteMetaAppPin(actor: MetaAppOwnerActor, input: Record<string, unknown>): Promise<MetabotCommandResult<Record<string, unknown>>>;
