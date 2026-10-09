export interface SurfNoLlmIngestPin {
  pinId: string;
  meta?: { title?: string };
  /** LLM-ready normalized body; null when empty/binary/encrypted — skip. */
  text: string | null;
}

export interface SurfNoLlmIngestResult {
  savedToKb: number;
  savedPinIds: string[];
  skippedPinIds: string[];
}

const MAX_DOCUMENT_CHARS = 100_000;

/**
 * Deterministic no-LLM surf fallback (Grok Bot scenario): when no LLM channel
 * is usable at all, the fetch/list/save part of the pipeline still works —
 * read each briefed pin's raw body and file it into the knowledge base
 * untouched. No deep reading, no knowledge points, no chain interactions;
 * the caller reports the run as partial.
 */
export async function runSurfNoLlmKbIngest(input: {
  items: Array<{ pinId: string; title?: string }>;
  maxSaves: number;
  readPin: (pinId: string) => Promise<SurfNoLlmIngestPin>;
  addDocument: (doc: { title: string; content: string; sourceType: 'metaweb'; pinId: string }) => Promise<unknown>;
  logWarning?: (message: string) => void;
}): Promise<SurfNoLlmIngestResult> {
  const logWarning = input.logWarning ?? (() => undefined);
  const result: SurfNoLlmIngestResult = { savedToKb: 0, savedPinIds: [], skippedPinIds: [] };
  for (const item of input.items) {
    if (result.savedToKb >= input.maxSaves) {
      break;
    }
    const pinId = typeof item?.pinId === 'string' ? item.pinId.trim() : '';
    if (!pinId) {
      continue;
    }
    let pin: SurfNoLlmIngestPin;
    try {
      pin = await input.readPin(pinId);
    } catch (error) {
      logWarning(`pin ${pinId} read failed: ${error instanceof Error ? error.message : String(error)}`);
      result.skippedPinIds.push(pinId);
      continue;
    }
    const text = typeof pin.text === 'string' ? pin.text.trim() : '';
    if (!text) {
      result.skippedPinIds.push(pinId);
      continue;
    }
    try {
      await input.addDocument({
        title: (pin.meta?.title ?? item.title ?? '').trim() || pinId,
        content: text.length > MAX_DOCUMENT_CHARS ? `${text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[truncated]` : text,
        sourceType: 'metaweb',
        pinId,
      });
      result.savedToKb += 1;
      result.savedPinIds.push(pinId);
    } catch (error) {
      logWarning(`pin ${pinId} KB save failed: ${error instanceof Error ? error.message : String(error)}`);
      result.skippedPinIds.push(pinId);
    }
  }
  return result;
}
