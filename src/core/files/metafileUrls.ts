const FILE_INDEXER_BASE = 'https://file.metaid.io/metafile-indexer/api/v1/files';
const METAFILE_BROWSER_BASE = 'https://openagentinternet.org/browser/metafile';

export interface MetafileContentUrls {
  accelerateUrl: string;
  contentUrl: string;
  legacyContentUrl: string;
  previewUrl: string;
  downloadUrl: string;
}

export function buildMetafileContentUrls(pinId: string): MetafileContentUrls {
  const normalized = String(pinId || '').trim();
  if (!normalized) {
    throw new Error('pinId is required.');
  }

  const encoded = encodeURIComponent(normalized);
  const accelerateUrl = `${FILE_INDEXER_BASE}/accelerate/content/${encoded}`;
  const contentUrl = `${FILE_INDEXER_BASE}/content/${encoded}`;

  return {
    accelerateUrl,
    contentUrl,
    legacyContentUrl: `https://file.metaid.io/metafile-indexer/content/${encoded}`,
    previewUrl: contentUrl,
    downloadUrl: accelerateUrl,
  };
}

export function buildMetafileBrowserUrl(pinId: string): string {
  const normalized = String(pinId || '').trim();
  if (!normalized) {
    throw new Error('pinId is required.');
  }

  return `${METAFILE_BROWSER_BASE}/${encodeURIComponent(normalized)}`;
}
