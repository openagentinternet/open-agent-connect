import { promises as fs } from 'node:fs';
import type { MetabotCommandResult } from '../core/contracts/commandResult';
import type { ConcreteSkillHost, SkillRenderFormat } from '../core/skills/skillContractTypes';
import type { SystemHost } from '../core/system/types';

export type Awaitable<T> = T | Promise<T>;

export interface CliDependencies {
  config?: {
    get?: (input: { from?: string; key: string }) => Awaitable<MetabotCommandResult<unknown>>;
    set?: (input: { from?: string; key: string; value: boolean | string }) => Awaitable<MetabotCommandResult<unknown>>;
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
    create?: (input: { name: string; host?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    who?: () => Awaitable<MetabotCommandResult<unknown>>;
    list?: () => Awaitable<MetabotCommandResult<unknown>>;
    assign?: (input: { name: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  master?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    list?: (input: { online?: boolean; masterKind?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    ask?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    suggest?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    hostAction?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    trace?: (input: { from?: string; traceId: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  network?: {
    listServices?: (input: { online?: boolean; query?: string; cached?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    listBots?: (input: { online?: boolean; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    listProducts?: (input: { online?: boolean; cached?: boolean; query?: string; limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    listSources?: () => Awaitable<MetabotCommandResult<unknown>>;
    addSource?: (input: { baseUrl: string; label?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    removeSource?: (input: { baseUrl: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  services?: {
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    listPublishSkills?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
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
  products?: {
    listPublishSkills?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    publish?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    listOwned?: (input: {
      from?: string;
      all: boolean;
      page: number;
      pageSize: number;
      refresh: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  provider?: {
    inspectOrder?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    settleRefund?: (input: { from?: string; orderId?: string; paymentTxid?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  chat?: {
    private?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    conversations?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    messages?: (input: { conversationId: string; limit?: number; from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    autoReplyStatus?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setAutoReply?: (input: { enabled: boolean; defaultStrategyId?: string; from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  file?: {
    upload?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  };
  wallet?: {
    balance?: (input: { from?: string; chain: string }) => Awaitable<MetabotCommandResult<unknown>>;
    transfer?: (input: { from?: string; toAddress: string; amountRaw: string; confirm: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  trace?: {
    get?: (input: { from?: string; traceId?: string; sessionId?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    watch?: (input: { from?: string; traceId: string }) => Awaitable<string>;
    listSessions?: (input: { from?: string; all: boolean; limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  ui?: {
    open?: (input: {
      page: string;
      from?: string;
      traceId?: string;
      sessionId?: string;
      serviceId?: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  skills?: {
    resolve?: (input: { skill: string; host?: ConcreteSkillHost; format: SkillRenderFormat }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  host?: {
    bindSkills?: (input: { host: ConcreteSkillHost }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  evolution?: {
    status?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    adopt?: (input: {
      from?: string;
      skill: string;
      variantId: string;
      source?: 'local' | 'remote';
    }) => Awaitable<MetabotCommandResult<unknown>>;
    publish?: (input: { from?: string; skill: string; variantId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    rollback?: (input: { from?: string; skill: string }) => Awaitable<MetabotCommandResult<unknown>>;
    search?: (input: { from?: string; skill: string }) => Awaitable<MetabotCommandResult<unknown>>;
    import?: (input: { from?: string; pinId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    imported?: (input: { from?: string; skill: string }) => Awaitable<MetabotCommandResult<unknown>>;
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
    listBindings?: (input?: { from?: string; slug?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    upsertBindings?: (input: { from?: string; slug?: string; bindings: Record<string, unknown>[] }) => Awaitable<MetabotCommandResult<unknown>>;
    removeBinding?: (input: { from?: string; bindingId: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getPreferredRuntime?: (input?: { from?: string; slug?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setPreferredRuntime?: (input: { from?: string; slug?: string; runtimeId: string | null }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  loom?: {
    sync?: (input: { limit?: number }) => Awaitable<MetabotCommandResult<unknown>>;
    list?: (input: { refresh: boolean; limit?: number; tag?: string; currency?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    show?: (input: { taskPinId: string; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    dashboard?: (input: {
      from?: string;
      refresh: boolean;
      limit?: number;
      state?: string;
      role?: 'all' | 'requester' | 'developer' | 'needs_action';
      query?: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    draftTask?: (input: { wish: string; from?: string; allowInvalid: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    postTask?: (input: {
      from?: string;
      payloadFile?: string;
      wish?: string;
      chain?: string;
      dryRun: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    claimAndStart?: (input: {
      from?: string;
      taskPinId: string;
      payoutAddress?: string;
      claimPinId?: string;
      chain?: string;
      fileChain?: string;
      message?: string;
      dryRun: boolean;
      resetWorkspace: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    runDevRound?: (input: {
      from?: string;
      taskPinId: string;
      claimPinId: string;
      chain?: string;
      fileChain?: string;
      checks: string[];
      roundNote?: string;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    deliver?: (input: {
      from?: string;
      taskPinId: string;
      claimPinId: string;
      chain?: string;
      prTitle?: string;
      deliverySummary?: string;
      dryRun: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    acceptAndPay?: (input: {
      from?: string;
      taskPinId: string;
      deliveryPinId: string;
      score: number;
      comment: string;
      chain?: string;
      confirmPayment: boolean;
    }) => Awaitable<MetabotCommandResult<unknown>>;
    reviewDelivery?: (input: {
      from?: string;
      taskPinId: string;
      deliveryPinId: string;
      verdict: 'rejected' | 'revision_needed';
      score: number;
      comment: string;
      chain?: string;
      attachments: string[];
    }) => Awaitable<MetabotCommandResult<unknown>>;
    state?: (input: { taskPinId: string; refresh: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
  };
  bot?: {
    listProfiles?: () => Awaitable<MetabotCommandResult<unknown>>;
    getProfile?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    createProfile?: (input: Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    updateProfile?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    deleteProfile?: (input: { slug: string; confirm?: boolean }) => Awaitable<MetabotCommandResult<unknown>>;
    getConfig?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    setConfig?: (input: { slug: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
    getWallet?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    getBackup?: (input: { slug: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listRuntimes?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    discoverRuntimes?: (input?: { from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
    listSessions?: (input: { slug?: string; limit: number }) => Awaitable<MetabotCommandResult<unknown>>;
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

export function createCliRuntimeContext(context: CliContext = {}): CliRuntimeContext {
  return {
    stdout: context.stdout ?? process.stdout,
    stderr: context.stderr ?? process.stderr,
    env: context.env ?? process.env,
    cwd: context.cwd ?? process.cwd(),
    readTextFile: context.readTextFile ?? ((filePath) => fs.readFile(filePath, 'utf8')),
    dependencies: context.dependencies ?? {},
  };
}
