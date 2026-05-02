export const ORDER_PREFIX = '[ORDER]';
export const ORDER_RAW_REQUEST_OPEN_TAG = '<raw_request>';
export const ORDER_RAW_REQUEST_CLOSE_TAG = '</raw_request>';

const ORDER_PREFIX_RE = /^\s*\[ORDER\]\s*/i;
const RAW_REQUEST_BLOCK_RE = /<raw_request>\s*\n?([\s\S]*?)\n?\s*<\/raw_request>/i;

function normalizeMultilineText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim()
    : '';
}

function normalizeSingleLineText(value: unknown): string {
  return normalizeMultilineText(value).replace(/\s+/g, ' ').trim();
}

function getFallbackDisplaySummary(rawRequest: string): string {
  const normalized = normalizeMultilineText(rawRequest);
  if (!normalized) return '';
  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || normalized;
}

export function normalizeOrderRawRequest(value: unknown): string {
  return normalizeMultilineText(value);
}

export function extractOrderRawRequest(plaintext: string): string {
  const source = String(plaintext || '').replace(/\r\n?/g, '\n');
  const match = source.match(RAW_REQUEST_BLOCK_RE);
  return match?.[1] ? match[1].trim() : '';
}

export function buildOrderRawRequestBlock(rawRequest: string): string {
  const normalized = normalizeOrderRawRequest(rawRequest);
  return `${ORDER_RAW_REQUEST_OPEN_TAG}\n${normalized}\n${ORDER_RAW_REQUEST_CLOSE_TAG}`;
}

export function buildOrderPayload(input: {
  displayText?: unknown;
  rawRequest?: unknown;
  price?: unknown;
  currency?: unknown;
  paymentTxid?: unknown;
  paymentCommitTxid?: unknown;
  paymentChain?: unknown;
  settlementKind?: unknown;
  mrc20Ticker?: unknown;
  mrc20Id?: unknown;
  orderReference?: unknown;
  serviceId?: unknown;
  skillName?: unknown;
  serviceName?: unknown;
  outputType?: unknown;
}): string {
  const rawRequest = normalizeOrderRawRequest(input?.rawRequest);
  const displaySummary = normalizeSingleLineText(input?.displayText)
    || getFallbackDisplaySummary(rawRequest)
    || normalizeSingleLineText(input?.serviceName)
    || normalizeSingleLineText(input?.skillName)
    || 'Service Order';
  const effectiveRawRequest = rawRequest
    || getFallbackDisplaySummary(displaySummary)
    || normalizeSingleLineText(input?.serviceName)
    || normalizeSingleLineText(input?.skillName)
    || 'Service Order';
  const paymentTxid = normalizeSingleLineText(input?.paymentTxid);
  const paymentCommitTxid = normalizeSingleLineText(input?.paymentCommitTxid);
  const paymentChain = normalizeSingleLineText(input?.paymentChain);
  const settlementKind = normalizeSingleLineText(input?.settlementKind);
  const mrc20Ticker = normalizeSingleLineText(input?.mrc20Ticker);
  const mrc20Id = normalizeSingleLineText(input?.mrc20Id);
  const orderReference = normalizeSingleLineText(input?.orderReference);
  const outputType = normalizeSingleLineText(input?.outputType);

  const metadataLines = [
    `支付金额 ${String(input?.price || '').trim()} ${String(input?.currency || '').trim()}`,
  ];
  if (paymentTxid) {
    metadataLines.push(`txid: ${paymentTxid}`);
  } else if (orderReference) {
    metadataLines.push(`order id: ${orderReference}`);
  }
  if (paymentCommitTxid) {
    metadataLines.push(`commit txid: ${paymentCommitTxid}`);
  }
  if (paymentChain) {
    metadataLines.push(`payment chain: ${paymentChain}`);
  }
  if (settlementKind) {
    metadataLines.push(`settlement kind: ${settlementKind}`);
  }
  if (mrc20Ticker) {
    metadataLines.push(`mrc20 ticker: ${mrc20Ticker}`);
  }
  if (mrc20Id) {
    metadataLines.push(`mrc20 id: ${mrc20Id}`);
  }
  metadataLines.push(
    `service id: ${String(input?.serviceId || '').trim()}`,
    `skill name: ${String(input?.skillName || '').trim()}`,
  );
  if (outputType) {
    metadataLines.push(`output type: ${outputType}`);
  }

  return [
    `${ORDER_PREFIX} ${displaySummary}`,
    buildOrderRawRequestBlock(effectiveRawRequest),
    ...metadataLines,
  ].join('\n');
}

export function extractOrderDisplaySummary(plaintext: string): string {
  const source = String(plaintext || '').replace(/\r\n?/g, '\n');
  const firstLine = source.split('\n')[0] || '';
  return firstLine.replace(ORDER_PREFIX_RE, '').trim();
}
