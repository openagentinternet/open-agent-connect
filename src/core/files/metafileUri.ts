const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
  'application/gzip': '.gz',
  'application/javascript': '.js',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/xml': '.xml',
  'application/x-tar': '.tar',
  'application/zip': '.zip',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/css': '.css',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function existingExtension(path: string): string | null {
  const lastDot = path.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === path.length - 1) {
    return null;
  }
  return path.slice(lastDot).toLowerCase();
}

export function safeMetafileExtension(value: unknown): string | null {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }
  const extension = normalized.startsWith('.') ? normalized : `.${normalized}`;
  if (!/^\.[a-z0-9][a-z0-9+-]{0,31}$/.test(extension)) {
    return null;
  }
  return extension;
}

export function extensionFromContentType(value: unknown): string | null {
  const normalized = normalizeText(value).toLowerCase().split(';', 1)[0].trim();
  return CONTENT_TYPE_EXTENSION_MAP[normalized] ?? null;
}

export function appendMetafileUriExtension(uri: unknown, extension: unknown): string {
  const normalizedUri = normalizeText(uri);
  const normalizedExtension = safeMetafileExtension(extension);
  if (!normalizedUri || !normalizedExtension || !normalizedUri.toLowerCase().startsWith('metafile://')) {
    return normalizedUri;
  }

  const match = normalizedUri.match(/^metafile:\/\/([^?#]+)([?#].*)?$/iu);
  if (!match) {
    return normalizedUri;
  }
  const path = match[1] || '';
  if (!path || path.includes('/') || path.includes('\\') || existingExtension(path)) {
    return normalizedUri;
  }

  return `metafile://${path}${normalizedExtension}${match[2] || ''}`;
}

export function metafileUriFromPinId(pinId: unknown, extension: unknown): string {
  const normalizedPinId = normalizeText(pinId);
  if (!normalizedPinId) {
    return '';
  }
  return appendMetafileUriExtension(`metafile://${normalizedPinId}`, extension);
}
