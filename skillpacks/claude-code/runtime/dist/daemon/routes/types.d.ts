import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Buffer } from 'node:buffer';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
export type Awaitable<T> = T | Promise<T>;
export type MetabotUiPageName = 'hub' | 'publish' | 'my-services' | 'trace' | 'refund' | 'chat-viewer';
export interface MetabotDaemonHttpHandlers {
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
        }) => Awaitable<MetabotCommandResult<unknown>>;
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
    provider?: {
        getSummary?: () => Awaitable<MetabotCommandResult<unknown>>;
        setPresence?: (input: {
            enabled: boolean;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        confirmRefund?: (input: {
            orderId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    services?: {
        publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        call?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        rate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    chat?: {
        private?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
        privateConversation?: (input: {
            peer: string;
            afterIndex?: number;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        privateChatConversations?: () => Awaitable<MetabotCommandResult<unknown>>;
        privateChatMessages?: (input: {
            conversationId: string;
            limit?: number;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        autoReplyStatus?: () => Awaitable<MetabotCommandResult<unknown>>;
        setAutoReply?: (input: {
            enabled: boolean;
            defaultStrategyId?: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        stopConversation?: (input: {
            peer: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
    };
    file?: {
        upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    };
    trace?: {
        getTrace?: (input: {
            traceId: string;
        }) => Awaitable<MetabotCommandResult<unknown>>;
        watchTrace?: (input: {
            traceId: string;
        }) => Awaitable<string>;
    };
    ui?: {
        renderPage?: (page: MetabotUiPageName) => Awaitable<string>;
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
