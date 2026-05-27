import { buildMetafileContentUrls } from '../files/metafileUrls';

export type A2ADeliveryArtifactKind = 'image' | 'video' | 'audio' | 'file';

export interface A2ADeliveryArtifact {
  uri: string;
  pinId: string;
  kind: A2ADeliveryArtifactKind;
  fileName: string | null;
  extension: string | null;
  contentType: string | null;
  byteLength: number | null;
  sourceUrl: string;
  fallbackUrl: string;
  downloadUrl: string;
}

const IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const TRAILING_TEXT_PUNCTUATION = /[)\]}`.,;:!?]+$/;
const METAFILE_URI_PATTERN = /metafile:\/\/[^\s<>"']+/gi;

function normalizeExtension(extension: string | null): string | null {
  const trimmed = String(extension || '').trim();
  if (!trimmed) {
    return null;
  }

  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return withDot.toLowerCase();
}

function extensionFromPath(path: string): string | null {
  const lastSlash = path.lastIndexOf('/');
  const fileName = path.slice(lastSlash + 1);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return null;
  }

  return normalizeExtension(fileName.slice(lastDot));
}

function pinIdFromPath(path: string, extension: string | null): string | null {
  const lastSlash = path.lastIndexOf('/');
  const fileName = path.slice(lastSlash + 1);
  const pinId = extension ? fileName.slice(0, -extension.length) : fileName;
  const trimmed = pinId.trim();
  return trimmed ? trimmed : null;
}

function stripTrailingTextPunctuation(value: string): string {
  let normalized = value.trim();
  while (TRAILING_TEXT_PUNCTUATION.test(normalized)) {
    normalized = normalized.replace(TRAILING_TEXT_PUNCTUATION, '');
  }
  return normalized;
}

export function inferDeliveryArtifactKind(
  extension: string | null,
  contentType?: string | null,
): A2ADeliveryArtifactKind {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  if (normalizedContentType.startsWith('image/')) {
    return 'image';
  }
  if (normalizedContentType.startsWith('video/')) {
    return 'video';
  }
  if (normalizedContentType.startsWith('audio/')) {
    return 'audio';
  }

  const normalizedExtension = normalizeExtension(extension);
  if (normalizedExtension && IMAGE_EXTENSIONS.has(normalizedExtension)) {
    return 'image';
  }
  if (normalizedExtension && VIDEO_EXTENSIONS.has(normalizedExtension)) {
    return 'video';
  }
  if (normalizedExtension && AUDIO_EXTENSIONS.has(normalizedExtension)) {
    return 'audio';
  }

  return 'file';
}

export function parseMetafileUri(rawUri: string): A2ADeliveryArtifact | null {
  const uri = stripTrailingTextPunctuation(rawUri);
  if (!uri || !uri.toLowerCase().startsWith('metafile://')) {
    return null;
  }

  const withoutScheme = uri.slice('metafile://'.length);
  const path = withoutScheme.split(/[?#]/, 1)[0] || '';
  if (!path) {
    return null;
  }

  const extension = extensionFromPath(path);
  const pinId = pinIdFromPath(path, extension);
  if (!pinId) {
    return null;
  }

  const urls = buildMetafileContentUrls(pinId);

  return {
    uri,
    pinId,
    kind: inferDeliveryArtifactKind(extension),
    fileName: extension ? `${pinId}${extension}` : null,
    extension,
    contentType: null,
    byteLength: null,
    sourceUrl: urls.accelerateUrl,
    fallbackUrl: urls.contentUrl,
    downloadUrl: urls.accelerateUrl,
  };
}

export function extractDeliveryArtifactsFromText(text: string): A2ADeliveryArtifact[] {
  const seen = new Set<string>();
  const artifacts: A2ADeliveryArtifact[] = [];

  for (const match of String(text || '').matchAll(METAFILE_URI_PATTERN)) {
    const artifact = parseMetafileUri(match[0]);
    if (!artifact || seen.has(artifact.uri)) {
      continue;
    }

    seen.add(artifact.uri);
    artifacts.push(artifact);
  }

  return artifacts;
}
