import type { MetabotCommandResult } from '../core/contracts/commandResult';
import type { ConcreteSkillHost, SkillRenderFormat } from '../core/skills/skillContractTypes';
export type Awaitable<T> = T | Promise<T>;
export interface CliDependencies {
    config?: {
        get?: (input: {
            key: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        set?: (input: {
            key: string;
            value: boolean | string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    buzz?: {
        post?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chain?: {
        write?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    daemon?: {
        start?: () => Awaitable<MetabotCommandResult<unknown>>;
        stop?: () => Awaitable<MetabotCommandResult<unknown>>;
    };
    doctor?: {
        run?: () => Awaitable<MetabotCommandResult<unknown>>;
    };
    identity?: {
        create?: (input: {
            name: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        who?: () => Awaitable<MetabotCommandResult<unknown>>;
        list?: () => Awaitable<MetabotCommandResult<unknown>>;
        assign?: (input: {
            name: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    master?: {
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        list?: (input: {
            online?: boolean;
            masterKind?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        ask?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        suggest?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        hostAction?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        trace?: (input: {
            traceId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    network?: {
        listServices?: (input: {
            online?: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listBots?: (input: {
            online?: boolean;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listSources?: () => Awaitable<MetabotCommandResult<unknown>>;
        addSource?: (input: {
            baseUrl: string;
            label?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        removeSource?: (input: {
            baseUrl: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    services?: {
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        call?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        rate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chat?: {
        private?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        conversations?: () => Awaitable<MetabotCommandResult<unknown>>;
        messages?: (input: {
            conversationId: string;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        autoReplyStatus?: () => Awaitable<MetabotCommandResult<unknown>>;
        setAutoReply?: (input: {
            enabled: boolean;
            defaultStrategyId?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    file?: {
        upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    wallet?: {
        balance?: (input: {
            chain: 'all' | 'mvc' | 'btc';
        }) => Awaitable<MetabotCommandResult<unknown>>;
        transfer?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    trace?: {
        get?: (input: {
            traceId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        watch?: (input: {
            traceId: string;
        }) => Awaitable<string>;
    };
    ui?: {
        open?: (input: {
            page: string;
            traceId?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    skills?: {
        resolve?: (input: {
            skill: string;
            host?: ConcreteSkillHost;
            format: SkillRenderFormat;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    host?: {
        bindSkills?: (input: {
            host: ConcreteSkillHost;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    evolution?: {
        status?: () => Awaitable<MetabotCommandResult<unknown>>;
        adopt?: (input: {
            skill: string;
            variantId: string;
            source?: 'local' | 'remote';
        }) => Awaitable<MetabotCommandResult<unknown>>;
        publish?: (input: {
            skill: string;
            variantId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        rollback?: (input: {
            skill: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        search?: (input: {
            skill: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        import?: (input: {
            pinId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        imported?: (input: {
            skill: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
}
export interface CliContext {
    stdout?: Pick<NodeJS.WriteStream, 'write'>;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    dependencies?: CliDependencies;
    readTextFile?: (filePath: string) => Promise<string>;
}
export interface CliRuntimeContext {
    stdout: Pick<NodeJS.WriteStream, 'write'>;
    stderr: Pick<NodeJS.WriteStream, 'write'>;
    env: NodeJS.ProcessEnv;
    cwd: string;
    readTextFile: (filePath: string) => Promise<string>;
    dependencies: CliDependencies;
}
export declare function createCliRuntimeContext(context?: CliContext): CliRuntimeContext;
