const AVATAR_PATH = '/info/avatar';
const SUPPORTED_AVATAR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAvatarMimeType(value) {
  var mimeType = normalizeText(value).toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function isRawBase64Payload(value) {
  var base64 = value.replace(/\s+/g, '');
  if (!base64 || base64.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64);
}

export function buildAvatarMetaidData(input) {
  var body = normalizeText(input && input.avatarBase64);
  if (!body) return null;
  if (/^data:/i.test(body)) {
    throw new Error('Avatar body must be raw base64 without a data URL prefix.');
  }
  if (!isRawBase64Payload(body)) {
    throw new Error('Avatar body must be raw base64.');
  }

  var mimeType = normalizeAvatarMimeType(input && input.avatarContentType);
  if (!SUPPORTED_AVATAR_MIME_TYPES.has(mimeType)) {
    throw new Error('Avatar contentType must be a supported binary image type.');
  }

  var avatarId = normalizeText(input && input.avatarId);
  return {
    operation: avatarId ? 'modify' : 'create',
    body: body,
    path: avatarId ? '@' + avatarId : AVATAR_PATH,
    encoding: 'base64',
    contentType: mimeType + ';binary',
  };
}
