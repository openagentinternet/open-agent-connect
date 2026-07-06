import { assertMetaAppPinId } from './pinId';

export const METAAPP_PUBLIC_BASE_URL = 'https://openagentinternet.org/browser/metaapp';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildMetaAppCanonicalUrl(pinId: string): string {
  const normalizedPinId = assertMetaAppPinId(pinId);
  return `${METAAPP_PUBLIC_BASE_URL}/${normalizedPinId}`;
}

export function buildMetaAppShareBundle(pinId: string): {
  pinId: string;
  metawebUrl: string;
  suggestedBuzz: string;
} {
  const normalizedPinId = assertMetaAppPinId(pinId);
  const metawebUrl = buildMetaAppCanonicalUrl(normalizedPinId);
  return {
    pinId: normalizedPinId,
    metawebUrl,
    suggestedBuzz: `I published a MetaApp: ${metawebUrl}`,
  };
}

export function buildMetaAppBuzzRequest(input: {
  pinId: string;
  message?: string;
}): {
  content: string;
  contentType: 'text/plain;utf-8';
  quotePin: string;
} {
  const share = buildMetaAppShareBundle(input.pinId);
  return {
    content: normalizeText(input.message) || share.suggestedBuzz,
    contentType: 'text/plain;utf-8',
    quotePin: share.pinId,
  };
}

export function buildMetaAppCommentWrite(input: {
  pinId: string;
  comment: string;
}): {
  operation: 'create';
  path: '/protocols/paycomment';
  contentType: 'application/json';
  payload: string;
} {
  const pinId = assertMetaAppPinId(input.pinId);
  const comment = normalizeText(input.comment);
  if (!comment) {
    throw new Error('MetaApp comment requires non-empty content.');
  }

  return {
    operation: 'create',
    path: '/protocols/paycomment',
    contentType: 'application/json',
    payload: JSON.stringify({
      content: comment,
      contentType: 'text/plain;utf-8',
      commentTo: pinId,
    }),
  };
}
