"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateDreamMessageTokens = estimateDreamMessageTokens;
exports.estimateDreamActivityTokens = estimateDreamActivityTokens;
exports.chunkDreamActivity = chunkDreamActivity;
exports.chunkToActivity = chunkToActivity;
exports.summariesToActivity = summariesToActivity;
const memoryText_1 = require("./memoryText");
const MESSAGE_FRAME_TOKENS = 8;
const SESSION_FRAME_TOKENS = 32;
function estimateDreamMessageTokens(message) {
    return (0, memoryText_1.estimateTextTokens)(message.content) + MESSAGE_FRAME_TOKENS;
}
function groupChatsToSessions(chats) {
    return chats
        .filter((chat) => chat.messages.length > 0)
        .map((chat) => ({
        sessionId: `group-chat:${chat.taskId}`,
        title: `链上群聊:${chat.title}`,
        sessionType: 'group_chat',
        peerName: null,
        isOrder: false,
        messages: chat.messages.map((message) => ({
            type: 'user',
            content: `${message.senderName}: ${message.content}`,
            createdAt: message.occurredAt,
        })),
    }));
}
function estimateDreamActivityTokens(activity) {
    let tokens = 32 + (0, memoryText_1.estimateTextTokens)(activity.taskRuns.map((run) => `${run.taskName} ${run.status}`).join(' '));
    tokens += (0, memoryText_1.estimateTextTokens)((activity.groupTasks ?? [])
        .map((task) => `${task.title} ${task.goal} ${task.rating ?? ''} ${task.ratingComment ?? ''}`)
        .join(' '));
    for (const session of [...activity.sessions, ...groupChatsToSessions(activity.groupChats ?? [])]) {
        tokens += SESSION_FRAME_TOKENS + (0, memoryText_1.estimateTextTokens)(`${session.title} ${session.peerName ?? ''}`);
        for (const message of session.messages) {
            tokens += estimateDreamMessageTokens(message);
        }
    }
    // Chain content history lines render directly (summary or stored text as
    // the gist), so the estimate mirrors what buildDreamPrompt will emit.
    tokens += (0, memoryText_1.estimateTextTokens)((activity.chainWrites ?? [])
        .map((write) => `${write.pinId} ${write.path ?? ''} ${write.summary ?? write.contentText ?? ''}`)
        .join(' '));
    tokens += (0, memoryText_1.estimateTextTokens)((activity.chainReads ?? [])
        .map((read) => `${read.pinId} ${read.title ?? ''} ${read.path ?? ''} ${read.summary ?? read.contentExcerpt ?? ''}`)
        .join(' '));
    return tokens;
}
function splitContentByTokenBudget(content, maxTokens) {
    const chars = Array.from(content);
    if (chars.length === 0)
        return [''];
    const parts = [];
    let offset = 0;
    while (offset < chars.length) {
        let low = 1;
        let high = chars.length - offset;
        let best = 1;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = chars.slice(offset, offset + middle).join(' ');
            if ((0, memoryText_1.estimateTextTokens)(candidate) + MESSAGE_FRAME_TOKENS <= maxTokens) {
                best = middle;
                low = middle + 1;
            }
            else {
                high = middle - 1;
            }
        }
        parts.push(chars.slice(offset, offset + best).join(''));
        offset += best;
    }
    return parts;
}
function messageParts(message, maxTokens) {
    if (estimateDreamMessageTokens(message) <= maxTokens)
        return [message];
    return splitContentByTokenBudget(message.content, Math.max(64, maxTokens)).map((content) => ({
        ...message,
        content,
    }));
}
function chunkSession(session, maxInputTokens, taskRuns, orderCount, groupTasks) {
    const chunks = [];
    let current = [];
    let currentTokens = SESSION_FRAME_TOKENS + (0, memoryText_1.estimateTextTokens)(`${session.title} ${session.peerName ?? ''}`);
    const flush = () => {
        if (current.length === 0)
            return;
        const chunkIndex = chunks.length;
        chunks.push({
            fragmentKey: `session:${session.sessionId}:${chunkIndex}`,
            sessionId: session.sessionId,
            title: session.title,
            sessionType: session.sessionType,
            peerName: session.peerName,
            isOrder: session.isOrder,
            chunkIndex,
            messages: current,
            taskRuns: chunkIndex === 0 ? taskRuns : [],
            orderCount: chunkIndex === 0 ? orderCount : 0,
            groupTasks: chunkIndex === 0 ? groupTasks : [],
            sourceMessageCount: current.length,
            sourceCharCount: current.reduce((sum, message) => sum + message.content.length, 0),
            estimatedInputTokens: currentTokens,
        });
        current = [];
        currentTokens = SESSION_FRAME_TOKENS + (0, memoryText_1.estimateTextTokens)(`${session.title} ${session.peerName ?? ''}`);
    };
    for (const originalMessage of session.messages) {
        for (const message of messageParts(originalMessage, Math.max(64, maxInputTokens - currentTokens))) {
            const messageTokens = estimateDreamMessageTokens(message);
            if (current.length > 0 && currentTokens + messageTokens > maxInputTokens) {
                flush();
            }
            current.push(message);
            currentTokens += messageTokens;
            if (currentTokens >= maxInputTokens)
                flush();
        }
    }
    flush();
    return chunks;
}
/**
 * Split a day without dropping messages. A single oversized message is split
 * into continuation segments, so even pathological sessions remain resumable.
 */
