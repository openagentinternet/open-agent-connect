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
