import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Buffer } from 'node:buffer';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';

export type Awaitable<T> = T | Promise<T>;

export type MetabotUiPageName = 'hub' | 'publish' | 'my-services' | 'trace' | 'refund' | 'chat-viewer' | 'bot';

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
    create?: (input: { name: string; host?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
  };
  master?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    list?: (input: { online?: boolean; masterKind?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    ask?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    hostAction?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    suggest?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    receive?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    trace?: (input: { traceId: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  network?: {
    listServices?: (input: { online?: boolean; query?: string; cached?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    listBots?: (input: { online?: boolean; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    listSources?: () => Awaitable<MetabotCommandResult<unknown>>;
    addSource?: (input: { baseUrl: string; label?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    removeSource?: (input: { baseUrl: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  provider?: {
    getSummary?: () => Awaitable<MetabotCommandResult<unknown>>;
    getInitiatedRefunds?: () => Awaitable<MetabotCommandResult<unknown>>;
    setPresence?: (input: { enabled: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    confirmRefund?: (input: { orderId: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  services?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    listPublishSkills?: () => Awaitable<MetabotCommandResult<unknown>>;
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
    getTrace?: (input: { traceId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    watchTrace?: (input: { traceId: string }) => Awaitable<string>;
    listSessions?: () => Awaitable<MetabotCommandResult<unknown>>;
    getSession?: (input: { sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  ui?: {
    renderPage?: (page: MetabotUiPageName) => Awaitable<string>;
  };
  llm?: {
    listRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
    discoverRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
    listBindings?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    upsertBindings?: (input: { slug: string; bindings: Record<string, unknown>[] }) => Awaitable<MetabotCommandResult<unknown>>;
    removeBinding?: (input: { bindingId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getPreferredRuntime?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setPreferredRuntime?: (input: { slug: string; runtimeId: string | null }) => Awaitable<MetabotCommandResult<unknown>>;
    execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getSession?: (input: { sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    cancelSession?: (input: { sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listSessions?: (input: { limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
    streamSessionEvents?: (input: { sessionId: string }) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
  };
  bot?: {
    getStats?: () => Awaitable<MetabotCommandResult<unknown>>;
    listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
    getProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    updateProfile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getWallet?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getBackup?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    deleteProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
    discoverRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
    listSessions?: (input: { slug?: string; limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
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
