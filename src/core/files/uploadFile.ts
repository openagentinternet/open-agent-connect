import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Signer } from '../signing/signer';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function inferUploadContentType(filePath: string): string {
  return MIME_MAP[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export interface UploadLocalFileToChainResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  filePath: string;
  fileName: string;
  contentType: string;
  bytes: number;
  extension: string;
  metafileUri: string;
  globalMetaId: string;
}

export interface UploadFileBufferToChainResult extends UploadLocalFileToChainResult {}

export async function uploadFileBufferToChain(input: {
  fileName: string;
  data: Buffer;
  contentType?: string;
  network?: string;
  signer: Signer;
}): Promise<UploadFileBufferToChainResult> {
  const fileName = path.basename(normalizeText(input.fileName) || 'upload.bin');
  const extension = path.extname(fileName).toLowerCase();
  const contentType = normalizeText(input.contentType) || inferUploadContentType(fileName);
  const network = normalizeText(input.network) || 'mvc';
  if (network.toLowerCase() === 'doge') {
    throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
  }
  if (!input.data.length) {
    throw new Error('File upload requires non-empty file data.');
  }

  const chainWrite = await input.signer.writePin({
    path: '/file',
    payload: input.data,
    contentType,
    encoding: 'binary',
    network,
  });

  return {
    pinId: chainWrite.pinId,
    txids: chainWrite.txids,
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    filePath: fileName,
    fileName,
    contentType,
    bytes: input.data.byteLength,
    extension,
    metafileUri: `metafile://${chainWrite.pinId}${extension}`,
    globalMetaId: chainWrite.globalMetaId,
  };
}

export async function uploadLocalFileToChain(input: {
  filePath: string;
  contentType?: string;
  network?: string;
  signer: Signer;
}): Promise<UploadLocalFileToChainResult> {
  const filePath = normalizeText(input.filePath);
  if (!filePath) {
    throw new Error('File upload requires a local filePath.');
  }

  const resolvedPath = path.resolve(filePath);
  const buffer = await fs.readFile(resolvedPath);
  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = normalizeText(input.contentType) || inferUploadContentType(resolvedPath);
  const network = normalizeText(input.network) || 'mvc';
  if (network.toLowerCase() === 'doge') {
    throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
  }

  const chainWrite = await input.signer.writePin({
    path: '/file',
    payload: buffer,
    contentType,
    encoding: 'binary',
    network,
  });

  return {
    pinId: chainWrite.pinId,
    txids: chainWrite.txids,
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    filePath: resolvedPath,
    fileName: path.basename(resolvedPath),
    contentType,
    bytes: buffer.byteLength,
    extension,
    metafileUri: `metafile://${chainWrite.pinId}${extension}`,
    globalMetaId: chainWrite.globalMetaId,
  };
}
