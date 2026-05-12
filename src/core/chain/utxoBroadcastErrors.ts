function normalizeText(value: unknown): string {
  return value instanceof Error ? value.message.trim() : typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function isRetryableUtxoFundingError(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return (
    normalized.includes('txn-mempool-conflict')
    || /mempool[-\s]?conflict/.test(normalized)
    || normalized.includes('missingorspent')
    || normalized.includes('inputs missing/spent')
    || normalized.includes('inputs missing or spent')
    || normalized.includes('missing inputs')
  );
}