function chunkDreamActivity(activity, maxInputTokens) {
    const budget = Math.max(256, Math.floor(maxInputTokens));
    const chunks = [];
    const sessions = [
        ...activity.sessions.filter((session) => session.messages.length > 0),
        ...groupChatsToSessions(activity.groupChats ?? []),
    ];
    const groupTasks = activity.groupTasks ?? [];
    for (const session of sessions) {
        const sessionChunks = chunkSession(session, budget, chunks.length === 0 ? activity.taskRuns : [], chunks.length === 0 ? activity.orderCount : 0, chunks.length === 0 ? groupTasks : []);
        chunks.push(...sessionChunks);
    }
    if (chunks.length === 0 && (activity.taskRuns.length > 0 || activity.orderCount > 0 || groupTasks.length > 0)) {
        chunks.push({
            fragmentKey: 'tasks:0',
            sessionId: '__dream_tasks__',
            title: '定时任务与服务订单',
            sessionType: 'dream_tasks',
            peerName: null,
            isOrder: false,
            chunkIndex: 0,
            messages: [],
            taskRuns: activity.taskRuns,
            orderCount: activity.orderCount,
            groupTasks,
            sourceMessageCount: 0,
            sourceCharCount: activity.taskRuns.reduce((sum, run) => sum + run.taskName.length, 0),
            estimatedInputTokens: 32 + (0, memoryText_1.estimateTextTokens)(activity.taskRuns.map((run) => run.taskName).join(' ')),
        });
    }
    else if (chunks.length > 0 && activity.taskRuns.length > 0 && chunks[0].taskRuns.length === 0) {
        chunks[0].taskRuns = activity.taskRuns;
        chunks[0].orderCount = activity.orderCount;
        chunks[0].groupTasks = groupTasks;
    }
    return chunks;
}
function chunkToActivity(chunk) {
    return {
        sessions: chunk.messages.length > 0
            ? [{
                    sessionId: chunk.sessionId,
                    title: chunk.title,
                    sessionType: chunk.sessionType,
                    peerName: chunk.peerName,
                    isOrder: chunk.isOrder,
                    messages: chunk.messages,
                }]
            : [],
        taskRuns: chunk.taskRuns,
        orderCount: chunk.orderCount,
        groupTasks: chunk.groupTasks ?? [],
    };
}
function summariesToActivity(summaries, taskRuns, orderCount, groupTasks = []) {
    return {
        sessions: summaries.map((summary) => ({
            sessionId: summary.fragmentKey,
            title: `分块摘要:${summary.title}#${summary.chunkIndex + 1}`,
            sessionType: 'dream_fragment',
            peerName: null,
            isOrder: false,
            messages: [{
                    type: 'assistant',
                    content: JSON.stringify({
                        fragment_key: summary.fragmentKey,
                        source_session_id: summary.sessionId,
                        source_session_title: summary.title,
                        chunk_index: summary.chunkIndex,
                        summary: summary.output,
                    }),
                    createdAt: 0,
                }],
        })),
        taskRuns,
        orderCount,
        groupTasks,
    };
}
