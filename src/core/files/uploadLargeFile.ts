import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Signer } from '../signing/signer';
import { buildMetafileContentUrls } from './metafileUrls';
import { verifyMetafileAvailability } from './metafileVerifier';
import { inferUploadContentType, uploadLocalFileToChain } from './uploadFile';

export const DIRECT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const LARGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export type UploadLargeFileMode = 'direct' | 'chunked';

export interface UploadLargeFileResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  filePath?: string;
  fileName: string;
  contentType: string;
  bytes: number;
  extension: string;
  metafileUri: string;
  previewUrl: string;
  downloadUrl: string;
  globalMetaId: string;
  uploadMode: UploadLargeFileMode;
  verification?: {
    ok: boolean;
    url: string | null;
    attempts: number;
    error?: string;
  };
}

export interface ProductionLargeFileUploader {
  upload(input: {
    filePath: string;
    fileName: string;
    contentType: string;
    bytes: number;
    extension: string;
    network: string;
    signer: Signer;
  }): Promise<Omit<UploadLargeFileResult, 'verification'>>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveBytes(value: unknown, fallback: number): number {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}

async function maybeVerify(
  input: {
    pinId: string;
    verify?: boolean;
    verifyAvailability?: (pinId: string) => Promise<UploadLargeFileResult['verification']>;
  },
): Promise<UploadLargeFileResult['verification'] | undefined> {
  if (input.verifyAvailability) {
    return input.verifyAvailability(input.pinId);
  }

  if (input.verify) {
    return verifyMetafileAvailability({ pinId: input.pinId });
  }

  return undefined;
}

function withCanonicalUrls<T extends Omit<UploadLargeFileResult, 'previewUrl' | 'downloadUrl'>>(
  result: T,
): T & Pick<UploadLargeFileResult, 'previewUrl' | 'downloadUrl'> {
  const urls = buildMetafileContentUrls(result.pinId);
  return {
    ...result,
    previewUrl: urls.previewUrl,
    downloadUrl: urls.downloadUrl,
  };
}

export async function uploadLargeFileToChain(input: {
  filePath: string;
  contentType?: string;
  network?: string;
  signer: Signer;
  largeUploader?: ProductionLargeFileUploader;
  verify?: boolean;
  verifyAvailability?: (pinId: string) => Promise<UploadLargeFileResult['verification']>;
  directMaxBytes?: number;
  hardMaxBytes?: number;
}): Promise<UploadLargeFileResult> {
  const filePath = normalizeText(input.filePath);
  if (!filePath) {
    throw new Error('Large file upload requires a local filePath.');
  }

  const resolvedPath = path.resolve(filePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Large file upload requires a regular file: ${resolvedPath}`);
  }

  const network = normalizeText(input.network) || 'mvc';
  if (network.toLowerCase() === 'doge') {
    throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
  }

  const directMaxBytes = normalizePositiveBytes(input.directMaxBytes, DIRECT_UPLOAD_MAX_BYTES);
  const hardMaxBytes = normalizePositiveBytes(input.hardMaxBytes, LARGE_UPLOAD_MAX_BYTES);
  if (stat.size > hardMaxBytes) {
    throw new Error(`File exceeds maximum upload size of ${hardMaxBytes} bytes.`);
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = normalizeText(input.contentType) || inferUploadContentType(resolvedPath);

  if (stat.size <= directMaxBytes) {
    const directResult = await uploadLocalFileToChain({
      filePath: resolvedPath,
      contentType,
      network,
      signer: input.signer,
    });
    const result = withCanonicalUrls({
      ...directResult,
      uploadMode: 'direct' as const,
    });
    const verification = await maybeVerify({
      pinId: result.pinId,
      verify: input.verify,
      verifyAvailability: input.verifyAvailability,
    });
    return verification ? { ...result, verification } : result;
  }

  if (network.toLowerCase() !== 'mvc') {
    throw new Error('Large file upload currently supports MVC only.');
  }

  if (!input.largeUploader) {
    const error = new Error(
      'large_file_upload_unavailable: Large file upload requires an injected largeUploader.',
    );
    (error as Error & { code?: string }).code = 'large_file_upload_unavailable';
    throw error;
  }

  const largeResult = await input.largeUploader.upload({
    filePath: resolvedPath,
    fileName: path.basename(resolvedPath),
    contentType,
    bytes: stat.size,
    extension,
    network,
    signer: input.signer,
  });
  const result = withCanonicalUrls({
    pinId: largeResult.pinId,
    txids: largeResult.txids,
    totalCost: largeResult.totalCost,
    network: largeResult.network,
    fileName: largeResult.fileName,
    contentType: largeResult.contentType,
    bytes: largeResult.bytes,
    extension: largeResult.extension,
    metafileUri: largeResult.metafileUri,
    globalMetaId: largeResult.globalMetaId,
    uploadMode: 'chunked' as const,
  });
  const verification = await maybeVerify({
    pinId: result.pinId,
    verify: input.verify,
    verifyAvailability: input.verifyAvailability,
  });
  return verification ? { ...result, verification } : result;
}
