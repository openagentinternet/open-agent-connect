import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  computeDreamStaggerMinute,
  computeDreamRetryDelayMs,
  computeDueDreamDates,
  getDayBoundsMs,
  parseDreamOutput,
  buildDreamPrompt,
  validateSelfIdentity,
  DREAM_VERSION,
} = require('../../dist/core/memory/dreamPrompt.js');

function dateAt(daysAgo, hour = 0, minute = 0) {
  const now = new Date(2026, 7, 20, 12, 0, 0); // 2026-08-20 12:00 local
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('stagger minute is deterministic and inside the 4-hour window', () => {
  assert.equal(computeDreamStaggerMinute(0), 0);
  assert.equal(computeDreamStaggerMinute(120), 120);
  for (const seed of [1, 7, 42, 999983]) {
    const minute = computeDreamStaggerMinute(seed);
    assert.ok(minute >= 0 && minute < 240);
  }
});

test('retry backoff doubles with a 6h cap', () => {
  assert.equal(computeDreamRetryDelayMs(1), 30 * 60 * 1000);
  assert.equal(computeDreamRetryDelayMs(2), 60 * 60 * 1000);
  assert.equal(computeDreamRetryDelayMs(3), 120 * 60 * 1000);
  assert.equal(computeDreamRetryDelayMs(10), 6 * 60 * 60 * 1000);
});

test('due dates: yesterday waits for the staggered minute inside the window, catches up after', () => {
  const seed = 120; // stagger minute 120 = 02:00
  const inWindowEarly = new Date(2026, 7, 20, 1, 0); // 01:00, before stagger
  const early = computeDueDreamDates({ now: inWindowEarly, staggerSeed: seed, runStates: new Map() });
  assert.ok(!early.dueDates.includes(dateAt(1)));
  // Older missed dates are due immediately even inside the window.
  assert.ok(early.dueDates.includes(dateAt(3)));

  const inWindowLate = new Date(2026, 7, 20, 2, 30); // after stagger
  const late = computeDueDreamDates({ now: inWindowLate, staggerSeed: seed, runStates: new Map() });
  assert.ok(late.dueDates.includes(dateAt(1)));

  const afterWindow = new Date(2026, 7, 20, 10, 0);
  const caughtUp = computeDueDreamDates({ now: afterWindow, staggerSeed: seed, runStates: new Map() });
  assert.ok(caughtUp.dueDates.includes(dateAt(1)));
});

test('due dates: a whole-day completed run is final; a mid-day run re-dreams', () => {
  const date = dateAt(1);
  const dayEnd = getDayBoundsMs(date).endMs;
  const finalRun = new Map([[date, {
    status: 'completed',
    attemptCount: 1,
    startedAt: dayEnd + 1000,
    dreamVersion: DREAM_VERSION,
  }]]);
  const afterWindow = new Date(2026, 7, 20, 10, 0);
  assert.ok(!computeDueDreamDates({ now: afterWindow, staggerSeed: 0, runStates: finalRun }).dueDates.includes(date));

  const partialRun = new Map([[date, {
    status: 'completed',
    attemptCount: 1,
    startedAt: dayEnd - 3600_000, // started before the day ended
    dreamVersion: DREAM_VERSION,
  }]]);
  assert.ok(computeDueDreamDates({ now: afterWindow, staggerSeed: 0, runStates: partialRun }).dueDates.includes(date));
});

test('due dates: stale-version final runs become window-gated repairs', () => {
  const date = dateAt(1);
  const staleRun = new Map([[date, {
    status: 'completed',
    attemptCount: 1,
    startedAt: getDayBoundsMs(date).endMs + 1000,
    dreamVersion: DREAM_VERSION - 1,
  }]]);
  const inWindow = new Date(2026, 7, 20, 3, 0);
  const result = computeDueDreamDates({ now: inWindow, staggerSeed: 0, runStates: staleRun });
  assert.deepEqual(result.repairDates, [date]);
  assert.ok(!result.dueDates.includes(date));

  const afterWindow = new Date(2026, 7, 20, 10, 0);
  assert.deepEqual(computeDueDreamDates({ now: afterWindow, staggerSeed: 0, runStates: staleRun }).repairDates, []);
});

test('due dates: failed runs retry after backoff, running runs are skipped', () => {
  const date = dateAt(1);
  const now = new Date(2026, 7, 20, 10, 0);
  const recentFail = new Map([[date, {
    status: 'failed',
    attemptCount: 1,
    startedAt: now.getTime() - 5 * 60 * 1000, // 5 min ago, backoff 30 min
    dreamVersion: DREAM_VERSION,
  }]]);
  assert.ok(!computeDueDreamDates({ now, staggerSeed: 0, runStates: recentFail }).dueDates.includes(date));

  const oldFail = new Map([[date, {
    status: 'failed',
    attemptCount: 1,
    startedAt: now.getTime() - 45 * 60 * 1000,
    dreamVersion: DREAM_VERSION,
  }]]);
  assert.ok(computeDueDreamDates({ now, staggerSeed: 0, runStates: oldFail }).dueDates.includes(date));

  const running = new Map([[date, {
    status: 'running',
    attemptCount: 1,
    startedAt: now.getTime() - 1000,
    dreamVersion: DREAM_VERSION,
  }]]);
  assert.ok(!computeDueDreamDates({ now, staggerSeed: 0, runStates: running }).dueDates.includes(date));
});

test('parseDreamOutput: tolerant parse, caps, and legacy evaluation mapping', () => {
  const fenced = '```json\n' + JSON.stringify({
    daily_summary: '今天帮用户完成了发布流程。',
    sections: { human: '和用户聊了很多', noise: 'ignored key' },
    work_reviews: Array.from({ length: 8 }, (_, i) => ({
      subject: `工作${i}`,
      counterparty: '用户',
      evaluation: i === 0 ? 'praise' : 'stable',
      note: '依据',
    })),
    important_memories: ['甲', '乙', '丙', '丁', '戊', '己', '庚'],
    value_lessons: [{ rule: '谨慎', source: '经历' }, '纯字符串规则'],
    self_identity: '我是一个助手。',
    impression_updates: [{ subjectGlobalMetaId: 'gm-x', observation: '观察到', interpretation: '解读' }],
    knowledge_points: [{ topic: '用户喜欢的风格', summary: '极简', kind: 'know_how' }],
  }) + '\n```';
  const result = parseDreamOutput(fenced);
  assert.ok(result.ok);
  assert.equal(result.output.dailySummary, '今天帮用户完成了发布流程。');
  assert.deepEqual(Object.keys(result.output.sections), ['human']);
  assert.equal(result.output.workReviews.length, 5); // MAX_WORK_REVIEWS
  assert.equal(result.output.workReviews[0].evaluation, 'warming'); // legacy praise → warming
  assert.equal(result.output.importantMemories.length, 5);
  assert.equal(result.output.valueLessons.length, 2);
  assert.equal(result.output.valueLessons[1].rule, '纯字符串规则');
  assert.equal(result.output.impressionUpdates.length, 1);
  assert.equal(result.output.knowledgeUpdates.length, 1);

  assert.equal(parseDreamOutput('not json at all').ok, false);
  assert.equal(parseDreamOutput('{"sections": {}}').ok, false);
  assert.equal(parseDreamOutput('').ok, false);
});

test('buildDreamPrompt: persona, inventory and session sections are all present', () => {
  const prompt = buildDreamPrompt({
    botName: '小梦',
    role: '主人的数字分身',
    soul: '温和而坚定',
    date: '2026-08-19',
    activity: {
      sessions: [{
        sessionId: 's1',
        title: 'DSH 会话 s1',
        sessionType: 'human',
        peerName: null,
        isOrder: false,
        messages: [
          { type: 'user', content: '帮我看看这个方案', createdAt: 1 },
          { type: 'assistant', content: '好的', createdAt: 2, feedbackRating: 'up', feedbackComment: '很棒' },
        ],
      }],
      taskRuns: [],
      orderCount: 0,
      groupTasks: [],
      groupChats: [],
    },
  });
  assert.match(prompt.system, /你是 小梦/);
  assert.match(prompt.system, /你的角色:主人的数字分身/);
  assert.match(prompt.system, /夜间整理时间/);
  assert.match(prompt.user, /2026-08-19/);
  assert.match(prompt.user, /当天共有 1 段会话/);
  assert.match(prompt.user, /## 与人类用户的对话/);
  assert.match(prompt.user, /〔人类评价:赞〕/);
  assert.match(prompt.user, /〔人类留言:很棒〕/);
  assert.match(prompt.user, /self_identity/);
});

test('validateSelfIdentity enforces the 200 non-whitespace char minimum', () => {
  assert.equal(validateSelfIdentity('短').valid, false);
  assert.equal(validateSelfIdentity(null).valid, false);
  assert.equal(validateSelfIdentity('我'.repeat(200)).valid, true);
});

test('DREAM_VERSION is 2 (chain history sections added)', () => {
  assert.equal(DREAM_VERSION, 2);
});

function makeChainActivity() {
  return {
    chainWrites: [
      {
        pinId: 'pin-w-1',
        path: '/protocols/simplebuzz',
        operation: 'create',
        occurredAtMs: 1,
        summary: '  总结了这条动态的大意  ',
        contentText: '动态原文不应优先使用',
        contentType: 'text/plain',
      },
      {
        pinId: 'pin-w-2',
        path: null,
        operation: null,
        occurredAtMs: 2,
        summary: null,
        contentText: null,
        contentType: 'image/png',
      },
      {
        pinId: 'pin-w-3',
        path: '/protocols/metaprotocol',
        operation: 'modify',
        occurredAtMs: 3,
        summary: null,
        contentText: '长'.repeat(400),
        contentType: 'text/plain',
      },
    ],
    chainReads: [
      {
        pinId: 'pin-r-1',
        path: '/protocols/simplebuzz',
        protocol: 'simplebuzz',
        title: '一篇有标题的文章',
        authorGlobalMetaId: 'gm-author-1',
        summary: '读过的文章摘要',
        contentExcerpt: '文章摘录不应优先',
        savedToKb: true,
        readCount: 2,
        lastReadAtMs: 10,
      },
      {
        pinId: 'pin-r-2',
        path: null,
        protocol: 'metaprotocol',
        title: null,
        authorGlobalMetaId: null,
        summary: null,
        contentExcerpt: null,
        savedToKb: false,
        readCount: 1,
        lastReadAtMs: 11,
      },
    ],
  };
}

test('buildDreamPrompt: chain sections render with gists, markers and inventory counts', () => {
  const prompt = buildDreamPrompt({
    botName: '小梦',
    date: '2026-08-19',
    activity: {
      sessions: [],
      taskRuns: [{ taskName: '每晚备份', status: 'success', startedAt: 1, sessionId: null }],
      orderCount: 0,
      groupTasks: [],
      groupChats: [],
      ...makeChainActivity(),
    },
  });
  const { user } = prompt;
  assert.match(user, /## 当日写入链上的内容\(你自己发布的,是你最深刻的经历\)/);
  assert.match(user, /## 当日阅读的链上内容\(完整读过的文章\/帖子,读过即有印象\)/);
  // The LLM summary is the preferred gist; stored text loses.
  assert.match(user, /- PinID:pin-w-1\(\/protocols\/simplebuzz,create\):总结了这条动态的大意/);
  assert.ok(!user.includes('动态原文不应优先使用'));
  // A binary write (contentText null) degrades to a metadata-only line.
  assert.match(user, /- PinID:pin-w-2\(\(无路径\)\):\(二进制内容\)/);
  // Text fallback gist is whitespace-collapsed and truncated at 300 chars.
  const w3line = user.split('\n').find((line) => line.startsWith('- PinID:pin-w-3'));
  assert.ok(w3line.startsWith('- PinID:pin-w-3(/protocols/metaprotocol,modify):'));
  assert.ok(w3line.includes('长'.repeat(300)));
  assert.ok(!w3line.includes('长'.repeat(301)));
  assert.ok(w3line.endsWith('…'));
  // Read lines: title label, author + saved-to-KB markers; summary-preferred gist.
  assert.match(user, /- PinID:pin-r-1\(一篇有标题的文章,作者=gm-author-1,已存入知识库\):读过的文章摘要/);
  assert.ok(!user.includes('文章摘录不应优先'));
  // An untitled read falls back to path/protocol; an empty excerpt degrades.
  assert.match(user, /- PinID:pin-r-2\(metaprotocol\):\(无正文摘录\)/);
  // Inventory counts.
  assert.match(user, /写入链上内容 3 条;阅读链上内容 2 条。/);
  // Placement: after the orders/group-chat sections, before 定时任务.
  assert.ok(user.indexOf('## 当日写入链上的内容') < user.indexOf('## 定时任务'));
  assert.ok(user.indexOf('## 当日阅读的链上内容') < user.indexOf('## 定时任务'));
});

test('buildDreamPrompt: chain sections and inventory line are omitted when empty', () => {
  const prompt = buildDreamPrompt({
    botName: '小梦',
    date: '2026-08-19',
    activity: {
      sessions: [],
      taskRuns: [],
      orderCount: 0,
      groupTasks: [],
      groupChats: [],
      chainWrites: [],
      chainReads: [],
    },
  });
  assert.ok(!prompt.user.includes('## 当日写入链上的内容'));
  assert.ok(!prompt.user.includes('## 当日阅读的链上内容'));
  assert.ok(!prompt.user.includes('写入链上内容'));
  assert.ok(!prompt.user.includes('阅读链上内容'));
});

test('buildDreamPrompt: fragment mode never renders the chain sections', () => {
  const prompt = buildDreamPrompt({
    botName: '小梦',
    date: '2026-08-19',
    sourceMode: 'fragment',
    activity: {
      sessions: [],
      taskRuns: [],
      orderCount: 0,
      groupTasks: [],
      groupChats: [],
      ...makeChainActivity(),
    },
  });
  assert.ok(!prompt.user.includes('## 当日写入链上的内容'));
  assert.ok(!prompt.user.includes('## 当日阅读的链上内容'));
  assert.ok(!prompt.user.includes('总结了这条动态的大意'));
});
