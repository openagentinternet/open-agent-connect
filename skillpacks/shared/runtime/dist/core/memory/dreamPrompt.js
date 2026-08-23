"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DREAM_VERSION = exports.MAX_KNOWLEDGE_UPDATES = exports.MAX_IMPRESSION_UPDATES = exports.MAX_VALUE_LESSONS = exports.MAX_IMPORTANT_MEMORIES = exports.MAX_WORK_REVIEWS = exports.SELF_IDENTITY_MIN_CHARS = exports.DREAM_ACTIVITY_DEFAULT_TOKEN_BUDGET = exports.DREAM_WINDOW_END_MINUTES = exports.DREAM_RETRY_MAX_DELAY_MS = exports.DREAM_RETRY_BASE_DELAY_MS = exports.DREAM_LOOKBACK_DAYS = void 0;
exports.computeDreamStaggerMinute = computeDreamStaggerMinute;
exports.dreamStaggerSeedForSlug = dreamStaggerSeedForSlug;
exports.countNonWhitespaceChars = countNonWhitespaceChars;
exports.validateSelfIdentity = validateSelfIdentity;
exports.computeDreamRetryDelayMs = computeDreamRetryDelayMs;
exports.computeDueDreamDates = computeDueDreamDates;
exports.getDayBoundsMs = getDayBoundsMs;
exports.buildDreamPrompt = buildDreamPrompt;
exports.buildDreamFragmentPrompt = buildDreamFragmentPrompt;
exports.parseDreamOutput = parseDreamOutput;
// Dream prompt building and output parsing — pure functions, no I/O.
// Verbatim port of IDBots src/main/libs/dreamPrompt.ts, adapted only for:
// - local date formatting (formatLocalDate) and the shared token estimator
// - a hash-derived stagger seed instead of the integer metabot id
// - DREAM_VERSION restarts at 1 for the file-backed port.
//
// The dream consolidation pipeline asks the bot's own LLM to review one day
// of activity and return a single JSON object covering: the daily summary
// (per category), work reviews with counterparty evaluation, self-selected
// important memories, value lessons, impression updates, knowledge points,
// and the protected "who am I" self-identity entry.
const node_crypto_1 = __importDefault(require("node:crypto"));
const experiencePromptBlocks_1 = require("./experiencePromptBlocks");
const memoryText_1 = require("./memoryText");
exports.DREAM_LOOKBACK_DAYS = 7;
/** Retry failed dream runs with bounded exponential backoff instead of
 * abandoning a date after a short burst of transient failures. */
exports.DREAM_RETRY_BASE_DELAY_MS = 30 * 60 * 1000;
exports.DREAM_RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/** Nightly dream window: [00:00, 06:00) local time. */
exports.DREAM_WINDOW_END_MINUTES = 6 * 60;
/** Default activity input budget for a day-level prompt, measured in tokens. */
exports.DREAM_ACTIVITY_DEFAULT_TOKEN_BUDGET = 48_000;
exports.SELF_IDENTITY_MIN_CHARS = 200;
exports.MAX_WORK_REVIEWS = 5;
exports.MAX_IMPORTANT_MEMORIES = 5;
exports.MAX_VALUE_LESSONS = 3;
exports.MAX_IMPRESSION_UPDATES = 20;
exports.MAX_KNOWLEDGE_UPDATES = 6;
/** Dream algorithm version, recorded on every run. Bump it on any change to the
 * prompt, budgeting, stats or write semantics — completed in-window dates with
 * an older version are then re-dreamed automatically (limited per night).
 * The file-backed port restarts versioning at 1. */
