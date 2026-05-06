"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmExecutor = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const backend_1 = require("./backends/backend");
const session_manager_1 = require("./session-manager");
const skill_injector_1 = require("./skill-injector");
function createSessionId() {
    return `llm_${(0, node_crypto_1.randomUUID)()}`;
}
function nowIso() {
    return new Date().toISOString();
}
function isTerminalStatus(status) {
    return ['completed', 'failed', 'timeout', 'cancelled'].includes(status);
}
class LlmExecutor {
    sessionsRoot;
    transcriptsRoot;
    skillsRoot;
    backends;
    sessionManager;
    streams = new Map();
    running = new Map();
    constructor(options) {
        this.sessionsRoot = options.sessionsRoot;
        this.transcriptsRoot = options.transcriptsRoot;
        this.skillsRoot = options.skillsRoot;
        this.backends = options.backends;
        this.sessionManager = options.sessionManager ?? (0, session_manager_1.createFileSessionManager)(options.sessionsRoot);
    }
    async execute(request) {
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
        const record = {
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
            void this.failSession(sessionId, (0, backend_1.stringifyError)(error));
        });
        return sessionId;
    }
    async cancel(sessionId) {
        const session = await this.sessionManager.get(sessionId);
        if (!session) {
            throw new Error(`LLM session not found: ${sessionId}`);
        }
        if (isTerminalStatus(session.status) || session.result) {
            return;
        }
        const running = this.running.get(sessionId);
        if (running)
            running.controller.abort();
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
    async getSession(sessionId) {
        return this.sessionManager.get(sessionId);
    }
    async listSessions(limit, options) {
        return this.sessionManager.list(limit, options);
    }
    async *streamEvents(sessionId) {
        let stream = this.streams.get(sessionId);
        if (!stream) {
            const session = await this.sessionManager.get(sessionId);
            if (!session)
                return;
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
            if (stream.closed)
                return;
            await new Promise((resolve) => {
                stream.waiters.push(resolve);
            });
        }
    }
    async runSession(sessionId, request, factory, binaryPath, controller) {
        const startedAt = nowIso();
        const cwd = request.cwd ?? process.cwd();
        await this.sessionManager.update(sessionId, { status: 'running', startedAt, cwd });
        if (request.skills && request.skills.length > 0) {
            const injection = await (0, skill_injector_1.injectSkills)({
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
            emit: (event) => {
                if (event.type === 'text') {
                    accumulatedOutput += event.content;
                }
                if (event.type === 'status' && event.sessionId) {
                    void this.sessionManager.update(sessionId, { providerSessionId: event.sessionId }).catch(() => undefined);
                }
                this.pushEvent(sessionId, event);
            },
        };
        let result;
        try {
            result = await backend.execute({ ...request, cwd }, emitter, controller.signal);
            if (!result.output && accumulatedOutput) {
                result = { ...result, output: accumulatedOutput };
            }
        }
        catch (error) {
            result = {
                status: controller.signal.aborted ? 'cancelled' : 'failed',
                output: accumulatedOutput,
                error: (0, backend_1.stringifyError)(error),
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
    async failSession(sessionId, message) {
        const result = {
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
    pushEvent(sessionId, event) {
        let stream = this.streams.get(sessionId);
        if (!stream) {
            stream = { events: [], closed: false, waiters: [] };
            this.streams.set(sessionId, stream);
        }
        stream.events.push(event);
        void this.appendTranscript(sessionId, event);
        const waiters = stream.waiters.splice(0);
        for (const waiter of waiters)
            waiter();
        if (event.type === 'result' || (event.type === 'status' && isTerminalStatus(event.status))) {
            this.closeStream(sessionId);
        }
    }
    closeStream(sessionId) {
        const stream = this.streams.get(sessionId);
        if (!stream)
            return;
        stream.closed = true;
        const waiters = stream.waiters.splice(0);
        for (const waiter of waiters)
            waiter();
    }
    async appendTranscript(sessionId, event) {
        await node_fs_1.promises.mkdir(this.transcriptsRoot, { recursive: true });
        await node_fs_1.promises.appendFile(node_path_1.default.join(this.transcriptsRoot, `${sessionId}.log`), `${JSON.stringify({ at: nowIso(), event })}\n`, 'utf8');
    }
}
exports.LlmExecutor = LlmExecutor;
