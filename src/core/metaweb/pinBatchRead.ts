/**
 * Batch pin read for the MetaWeb tools: POST /api/metaweb/pins:batch — up to
 * 50 pins in one round trip (OAC port of the IDBots R2 batch client plus the
 * budget-capped batch renderer). Per-pin failures are isolated server-side
 * ({pinId, error} entries) and stay isolated in the render; upstream `text`
 * is capped at 8000 runes per pin while `payload` is never truncated.
 *
 * Rendering is budget-capped (two-pass): pass 1 renders every requested
 * entry's meta-only skeleton (complete for every pin, whatever happens
 * later); pass 2 splits the leftover budget across bodies — water-filling,
 * short bodies render whole first — trimming or omitting with a per-pin
 * label so the model always knows which bodies it did NOT get. The receipt
 * carries a machine-readable one-line summary whose bytes_written is solved
 * to a fixed point (the marker's own digits change the length it reports).
 */
import { DEFAULT_METAWEB_PIN_BASE_URL, normalizePin, type MetawebPin, type MetawebPinServiceOptions } from './pinRead';
import { formatMetawebPinDetail } from './format';
import { METAWEB_CITATION_RULE } from './uri';

export const METAWEB_PINS_BATCH_MAX = 50;

export type MetawebBatchPin = MetawebPin & {
  version: { latest: string; count: number | null };
};

/** Per-pin failure entries are isolated server-side: {pinId, error}. */
export type MetawebBatchEntry = MetawebBatchPin | { pinId: string; error: string };

export const isBatchErrorEntry = (entry: MetawebBatchEntry): entry is { pinId: string; error: string } =>
  'error' in entry && typeof (entry as { error?: unknown }).error === 'string';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBatchEntry(pinId: string, raw: unknown): MetawebBatchEntry {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) {
    return { pinId: text(record.pinId) || pinId, error: record.error.trim() };
  }
  const versionRaw = (record.version && typeof record.version === 'object' ? record.version : {}) as Record<string, unknown>;
  const count = Number(versionRaw.count);
  const pin = normalizePin(record);
  return {
    ...pin,
    pinId: pin.pinId || pinId,
    version: {
      latest: text(versionRaw.latest) || pin.currentPinId || pin.pinId,
      count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : null,
    },
  };
}

async function postEnvelope(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MetaWeb pins-batch API timed out after ${Math.round(timeoutMs / 1000)}s — try again later.`);
      }
      throw error;
    }
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`MetaWeb pins-batch API returned an invalid response (HTTP ${response.status}).`);
    }
    const code = Number(parsed.code);
    if (code === 0) {
      return (parsed.data && typeof parsed.data === 'object' ? parsed.data : {}) as Record<string, unknown>;
    }
    const message = text(parsed.message) || 'unknown error';
    if (code === 40400) {
      throw new Error(`MetaWeb pins-batch API not found: ${message}`);
    }
    throw new Error(`MetaWeb pins-batch API error ${code}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBatchOptions(options: MetawebPinServiceOptions | undefined): Promise<{
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for MetaWeb pins batch read.');
  }
  return {
    baseUrl: (options?.baseUrl ?? DEFAULT_METAWEB_PIN_BASE_URL).replace(/\/+$/, ''),
    fetchImpl,
    timeoutMs: options?.timeoutMs ?? 10_000,
  };
}

/**
 * Read up to 50 pins in one round trip. The response is a map keyed by the
 * requested pinId; entries are full pin objects (same shape as
 * GET /api/metaweb/pin/:id plus version info) or isolated {error} entries.
 */