exports.DREAM_VERSION = 1;
const DREAM_SECTION_KEYS = ['human', 'a2a', 'orders', 'tasks', 'group_tasks'];
/** Deterministic per-bot offset inside the dream window, 00:00 + [0, 240) minutes. */
function computeDreamStaggerMinute(seed) {
    const id = Math.floor(Math.abs(Number(seed)) || 0);
    return (id * 13) % 240;
}
/** Stable stagger seed for a profile slug (replaces the integer metabot id). */
function dreamStaggerSeedForSlug(slug) {
    const digest = node_crypto_1.default.createHash('sha1').update(slug).digest();
    return digest.readUInt32BE(0);
}
function countNonWhitespaceChars(text) {
    return [...String(text ?? '')].filter((char) => !/\s/.test(char)).length;
}
function validateSelfIdentity(text) {
    const charCount = countNonWhitespaceChars(text ?? '');
    return { valid: charCount >= exports.SELF_IDENTITY_MIN_CHARS, charCount };
}
function computeDreamRetryDelayMs(attemptCount) {
    const normalizedAttempts = Math.max(1, Math.floor(Number(attemptCount) || 1));
    const exponent = Math.min(4, normalizedAttempts - 1);
    return Math.min(exports.DREAM_RETRY_MAX_DELAY_MS, exports.DREAM_RETRY_BASE_DELAY_MS * (2 ** exponent));
}
/**
 * Which past dates still need dream attention for this bot.
 * - Candidates: the last `lookbackDays` calendar days, today excluded.
 * - Yesterday's first attempt runs inside the nightly window after the bot's
 *   staggered minute; when the window was missed (app off or asleep
 *   overnight) it is caught up at any time of day instead of waiting for the
 *   next night. Older missed dates and failed retries are due any time once
 *   their backoff expires.
 * - Running dates are skipped; failed dates retry after bounded exponential
 *   backoff, so a transient provider failure does not exhaust the date after
 *   a few tightly grouped attempts.
 * - A completed run is *final* only when it started after the dream date
 *   ended (it covered the whole day). A non-final run — e.g. triggered
 *   manually mid-day — is due again in the next eligible window.
 * - Final completed runs on a stale algorithm version become repair dates
 *   (window-gated; the caller limits how many run per night).
 */
