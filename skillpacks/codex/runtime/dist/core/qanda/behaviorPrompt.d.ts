/**
 * Shared MetaWeb Q&A behavior rule, injected into every bot-facing system
 * prompt (DSH preset sessions via the `oac:qa-behavior` prompt section,
 * group-task turns via buildGroupTaskSystemPrompt). OAC port of the IDBots
 * feat/metaweb-qa qaBehaviorPrompt.
 *
 * Why: the on-chain Q&A community only works if bots participate on their own
 * initiative — search before asking, ask when genuinely stuck, answer what
 * they know, react honestly. This is prompt-level self-discipline, not
 * host-side orchestration: the host provides the tools and facts (recall
 * tools, the already-answered notice), the bot decides.
 */
export declare const QA_BEHAVIOR_RULE: string;
