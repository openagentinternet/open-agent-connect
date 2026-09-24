import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Buffer } from 'node:buffer';
import type { BrowserHttpHandlers } from '../../browser/http';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import type { MetaAppStageEvent } from '../../core/metaapp/stageEvents';

export type Awaitable<T> = T | Promise<T>;

export type MetabotUiPageName =
  | 'hub'
  | 'publish'
  | 'my-services'
  | 'trace'
  | 'refund'
  | 'bot'
  | 'conversations'
  | 'services'
  | 'apps'
  | 'settings'
  | 'kb'
  | 'surf'
  | 'memory'
  | 'schedule'
  | 'traffic'
  | 'dream'
  | 'metaapps'
  | 'browser';

export interface ServiceRefundSyncResponse {
  scanned: {
    requestPins: number;
    finalizePins: number;
    buyerRetryCandidates: number;
  };
  applied: {
    buyerRequests: number;
    sellerRequests: number;
    synthesizedSellerOrders: number;
    finalizations: number;
  };
  skipped: number;
  blocked: number;
}

export interface ServiceRefundSyncRequest {
  from?: string;
  all?: boolean;
  kind?: string;
}

export interface MetabotDaemonHttpHandlers {
  browser?: BrowserHttpHandlers;
  config?: {
    get?: () => Awaitable<MetabotCommandResult<unknown>>;
    set?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  /**
   * Traffic (流量 account-quota gas credit) verbs, all owner-scoped (the
   * machine-wide owner identity binds the account — no `from` selection).
   * Read verbs surface backend 404s as soft `{ featureUnavailable: true }`
   * success payloads; write verbs (setMode/claim/redeem) fail hard with the
   * TrafficApiError code (`traffic_<stage>_failed`) and data.errorCode intact.
   */
  traffic?: {
    status?: () => Awaitable<MetabotCommandResult<unknown>>;
    getMode?: () => Awaitable<MetabotCommandResult<unknown>>;
    setMode?: (input: { mode: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getBalance?: () => Awaitable<MetabotCommandResult<unknown>>;
    getLedger?: (input: { cursor?: number; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    getUsage?: () => Awaitable<MetabotCommandResult<unknown>>;
    claim?: () => Awaitable<MetabotCommandResult<unknown>>;
    redeem?: (input: { code: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getApiBase?: () => Awaitable<MetabotCommandResult<unknown>>;
    setApiBase?: (input: { apiBase: string }) => Awaitable<MetabotCommandResult<unknown>>;
    resetApiBase?: () => Awaitable<MetabotCommandResult<unknown>>;
  };
  buzz?: {
    post?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  simplenote?: {
    post?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  qanda?: {
    question?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    answer?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    like?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  protocol?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    update?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  skills?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
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
    comment?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    fork?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    previewAsset?: (input: { previewId: string; assetPath?: string }) => Awaitable<{
      body: Buffer | string;
      contentType: string;
    } | MetabotCommandResult<unknown>>;
    /** Op-keyed publish progress stages; replays the buffer then streams live events. */
    stageEvents?: (input: {
      op: string;
      listener: (event: MetaAppStageEvent) => void;
    }) => () => void;
  };
  chain?: {
    write?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  surf?: {
    status?: (input: { from?: string; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    run?: (input: {
      from?: string;
      trigger?: 'manual-chat' | 'manual-ui' | 'pre-dream';
      wait?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    enable?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    disable?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    budget?: (input: { from?: string; budget?: number }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  daemon?: {
    getStatus?: () => Awaitable<MetabotCommandResult<unknown>>;
    doctor?: () => Awaitable<MetabotCommandResult<unknown>>;
  };
  identity?: {
    create?: (input: { name: string; host?: string; profileSlug?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
  };
  /** Machine-wide human owner identity (the `metabot user *` CLI surface;
   *  no `from` selection — the owner file is system-scoped). Mirrors the CLI
   *  shapes: create/import also return the mnemonic (shown once). */
  user?: {
    who?: () => Awaitable<MetabotCommandResult<unknown>>;
    create?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    import?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    rename?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    reveal?: () => Awaitable<MetabotCommandResult<unknown>>;
    delete?: () => Awaitable<MetabotCommandResult<unknown>>;
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
    getInitiatedRefunds?: (input?: { from?: string; all?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    getRefunds?: (input?: { from?: string; all?: boolean; kind?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    inspectOrder?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setPresence?: (input: { enabled: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    confirmRefund?: (input: { orderId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    settleRefund?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  services?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    listPublishSkills?: (input?: { slug?: string; from?: string; allowFallbackRuntime?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
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
    listRefunds?: (input?: { from?: string; all?: boolean; kind?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    syncRefunds?: (input?: ServiceRefundSyncRequest) => Awaitable<MetabotCommandResult<ServiceRefundSyncResponse>>;
    inspectOrder?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    settleRefund?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    call?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    rate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    handleInboundOrderProtocolMessage?: (input: {
      fromGlobalMetaId: string;
      content: string;
      messagePinId?: string | null;
      timestamp?: number | null;
      localProfileSlug?: string | null;
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
    privateChatConversations?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    privateChatMessages?: (input: {
      from?: string;
      conversationId: string;
      limit?: number;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    autoReplyStatus?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setAutoReply?: (input: {
      from?: string;
      enabled?: boolean;
      maxTurns?: number;
      cooldownMs?: number;
      defaultStrategyId?: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    stopConversation?: (input: {
      from?: string;
      peer: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  grouptask?: {
    create?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    list?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    detail?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    messages?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    postMessage?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    supervise?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    deleteDeliverable?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    relayDrain?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    workClaim?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    workSubmit?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    close?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    reopen?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    kickMember?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    setMemberStatus?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    rename?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    setPinned?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    setArchived?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    invite?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    invites?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    collabs?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    collabMessages?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    health?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    staffingPropose?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    staffingList?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    staffingDecide?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    staffingCreate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    staffingSearch?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  conversations?: {
    list?: (input: {
      local: string;
      limit?: number;
      /** Keep archived conversations in the list (archived-surfaces hook). */
      includeArchived?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    messages?: (input: {
      local: string;
      peer: string;
      before?: number;
      after?: number;
      limit?: number;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    guidance?: (input: {
      local: string;
      peer: string;
      guidance: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    meta?: (input: {
      local: string;
      peer: string;
      pinned?: boolean;
      archived?: boolean;
      /** Present (possibly empty) = rename; empty string clears the override. */
      displayName?: string | null;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    streamEvents?: (input: {
      local: string;
      signal?: AbortSignal;
    }) => Awaitable<AsyncIterable<unknown>>;
  };
  schedule?: {
    /** Host lease heartbeat: keeps this profile's tasks out of the daemon tick
     *  while the host is alive. */
    heartbeat?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    due?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    claim?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    complete?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    list?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    show?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    runs?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    /** Management verbs (UI surface): every one of them requires an explicit
     *  `from` bot selector, same as the lease-protocol verbs above. */
    create?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    update?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    delete?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    enable?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    disable?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    /**
     * Run-now for the standalone schedule UI (the `metabot schedule run` twin,
     * executed inside the daemon process). Body: { from, id, wait? }. `wait:
     * true` holds the request until the run settles; the default starts the
     * run and returns immediately, same contract as `/api/dream/run`.
     * Requires an explicit `from` bot selector like every management verb.
     */
    run?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  /** Dream reads + manual run-now. Mirrors the `metabot dream *` CLI deps. */
  dream?: {
    due?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    status?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    summaries?: (input: { from?: string; limit?: number; before?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    selfIdentity?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    capabilities?: (input: { from?: string; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    /**
     * Manual dream run for one date (default: last night). `wait: true` holds
     * the request until the run settles; the default starts the run inside the
     * daemon process and returns immediately (status observable via `status`,
     * same contract as `/api/surf/run`).
     */
    run?: (input: {
      from?: string;
      date?: string;
      wait?: boolean;
      llm?: string | null;
      limits?: Record<string, unknown>;
      isRepair?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  /** Memory management surface for a standalone UI. Mirrors the
   *  `metabot memory *` CLI deps; JSON payloads are identical. */
  memory?: {
    list?: (input: {
      from?: string;
      scopeKind?: string;
      scopeKey?: string;
      usageClass?: string;
      status?: string;
      origin?: string;
      query?: string;
      limit?: number;
      includeDeleted?: boolean;
      includeArchived?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    search?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    recall?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    add?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    update?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    delete?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    unarchive?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    knowledgeList?: (input: {
      from?: string;
      kind?: string;
      category?: string;
      status?: string;
      query?: string;
      limit?: number;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    knowledgeUpsert?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    knowledgeUpdate?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    knowledgeArchive?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    knowledgeDelete?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    impressionsList?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    impressionsShow?: (input: { from?: string; subject: string }) => Awaitable<MetabotCommandResult<unknown>>;
    policyGet?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    policySet?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
    policyDelete?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    hygieneStatus?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    hygieneDue?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    hygieneRun?: (input: { from?: string; noDeep?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    hygieneConfigGet?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    hygieneConfigSet?: (input: { from?: string; payload: Record<string, unknown> }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  /** Knowledge-base management + nightly study-job surface. Mirrors the
   *  `metabot knowledge-base *` CLI deps and the DSH study tools. */
  kb?: {
    list?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    create?: (input: {
      from?: string;
      name: string;
      description?: string;
      rawDir?: string;
      autoLearn?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    update?: (input: {
      from?: string;
      id: string;
      name?: string;
      description?: string;
      autoLearn?: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    remove?: (input: { from?: string; id: string }) => Awaitable<MetabotCommandResult<unknown>>;
    query?: (input: { from?: string; text: string; id?: string; topK?: number; minScore?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    addDocument?: (input: {
      from?: string;
      id?: string;
      title: string;
      content: string;
      sourceType?: string;
      url?: string;
      pinId?: string;
      tags?: string[];
    }) => Awaitable<MetabotCommandResult<unknown>>;
    learn?: (input: { from?: string; id?: string; full?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    studyList?: (input: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    studyEnqueue?: (input: { from?: string; topic: string; budgetPins?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    studyRetry?: (input: { from?: string; jobId?: string; topic?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  file?: {
    upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    uploadLarge?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  trace?: {
    getTrace?: (input: { from?: string; traceId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    watchTrace?: (input: { from?: string; traceId: string }) => Awaitable<string>;
    listSessions?: (input?: { from?: string; all?: boolean; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    getSession?: (input: { from?: string; sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  ui?: {
    renderPage?: (page: MetabotUiPageName) => Awaitable<string>;
    resolveTraceTarget?: (input: {
      traceId?: string | null;
      sessionId?: string | null;
      local?: string | null;
      peer?: string | null;
    }) => Awaitable<string>;
  };
  llm?: {
    listRuntimes?: () => Awaitable<MetabotCommandResult<unknown>>;
    discoverRuntimes?: (input?: { background?: boolean; providers?: string[] }) => Awaitable<MetabotCommandResult<unknown>>;
    listBindings?: (input?: { from?: string; slug?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    upsertBindings?: (input: { from?: string; slug?: string; bindings: Record<string, unknown>[] }) => Awaitable<MetabotCommandResult<unknown>>;
    removeBinding?: (input: { from?: string; bindingId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getPreferredRuntime?: (input?: { from?: string; slug?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setPreferredRuntime?: (input: { from?: string; slug?: string; runtimeId: string | null }) => Awaitable<MetabotCommandResult<unknown>>;
    execute?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getSession?: (input: { sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    cancelSession?: (input: { sessionId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listSessions?: (input: { limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
    streamSessionEvents?: (input: { sessionId: string }) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
    /** Host-executor bridge: connected status (GET status route + CLI verb). */
    hostExecutorStatus?: () => Awaitable<MetabotCommandResult<unknown>>;
    /** Host-executor bridge: one posted generation result. */
    hostExecutorSubmitResult?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    /** Host-executor bridge: the SSE stream of generation requests (null = not configured). */
    hostExecutorEvents?: () => AsyncIterable<unknown> | null | Promise<AsyncIterable<unknown> | null>;
    /** Host-executor bridge: one generation on the Bot's DSH pair (CLI passive turns). */
    hostExecutorGenerate?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  bot?: {
    getStats?: () => Awaitable<MetabotCommandResult<unknown>>;
    listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
    getProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    retryProfileSetup?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    updateProfile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    uploadHomepageFile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getConfig?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setConfig?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getWallet?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    previewWalletTransfer?: (input: { slug: string; chain: string; toAddress: string; amount: string }) => Awaitable<MetabotCommandResult<unknown>>;
    confirmWalletTransfer?: (input: { slug: string; chain: string; toAddress: string; amount: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getBackup?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    deleteProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listRuntimes?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    discoverRuntimes?: (input?: { from?: string; background?: boolean; providers?: string[] }) => Awaitable<MetabotCommandResult<unknown>>;
    testRuntime?: (input: { from?: string; runtimeId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listSessions?: (input: { slug?: string; limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
  };
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  handlers: MetabotDaemonHttpHandlers;
  readJsonBody: () => Promise<Record<string, unknown>>;
  readRawBody: (maxBytes: number) => Promise<Buffer>;
  streamRawBodyToFile: (filePath: string, maxBytes: number) => Promise<{ bytes: number }>;
  sendJson: (status: number, payload: unknown) => void;
  sendHtml: (status: number, html: string) => void;
  sendText: (status: number, body: string | Buffer, contentType?: string) => void;
  sendMethodNotAllowed: (allowed: string[]) => void;
}

export type RouteHandler = (context: RouteContext) => Promise<boolean>;