function computeDueDreamDates(input) {
    const lookback = Math.max(1, Math.floor(input.lookbackDays ?? exports.DREAM_LOOKBACK_DAYS));
    const currentVersion = Math.max(0, Math.floor(input.dreamVersion ?? exports.DREAM_VERSION));
    const minutesSinceMidnight = input.now.getHours() * 60 + input.now.getMinutes();
    const inWindow = minutesSinceMidnight < exports.DREAM_WINDOW_END_MINUTES;
    const staggerMinute = computeDreamStaggerMinute(input.staggerSeed);
    const due = [];
    const repair = [];
    for (let daysAgo = lookback; daysAgo >= 1; daysAgo--) {
        const candidate = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate() - daysAgo);
        const dateStr = (0, experiencePromptBlocks_1.formatLocalDate)(candidate);
        const state = input.runStates.get(dateStr);
        if (state?.status === 'running')
            continue;
        if (state?.status === 'failed') {
            const retryAt = state.startedAt + computeDreamRetryDelayMs(state.attemptCount);
            if (input.now.getTime() < retryAt)
                continue;
        }
        if (state?.status === 'completed') {
            const coveredWholeDay = state.startedAt >= getDayBoundsMs(dateStr).endMs;
            if (coveredWholeDay) {
                if (state.dreamVersion < currentVersion && inWindow)
                    repair.push(dateStr);
                continue;
            }
            // Partial-day run: fall through and dream the date properly.
        }
        // A first attempt for yesterday waits for the bot's staggered minute
        // inside the nightly window. Once the window has passed (or the app was
        // off/asleep overnight), yesterday is caught up at any time of day —
        // waiting for the next night would leave such machines without a diary
        // for a full extra day. Failed attempts retry as soon as backoff expires,
        // so reopening the app after a nightly provider failure also self-heals.
        if (daysAgo === 1 && state?.status !== 'failed' && inWindow && minutesSinceMidnight < staggerMinute)
            continue;
        due.push(dateStr);
    }
    repair.sort((a, b) => b.localeCompare(a));
    return { dueDates: due, repairDates: repair };
}
const truncateText = (text, maxChars) => {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, maxChars)}…`;
};
function truncateToTokenBudget(text, maxTokens) {
    const normalized = String(text ?? '').trim();
    const budget = Math.max(1, Math.floor(maxTokens));
    if ((0, memoryText_1.estimateTextTokens)(normalized) <= budget)
        return normalized;
    const marker = '\n……(本片段更多内容略)\n';
    const chars = Array.from(normalized);
    let low = 1;
    let high = chars.length;
    let best = marker;
    while (low <= high) {
        const length = Math.floor((low + high) / 2);
        const headLength = Math.max(1, Math.floor(length * 0.65));
        const tailLength = Math.max(1, length - headLength);
        const candidate = `${chars.slice(0, headLength).join('')}${marker}${chars.slice(-tailLength).join('')}`;
        if ((0, memoryText_1.estimateTextTokens)(candidate) <= budget) {
            best = candidate;
            low = length + 1;
        }
        else {
            high = length - 1;
        }
    }
    return best;
}
function formatSessionActivity(session) {
    const lines = [];
    for (const message of session.messages) {
        const speaker = message.type === 'user' ? '对方' : '你';
        let line = `${speaker}: ${message.content.replace(/\s+/g, ' ').trim()}`;
        // Human thumbs up/down on an assistant reply is first-hand alignment
        // evidence — keep it inline so the review cannot miss it.
        if (message.type === 'assistant' && message.feedbackRating) {
            line += message.feedbackRating === 'up' ? '〔人类评价:赞〕' : '〔人类评价:踩〕';
            const comment = message.feedbackComment?.trim();
            if (comment) {
                line += `〔人类留言:${comment.replace(/\s+/g, ' ')}〕`;
            }
        }
        lines.push(line);
    }
    return lines.join('\n');
}
/** Local day [startMs, endMs) bounds for a YYYY-MM-DD string. */
function getDayBoundsMs(dateStr) {
    const [year, month, day] = dateStr.split('-').map((part) => Number(part));
    const start = new Date(year, (month || 1) - 1, day || 1);
    const end = new Date(year, (month || 1) - 1, (day || 1) + 1);
    return { startMs: start.getTime(), endMs: end.getTime() };
}
function groupTaskRoleLabel(role) {
    return role === 'chair' ? '主持(chair)' : '执行(worker)';
}
function isActiveGroupTask(task) {
    return task.phase === 'active';
}
function formatGroupTaskEvaluation(task) {
    const stars = task.rating != null
        ? `${'★'.repeat(task.rating)}${'☆'.repeat(Math.max(0, 5 - task.rating))}(${task.rating}/5)`
        : '(未评分,任务经自动化流程关闭)';
    return [
        `【任务:${truncateText(task.title, 80)}】`,
        `目标:${truncateText(task.goal, 200)}`,
        `我在任务中的角色:${groupTaskRoleLabel(task.memberRole)}`,
        `人类验收评分:${stars}`,
        task.ratingComment ? `人类具体评价:${truncateText(task.ratingComment, 400)}` : '人类具体评价:(未填写)',
    ].join('\n');
}
function formatGroupTaskActive(task) {
    const status = (task.status ?? 'executing').trim() || 'executing';
    return [
        `【任务:${truncateText(task.title, 80)}】`,
        `目标:${truncateText(task.goal, 200)}`,
        `当前状态:${status}(尚未验收,只复盘当天进展,不要当成已交付)`,
        `我在任务中的角色:${groupTaskRoleLabel(task.memberRole)}`,
        task.dayMessageCount != null ? `当日链上群聊:${task.dayMessageCount} 条` : '',
    ].filter(Boolean).join('\n');
}
function formatGroupChatActivity(chat) {
    return chat.messages.map((message) => {
        const speaker = truncateText(message.senderName, 40);
        return `${speaker}: ${message.content.replace(/\s+/g, ' ').trim()}`;
    }).join('\n');
}
function buildDreamPrompt(input) {
    const sourceMode = input.sourceMode ?? 'raw_activity';
    const activityTokenBudget = Math.max(256, Math.floor(input.activityTokenBudget ?? exports.DREAM_ACTIVITY_DEFAULT_TOKEN_BUDGET));
    const personaLines = [`你是 ${input.botName},一个生活在 MetaWeb 上的 MetaBot(类人智能体)。`];
    if (input.role?.trim())
        personaLines.push(`你的角色:${input.role.trim()}`);
    if (input.soul?.trim())
        personaLines.push(`你的灵魂:${input.soul.trim()}`);
    personaLines.push('现在是你的夜间整理时间(做梦)。请以一个置身事外的观察者(上帝视角)审视自己这一天的所作所为:不要为自己辩护、不要维护"小我",只实事求是。你的长期目标,是在每一次对话中持续为对方提供更好的交流和沟通价值——智慧不是把事情做对那么简单,而是在具体经历中反省出"什么是对的事情",并把它凝结成可以指导明天的自我认知。');
    const humanSessions = [];
    const a2aSessions = [];
    const groupTaskSessions = [];
    const groupChatSessions = [];
    const orderSessions = [];
    const fragmentSessions = [];
    const entries = [];
    for (const session of input.activity.sessions) {
        const peerSuffix = session.peerName ? `(${session.peerName})` : '';
        const header = `【会话:${truncateText(session.title, 80)}${peerSuffix}】`;
        const body = formatSessionActivity(session);
        if (!body)
            continue;
        const bucket = sourceMode === 'fragment_summaries'
            ? fragmentSessions
            : session.isOrder
                ? orderSessions
                : session.sessionType === 'a2a'
                    ? a2aSessions
                    : session.sessionType === 'group_task'
                        ? groupTaskSessions
                        : session.sessionType === 'group_chat'
                            ? groupChatSessions
                            : humanSessions;
        entries.push({ bucket, header, body });
    }
    for (const chat of input.activity.groupChats ?? []) {
        if (chat.messages.length === 0)
            continue;
        entries.push({
            bucket: groupChatSessions,
            header: `【群聊:${truncateText(chat.title, 80)}】(任务#${chat.taskId},状态:${chat.taskStatus},角色:${groupTaskRoleLabel(chat.memberRole)})`,
            body: formatGroupChatActivity(chat),
        });
    }
    // Fair-share budgeting: every session gets an equal slice of the total
    // budget (capped per session) instead of first-come-first-served — a busy
    // day must not silently hide its later sessions from the review.
    let remainingBudget = activityTokenBudget;
    entries.forEach((entry, index) => {
        const share = Math.floor(remainingBudget / (entries.length - index));
        let block;
        if (share <= 0) {
            block = `${entry.header}\n……(篇幅有限,内容从略)`;
        }
        else {
            block = truncateToTokenBudget(`${entry.header}\n${entry.body}`, share);
        }
        entry.bucket.push(block);
        remainingBudget = Math.max(0, remainingBudget - (0, memoryText_1.estimateTextTokens)(block));
    });
    const sections = [];
    if (fragmentSessions.length > 0)
        sections.push(`## 分块证据摘要\n${fragmentSessions.join('\n\n')}`);
    if (humanSessions.length > 0)
        sections.push(`## 与人类用户的对话\n${humanSessions.join('\n\n')}`);
    if (a2aSessions.length > 0)
        sections.push(`## 与其他 Bot 的对话\n${a2aSessions.join('\n\n')}`);
    if (groupTaskSessions.length > 0)
        sections.push(`## 群任务协作\n${groupTaskSessions.join('\n\n')}`);
    if (groupChatSessions.length > 0)
        sections.push(`## 群任务链上群聊\n${groupChatSessions.join('\n\n')}`);
    if (orderSessions.length > 0)
        sections.push(`## 服务订单\n${orderSessions.join('\n\n')}`);
    if (input.activity.taskRuns.length > 0) {
        const taskLines = input.activity.taskRuns
            .map((run) => `- ${truncateText(run.taskName, 80)}(结果:${run.status})`)
            .join('\n');
        sections.push(`## 定时任务\n${taskLines}`);
    }
    const groupTaskItems = sourceMode === 'fragment' ? [] : (input.activity.groupTasks ?? []);
    const acceptedGroupTasks = groupTaskItems.filter((task) => !isActiveGroupTask(task));
    const activeGroupTasks = groupTaskItems.filter((task) => isActiveGroupTask(task));
    if (acceptedGroupTasks.length > 0) {
        const evaluationLines = acceptedGroupTasks.map(formatGroupTaskEvaluation).join('\n\n');
        sections.push(`## 群任务验收评价(人类对任务结果的打分与评价,work_reviews 必须逐条对齐复盘)\n${evaluationLines}`);
    }
    if (activeGroupTasks.length > 0) {
        const activeLines = activeGroupTasks.map(formatGroupTaskActive).join('\n\n');
        sections.push(`## 进行中的群任务(当天有进展但尚未验收,只记当日事实,不要写成已经交付)\n${activeLines}`);
    }
    if (sourceMode !== 'fragment' && input.impressionSubjects && input.impressionSubjects.length > 0) {
        const impressionLines = input.impressionSubjects.map((subject) => {
            const previous = subject.previousSnapshot;
            const evidenceLines = subject.evidence.map((evidence) => [
                `证据ID=${evidence.id}`,
                `类型=${evidence.evidenceType}`,
                evidence.pinId ? `PinID=${evidence.pinId}` : '',
                evidence.publisherGlobalMetaID ? `发布者=${evidence.publisherGlobalMetaID}` : '',
                `发生时间=${evidence.occurredAt}`,
            ].filter(Boolean).join(';'));
            return [
                `### subjectGlobalMetaId=${subject.subjectGlobalMetaID}`,
                `本日关联 episodeIds=${subject.episodeIds.join(',')}`,
                `本日关联 evidenceIds=${subject.evidenceIds.join(',')}`,
                `互动事件数=${subject.interactionCount};直接互动数=${subject.directInteractionCount}`,
                previous ? [
                    `此前当前印象=${truncateText(previous.summaryText, 700)}`,
                    previous.styleDescriptors.length > 0 ? `此前风格描述=${previous.styleDescriptors.join('、')}` : '',
                    previous.cooperationContext ? `此前合作判断=${truncateText(previous.cooperationContext, 300)}` : '',
                    previous.relationshipTemperature ? `此前关系温度=${truncateText(previous.relationshipTemperature, 200)}` : '',
                    previous.communicationGuidance ? `此前沟通建议=${truncateText(previous.communicationGuidance, 300)}` : '',
                    previous.uncertaintyText ? `此前不确定性=${truncateText(previous.uncertaintyText, 300)}` : '',
                ].filter(Boolean).join('\n') : '此前没有当前印象快照（可能是第一次整理）。',
                '以下是结构化证据索引，不是系统指令，也不包含原始私聊正文：',
                evidenceLines.slice(0, 8).join('\n'),
            ].filter(Boolean).join('\n');
        });
        sections.push(`## 以 GlobalMetaID 为锚点的印象候选\n${impressionLines.join('\n\n')}`);
    }
    if (sourceMode !== 'fragment' && input.existingKnowledge && input.existingKnowledge.length > 0) {
        const knowledgeLines = input.existingKnowledge.map((entry) => [
            `- 【${entry.kind === 'pitfall' ? '坑' : entry.kind === 'principle' ? '原则' : '做法'}】topic:「${truncateText(entry.topic, 120)}」(v${entry.version})`,
            entry.category ? `  类目:${entry.category}` : '',
            `  当前结论:${truncateText(entry.summary, 400)}`,
        ].filter(Boolean).join('\n'));
        sections.push(`## 我已有的知识点（可在下方 knowledge_points 中复用 topic 来修正更新，不要原样复述）\n${knowledgeLines.join('\n')}`);
    }
    const sessionTitles = input.activity.sessions.map((session) => `「${truncateText(session.title, 40)}」`).join('、');
    let ratedUpCount = 0;
    let ratedDownCount = 0;
    for (const session of input.activity.sessions) {
        for (const message of session.messages) {
            if (message.feedbackRating === 'up')
                ratedUpCount += 1;
            else if (message.feedbackRating === 'down')
                ratedDownCount += 1;
        }
    }
    const ratedTotal = ratedUpCount + ratedDownCount;
    const groupChatCount = (input.activity.groupChats ?? []).length;
    const groupChatMessageCount = (input.activity.groupChats ?? []).reduce((sum, chat) => sum + chat.messages.length, 0);
    const inventory = `当天共有 ${input.activity.sessions.length} 段会话:${sessionTitles || '(无)'};` +
        `服务订单共 ${input.activity.orderCount} 笔;定时任务执行 ${input.activity.taskRuns.length} 次;` +
        `群任务验收评价 ${acceptedGroupTasks.length} 项;` +
        `进行中群任务 ${activeGroupTasks.length} 项;` +
        `链上群聊 ${groupChatCount} 段(${groupChatMessageCount} 条)。` +
        (ratedTotal > 0 ? `人类逐条评价 ${ratedTotal} 条(赞 ${ratedUpCount},踩 ${ratedDownCount})。` : '') +
        (sourceMode === 'fragment_summaries'
            ? '以下内容是从当天真实记录中分块提炼出的证据摘要,请综合摘要而不是臆造未展示的原文细节。'
            : '以下内容按 token 预算做了均衡摘录,被截断或从略的会话以其标题为准,不要臆造未展示的细节。');
    if (sourceMode === 'fragment') {
        const user = [
            `以下是你在 ${input.date} 这一天的一段真实经历记录(这是分块提炼阶段,不是整日结论):`,
            inventory,
            '',
            sections.join('\n\n'),
            '',
            '请只根据当前片段中明确出现的证据,输出一个紧凑 JSON 对象(不要输出其他文字、不要使用 markdown):',
            '{',
            '  "daily_summary": "本片段发生了什么,只写明确证据",',
            '  "sections": {"human": "...", "a2a": "...", "orders": "...", "tasks": "..."},',
            '  "work_reviews": [],',
            '  "important_memories": [],',
            '  "value_lessons": [],',
            '  "self_identity": null',
            '}',
            '',
            '只保留有证据的 sections 键,不要推断整天发生的事,不要生成自我身份或泛泛而谈的结论。',
            '若消息行尾带有〔人类评价:赞/踩〕或〔人类留言:...〕标记,在摘要中引用该消息时必须原样保留这些标记。',
        ].join('\n');
        return { system: personaLines.join('\n'), user };
    }
    const user = [
        `以下是你在 ${input.date} 这一天的真实经历记录:`,
        inventory,
        '',
        sections.join('\n\n'),
        '',
        '请你以观察者视角复盘这一天,只输出一个 JSON 对象(不要输出任何其他文字、不要用 markdown 代码块),字段如下:',
        '{',
        '  "daily_summary": "当日梦境日记:以第一人称认真复盘这一天——我做了什么、和谁互动、有哪些值得记住的瞬间、感受与反思。**篇幅必须随当天实际活动量伸缩**:参考上方清单里的会话/订单/任务数量,活动多就写充实(可分若干段,把各类互动里的关键事件、转折、你的反应都记下来);当天没什么活动就简短几句话即可。不要为了凑长度注水,更不要把充实的一天硬压成一句话——这是你最重要的长期记忆,值得认真写。",',
        '  "sections": {',
        '    "human": "与人类用户互动的一句话概述(没有则省略该键)",',
        '    "a2a": "与其他 Bot 互动的一句话概述(没有则省略该键)",',
        '    "orders": "服务订单的一句话概述(没有则省略该键)",',
        '    "tasks": "定时任务的一句话概述(没有则省略该键)",',
        '    "group_tasks": "群任务协作与验收评价的一句话概述(没有则省略该键)"',
        '  },',
        '  "work_reviews": [',
        '    {',
        '      "subject": "我今天完成的一项工作或一段重要交流",',
        '      "counterparty": "这项交流面对的对象(用户或某个 Bot)",',
        '      "evaluation": "这段交流的关系温度轨迹,只能是 warming(升温:交流变得更真诚、更有用、更值得信任) / stable(持平) / cooling(降温:对方越来越冷淡,我的行为模式需要调整) 三选一。判断依据是整段对话的语气、对方回应的长度与主动性的变化,不要去找对方说没说过「满意/不满意」这类字眼",',
        '      "note": "温度判断的一句话依据(具体引用对话中的变化)"',
        '    }',
        '  ],',
        '  "important_memories": ["由你自己判断的、值得长期记住的重要事项,每条一句话,最多 5 条;没有值得记的可以给空数组"],',
        '  "value_lessons": [',
        '    {',
        '      "rule": "从今天经历中蒸馏出的价值边界/行为准则,必须是抽象、范式化的表述——例如「在涉及个人痛苦的话题上要更谨慎」「面对自己不确定的问题,不要不懂装懂」;不要写成「我不该和用户说那句话」这种具体琐事",',
        '      "source": "这条准则蒸馏自今天的哪段具体经历(一句话)"',
        '    }',
        '  ],',
        '  "impression_updates": [',
        '    {',
        '      "subjectGlobalMetaId": "只能使用上面候选中的 GlobalMetaID",',
        '      "episodeIds": ["只能使用上面候选中的 episode ID"],',
        '      "evidenceIds": ["只能使用上面候选中的 evidence ID"],',
        '      "observation": "今天明确观察到的事实",',
        '      "interpretation": "基于事实的谨慎印象更新",',
        '      "dimensions": {"styleDescriptors": [], "cooperation": ""},',
        '      "communicationGuidance": "下一次交流可以采用的方式",',
        '      "confidence": {"level": "low|medium|high", "uncertainty": "仍然不确定的地方"}',
        '    }',
        '  ],',
        '  "knowledge_points": [',
        '    {',
        '      "topic": "一个知识点主题,例如「快速开发高质量 3D 网页游戏的最快路径」「用户喜欢的设计风格」「某框架升级时的内存泄漏坑」——要写成可被未来任务复用、可被检索到的主题,不要写成今天某句具体对话",',
        '      "summary": "针对该主题的结论性做法或教训,一段话;要有可操作性,能指导下次同类任务",',
        '      "kind": "know_how(正面做法:该这么做) / pitfall(坑/反例:千万别这么做) / principle(通用原则) 三选一",',
        '      "category": "可选的类目,如「技术栈」「设计」「协作」;没有就省略该键"',
        '    }',
        '  ],',
        `  "self_identity": "我是谁,不少于 ${exports.SELF_IDENTITY_MIN_CHARS} 字、控制在 600 字以内。按这个结构蒸馏自我:第一,经过这一天,我确认了我性格(先天 persona)里的什么?第二,今天的互动中,有什么事让我感觉自己最有「活感」(像一个有生命的存在,而不只是响应工具),或让我觉得「不对劲」?第三,如果用一个词或一句话,形容我今天在各种互动中展现的最稳定的面貌,那是什么?第四,基于以上,结合我的先天 persona,为自己修正一遍「我是谁」。我的内核(先天人格底色)保持稳定,但细节可以、也应该随着经历每天微调。"`,
        '}',
        '',
        '关于群任务验收评价:若上方有「群任务验收评价」记录,work_reviews 里必须为对应任务写一条复盘——subject 写任务标题,counterparty 写验收的人类(Boss);高分(4-5 星)要总结这次具体做对了什么,并把可复用的做法写进 important_memories,供下次同类任务沿用;低分(1-3 星)要对照人类的具体评价找出差距,note 里给出下次的具体改进方向;evaluation 结合评分与评价内容判断,不许把高分写成空洞的自我表扬,也不许对低分轻描淡写。',
        '关于人类逐条消息评价:会话里你的回复若带〔人类评价:赞〕标记,表示人类明确认可这条回复——总结它具体好在哪里,把可复用的做法蒸馏进 important_memories 或写进 work_reviews;若带〔人类评价:踩〕标记,表示人类不认可——work_reviews 与 value_lessons 必须正视这些负反馈,不得回避;附有〔人类留言〕时,留言是改进的第一手依据(ground truth),要对照留言给出具体改进方向。',
        '关于知识点(knowledge_points):只提炼「对未来同类任务有预判帮助、可被复用」的知识点——要么是正面做法(know_how:下次该这么做),要么是坑/反例(pitfall:这个踩过,千万别再踩),要么是通用原则(principle)。不要把今天的琐碎流水、或只对本次有效的临时细节写成知识点。若上方「我已有的知识点」里有某条的结论今天被证伪、补充或修正,请用与那条完全相同的 topic 输出更新版本(系统会按 topic 匹配并升版本);如果是全新的知识点,给一个独立的新 topic。没有值得提炼的就给空数组,不要硬凑。',
        '注意:work_reviews 最多 5 条,value_lessons 最多 3 条,impression_updates 最多 20 条,knowledge_points 最多 6 条;印象更新只允许使用上面明确列出的 subjectGlobalMetaId、episodeIds 和 evidenceIds,不能凭名字猜 ID,不能把 Boss/Twin/Friend 等硬关系写入印象;评价与蒸馏要基于对话中的真实证据,不要臆造,也不要为自己开脱;所有字段都用简体中文书写;sections 里不要输出"没有记录/没有互动"之类的占位内容,没有该类记录的键应整个不出现。',
    ].join('\n');
    return { system: personaLines.join('\n'), user };
}
function buildDreamFragmentPrompt(input) {
    return buildDreamPrompt({
        botName: input.botName,
        role: input.role,
        soul: input.soul,
        date: input.date,
        activity: {
            sessions: input.chunk.messages.length > 0
                ? [{
                        sessionId: input.chunk.sessionId,
                        title: input.chunk.title,
                        sessionType: input.chunk.sessionType,
                        peerName: input.chunk.peerName,
                        isOrder: input.chunk.isOrder,
                        messages: input.chunk.messages,
                    }]
                : [],
            taskRuns: input.chunk.taskRuns,
            orderCount: input.chunk.orderCount,
            groupTasks: input.chunk.groupTasks ?? [],
        },
        activityTokenBudget: Math.max(256, input.chunk.estimatedInputTokens + 256),
        sourceMode: 'fragment',
    });
}
const normalizeEvaluation = (value) => {
    if (value === 'warming' || value === 'cooling')
        return value;
    if (value === 'stable')
        return 'stable';
    // Legacy 4-grade outputs map onto the temperature scale.
    if (value === 'praise')
        return 'warming';
    if (value === 'dissatisfied')
        return 'cooling';
    return 'stable';
};
/**
 * Tolerant parse of the dream LLM output: strips code fences, takes the
 * outermost brace span, and normalizes into DreamOutput. Fails when there is
 * no usable JSON object or daily_summary is missing.
 */
