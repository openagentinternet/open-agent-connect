import type { MetabotCommandResult } from '../core/contracts/commandResult';
import type { ConcreteSkillHost, SkillRenderFormat } from '../core/skills/skillContractTypes';
import type { SystemHost } from '../core/system/types';
export type Awaitable<T> = T | Promise<T>;
export interface CliDependencies {
    config?: {
        get?: (input: {
            from?: string;
            key: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        set?: (input: {
            from?: string;
            key: string;
            value: boolean | string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    buzz?: {
        post?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    browser?: {
        open?: (input: {
            uri?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        /** Ask every currently-open Browser page to open a URI in a new tab. */
        tabOpen?: (input: {
            uri: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        /** Resolve a deep-link URI into its clickable local Browser http URL. */
        link?: (input: {
            uri: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    metaapp?: {
        preview?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        update?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        delete?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        list?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        publishProject?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        updateProject?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        share?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        view?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        comment?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        search?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        forks?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        source?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    metaid?: {
        search?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        detail?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
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
            host?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        who?: () => Awaitable<MetabotCommandResult<unknown>>;
        list?: () => Awaitable<MetabotCommandResult<unknown>>;
        assign?: (input: {
            name: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    network?: {
        listServices?: (input: {
            online?: boolean;
            query?: string;
            cached?: boolean;
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
        listPublishSkills?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listOwned?: (input: {
            from?: string;
            all: boolean;
            page: number;
            pageSize: number;
            refresh: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listOwnedOrders?: (input: {
            serviceId: string;
            from?: string;
            all: boolean;
            page: number;
            pageSize: number;
            refresh: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        modifyOwned?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        revokeOwned?: (input: {
            serviceId: string;
            from?: string;
            network?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listRefunds?: (input: {
            from?: string;
            all: boolean;
            kind: 'initiated' | 'received' | 'all';
        }) => Awaitable<MetabotCommandResult<unknown>>;
        syncRefunds?: (input: {
            from?: string;
            all: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        settleRefund?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        inspectOrder?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        call?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        rate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    provider?: {
        inspectOrder?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        settleRefund?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chat?: {
        private?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        conversations?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        messages?: (input: {
            conversationId: string;
            limit?: number;
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        autoReplyStatus?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        setAutoReply?: (input: {
            enabled?: boolean;
            defaultStrategyId?: string;
            maxTurns?: number;
            cooldownMs?: number;
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    conversations?: {
        list?: (input: {
            local: string;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        messages?: (input: {
            local: string;
            peer: string;
            limit?: number;
            before?: number;
            after?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        guidance?: (input: {
            local: string;
            peer: string;
            guidance: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    file?: {
        upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        uploadLarge?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    wallet?: {
        balance?: (input: {
            from?: string;
            chain: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        transfer?: (input: {
            from?: string;
            toAddress: string;
            amountRaw: string;
            confirm: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    trace?: {
        get?: (input: {
            from?: string;
            traceId?: string;
            sessionId?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        watch?: (input: {
            from?: string;
            traceId: string;
        }) => Awaitable<string>;
        listSessions?: (input: {
            from?: string;
            all: boolean;
            limit: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    ui?: {
        open?: (input: {
            page: string;
            from?: string;
            traceId?: string;
            sessionId?: string;
            serviceId?: string;
            mode?: string;
            host?: string;
            pinId?: string;
            firstPinId?: string;
            mine?: boolean;
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
        bindPersona?: (input: {
            host: 'codex';
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        personaStatus?: (input: {
            host: 'codex';
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        unbindPersona?: (input: {
            host: 'codex';
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    system?: {
        update?: (input: {
            host?: SystemHost;
            version?: string;
            dryRun: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        uninstall?: (input: {
            all: boolean;
            confirmToken?: string;
            yes: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    llm?: {
        listRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
        discoverRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
        listBindings?: (input?: {
            from?: string;
            slug?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        upsertBindings?: (input: {
            from?: string;
            slug?: string;
            bindings: Record<string, unknown>[];
        }) => Awaitable<MetabotCommandResult<unknown>>;
        removeBinding?: (input: {
            from?: string;
            bindingId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        getPreferredRuntime?: (input?: {
            from?: string;
            slug?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        setPreferredRuntime?: (input: {
            from?: string;
            slug?: string;
            runtimeId: string | null;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    bot?: {
        listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
        getProfile?: (input: {
            slug: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        updateProfile?: (input: {
            slug: string;
        } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        deleteProfile?: (input: {
            slug: string;
            confirm?: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        getConfig?: (input: {
            slug: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        setConfig?: (input: {
            slug: string;
        } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        getWallet?: (input: {
            slug: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        getBackup?: (input: {
            slug: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listRuntimes?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        discoverRuntimes?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listSessions?: (input: {
            slug?: string;
            limit: number;
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
