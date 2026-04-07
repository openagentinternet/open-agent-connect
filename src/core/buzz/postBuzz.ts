import type { Signer } from '../signing/signer';
import { uploadLocalFileToChain, type UploadLocalFileToChainResult } from '../files/uploadFile';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface PostBuzzToChainResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  content: string;
  contentType: string;
  attachments: string[];
  uploadedFiles: UploadLocalFileToChainResult[];
  globalMetaId: string;
}

export async function postBuzzToChain(input: {
  content: string;
  contentType?: string;
  attachments?: string[];
  quotePin?: string;
  network?: string;
  signer: Signer;
}): Promise<PostBuzzToChainResult> {
  const content = normalizeText(input.content);
  if (!content) {
    throw new Error('Buzz post requires non-empty content.');
  }

  const contentType = normalizeText(input.contentType) || 'text/plain;utf-8';
  const network = normalizeText(input.network) || 'mvc';
  const quotePin = normalizeText(input.quotePin);
  const attachmentPaths = normalizeStringArray(input.attachments);

  const uploadedFiles: UploadLocalFileToChainResult[] = [];
  for (const attachmentPath of attachmentPaths) {
    uploadedFiles.push(await uploadLocalFileToChain({
      filePath: attachmentPath,
      network,
      signer: input.signer,
    }));
  }

  const attachments = uploadedFiles.map((entry) => entry.metafileUri);
  const chainWrite = await input.signer.writePin({
    path: '/protocols/simplebuzz',
    payload: JSON.stringify({
      content,
      contentType,
      attachments,
      quotePin,
    }),
    contentType: 'application/json',
    network,
  });

  return {
    pinId: chainWrite.pinId,
    txids: chainWrite.txids,
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    content,
    contentType,
    attachments,
    uploadedFiles,
    globalMetaId: chainWrite.globalMetaId,
  };
}
