"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCronExpression = parseCronExpression;
exports.nextCronOccurrence = nextCronOccurrence;
// Five-field cron parsing (IDBots scheduler parity, no new dependency).
// Supported subset per field: `*`, `*/n`, `a`, `a-b`, `a,b,c`. Matching is
// minute-scanning in the machine-local timezone with a 4-year bound; day of
// month and day of week follow standard cron OR-semantics when both are
// restricted.
const FIELD_RANGES = [
    { min: 0, max: 59, name: 'minute' },
    { min: 0, max: 23, name: 'hour' },
    { min: 1, max: 31, name: 'day-of-month' },
    { min: 1, max: 12, name: 'month' },
    { min: 0, max: 7, name: 'day-of-week' },
];
const FIELD_COUNT = 5;
/** Search horizon: 4 years, like the IDBots minute scanner. */
const NEXT_OCCURRENCE_BOUND_MS = 4 * 366 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ELEMENT_PATTERN = /^(?:\*|\*\/\d+|\d+|\d+-\d+)$/;
function expandElement(element, min, max) {
    if (element === '*')
        return null;
    const stepMatch = /^\*\/(\d+)$/.exec(element);
    if (stepMatch) {
        const step = Number(stepMatch[1]);
        if (step < 1)
            throw new Error(`cron step must be at least 1: ${element}`);
        const values = new Set();
        for (let value = min; value <= max; value += step)
            values.add(value);
        return values;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(element);
    if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (start < min || end > max || start > end) {
            throw new Error(`cron range out of bounds (${min}-${max}): ${element}`);
        }
        const values = new Set();
        for (let value = start; value <= end; value += 1)
            values.add(value);
        return values;
    }
    if (/^\d+$/.test(element)) {
        const value = Number(element);
        if (value < min || value > max) {
            throw new Error(`cron value out of bounds (${min}-${max}): ${element}`);
        }
        return new Set([value]);
    }
    throw new Error(`unsupported cron element: ${element}`);
}
function parseCronExpression(expression) {
    const fields = String(expression ?? '').trim().split(/\s+/);
    if (fields.length !== FIELD_COUNT) {
        throw new Error(`cron expression must have ${FIELD_COUNT} fields: ${expression}`);
    }
    const fieldSets = [];
    for (let index = 0; index < FIELD_COUNT; index += 1) {
        const { min, max } = FIELD_RANGES[index];
        const fieldValues = new Set();
        let unrestricted = true;
        for (const element of fields[index].split(',')) {
            if (!ELEMENT_PATTERN.test(element)) {
                throw new Error(`invalid cron element "${element}" in field ${FIELD_RANGES[index].name}`);
            }
            const values = expandElement(element, min, max);
            if (values === null) {
                // `*` inside a comma list makes the whole field unrestricted.
                fieldValues.clear();
                unrestricted = true;
                break;
            }
            for (const value of values)
                fieldValues.add(value);
            unrestricted = false;
        }
        fieldSets.push(unrestricted ? null : fieldValues);
    }
    const [minute, hour, dom, month, dow] = fieldSets;
    return {
        minute: minute ?? new Set(),
        hour: hour ?? new Set(),
        month: month ?? new Set(),
        dom,
        dow,
    };
}
function normalizeDow(value) {
    return value === 7 ? 0 : value;
}
function domOrDowMatches(date, dom, dow) {
    const domMatches = dom?.has(date.getDate()) ?? true;
    const dowMatches = dow?.has(normalizeDow(date.getDay())) ?? true;
    if (dom !== null && dow !== null)
        return domMatches || dowMatches;
    if (dom !== null)
        return domMatches;
    if (dow !== null)
        return dowMatches;
    return true;
}
function minuteMatches(date, fieldSet) {
    if (fieldSet.minute.size > 0 && !fieldSet.minute.has(date.getMinutes()))
        return false;
    if (fieldSet.hour.size > 0 && !fieldSet.hour.has(date.getHours()))
        return false;
    if (fieldSet.month.size > 0 && !fieldSet.month.has(date.getMonth() + 1))
        return false;
    return domOrDowMatches(date, fieldSet.dom, fieldSet.dow);
}
/**
 * Next occurrence of the expression strictly after `afterMs`, in the
 * machine-local timezone, or null when none exists within 4 years.
 */
function nextCronOccurrence(expression, afterMs) {
    const fieldSet = parseCronExpression(expression);
    const bound = afterMs + NEXT_OCCURRENCE_BOUND_MS;
    let candidate = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    while (candidate <= bound) {
        if (minuteMatches(new Date(candidate), fieldSet))
            return candidate;
        candidate += MINUTE_MS;
    }
    return null;
}