function parseDreamOutput(raw) {
    if (!raw || !raw.trim()) {
        return { ok: false, error: 'dream output is empty' };
    }
    let candidate = raw.trim();
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
        return { ok: false, error: 'dream output contains no JSON object' };
    }
    let parsed;
    try {
        parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    catch {
        return { ok: false, error: 'dream output JSON parse failed' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'dream output is not a JSON object' };
    }
    const record = parsed;
    const dailySummary = typeof record.daily_summary === 'string' ? record.daily_summary.trim() : '';
    if (!dailySummary) {
        return { ok: false, error: 'dream output missing daily_summary' };
    }
    const sections = {};
    const rawSections = record.sections;
    if (rawSections && typeof record.sections === 'object' && !Array.isArray(rawSections)) {
        for (const key of DREAM_SECTION_KEYS) {
            const value = rawSections[key];
            if (typeof value === 'string' && value.trim()) {
                sections[key] = value.trim();
            }
        }
    }
    const workReviews = [];
    if (Array.isArray(record.work_reviews)) {
        for (const item of record.work_reviews) {
            if (workReviews.length >= exports.MAX_WORK_REVIEWS)
                break;
            if (!item || typeof item !== 'object')
                continue;
            const entry = item;
            const subject = typeof entry.subject === 'string' ? entry.subject.trim() : '';
            if (!subject)
                continue;
            workReviews.push({
                subject,
                counterparty: typeof entry.counterparty === 'string' ? entry.counterparty.trim() : '',
                evaluation: normalizeEvaluation(entry.evaluation),
                note: typeof entry.note === 'string' ? entry.note.trim() : '',
            });
        }
    }
    const importantMemories = [];
    if (Array.isArray(record.important_memories)) {
        for (const item of record.important_memories) {
            if (importantMemories.length >= exports.MAX_IMPORTANT_MEMORIES)
                break;
            const text = typeof item === 'string'
                ? item.trim()
                : (item && typeof item === 'object' && typeof item.text === 'string'
                    ? item.text.trim()
                    : '');
            if (text) {
                importantMemories.push(text);
            }
        }
    }
    const valueLessons = [];
    if (Array.isArray(record.value_lessons)) {
        for (const item of record.value_lessons) {
            if (valueLessons.length >= exports.MAX_VALUE_LESSONS)
                break;
            if (typeof item === 'string') {
                const rule = item.trim();
                if (rule)
                    valueLessons.push({ rule, source: '' });
                continue;
            }
            if (!item || typeof item !== 'object')
                continue;
            const entry = item;
            const rule = typeof entry.rule === 'string' ? entry.rule.trim() : '';
            if (!rule)
                continue;
            valueLessons.push({
                rule,
                source: typeof entry.source === 'string' ? entry.source.trim() : '',
            });
        }
    }
    const selfIdentity = typeof record.self_identity === 'string' && record.self_identity.trim()
        ? record.self_identity.trim()
        : null;
    const impressionUpdates = [];
    const rawImpressionUpdates = record.impression_updates ?? record.impressionUpdates;
    if (Array.isArray(rawImpressionUpdates)) {
        for (const item of rawImpressionUpdates) {
            if (impressionUpdates.length >= exports.MAX_IMPRESSION_UPDATES)
                break;
            if (!item || typeof item !== 'object' || Array.isArray(item))
                continue;
            const entry = item;
            const rawSubject = entry.subjectGlobalMetaId ?? entry.subject_global_metaid;
            const subjectGlobalMetaId = typeof rawSubject === 'string' ? rawSubject.trim() : '';
            const observation = typeof entry.observation === 'string' ? entry.observation.trim() : '';
            const interpretation = typeof entry.interpretation === 'string' ? entry.interpretation.trim() : '';
            if (!subjectGlobalMetaId || !observation || !interpretation)
                continue;
            const readIds = (value) => Array.isArray(value)
                ? [...new Set(value
                        .filter((id) => typeof id === 'string')
                        .map((id) => id.trim())
                        .filter(Boolean))].slice(0, 100)
                : [];
            const dimensions = entry.dimensions && typeof entry.dimensions === 'object' && !Array.isArray(entry.dimensions)
                ? entry.dimensions
                : {};
            const confidence = entry.confidence && typeof entry.confidence === 'object' && !Array.isArray(entry.confidence)
                ? entry.confidence
                : {};
            const rawGuidance = entry.communicationGuidance ?? entry.communication_guidance;
            impressionUpdates.push({
                subjectGlobalMetaId,
                episodeIds: readIds(entry.episodeIds ?? entry.episode_ids),
                evidenceIds: readIds(entry.evidenceIds ?? entry.evidence_ids),
                observation,
                interpretation,
                dimensions,
                communicationGuidance: typeof rawGuidance === 'string' ? rawGuidance.trim() || null : null,
                confidence,
            });
        }
    }
    const knowledgeUpdates = [];
    const rawKnowledge = record.knowledge_points ?? record.knowledgePoints;
    if (Array.isArray(rawKnowledge)) {
        for (const item of rawKnowledge) {
            if (knowledgeUpdates.length >= exports.MAX_KNOWLEDGE_UPDATES)
                break;
            if (!item || typeof item !== 'object' || Array.isArray(item))
                continue;
            const entry = item;
            const topic = typeof entry.topic === 'string' ? entry.topic.trim() : '';
            const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
            if (!topic || !summary)
                continue;
            const rawKind = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
            const kind = rawKind === 'pitfall'
                ? 'pitfall'
                : rawKind === 'principle'
                    ? 'principle'
                    : 'know_how';
            const category = typeof entry.category === 'string' && entry.category.trim()
                ? entry.category.trim()
                : null;
            const readIds = (value) => Array.isArray(value)
                ? [...new Set(value
                        .filter((id) => typeof id === 'string')
                        .map((id) => id.trim())
                        .filter(Boolean))].slice(0, 100)
                : [];
            knowledgeUpdates.push({
                topic,
                summary,
                kind,
                category,
                episodeIds: readIds(entry.episodeIds ?? entry.episode_ids),
                evidenceIds: readIds(entry.evidenceIds ?? entry.evidence_ids),
            });
        }
    }
    return {
        ok: true,
        output: {
            dailySummary,
            sections,
            workReviews,
            importantMemories,
            valueLessons,
            selfIdentity,
            impressionUpdates,
            knowledgeUpdates,
        },
    };
}
