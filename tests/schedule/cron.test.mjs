import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  nextCronOccurrence,
  parseCronExpression,
} = require('../../dist/core/schedule/cron.js');

function localEpoch(y, mo, d, h = 0, mi = 0) {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

test('parser accepts the documented subset: *, */n, a, a-b, a,b,c', () => {
  assert.deepEqual(parseCronExpression('* * * * *'), {
    minute: new Set(),
    hour: new Set(),
    month: new Set(),
    dom: null,
    dow: null,
  });
  assert.deepEqual(parseCronExpression('*/15 * * * *').minute, new Set([0, 15, 30, 45]));
  assert.deepEqual(parseCronExpression('0 9 * * 1').hour, new Set([9]));
  assert.deepEqual(parseCronExpression('30 9 * * 1-5').hour, new Set([9]));
  assert.deepEqual(parseCronExpression('0 9 * * 1,3,5').dow, new Set([1, 3, 5]));
  assert.deepEqual(parseCronExpression('0 9 1-5 * *').dom, new Set([1, 2, 3, 4, 5]));
  // DOW 7 normalizes to Sunday (0).
  assert.deepEqual(parseCronExpression('0 9 * * 7').dow, new Set([7]));
});

test('parser rejects malformed and out-of-bounds fields', () => {
  for (const expression of [
    '',
    '0 9 * *',
    'a b c d e',
    '0 99 * * *',
    '60 * * * *',
    '0 9 32 * *',
    '0 9 * 13 *',
    '0 9 * * 8',
    '*/0 * * * *',
    '1-5-9 * * * *',
    '0 9 * * * *',
  ]) {
    assert.throws(() => parseCronExpression(expression), undefined, expression);
  }
});

test('next occurrence scans the machine-local timezone', () => {
  // Daily 09:30 local.
  const expression = '30 9 * * *';
  const after = localEpoch(2026, 9, 5, 10, 0);
  const next = nextCronOccurrence(expression, after);
  assert.equal(next, localEpoch(2026, 9, 6, 9, 30));

  // Strictly-after: an occurrence at the exact `after` minute is skipped.
  const at = localEpoch(2026, 9, 5, 9, 30);
  assert.equal(nextCronOccurrence(expression, at), localEpoch(2026, 9, 6, 9, 30));
});

test('*/n steps from the field minimum', () => {
  const expression = '*/15 * * * *';
  const after = localEpoch(2026, 9, 5, 10, 3);
  assert.equal(nextCronOccurrence(expression, after), localEpoch(2026, 9, 5, 10, 15));
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 9, 5, 10, 16)), localEpoch(2026, 9, 5, 10, 30));
});

test('ranges and lists combine within one field', () => {
  const expression = '0 9-10,14 * * *';
  const after = localEpoch(2026, 9, 5, 8, 0);
  assert.equal(nextCronOccurrence(expression, after), localEpoch(2026, 9, 5, 9, 0));
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 9, 5, 9, 1)), localEpoch(2026, 9, 5, 10, 0));
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 9, 5, 10, 1)), localEpoch(2026, 9, 5, 14, 0));
});

test('day-of-month and day-of-week follow standard OR-semantics when both are restricted', () => {
  const expression = '0 9 13 * 5'; // 13th of the month OR any Friday.
  // A Friday that is not the 13th still matches.
  const friday = localEpoch(2026, 9, 4); // 2026-09-04 is a Friday.
  assert.equal(new Date(friday).getDay(), 5);
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 9, 1, 0, 0)), localEpoch(2026, 9, 4, 9, 0));
  // The 13th of a non-Friday month matches via DOM.
  const sunday13th = localEpoch(2026, 9, 13); // 2026-09-13 is a Sunday.
  assert.equal(new Date(sunday13th).getDay(), 0);
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 9, 13, 0, 0)), localEpoch(2026, 9, 13, 9, 0));
});

test('a single restricted dom/dow field restricts alone', () => {
  // Only DOW restricted: fires on that weekday regardless of the date.
  const weekdayOnly = '0 9 * * 1';
  const monday = localEpoch(2026, 9, 7); // 2026-09-07 is a Monday.
  assert.equal(new Date(monday).getDay(), 1);
  assert.equal(nextCronOccurrence(weekdayOnly, localEpoch(2026, 9, 1, 0, 0)), monday + 9 * 3600_000);

  // Only DOM restricted: fires on that date regardless of the weekday.
  const domOnly = '0 9 13 * *';
  assert.equal(nextCronOccurrence(domOnly, localEpoch(2026, 9, 1, 0, 0)), localEpoch(2026, 9, 13, 9, 0));
});

test('month boundaries and year rollover are handled', () => {
  const expression = '0 9 1 * *';
  assert.equal(nextCronOccurrence(expression, localEpoch(2026, 12, 30)), localEpoch(2027, 1, 1, 9, 0));
  const monthly = '0 9 31 * *';
  assert.equal(nextCronOccurrence(monthly, localEpoch(2026, 8, 1)), localEpoch(2026, 8, 31, 9, 0));
  assert.equal(nextCronOccurrence(monthly, localEpoch(2026, 8, 31, 9, 1)), localEpoch(2026, 10, 31, 9, 0));
});

test('a February 29 expression skips non-leap years and returns null beyond the 4-year bound', () => {
  const leapDay = '0 9 29 2 *';
  const after = localEpoch(2026, 9, 5);
  assert.equal(nextCronOccurrence(leapDay, after), localEpoch(2028, 2, 29, 9, 0));
  // 2027-02-29 does not exist; scanning 4 years past a late-2029 anchor finds
  // no occurrence.
  assert.equal(nextCronOccurrence('0 9 30 2 *', localEpoch(2029, 9, 5)), null);
});
