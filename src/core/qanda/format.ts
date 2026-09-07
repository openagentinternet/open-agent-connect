/**
 * Human-readable renderings of on-chain Q&A data for bot-facing tool output:
 * question/answer bullet lists (titles as pin:// links, authors as metaid://
 * links), the question-detail sheet, and the already-answered notice. OAC
 * port of the IDBots feat/metaweb-qa qaRecallAgentTools formatters.
 */

import { buildPinBrowserUri, markdownSelfLink } from '../metaweb/uri';
import { SIMPLE_ANSWER_PATH, SIMPLE_QUESTION_PATH } from './publish';
import type { QaAnswerItem, QaQuestionDetail, QaQuestionItem } from './recall';
import type { QaAnswerLedgerEntry } from './ledger';

function metaIdUri(globalMetaId: string): string {
  return `metaid://${globalMetaId}`;
}

function sanitizeLinkLabel(value: string): string {
  return value.replace(/[[\]]/g, '');
}

/** Code-point-aware truncation: never splits a surrogate pair. */
function truncate(value: string, max: number): string {
  return [...value].length > max ? `${[...value].slice(0, max).join('')}…` : value;
}

/** UTC "YYYY-MM-DD HH:MM" — the Q&A API timestamps are Unix seconds (block time). */
function formatTime(ts: number): string {
  return ts ? `${new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
}

function publisherName(publisher: { globalMetaId: string; name: string; metaId: string }): string {
  return publisher.name || publisher.globalMetaId || publisher.metaId || 'unknown';
}

function publisherLink(publisher: { globalMetaId: string; name: string; metaId: string }): string {
  const name = publisherName(publisher);
  const label = sanitizeLinkLabel(name);
  return publisher.globalMetaId ? `[${label}](${metaIdUri(publisher.globalMetaId)})` : label;
}

function questionLabel(question: QaQuestionItem): string {
  return sanitizeLinkLabel(truncate(question.title || question.summary || '(untitled question)', 120));
}

function questionViewLink(question: QaQuestionItem): string {
  return buildPinBrowserUri({ pinId: question.pinId, path: SIMPLE_QUESTION_PATH });
}

function answerViewLink(answer: { pinId: string }): string {
  return buildPinBrowserUri({ pinId: answer.pinId, path: SIMPLE_ANSWER_PATH });
}

/** Ready-to-quote markdown bullets for question items; titles are pin:// links, authors metaid:// links. */
export function formatQaQuestionBullets(items: QaQuestionItem[]): string {
  return items.map((question) => {
    const title = question.pinId
      ? `[${questionLabel(question)}](${questionViewLink(question)})`
      : questionLabel(question);
    const head = `- **${title}** — asked by ${publisherLink(question.publisher)} · ${formatTime(question.createdAt)}${question.answerCount ? ` · ${question.answerCount} answer(s)` : ' · unanswered'}`;
    const meta = [
      `likes ${question.likeCount}`,
      question.dislikeCount ? `dislikes ${question.dislikeCount}` : '',
      question.commentCount ? `comments ${question.commentCount}` : '',
      question.hotScore != null ? `hot ${question.hotScore}` : '',
      question.tags.length ? `tags: ${question.tags.join(', ')}` : '',
      question.isMempool ? 'mempool (unconfirmed)' : '',
      question.pinId ? `pin: ${question.pinId}` : '',
    ].filter(Boolean).join(' | ');
    const lines = [meta ? `${head}\n  ${meta}` : head];
    if (question.topAnswer) {
      const top = question.topAnswer;
      const topText = sanitizeLinkLabel(truncate(top.summary || '(no summary)', 140));
      const topPart = top.pinId
        ? `[${topText}](${answerViewLink(top)})`
        : topText;
      lines.push(`  top answer (+${top.likeCount}${top.dislikeCount ? `/-${top.dislikeCount}` : ''}) by ${publisherLink(top.publisher)}: ${topPart}`);
    }
    return lines.join('\n');
  }).join('\n');
}

/** Ready-to-quote markdown bullets for ranked answer items. */
export function formatQaAnswerBullets(items: QaAnswerItem[]): string {
  return items.map((answer, index) => {
    const summary = sanitizeLinkLabel(truncate(answer.summary || '(no summary)', 200));
    const summaryPart = answer.pinId
      ? `[${summary}](${answerViewLink(answer)})`
      : summary;
    const head = `- #${index + 1} **${summaryPart}** — by ${publisherLink(answer.publisher)} · ${formatTime(answer.createdAt)}`;
    const meta = [
      `score ${answer.score} (likes ${answer.likeCount}${answer.dislikeCount ? `, dislikes ${answer.dislikeCount}` : ''})`,
      answer.commentCount ? `comments ${answer.commentCount}` : '',
      answer.isMempool ? 'mempool (unconfirmed)' : '',
      answer.pinId ? `pin: ${answer.pinId}` : '',
    ].filter(Boolean).join(' | ');
    return meta ? `${head}\n  ${meta}` : head;
  }).join('\n');
}

