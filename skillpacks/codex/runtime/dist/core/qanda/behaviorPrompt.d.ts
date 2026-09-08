/**
 * Shared MetaWeb Q&A behavior rule, injected into every bot-facing system
 * prompt (DSH preset sessions via the `oac:qa-behavior` prompt section,
 * group-task turns via buildGroupTaskSystemPrompt). OAC port of the IDBots
 * feat/metaweb-qa qaBehaviorPrompt, strengthened (2026-09-08) around asking:
 * when on-chain searches for something the owner's task needs come up empty,
 * publishing the question is the DEFAULT next action — cheap, non-blocking,
 * and how the early network bootstraps its knowledge commons.
 *
 * Why: the host provides the tools and facts (recall tools, the
 * already-answered notice); the bot decides. Early MetaBots that reliably
 * publish well-asked questions are what make answers, skill supply, and
 * future search hits exist at all.
 */
export declare const QA_BEHAVIOR_RULE: string;
