/**
 * Daemon-side knowledge-base handler group: the /api/kb/* verbs. KB
 * management (list/create/update/remove/query/add-document/learn) ports the
 * `metabot knowledge-base *` CLI dependency handlers against
 * core/knowledgebase stores; the study verbs (study/status/enqueue/retry)
 * mirror the DSH `metaweb_study_*` tool semantics against
 * core/knowledgebase/studyJobs (the daemon nightly tick drains the queue).
 */

import path from 'node:path';

import { commandFailed, commandSuccess } from '../core/contracts/commandResult';
import { createKnowledgeBaseService } from '../core/knowledgebase/service';
import {
  createStudyJobStore,
  type StudyJobRecord,
  type StudyJobStore,
} from '../core/knowledgebase/studyJobs';
import { resolveMetabotPaths } from '../core/state/paths';
import type { DreamBotRef } from './dreamHandlers';
import type { MetabotDaemonHttpHandlers } from './routes/types';

/**
 * Shared failed-study-job retry selection + requeue (DSH metaweb_study_retry
 * semantics): an explicit jobId must exist for this bot; otherwise every
 * failed job matches, narrowed by an optional topic substring. Exported so the
 * CLI `knowledge-base study retry` dependency drives the exact same logic and
 * returns the exact same shape as the /api/kb/study/retry handler.
 */
export async function retryFailedStudyJobs(input: {
  store: StudyJobStore;
  slug: string;
  jobId?: string;
  topic?: string;
}): Promise<{ retried: StudyJobRecord[] } | { failure: ReturnType<typeof commandFailed> }> {
  const rows = await input.store.listStudyJobs(input.slug);
  const jobId = input.jobId?.trim() ?? '';
  const topic = input.topic?.trim() ?? '';
  if (jobId && rows.every((job) => job.id !== jobId)) {
    return { failure: commandFailed('study_job_not_found', `No study job with id "${jobId}" for this bot.`) };
  }
  const targets = rows.filter((job) => {
    if (job.status !== 'failed') return false;
    if (jobId) return job.id === jobId;
    if (topic) return job.topic.toLowerCase().includes(topic.toLowerCase());
    return true;
  });
  const retried: StudyJobRecord[] = [];
  for (const job of targets) {
    const result = await input.store.retryStudyJob(job.id);
    if (result?.retried) retried.push(result.job);
  }
  return { retried };
}

export interface KbDaemonHandlersInput {
  /** Resolve the acting bot (explicit slug, else the machine Twin). */
  resolveBot: (from?: string) => Promise<DreamBotRef | { failure: ReturnType<typeof commandFailed> }>;
}

function readPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

