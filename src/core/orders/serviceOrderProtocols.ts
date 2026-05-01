import {
  buildDeliveryMessage as buildA2ADeliveryMessage,
  parseDeliveryMessage as parseA2ADeliveryMessage,
  parseNeedsRatingMessage as parseA2ANeedsRatingMessage,
} from '../a2a/protocol/orderProtocol';

const MARKDOWN_HEADING_RE = /^#{1,6}\s+/;
const EXCLUDED_RESULT_SECTION_RE = /(服务订单确认|订单确认|order confirmation|payment confirmation|payment details|交易信息|付款信息|支付信息)/i;
const RESULT_METADATA_LINE_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:(?:支付金额)(?:\s+[0-9]+(?:\.[0-9]+)?\s+[A-Za-z0-9._-]+|\s*[:：])|(?:交易ID|交易Id|txid|commit txid|payment chain|settlement kind|mrc20 ticker|mrc20 id|output type|service id|服务ID|技能名称|skill name|payment(?: amount)?|transaction id|service name)\s*[:：])/i;
const INTRO_CHATTER_RE = /(你好|您好|我是|数字主分身|收到你的服务订单|成功处理了你的服务订单|已经成功处理|链上远端服务)/i;
const CLOSING_CHATTER_RE = /(?:服务已完成|感谢.*使用|如有其他需求|欢迎随时联系|欢迎再次使用|希望.*体验|欢迎.*评价|欢迎.*反馈|期待.*再次)/i;

export interface DeliveryMessagePayload {
  paymentTxid?: string | null;
  servicePinId?: string | null;
  serviceName?: string | null;
  result?: string | null;
  deliveredAt?: number | null;
  [key: string]: unknown;
}

export function buildDeliveryMessage(payload: DeliveryMessagePayload): string {
  return buildA2ADeliveryMessage(payload);
}

function normalizeMultilineText(value: unknown): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function compactBlankLines(value: string): string {
  return value
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitMarkdownSections(value: string): string[] {
  const lines = value.split('\n');
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (MARKDOWN_HEADING_RE.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join('\n').trim());
  }
  return sections.filter(Boolean);
}

function getSectionHeading(sectionText: string): string {
  const firstLine = sectionText.split('\n')[0]?.trim() || '';
  return MARKDOWN_HEADING_RE.test(firstLine) ? firstLine : '';
}

function shouldDropIntroLine(line: string): boolean {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  return INTRO_CHATTER_RE.test(trimmed) || RESULT_METADATA_LINE_RE.test(trimmed);
}

function shouldDropTrailingLine(line: string): boolean {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  return RESULT_METADATA_LINE_RE.test(trimmed) || CLOSING_CHATTER_RE.test(trimmed);
}

function cleanupResidualLines(value: string): string {
  const lines = normalizeMultilineText(value).split('\n');
  if (lines.length === 0) return '';

  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (!line) {
      start += 1;
      continue;
    }
    if (shouldDropIntroLine(line)) {
      start += 1;
      continue;
    }
    break;
  }

  let end = lines.length;
  while (end > start) {
    const line = lines[end - 1].trim();
    if (!line) {
      end -= 1;
      continue;
    }
    if (shouldDropTrailingLine(line)) {
      end -= 1;
      continue;
    }
    break;
  }

  const kept: string[] = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (RESULT_METADATA_LINE_RE.test(line.trim())) {
      continue;
    }
    kept.push(line);
  }

  return compactBlankLines(kept.join('\n'));
}

export function cleanServiceResultText(content: string): string {
  const raw = normalizeMultilineText(content);
  if (!raw) return '';

  const sections = splitMarkdownSections(raw);
  if (sections.length > 1) {
    const keptSections = sections.filter((section, index) => {
      const heading = getSectionHeading(section);
      if (!heading) {
        return index !== 0;
      }
      return !EXCLUDED_RESULT_SECTION_RE.test(heading);
    });
    const cleanedSections = keptSections
      .map((section) => cleanupResidualLines(section))
      .filter(Boolean);
    const combined = compactBlankLines(cleanedSections.join('\n\n'));
    if (combined) {
      return combined;
    }
  }

  const cleaned = cleanupResidualLines(raw);
  return cleaned || raw;
}

export function parseDeliveryMessage(content: string): DeliveryMessagePayload | null {
  return parseA2ADeliveryMessage(content) as DeliveryMessagePayload | null;
}

export function parseNeedsRatingMessage(content: string): string | null {
  const parsed = parseA2ANeedsRatingMessage(content);
  return parsed ? parsed.content : null;
}
