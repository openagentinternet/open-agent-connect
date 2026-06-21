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

function base64ToBytes(value) {
  var base64 = value.replace(/\s+/g, '');
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

  return {
    operation: 'create',
    body: base64ToBytes(body),
    path: AVATAR_PATH,
    encoding: 'binary',
    contentType: mimeType + ';binary',
  };
}
