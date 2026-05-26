import { assertMetaAppPinId } from './pinId';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildMetaAppCanonicalUrl(pinId: string): string {
  const normalizedPinId = assertMetaAppPinId(pinId);
  return `https://metaweb.world/metaapp/${normalizedPinId}`;
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
