import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Buffer } from 'node:buffer';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
export type Awaitable<T> = T | Promise<T>;
export type MetabotUiPageName = 'hub' | 'publish' | 'my-services' | 'trace' | 'refund' | 'chat-viewer' | 'bot' | 'loom';
export interface MetabotDaemonHttpHandlers {
    config?: {
        get?: () => Awaitable<MetabotCommandResult<unknown>>;
        set?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    buzz?: {
        post?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chain?: {
        write?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    daemon?: {
        getStatus?: () => Awaitable<MetabotCommandResult<unknown>>;
        doctor?: () => Awaitable<MetabotCommandResult<unknown>>;
    };
    identity?: {
        create?: (input: {
            name: string;
            host?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
    };
    loom?: {
        getDashboard?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        getTaskDetail?: (input: {
            taskPinId: string;
        } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        refresh?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    master?: {
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        list?: (input: {
            online?: boolean;
            masterKind?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        ask?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        hostAction?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        suggest?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        receive?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        trace?: (input: {
            from?: string;
            traceId: string;
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
    provider?: {
        getSummary?: () => Awaitable<MetabotCommandResult<unknown>>;
        getInitiatedRefunds?: (input?: {
            from?: string;
            all?: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        getRefunds?: (input?: {
            from?: string;
            all?: boolean;
            kind?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        inspectOrder?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        setPresence?: (input: {
            enabled: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        confirmRefund?: (input: {
            orderId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        settleRefund?: (input: {
            from?: string;
            orderId?: string;
            paymentTxid?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    services?: {
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        listPublishSkills?: (input?: {
            slug?: string;
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listMyServices?: (input: {
            from?: string;
            all?: boolean;
            page: number;
            pageSize: number;
            refresh: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listMyServiceOrders?: (input: {
            serviceId: string;
            from?: string;
            all?: boolean;
            page: number;
            pageSize: number;
            refresh: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        modifyMyService?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        revokeMyService?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        listRefunds?: (input?: {
            from?: string;
            all?: boolean;
            kind?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
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
        call?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        rate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        handleInboundOrderProtocolMessage?: (input: {
            fromGlobalMetaId: string;
            content: string;
            messagePinId?: string | null;
            timestamp?: number | null;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chat?: {
        private?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        privateConversation?: (input: {
            from?: string;
            peer: string;
            afterIndex?: number;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        privateChatConversations?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        privateChatMessages?: (input: {
            from?: string;
            conversationId: string;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        autoReplyStatus?: (input?: {
            from?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        setAutoReply?: (input: {
            from?: string;
            enabled: boolean;
            defaultStrategyId?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        stopConversation?: (input: {
            from?: string;
            peer: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    file?: {
        upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    trace?: {
        getTrace?: (input: {
            from?: string;
            traceId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        watchTrace?: (input: {
            from?: string;
            traceId: string;
        }) => Awaitable<string>;
        listSessions?: (input?: {
            from?: string;
            all?: boolean;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        getSession?: (input: {
            from?: string;
            sessionId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    ui?: {
        renderPage?: (page: MetabotUiPageName) => Awaitable<string>;
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
        execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        getSession?: (input: {
            sessionId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        cancelSession?: (input: {
            sessionId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        listSessions?: (input: {
            limit: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        streamSessionEvents?: (input: {
            sessionId: string;
        }) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
    };
    bot?: {
        getStats?: () => Awaitable<MetabotCommandResult<unknown>>;
        listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
        getProfile?: (input: {
            slug: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        updateProfile?: (input: {
            slug: string;
        } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
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
        deleteProfile?: (input: {
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
export interface RouteContext {
    req: IncomingMessage;
    res: ServerResponse;
    url: URL;
    handlers: MetabotDaemonHttpHandlers;
    readJsonBody: () => Promise<Record<string, unknown>>;
    sendJson: (status: number, payload: unknown) => void;
    sendHtml: (status: number, html: string) => void;
    sendText: (status: number, body: string | Buffer, contentType?: string) => void;
    sendMethodNotAllowed: (allowed: string[]) => void;
}
export type RouteHandler = (context: RouteContext) => Promise<boolean>;
