import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const dist = require('../../dist/core/qanda/recall.js');

function envelopeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const body = await handler(String(url));
    return {
      status: 200,
      json: async () => body,
    };
  };
  return { calls, fetchImpl };
}

const QUESTION = {
  pinId: 'a'.repeat(64) + 'i0',
  currentPinId: 'a'.repeat(64) + 'i0',
  chainName: 'mvc',
  title: 'How to recover a wallet',
  summary: 'summary',
  tags: ['wallet'],
  contentType: 'text/markdown',
  publisher: { globalMetaId: 'idq1abc', metaId: 'mid', name: 'Asker', avatar: '' },
  createdAt: 1757200000,
  isMempool: false,
  likeCount: 2,
  dislikeCount: 1,
  commentCount: 3,
  answerCount: 1,
  topAnswer: {
    pinId: 'b'.repeat(64) + 'i0',
    summary: 'top',
    publisher: { globalMetaId: 'idq1def', metaId: 'mid2', name: 'Helper', avatar: '' },
    createdAt: 1757200100,
    likeCount: 8,
    dislikeCount: 1,
    score: 7,
  },
};

test('qaSearch serializes filters onto the wire and normalizes the page', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: { items: [QUESTION], nextCursor: 'cur-1', hasMore: true },
  }));
  const page = await dist.qaSearch(
    { q: 'wallet', tags: ['a', 'b'], publisher: 'idq1abc', answered: true, sort: 'newest', size: 20, cursor: 'c0' },
    { baseUrl: 'https://so.test/', fetchImpl },
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].topAnswer.score, 7);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'cur-1');
  const url = new URL(calls[0]);
  assert.equal(url.pathname, '/api/qa/search');
  assert.equal(url.searchParams.get('q'), 'wallet');
  assert.equal(url.searchParams.get('tags'), 'a,b');
  assert.equal(url.searchParams.get('publisher'), 'idq1abc');
  assert.equal(url.searchParams.get('answered'), 'true');
  assert.equal(url.searchParams.get('sort'), 'newest');
  assert.equal(url.searchParams.get('size'), '20');
  assert.equal(url.searchParams.get('cursor'), 'c0');
});

test('qaSearch answered=false stays on the wire; empty query throws', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({ code: 0, data: { items: [], nextCursor: null, hasMore: false } }));
  await dist.qaSearch({ q: 'x', answered: false }, { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(new URL(calls[0]).searchParams.get('answered'), 'false');
  await assert.rejects(() => dist.qaSearch({ q: '  ' }, { baseUrl: 'https://so.test', fetchImpl }), /q is required/);
});

test('qaLatestQuestions keeps maxAnswers=0 (unanswered) on the wire', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({ code: 0, data: { items: [], nextCursor: null, hasMore: false } }));
  await dist.qaLatestQuestions(
    { tags: ['t'], minAnswers: 0, maxAnswers: 0, sort: 'hot', size: 50, cursor: 'z' },
    { baseUrl: 'https://so.test', fetchImpl },
  );
  const url = new URL(calls[0]);
  assert.equal(url.pathname, '/api/qa/questions');
  assert.equal(url.searchParams.get('maxAnswers'), '0');
  assert.equal(url.searchParams.get('sort'), 'hot');
  assert.equal(url.searchParams.get('size'), '50');
});

test('qaQuestionDetail normalizes question + answers', async () => {
  const { fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: {
      question: QUESTION,
      answers: [{
        pinId: 'b'.repeat(64) + 'i0',
        currentPinId: 'b'.repeat(64) + 'i0',
        questionPinId: 'a'.repeat(64) + 'i0',
        chainName: 'mvc',
        summary: 'ans',
        tags: [],
        publisher: QUESTION.publisher,
        createdAt: 1,
        isMempool: true,
        likeCount: 3,
        dislikeCount: 1,
        commentCount: 0,
        score: 2,
      }],
      nextCursor: null,
      hasMore: false,
    },
  }));
  const detail = await dist.qaQuestionDetail(QUESTION.pinId, { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(detail.question.title, 'How to recover a wallet');
  assert.equal(detail.answers[0].isMempool, true);
  assert.equal(detail.answers[0].score, 2);
});

test('qaQuestionAnswers serializes publisher filter', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({ code: 0, data: { items: [], nextCursor: null, hasMore: false } }));
  await dist.qaQuestionAnswers(
    { pinId: 'p'.repeat(64) + 'i0', publisher: 'IDQ1ABC', size: 10, cursor: 'n' },
    { baseUrl: 'https://so.test', fetchImpl },
  );
  const url = new URL(calls[0]);
  assert.equal(url.pathname, `/api/qa/questions/${'p'.repeat(64)}i0/answers`);
  assert.equal(url.searchParams.get('publisher'), 'IDQ1ABC');
  assert.equal(url.searchParams.get('size'), '10');
});

test('business codes: 40400 raises QaRecallNotFoundError, others raise a plain error', async () => {
  const notFound = envelopeFetch(() => ({ code: 40400, data: null, message: 'no such question' }));
  await assert.rejects(
    () => dist.qaQuestionDetail('x', { baseUrl: 'https://so.test', fetchImpl: notFound.fetchImpl }),
    (error) => error.name === 'QaRecallNotFoundError',
  );
  const serverError = envelopeFetch(() => ({ code: 50000, data: null, message: 'boom' }));
  await assert.rejects(
    () => dist.qaSearch({ q: 'x' }, { baseUrl: 'https://so.test', fetchImpl: serverError.fetchImpl }),
    /Q&A API error 50000: boom/,
  );
});

test('non-JSON body raises the invalid-response error', async () => {
  const fetchImpl = async () => ({ status: 502, json: async () => { throw new Error('not json'); } });
  await assert.rejects(
    () => dist.qaSearch({ q: 'x' }, { baseUrl: 'https://so.test', fetchImpl }),
    /invalid response \(HTTP 502\)/,
  );
});