export async function metawebPinsBatch(
  pinIds: string[],
  options?: MetawebPinServiceOptions,
): Promise<Record<string, MetawebBatchEntry>> {
  const { baseUrl, fetchImpl, timeoutMs } = await resolveBatchOptions(options);
  const ids = (pinIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('metawebPinsBatch requires at least one pinId.');
  }
  if (ids.length > METAWEB_PINS_BATCH_MAX) {
    throw new Error(`metawebPinsBatch accepts at most ${METAWEB_PINS_BATCH_MAX} pinIds per call (got ${ids.length}).`);
  }
  const data = await postEnvelope(
    `${baseUrl}/api/metaweb/pins:batch`,
    { pinIds: ids },
    fetchImpl,
    timeoutMs,
  );
  const pinsRaw = (data.pins && typeof data.pins === 'object' ? data.pins : {}) as Record<string, unknown>;
  const out: Record<string, MetawebBatchEntry> = {};
  for (const requestedId of ids) {
    if (requestedId in pinsRaw) {
      out[requestedId] = normalizeBatchEntry(requestedId, pinsRaw[requestedId]);
    } else {
      out[requestedId] = { pinId: requestedId, error: 'pin missing from batch response' };
    }
  }
  return out;
}

// ---------------- budget-capped batch renderer ----------------

/** Total char budget the rendered batch must fit under (IDBots host budget port). */
export const METAWEB_BATCH_RESULT_CHAR_BUDGET = 18_000;
/**
 * Bodies whose equal share of the batch budget falls below this render as a
 * labeled pointer instead of a token sliver — a 40-char body is noise.
 */
export const METAWEB_BATCH_BODY_FLOOR_CHARS = 240;
/** Cap on the id/point lists in the machine-readable line; counts stay exact. */
export const METAWEB_BATCH_RECEIPT_MAX_LIST = 12;
export const METAWEB_BATCH_RECEIPT_MARKER = '- RECEIPT read_metaweb_pins_batch: ';
/** Reading caliber (口径) tag: names the upstream endpoint, its 8000-rune text cap, and this renderer's char budget. */
export const METAWEB_BATCH_READ_CALIBER =
  `api/metaweb/pins:batch;text-cap=8000runes;host-budget=${METAWEB_BATCH_RESULT_CHAR_BUDGET}chars`;

export type MetawebBatchTruncationPoint = {
  pin_id: string;
  reason: 'trimmed' | 'omitted' | 'server_cap';
  /** Body chars delivered in this output, counted in `unit` (0 for a whole-body omission). */
  kept_chars: number;
  /** The full body's UTF-16 chars; null when only the upstream-capped text is known (server_cap). */
  total_chars: number | null;
  /** UTF-8 byte offset into the full body where delivery stopped (0 for a whole-body omission). */
  cut_at_bytes: number;
  /** The full body's UTF-8 bytes; null when only the capped text is known (server_cap). */
  total_bytes: number | null;
  /** Unit of kept_chars/total_chars: UTF-16 units for host cuts, runes for the upstream cap. */
  unit: 'utf16-char' | 'rune';
};

export type MetawebBatchReadReceipt = {
  /** pinIds asked for in this call. */
  requested: number;
  /** Pins whose upstream fetch returned a body — the header's first number. */
  readable_upstream: number;
  /** Bodies actually present in the delivered receipt (whole + trimmed). */
  returned: number;
  /** True when any body was cut or dropped. */
  truncated: boolean;
  /** UTF-8 byte length of the delivered receipt text, THIS marker line included. */
  bytes_written: number;
  /** Readable pins whose whole body was dropped to fit the render budget (exact count). */
  omitted: number;
  /** Omitted pin ids, capped at METAWEB_BATCH_RECEIPT_MAX_LIST — `omitted` stays exact. */
  omitted_ids: string[];
  /** Requested ids that produced no usable body at all (error / no entry / encrypted-or-empty); exact count. */
  unreadable: number;
  /** Unreadable ids, capped like the omitted list. */
  unreadable_ids: string[];
  /** Exact number of cuts (trimmed + omitted + upstream-capped); `truncation_points` is capped. */
  truncation_point_count: number;
  /** Per-cut detail, capped at METAWEB_BATCH_RECEIPT_MAX_LIST. */
  truncation_points: MetawebBatchTruncationPoint[];
  caliber: string;
};

/** Degenerate batch: even meta-only skeletons bust the budget — fail loudly with a split size. */
export class MetawebBatchTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetawebBatchTooLargeError';
  }
}