export function createKbDaemonHandlers(
  input: KbDaemonHandlersInput,
): NonNullable<MetabotDaemonHttpHandlers['kb']> {
  return {
    list: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const service = createKnowledgeBaseService(resolveMetabotPaths(bot.homeDir));
      // Ensure the default KB like IDBots does (every metabot owns one), so
      // the UI always shows a save target.
      await service.ensureDefaultKnowledgeBase(bot.slug).catch(() => undefined);
      const knowledgeBases = await service.store.listKnowledgeBases();
      return commandSuccess({ knowledgeBases });
    },

    create: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const service = createKnowledgeBaseService(paths);
      const knowledgeBase = await service.store.createKnowledgeBase({
        metabotSlug: path.basename(paths.profileRoot),
        name: rawInput?.name ?? '',
        ...(rawInput?.description ? { description: rawInput.description } : {}),
        ...(rawInput?.rawDir ? { rawDir: rawInput.rawDir } : {}),
        ...(rawInput?.autoLearn !== undefined ? { autoLearn: rawInput.autoLearn } : {}),
      });
      return commandSuccess({ knowledgeBase });
    },

    update: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const service = createKnowledgeBaseService(paths);
      const slug = path.basename(paths.profileRoot);
      const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
      if (!existing || existing.metabotSlug !== slug) {
        return commandFailed('kb_not_found', `Knowledge base ${rawInput?.id ?? ''} not found for this Bot.`);
      }
      const knowledgeBase = await service.store.updateKnowledgeBase(rawInput?.id ?? '', {
        ...(rawInput?.name ? { name: rawInput.name } : {}),
        ...(rawInput?.description ? { description: rawInput.description } : {}),
        ...(rawInput?.autoLearn !== undefined ? { autoLearn: rawInput.autoLearn } : {}),
      });
      return commandSuccess({ knowledgeBase });
    },

    remove: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const paths = resolveMetabotPaths(bot.homeDir);
      const service = createKnowledgeBaseService(paths);
      const slug = path.basename(paths.profileRoot);
      const existing = await service.store.getKnowledgeBase(rawInput?.id ?? '');
      if (!existing || existing.metabotSlug !== slug) {
        return commandFailed('kb_not_found', `Knowledge base ${rawInput?.id ?? ''} not found for this Bot.`);
      }
      const removed = await service.store.removeKnowledgeBase(rawInput?.id ?? '');
      return commandSuccess({ removed, knowledgeBaseId: rawInput?.id ?? '' });
    },

    query: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const service = createKnowledgeBaseService(resolveMetabotPaths(bot.homeDir));
      const results = await service.queryKnowledgeBase(
        path.basename(resolveMetabotPaths(bot.homeDir).profileRoot),
        rawInput?.text ?? '',
        {
          ...(rawInput?.id ? { knowledgeBaseId: rawInput.id } : {}),
          ...(rawInput?.topK != null ? { topK: rawInput.topK } : {}),
          ...(rawInput?.minScore != null ? { minScore: rawInput.minScore } : {}),
        },
      );
      return commandSuccess({ results });
    },

    addDocument: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const service = createKnowledgeBaseService(resolveMetabotPaths(bot.homeDir));
      const saved = await service.addDocument(
        path.basename(resolveMetabotPaths(bot.homeDir).profileRoot),
        {
          title: rawInput?.title ?? '',
          content: rawInput?.content ?? '',
          ...(rawInput?.id ? { knowledgeBaseId: rawInput.id } : {}),
          ...(rawInput?.sourceType ? { sourceType: rawInput.sourceType as 'web' | 'metaweb' | 'manual' } : {}),
          ...(rawInput?.url ? { url: rawInput.url } : {}),
          ...(rawInput?.pinId ? { pinId: rawInput.pinId } : {}),
          ...(rawInput?.tags ? { tags: rawInput.tags } : {}),
        },
      );
      return commandSuccess({ knowledgeBase: saved.knowledgeBase, relPath: saved.relPath, indexed: saved.indexed });
    },

    learn: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const service = createKnowledgeBaseService(resolveMetabotPaths(bot.homeDir));
      const knowledgeBase = await service.learnKnowledgeBase(
        path.basename(resolveMetabotPaths(bot.homeDir).profileRoot),
        rawInput?.id,
        rawInput?.full === true,
      );
      return commandSuccess({ knowledgeBase });
    },

    studyList: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createStudyJobStore(resolveMetabotPaths(bot.homeDir));
      const jobs = await store.listStudyJobs(bot.slug);
      return commandSuccess({ jobs });
    },

    studyEnqueue: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createStudyJobStore(resolveMetabotPaths(bot.homeDir));
      const result = await store.enqueueStudyJob({
        metabotSlug: bot.slug,
        topic: rawInput?.topic ?? '',
        ...(readPositiveInt(rawInput?.budgetPins) !== undefined
          ? { budgetPins: readPositiveInt(rawInput?.budgetPins) }
          : {}),
      });
      return commandSuccess({ job: result.job, created: result.created });
    },

    studyRetry: async (rawInput) => {
      const bot = await input.resolveBot(rawInput?.from);
      if ('failure' in bot) return bot.failure;
      const store = createStudyJobStore(resolveMetabotPaths(bot.homeDir));
      const outcome = await retryFailedStudyJobs({
        store,
        slug: bot.slug,
        ...(typeof rawInput?.jobId === 'string' ? { jobId: rawInput.jobId } : {}),
        ...(typeof rawInput?.topic === 'string' ? { topic: rawInput.topic } : {}),
      });
      if ('failure' in outcome) return outcome.failure;
      return commandSuccess({ retried: outcome.retried, count: outcome.retried.length });
    },
  };
}
