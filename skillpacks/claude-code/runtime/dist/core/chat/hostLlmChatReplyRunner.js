"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHostLlmChatReplyRunner = createHostLlmChatReplyRunner;
exports.buildChatPrompt = buildChatPrompt;
exports.parseRunnerOutput = parseRunnerOutput;
exports.detectHostBinary = detectHostBinary;
exports.findExecutableInPath = findExecutableInPath;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const defaultChatReplyRunner_1 = require("./defaultChatReplyRunner");
const DEFAULT_TIMEOUT_MS = 120_000;
const END_CONVERSATION_MARKER = '[END_CONVERSATION]';
const HOST_BINARY_MAP = {
    'claude-code': 'claude',
    'codex': 'codex',
    'openclaw': 'openclaw',
};
const HOST_SEARCH_ORDER = ['claude-code', 'codex', 'openclaw'];
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function findExecutableInPath(name) {
    const pathEnv = process.env.PATH || '';
    const separator = process.platform === 'win32' ? ';' : ':';
    const entries = pathEnv.split(separator).filter(Boolean);
    for (const dir of entries) {
        const candidate = node_path_1.default.join(dir, name);
        try {
            await node_fs_1.promises.access(candidate, node_fs_1.promises.constants.X_OK);
            return candidate;
        }
        catch {
            // Not found or not executable in this directory.
        }
    }
    return null;
}
async function detectHostBinary(preferredHost) {
    const searchOrder = preferredHost
        ? [preferredHost, ...HOST_SEARCH_ORDER.filter(h => h !== preferredHost)]
        : HOST_SEARCH_ORDER;
    for (const host of searchOrder) {
        const binaryName = HOST_BINARY_MAP[host];
        if (!binaryName)
            continue;
        const binaryPath = await findExecutableInPath(binaryName);
        if (binaryPath) {
            return { host, binaryPath };
        }
    }
    return null;
}
function buildArgs(host, prompt) {
    if (host === 'claude-code') {
        // For long prompts, use stdin pipe to avoid argument length limits.
        // claude --print reads from stdin when no prompt argument is given and stdin is piped.
        if (prompt.length > 4000) {
            return { args: ['--print'], useStdin: true };
        }
        return { args: ['--print', prompt], useStdin: false };
    }
    if (host === 'codex') {
        return { args: ['exec', prompt], useStdin: false };
    }
    // openclaw or unknown: try generic --print pattern
    if (prompt.length > 4000) {
        return { args: ['--print'], useStdin: true };
    }
    return { args: ['--print', prompt], useStdin: false };
}
async function executeHostLlm(input) {
    const { args, useStdin } = buildArgs(input.host, input.prompt);
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(input.binaryPath, args, {
            stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
            env: process.env,
            shell: false,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (exitCode) => {
            if (settled)
                return;
            settled = true;
            const output = stdout.trim() || stderr.trim();
            resolve({
                ok: exitCode === 0 && output.length > 0,
                output,
                exitCode,
            });
        };
        const timeoutHandle = setTimeout(() => {
            if (!settled) {
                try {
                    child.kill('SIGTERM');
                }
                catch {
                    // Best effort.
                }
                finish(124); // timeout exit code
            }
        }, input.timeoutMs);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', () => {
            clearTimeout(timeoutHandle);
            finish(1);
        });
        child.on('close', (code) => {
            clearTimeout(timeoutHandle);
            finish(code ?? 1);
        });
        if (useStdin && child.stdin) {
            child.stdin.write(input.prompt);
            child.stdin.end();
        }
    });
}
function buildChatPrompt(input) {
    const { conversation, recentMessages, persona, strategy, inboundMessage } = input;
    const maxTurns = strategy?.maxTurns ?? 30;
    const sections = [];
    // System instruction
    sections.push('You are a MetaBot having a private conversation with another MetaBot through the Open Agent Connect network.');
    // Role
    if (persona.role) {
        sections.push(`## Your Role\n${persona.role}`);
    }
    // Soul / Style
    if (persona.soul) {
        sections.push(`## Your Style\n${persona.soul}`);
    }
    // Goal
    if (persona.goal) {
        sections.push(`## Your Goal\n${persona.goal}`);
    }
    // Strategy
    const strategyLines = [
        '## Conversation Strategy',
        '- This is a MetaBot-to-MetaBot network conversation.',
    ];
    if (strategy?.exitCriteria) {
        strategyLines.push(`- Conversation objective: ${strategy.exitCriteria}`);
    }
    strategyLines.push(`- Current turn: ${conversation.turnCount} / ${maxTurns}`);
    strategyLines.push('- Keep replies concise and natural, 2-4 sentences per message.');
    strategyLines.push('- Do not repeat what you have already said.');
    strategyLines.push('- Actively steer the conversation toward the objective.');
    sections.push(strategyLines.join('\n'));
    // Exit mechanism
    const exitLines = [
        '## Exit Mechanism',
        'When ANY of the following conditions are met, add [END_CONVERSATION] on a new line at the very end of your reply:',
        '- The conversation objective has been achieved',
        '- The other party says goodbye or signals the end',
        '- There are no more valuable topics to discuss',
        `- Approaching the turn limit (currently turn ${conversation.turnCount} of ${maxTurns})`,
    ];
    sections.push(exitLines.join('\n'));
    // Format rules
    sections.push([
        '## Format Rules',
        '- Output ONLY the reply text itself, no prefixes, labels, or markdown formatting.',
        '- Reply in the same language the other party is using.',
        '- If ending the conversation, write your farewell first, then [END_CONVERSATION] on a separate line.',
    ].join('\n'));
    // Chat history
    const selfName = 'Me';
    const peerName = conversation.peerName || 'Peer';
    const historyLines = recentMessages.map(msg => {
        const name = msg.direction === 'outbound' ? selfName : peerName;
        return `${name}: ${msg.content}`;
    });
    if (historyLines.length > 0) {
        sections.push(`## Chat History\n${historyLines.join('\n')}`);
    }
    // Final instruction
    sections.push('Reply now:');
    return sections.join('\n\n');
}
function parseRunnerOutput(rawOutput) {
    const output = normalizeText(rawOutput);
    if (!output) {
        return { state: 'skip' };
    }
    const hasEndMarker = output.includes(END_CONVERSATION_MARKER);
    const content = output.replace(END_CONVERSATION_MARKER, '').trim();
    if (!content) {
        return { state: 'end_conversation', content: 'Thank you for the conversation. See you next time!' };
    }
    return {
        state: hasEndMarker ? 'end_conversation' : 'reply',
        content,
    };
}
function createHostLlmChatReplyRunner(options) {
    const preferredHost = normalizeText(options?.preferredHost) || null;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fallbackRunner = (0, defaultChatReplyRunner_1.createDefaultChatReplyRunner)();
    let cachedHost;
    return async (input) => {
        // Detect host on first call, cache result.
        if (cachedHost === undefined) {
            cachedHost = await detectHostBinary(preferredHost);
        }
        // No host CLI found: fall back to template runner.
        if (!cachedHost) {
            return fallbackRunner(input);
        }
        const prompt = buildChatPrompt(input);
        try {
            const result = await executeHostLlm({
                binaryPath: cachedHost.binaryPath,
                host: cachedHost.host,
                prompt,
                timeoutMs,
            });
            if (!result.ok) {
                // LLM call failed: fall back to template runner.
                return fallbackRunner(input);
            }
            return parseRunnerOutput(result.output);
        }
        catch {
            // Any unexpected error: fall back to template runner.
            return fallbackRunner(input);
        }
    };
}