/**
 * Assemble the batch receipt with its machine-readable marker line and solve
 * `bytes_written` to a fixed point: the marker's own digits change the text
 * length it reports, so the value is measured on the assembled receipt and
 * re-embedded until stable.
 */
export function buildMetawebBatchReadReceipt(args: {
  header: string;
  sections: string[];
  receipt: Omit<MetawebBatchReadReceipt, 'bytes_written'>;
}): string {
  const { header, sections, receipt } = args;
  const assemble = (bytesWritten: number): string => [
    header,
    `${METAWEB_BATCH_RECEIPT_MARKER}${JSON.stringify({ ...receipt, bytes_written: bytesWritten })}`,
    ...sections,
    METAWEB_CITATION_RULE,
  ].join('\n\n');
  let bytesWritten = 0;
  let text = assemble(bytesWritten);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const measured = Buffer.byteLength(text, 'utf8');
    if (measured === bytesWritten) break;
    bytesWritten = measured;
    text = assemble(bytesWritten);
  }
  return text;
}

export type RenderMetawebPinsBatchResult = {
  text: string;
  receipt: MetawebBatchReadReceipt;
  /** Pins whose body actually rendered (whole + trimmed) — for read-ledger recording. */
  deliveredPins: MetawebBatchPin[];
};

/**
 * Render a batch read under the result budget (two-pass water-filling, exact
 * OAC port of the IDBots renderer). Throws MetawebBatchTooLargeError for
 * degenerate batches that cannot render within the budget even without
 * bodies — the caller surfaces that as a split-and-retry error, never as a
 * silently beheaded result.
 */
