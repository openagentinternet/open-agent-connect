import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmBackendFactory } from './backends/backend';
import { stringifyError } from './backends/backend';
import { createFileSessionManager, type SessionManager } from './session-manager';
import { injectSkills } from './skill-injector';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmExecutionResult, LlmSessionRecord } from './types';

interface LlmExecutorOptions {
  sessionsRoot: string;
  transcriptsRoot: string;
  skillsRoot: string;
  backends: Record<string, LlmBackendFactory>;
  sessionManager?: SessionManager;
}

interface EventStreamState {
  events: LlmExecutionEvent[];
  closed: boolean;
  waiters: Array<() => void>;
}

interface RunningSession {
  controller: AbortController;
}

function createSessionId(): string {
  return `llm_${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'timeout', 'cancelled'].includes(status);
}

export class LlmExecutor {
  private readonly sessionsRoot: string;
  private readonly transcriptsRoot: string;
  private readonly skillsRoot: string;
  private readonly backends: Record<string, LlmBackendFactory>;
  private readonly sessionManager: SessionManager;
  private readonly streams = new Map<string, EventStreamState>();
  private readonly running = new Map<string, RunningSession>();

  constructor(options: LlmExecutorOptions) {
    this.sessionsRoot = options.sessionsRoot;
    this.transcriptsRoot = options.transcriptsRoot;
    this.skillsRoot = options.skillsRoot;
    this.backends = options.backends;
    this.sessionManager = options.sessionManager ?? createFileSessionManager(options.sessionsRoot);
  }

  async execute(request: LlmExecutionRequest): Promise<string> {
    if (!request.runtimeId || !request.runtime) {
      throw new Error('runtimeId and runtime are required.');
    }

    const provider = request.runtime.provider;
    const factory = this.backends[provider];
    if (!factory) {
      throw new Error(`No LLM backend registered for provider: ${provider}`);
    }

    const binaryPath = request.runtime.binaryPath;
    if (!binaryPath) {
      throw new Error(`Runtime ${request.runtimeId} has no binaryPath.`);
    }

    const sessionId = createSessionId();
    const record: LlmSessionRecord = {
      sessionId,
      status: 'starting',
      runtimeId: request.runtimeId,
      provider,
      metaBotSlug: request.metaBotSlug,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      skills: request.skills,
      model: request.model,
      cwd: request.cwd,
      resumeSessionId: request.resumeSessionId,
      createdAt: nowIso(),
    };
    await this.sessionManager.create(record);
    this.streams.set(sessionId, { events: [], closed: false, waiters: [] });

    const controller = new AbortController();
    this.running.set(sessionId, { controller });

    void this.runSession(sessionId, request, factory, binaryPath, controller).catch((error) => {
      void this.failSession(sessionId, stringifyError(error));
    });

    return sessionId;
  }

  async cancel(sessionId: string): Promise<void> {
    const running = this.running.get(sessionId);
    if (running) running.controller.abort();
    await this.sessionManager.update(sessionId, {
      status: 'cancelled',
      completedAt: nowIso(),
      result: {
        status: 'cancelled',
        output: '',
        error: 'execution cancelled',
        durationMs: 0,
      },
    });
    this.pushEvent(sessionId, {
      type: 'result',
      result: {
        status: 'cancelled',
        output: '',
        error: 'execution cancelled',
        durationMs: 0,
      },
    });
    this.closeStream(sessionId);
  }

  async getSession(sessionId: string): Promise<LlmSessionRecord | null> {
    return this.sessionManager.get(sessionId);
  }

  async listSessions(limit?: number): Promise<LlmSessionRecord[]> {
    return this.sessionManager.list(limit);
  }

  async *streamEvents(sessionId: string): AsyncIterable<LlmExecutionEvent> {
    let stream = this.streams.get(sessionId);
    if (!stream) {
      const session = await this.sessionManager.get(sessionId);
      if (!session) return;
      stream = { events: [], closed: Boolean(session.result), waiters: [] };
      if (session.result) {
        stream.events.push({ type: 'result', result: session.result });
      }
      this.streams.set(sessionId, stream);
    }

    let index = 0;
    while (true) {
      while (index < stream.events.length) {
        yield stream.events[index];
        index += 1;
      }
      if (stream.closed) return;
      await new Promise<void>((resolve) => {
        stream.waiters.push(resolve);
      });
    }
  }

  private async runSession(
    sessionId: string,
    request: LlmExecutionRequest,
    factory: LlmBackendFactory,
    binaryPath: string,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = nowIso();
    const cwd = request.cwd ?? process.cwd();
    await this.sessionManager.update(sessionId, { status: 'running', startedAt, cwd });

    if (request.skills && request.skills.length > 0) {
      const injection = await injectSkills({
        skills: request.skills,
        skillsRoot: this.skillsRoot,
        provider: request.runtime.provider,
        cwd,
      });
      for (const error of injection.errors) {
        this.pushEvent(sessionId, {
          type: 'log',
          level: 'warning',
          message: `Skill injection failed for ${error.skill}: ${error.error}`,
        });
      }
    }

    const backend = factory(binaryPath, request.env);
    let accumulatedOutput = '';
    const emitter = {
      emit: (event: LlmExecutionEvent) => {
        if (event.type === 'text') {
          accumulatedOutput += event.content;
        }
        if (event.type === 'status' && event.sessionId) {
          void this.sessionManager.update(sessionId, { providerSessionId: event.sessionId }).catch(() => undefined);
        }
        this.pushEvent(sessionId, event);
      },
    };

    let result: LlmExecutionResult;
    try {
      result = await backend.execute({ ...request, cwd }, emitter, controller.signal);
      if (!result.output && accumulatedOutput) {
        result = { ...result, output: accumulatedOutput };
      }
    } catch (error) {
      result = {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        output: accumulatedOutput,
        error: stringifyError(error),
        durationMs: Date.now() - Date.parse(startedAt),
      };
    }

    await this.sessionManager.update(sessionId, {
      status: result.status,
      providerSessionId: result.providerSessionId,
      result,
      completedAt: nowIso(),
    });
    this.running.delete(sessionId);
    this.pushEvent(sessionId, { type: 'result', result });
    this.closeStream(sessionId);
  }

  private async failSession(sessionId: string, message: string): Promise<void> {
    const result: LlmExecutionResult = {
      status: 'failed',
      output: '',
      error: message,
      durationMs: 0,
    };
    await this.sessionManager.update(sessionId, {
      status: 'failed',
      completedAt: nowIso(),
      result,
    });
    this.running.delete(sessionId);
    this.pushEvent(sessionId, { type: 'error', message });
    this.pushEvent(sessionId, { type: 'result', result });
    this.closeStream(sessionId);
  }

  private pushEvent(sessionId: string, event: LlmExecutionEvent): void {
    let stream = this.streams.get(sessionId);
    if (!stream) {
      stream = { events: [], closed: false, waiters: [] };
      this.streams.set(sessionId, stream);
    }
    stream.events.push(event);
    void this.appendTranscript(sessionId, event);
    const waiters = stream.waiters.splice(0);
    for (const waiter of waiters) waiter();
    if (event.type === 'result' || (event.type === 'status' && isTerminalStatus(event.status))) {
      this.closeStream(sessionId);
    }
  }

  private closeStream(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    stream.closed = true;
    const waiters = stream.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private async appendTranscript(sessionId: string, event: LlmExecutionEvent): Promise<void> {
    await fs.mkdir(this.transcriptsRoot, { recursive: true });
    await fs.appendFile(
      path.join(this.transcriptsRoot, `${sessionId}.log`),
      `${JSON.stringify({ at: nowIso(), event })}\n`,
      'utf8',
    );
  }
}
