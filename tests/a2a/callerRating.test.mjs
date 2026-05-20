import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { generateBuyerServiceRating } = require('../../dist/core/a2a/callerRating.js');
const { createDefaultChatReplyRunner } = require('../../dist/core/chat/defaultChatReplyRunner.js');

test('buyer service rating fallback uses service context instead of generic chat closing copy', async () => {
  const rating = await generateBuyerServiceRating({
    replyRunner: createDefaultChatReplyRunner(),
    persona: {
      role: 'Careful buyer bot',
      soul: 'Concise and fair.',
      goal: 'Evaluate remote service results by the delivered content.',
    },
    traceId: 'trace-context-rating',
    providerGlobalMetaId: 'idq1provider',
    providerName: 'Weather Oracle',
    originalRequest: 'Tell me tomorrow weather in Shanghai',
    serviceResult: 'Tomorrow weather: bright with light wind.',
    expectedOutputType: 'text',
    ratingRequestText: 'The forecast is ready; please rate it.',
    transcriptItems: [],
    now: 1_775_000_000_000,
  });

  assert.equal(rating.rate, 5);
  assert.match(rating.comment, /Shanghai|weather|forecast|result/i);
  assert.doesNotMatch(rating.comment, /Thank you for the conversation! It was nice chatting with you\. See you next time!\nBye/);
});

test('buyer service rating fallback avoids dumping provider output or mislabeling provider as user', async () => {
  const rating = await generateBuyerServiceRating({
    replyRunner: createDefaultChatReplyRunner(),
    persona: {
      role: '谨慎的买方 Bot',
      soul: '简洁、礼貌、尊重对方劳动。',
      goal: '根据服务结果给出公平评价。',
    },
    traceId: 'trace-weibo-rating',
    providerGlobalMetaId: 'idq1provider',
    providerName: 'AI_Sunny',
    originalRequest: '查询微博热搜',
    serviceResult: [
      '微博热搜 TOP 50 更新时间： 2026/5/20 08:24:10',
      '| 排名 | 话题 | 标签 | 热度(万) | 链接 |',
      '| 1 | 普京到达北京 | 热 | 164 | https://s.weibo.com/weibo?q=example |',
      '| 2 | 长表格内容 | 热 | 120 | https://s.weibo.com/weibo?q=long |',
    ].join('\n'),
    expectedOutputType: 'text',
    ratingRequestText: '如果这次服务有帮助，请给我 1-5 分评价，你的反馈对我很重要。',
    transcriptItems: [],
    now: 1_775_000_000_000,
  });

  assert.equal(rating.rate, 5);
  assert.match(rating.comment, /评分：5分|5\s*分/);
  assert.match(rating.comment, /AI_Sunny|服务|热搜/);
  assert.doesNotMatch(rating.comment, /用户请求 AI_Sunny|AI_Sunny 的用户/);
  assert.doesNotMatch(rating.comment, /微博热搜 TOP 50|https:\/\/|Result summary|\| 排名 \|/);
});

test('buyer service rating prefers dedicated generated protocol copy over private chat fallback', async () => {
  const generatedComment = '评分：5分。热搜结果正好回应了我的请求，内容清楚，谢谢你快速交付。';
  const generatorCalls = [];
  const rating = await generateBuyerServiceRating({
    replyRunner: createDefaultChatReplyRunner(),
    textGenerator: async (input) => {
      generatorCalls.push(input);
      return generatedComment;
    },
    persona: {
      role: 'I am a direct buyer bot.',
      soul: 'Concise and fair.',
      goal: 'Evaluate service results.',
    },
    traceId: 'trace-dedicated-rating',
    providerGlobalMetaId: 'idq1provider',
    providerName: 'AI_Sunny',
    originalRequest: '请求微博热搜',
    serviceResult: [
      '微博热搜 TOP 50 更新时间：2026/5/20 08:24:10',
      '| 排名 | 话题 | 热度 | 链接 |',
      '| 1 | 普京到达北京 | 164 | https://s.weibo.com/weibo?q=example |',
    ].join('\n'),
    expectedOutputType: 'text',
    ratingRequestText: '服务已完成，请给我一个 1-5 分评价。',
    transcriptItems: [],
  });

  assert.equal(generatorCalls.length, 1);
  assert.equal(generatorCalls[0].providerName, 'AI_Sunny');
  assert.equal(rating.rate, 5);
  assert.equal(rating.comment, generatedComment);
});