export function renderMetawebPinsBatch(
  pinIds: string[],
  entries: Record<string, MetawebBatchEntry>,
): RenderMetawebPinsBatchResult {
  // `body` carries the null-checked text: MetawebPin.text is string|null,
  // and readable slots are exactly the ones whose text survived the check.
  type ReadableSlot = { pin: MetawebBatchPin; body: string; skeleton: string };
  const slots: Array<string | ReadableSlot> = [];
  const readableSlots: ReadableSlot[] = [];
  const unreadableIds: string[] = [];
  for (const requestedId of pinIds) {
    const entry = entries[requestedId];
    if (!entry) {
      unreadableIds.push(requestedId);
      slots.push(`## ${requestedId}\n(no entry returned for this pinId — treat it as unreadable and move on)`);
      continue;
    }
    if (isBatchErrorEntry(entry)) {
      unreadableIds.push(requestedId);
      slots.push(`## ${requestedId}\n- error: ${entry.error}`);
      continue;
    }
    const pin = entry as MetawebBatchPin;
    if (pin.text == null) {
      unreadableIds.push(requestedId);
      slots.push(`## ${requestedId}\n- (${pin.protocol || 'unknown protocol'}) has no readable text content (encrypted, binary, or empty) — skip it; do NOT invent its content.`);
      continue;
    }
    const slot: ReadableSlot = { pin, body: pin.text, skeleton: formatMetawebPinDetail({ ...pin, text: null }) };
    readableSlots.push(slot);
    slots.push(slot);
  }

  if (readableSlots.length === 0) {
    const header = `0/${pinIds.length} pin(s) readable in this batch:`;
    const receiptHead: Omit<MetawebBatchReadReceipt, 'bytes_written'> = {
      requested: pinIds.length,
      readable_upstream: 0,
      returned: 0,
      truncated: false,
      omitted: 0,
      omitted_ids: [],
      unreadable: unreadableIds.length,
      unreadable_ids: unreadableIds.slice(0, METAWEB_BATCH_RECEIPT_MAX_LIST),
      truncation_point_count: 0,
      truncation_points: [],
      caliber: METAWEB_BATCH_READ_CALIBER,
    };
    const text = buildMetawebBatchReadReceipt({
      header,
      sections: slots.filter((slot): slot is string => typeof slot === 'string'),
      receipt: receiptHead,
    });
    return { text, receipt: { ...receiptHead, bytes_written: Buffer.byteLength(text, 'utf8') }, deliveredPins: [] };
  }

  // Measured per-body overhead (content-block wrapper, notes, trim label
  // allowance) — exact for this batch's shapes instead of a guess.
  const sample = readableSlots[0];
  const perBodyOverhead = formatMetawebPinDetail(sample.pin).length
    - sample.skeleton.length
    - sample.body.length
    + 170;
  const joinsAndFooter = pinIds.length * 2 + METAWEB_CITATION_RULE.length + 260;
  const skeletonTotal = slots.reduce(
    (sum, slot) => sum + (typeof slot === 'string' ? slot.length : slot.skeleton.length),
    0,
  );
  const fixedTotal = joinsAndFooter + readableSlots.length * perBodyOverhead;
  if (skeletonTotal + fixedTotal > METAWEB_BATCH_RESULT_CHAR_BUDGET) {
    // Degenerate batch: even meta-only skeletons bust the budget. Fail loudly
    // with a split size instead of emitting a result the runtime would
    // head+tail cut anyway.
    const avgSkeleton = Math.ceil(skeletonTotal / pinIds.length);
    const suggest = Math.max(1, Math.floor((METAWEB_BATCH_RESULT_CHAR_BUDGET - joinsAndFooter) / avgSkeleton));
    throw new MetawebBatchTooLargeError(
      `This batch (${pinIds.length} pins) cannot render within the result budget even without bodies — the meta blocks alone are ~${skeletonTotal} chars. Split it into batches of at most ~${suggest} pinIds and retry.`,
    );
  }
  const baseBodyBudget = METAWEB_BATCH_RESULT_CHAR_BUDGET - fixedTotal - skeletonTotal;
  // Water-filling: pins whose whole body fits under the running equal share
  // take it whole, shrinking the denominator for the rest.
  const allocateBodies = (bodyBudget: number): number[] => {
    const kept = new Array<number>(readableSlots.length).fill(0);
    const allocationOrder = readableSlots
      .map((slot, index) => ({ need: slot.body.length, index }))
      .sort((a, b) => a.need - b.need);
    let remaining = bodyBudget;
    let pending = allocationOrder.length;
    for (const { need, index } of allocationOrder) {
      const cap = Math.floor(remaining / pending);
      const keep = Math.min(need, cap);
      kept[index] = keep;
      remaining -= keep;
      pending -= 1;
    }
    return kept;
  };
  const renderReceipt = (keptChars: number[]): { text: string; receipt: MetawebBatchReadReceipt; deliveredPins: MetawebBatchPin[] } => {
    const sections: string[] = [];
    let trimmedCount = 0;
    let readableSeen = 0;
    // Delivery accounting for the machine-readable receipt: what actually
    // landed in this output, per pin — the header counts upstream fetch
    // outcomes, which is a different question.
    let returnedCount = 0;
    const omittedIds: string[] = [];
    const truncationPoints: MetawebBatchTruncationPoint[] = [];
    const deliveredPins: MetawebBatchPin[] = [];
    for (const slot of slots) {
      if (typeof slot === 'string') {
        sections.push(slot);
        continue;
      }
      const { pin } = slot;
      const keep = keptChars[readableSeen];
      readableSeen += 1;
      const whole = keep >= slot.body.length;
      const omit = !whole && keep < METAWEB_BATCH_BODY_FLOOR_CHARS;
      if (!whole) trimmedCount += 1;
      if (omit) {
        omittedIds.push(pin.pinId);
        truncationPoints.push({
          pin_id: pin.pinId,
          reason: 'omitted',
          kept_chars: 0,
          total_chars: slot.body.length,
          cut_at_bytes: 0,
          total_bytes: Buffer.byteLength(slot.body, 'utf8'),
          unit: 'utf16-char',
        });
      } else {
        returnedCount += 1;
        deliveredPins.push(pin);
        if (!whole) {
          const delivered = slot.body.slice(0, keep);
          truncationPoints.push({
            pin_id: pin.pinId,
            reason: 'trimmed',
            kept_chars: keep,
            total_chars: slot.body.length,
            cut_at_bytes: Buffer.byteLength(delivered, 'utf8'),
            total_bytes: Buffer.byteLength(slot.body, 'utf8'),
            unit: 'utf16-char',
          });
        } else if (pin.truncated === true) {
          // The upstream 8000-rune cap is a cut too, but only a whole-in-budget
          // body records it: a body the host already trimmed or omitted records
          // its host cut alone (one cut per pin — IDBots placement, so receipts
          // stay identical across hosts).
          truncationPoints.push({
            pin_id: pin.pinId,
            reason: 'server_cap',
            kept_chars: Array.from(slot.body).length,
            total_chars: pin.totalLength,
            cut_at_bytes: Buffer.byteLength(slot.body, 'utf8'),
            total_bytes: null,
            unit: 'rune',
          });
        }
      }
      sections.push(omit
        ? formatMetawebPinDetail(pin, { omitBody: true })
        : formatMetawebPinDetail(pin, whole ? undefined : { bodyCharCap: keep }));
    }
    const budgetNote = trimmedCount > 0
      ? `; ${trimmedCount} body(ies) trimmed or omitted to fit the result budget — read_metaweb_pin any of them you need in full`
      : '';
    const header = `${readableSlots.length}/${pinIds.length} pin(s) readable in this batch${budgetNote}:`;
    const receiptHead: Omit<MetawebBatchReadReceipt, 'bytes_written'> = {
      requested: pinIds.length,
      readable_upstream: readableSlots.length,
      returned: returnedCount,
      truncated: truncationPoints.length > 0,
      omitted: omittedIds.length,
      omitted_ids: omittedIds.slice(0, METAWEB_BATCH_RECEIPT_MAX_LIST),
      unreadable: unreadableIds.length,
      unreadable_ids: unreadableIds.slice(0, METAWEB_BATCH_RECEIPT_MAX_LIST),
      truncation_point_count: truncationPoints.length,
      truncation_points: truncationPoints.slice(0, METAWEB_BATCH_RECEIPT_MAX_LIST),
      caliber: METAWEB_BATCH_READ_CALIBER,
    };
    const text = buildMetawebBatchReadReceipt({ header, sections, receipt: receiptHead });
    return { text, receipt: { ...receiptHead, bytes_written: Buffer.byteLength(text, 'utf8') }, deliveredPins };
  };
  let renderBudget = baseBodyBudget;
  let rendered = renderReceipt(allocateBodies(renderBudget));
  // The machine-readable line is part of the delivered bytes too, so a batch
  // that filled its content budget would overflow it once the line is added.
  // Claw the overflow back from the body budget and re-render; trimming
  // bodies can add marker entries, so a couple of passes converge (the
  // budget only shrinks, so this terminates).
  for (let attempt = 0; attempt < 3 && rendered.text.length > METAWEB_BATCH_RESULT_CHAR_BUDGET; attempt += 1) {
    const nextBudget = renderBudget - (rendered.text.length - METAWEB_BATCH_RESULT_CHAR_BUDGET) - 16;
    if (nextBudget < 0) break;
    renderBudget = nextBudget;
    rendered = renderReceipt(allocateBodies(renderBudget));
  }
  if (rendered.text.length > METAWEB_BATCH_RESULT_CHAR_BUDGET) {
    // Bodies are already dropped and it still does not fit (only possible
    // when the meta blocks plus the machine-readable line alone bust the
    // budget): fail loudly instead of emitting a result the runtime would
    // head+tail cut.
    const splitHint = `Split it into batches of at most ~${Math.max(1, Math.floor((METAWEB_BATCH_RESULT_CHAR_BUDGET - joinsAndFooter) / Math.max(1, Math.ceil(skeletonTotal / pinIds.length))))} pinIds and retry.`;
    throw new MetawebBatchTooLargeError(
      `This batch (${pinIds.length} pins) cannot render within the result budget — the meta blocks plus the machine-readable receipt alone are over budget. ${splitHint}`,
    );
  }
  return rendered;
}
