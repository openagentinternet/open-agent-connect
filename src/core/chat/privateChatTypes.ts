export interface PrivateChatConversation {
  conversationId: string;
  peerGlobalMetaId: string;
  peerName: string | null;
  topic: string | null;
  strategyId: string | null;
  state: 'active' | 'paused' | 'closed';
  turnCount: number;
  lastDirection: 'inbound' | 'outbound';
  createdAt: number;
  updatedAt: number;
  pendingGuidanceText: string | null;
  pendingGuidanceCreatedAt: number | null;
  pendingGuidanceLeaseId?: string | null;
  pendingGuidanceLeaseExpiresAt?: number | null;
}

export interface PrivateChatMessage {
  conversationId: string;
  messageId: string;
  direction: 'inbound' | 'outbound';
  senderGlobalMetaId: string;
  content: string;
  messagePinId: string | null;
  extensions: Record<string, unknown> | null;
  timestamp: number;
  deliveryRecovery?: {
    failedPinIds: string[];
    retryCount: number;
  } | null;
}

export interface PrivateChatState {
  version: number;
  conversations: PrivateChatConversation[];
  messages: PrivateChatMessage[];
}

export interface ChatStrategy {
  id: string;
  maxTurns: number;
  maxIdleMs: number;
  exitCriteria: string;
}

export interface ChatStrategiesState {
  strategies: ChatStrategy[];
}

export interface ChatPersona {
  soul: string;
  goal: string;
  role: string;
  identity?: {
    name: string;
    globalMetaId: string;
  };
}

export interface PrivateChatInboundMessage {
  fromGlobalMetaId: string;
  content: string;
  contentType?: string | null;
  messagePinId: string | null;
  fromChatPublicKey: string | null;
  timestamp: number;
  rawMessage: Record<string, unknown> | null;
}

export interface ChatReplyRunnerInput {
  conversation: PrivateChatConversation;
  recentMessages: PrivateChatMessage[];
  persona: ChatPersona;
  strategy: ChatStrategy | null;
  inboundMessage?: PrivateChatMessage | null;
  operatorGuidanceText?: string | null;
  /** Scoped memory + experience blocks for this turn (contact scope; the
   * privacy gate already applied). Rendered as one prompt section. */
  memoryContext?: string | null;
  // When false, the reply must not close the conversation: the prompt forbids
  // farewell output and the orchestrator strips any close marker the model
  // still emits. Used for session-opening guided turns.
  conversationCloseAllowed?: boolean;
  // Fired at most once per turn when the reply runtime starts using a tool,
  // i.e. an allowed chat skill actually began executing. Fire-and-forget: the
  // orchestrator uses it to send the peer a short wait notice before a long
  // skill execution; it must never break the reply path.
  onSkillExecutionStart?: () => void;
  // Host-injected notice appended to the prompt (wake checks, empty-reply
  // retries). Empty/null means a plain turn.
  hostNoticeText?: string | null;
}

export interface ChatReplyRunnerResult {
  // 'reply': deliver content. 'end_conversation': deliver content and close.
  // 'no_reply': the model deliberately chose silence ([NO_REPLY]) — record a
  // local marker, deliver nothing, and arm a wake (IDBots parity).
  // 'empty_reply': the LLM completed but emitted no final text (reasoning-only
  // completion) — retryable with a host notice; never deliverable.
  // 'skip': no reply could be produced at all (no runtime, runner failure).
  state: 'reply' | 'end_conversation' | 'no_reply' | 'empty_reply' | 'skip';
  content?: string;
  extensions?: Record<string, unknown>;
}

export type ChatReplyRunner = (
  input: ChatReplyRunnerInput,
) => ChatReplyRunnerResult | Promise<ChatReplyRunnerResult>;

export interface PrivateChatAutoReplyConfig {
  enabled: boolean;
  acceptPolicy: 'accept_all';
  defaultStrategyId: string | null;
  maxTurns?: number;
  cooldownMs?: number;
  // Wake schedule for silent-but-open conversation tails (IDBots parity).
  // Defaults to DEFAULT_PRIVATE_CHAT_WAKE_DELAYS_MS when absent.
  wakeDelaysMs?: number[];
}
