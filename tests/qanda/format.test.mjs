import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const dist = require('../../dist/core/qanda/format.js');

const PUBLISHER = { globalMetaId: 'idq1abc', metaId: 'mid', name: 'Asker [bot]', avatar: '' };

const QUESTION = {
  pinId: 'a'.repeat(64) + 'i0',
  currentPinId: 'a'.repeat(64) + 'i0',
  chainName: 'mvc',
  title: 'How to recover a wallet',
  summary: 'summary text',
  tags: ['wallet', 'recovery'],
  contentType: 'text/markdown',
  publisher: PUBLISHER,
  createdAt: 1757200000,
  isMempool: false,
  likeCount: 2,
  dislikeCount: 1,
  commentCount: 3,
  answerCount: 1,
  topAnswer: {
    pinId: 'b'.repeat(64) + 'i0',
    summary: 'top answer summary',
    publisher: { globalMetaId: 'idq1def', metaId: 'mid2', name: 'Helper', avatar: '' },
    createdAt: 1757200100,
    likeCount: 8,
    dislikeCount: 1,
    score: 7,
  },
};

test('question bullets use pin:// titles, metaid:// authors, and full meta rows', () => {
  const text = dist.formatQaQuestionBullets([QUESTION]);
  assert.match(text, /\*\*\[How to recover a wallet\]\(pin:\/\//);
  assert.match(text, /\[Asker bot\]\(metaid:\/\/idq1abc\)/);
  assert.match(text, /unanswered|1 answer\(s\)/);
  assert.match(text, /likes 2 \| dislikes 1 \| comments 3/);
  assert.match(text, /tags: wallet, recovery/);
  assert.match(text, /top answer \(\+8\/-1\) by \[Helper\]\(metaid:\/\/idq1def\): \[top answer summary\]\(pin:\/\//);
  assert.ok(!text.includes('http://') && !text.includes('https://'), 'no Web2 URLs');
});

test('question detail sheet: no answers nudges post_simpleanswer; with answers it ranks', () => {
  const empty = dist.formatQaQuestionDetail({ question: QUESTION, answers: [] });
  assert.match(empty, /No answers yet/);
  assert.match(empty, /post_simpleanswer with `answer_to`/);

  const answer = {
    pinId: 'b'.repeat(64) + 'i0',
    currentPinId: 'b'.repeat(64) + 'i0',
    questionPinId: QUESTION.pinId,
    chainName: 'mvc',
    summary: 'best answer',
    tags: [],
    publisher: QUESTION.topAnswer.publisher,
    createdAt: 1757200100,
    isMempool: false,
    likeCount: 8,
    dislikeCount: 1,
    commentCount: 0,
    score: 7,
  };
  const detail = dist.formatQaQuestionDetail({ question: QUESTION, answers: [answer] });
  assert.match(detail, /Answers \(ranked by likes − dislikes, best first\):/);
  assert.match(detail, /- #1 \*\*\[best answer\]\(pin:\/\//);
  assert.match(detail, /read the full body of an answer with read_metaweb_pin/);
});

test('already-answered notice states facts and both sources', () => {
  const answers = [
    { answerPinId: 'b'.repeat(64) + 'i0', content: 'x'.repeat(600), postedAt: 1, network: 'mvc' },
  ];
  const local = dist.formatAlreadyAnsweredNotice('q', answers, 'local');
  assert.match(local, /Not published yet — you already have 1 previous answer/);
  assert.match(local, /Source: this host's local posting records only/);
  assert.match(local, /allow_repeat=true/);
  assert.match(local, /view link: \[pin:\/\//);
  const index = dist.formatAlreadyAnsweredNotice('q', answers, 'index');
  assert.match(index, /Source: on-chain Q&A index — complete across machines/);
});