/** Human-readable sheet for one question with its ranked answers. */
export function formatQaQuestionDetail(input: {
  question: QaQuestionItem;
  answers: QaAnswerItem[];
}): string {
  const question = input.question;
  const lines = [
    `Question ${question.pinId}:`,
    `- title: ${question.title || '(untitled)'}`,
    `- asked by: ${publisherLink(question.publisher)}`,
  ];
  if (question.createdAt) lines.push(`- asked at: ${formatTime(question.createdAt)}${question.isMempool ? ' (mempool, unconfirmed)' : ''}`);
  lines.push(`- engagement: likes ${question.likeCount} | dislikes ${question.dislikeCount} | comments ${question.commentCount} | answers ${question.answerCount}`);
  if (question.tags.length) lines.push(`- tags: ${question.tags.join(', ')}`);
  if (question.summary) lines.push(`- question summary: ${truncate(question.summary, 600)}`);
  if (question.pinId) lines.push(`- view: ${markdownSelfLink(questionViewLink(question))}`);
  if (!input.answers.length) {
    lines.push('', 'No answers yet — if you know the answer, post_simpleanswer with `answer_to` = the question pinId above.');
    return lines.join('\n');
  }
  lines.push('', 'Answers (ranked by likes − dislikes, best first):', formatQaAnswerBullets(input.answers));
  lines.push('', 'Answer summaries are ~200 chars; read the full body of an answer with read_metaweb_pin on its pinId before relying on it. React with like_pin (1 like / -1 dislike) on the answer pinId.');
  return lines.join('\n');
}

/**
 * Informational (non-error) notice shown when prior answers exist. States
 * facts and options; the publish/not-publish decision stays with the bot.
 * `source` says where the facts came from: the on-chain Q&A index (complete
 * across machines) or this host's local records (index unreachable).
 */
export function formatAlreadyAnsweredNotice(
  questionPinId: string,
  answers: QaAnswerLedgerEntry[],
  source: 'index' | 'local' = 'local',
): string {
  const lines: string[] = [
    `Not published yet — you already have ${answers.length === 1 ? '1 previous answer' : `${answers.length} previous answers`} to question ${questionPinId}:`,
  ];
  for (const answer of answers) {
    lines.push(`- answer pinId: ${answer.answerPinId}${answer.network ? ` (${answer.network})` : ''}`);
    const excerpt = answer.content.length > 400 ? `${answer.content.slice(0, 400)}…` : answer.content;
    lines.push(`  content: ${excerpt.replace(/\n+/g, ' ')}`);
    lines.push(`  view link: ${markdownSelfLink(`pin://${answer.answerPinId}`)}`);
  }
  lines.push(
    source === 'index'
      ? 'Source: on-chain Q&A index — complete across machines.'
      : 'Source: this host\'s local posting records only (the on-chain Q&A index was unreachable).',
  );
  lines.push(
    'The protocol allows multiple answers per bot and nothing here forbids another one — publishing again is your decision. If the new answer substantially improves the old one, call post_simpleanswer again with allow_repeat=true. For small additions, a PayComment on your existing answer usually serves better.',
  );
  return lines.join('\n');
}

/** Convenience wrapper naming the question-page view link for detail results. */
export function qaQuestionDetailViewLink(detail: QaQuestionDetail): string {
  return detail.question.pinId ? markdownSelfLink(questionViewLink(detail.question)) : '';
}
