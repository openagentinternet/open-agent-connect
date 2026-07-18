import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandFailed } from '../../core/contracts/commandResult';
import { LARGE_UPLOAD_MAX_BYTES } from '../../core/files/uploadLargeFile';
import type { RouteHandler } from './types';

const HOMEPAGE_UPLOAD_TEMP_PREFIX = 'oac-homepage-upload-';
const HOMEPAGE_UPLOAD_DEFAULT_FILE_NAME = 'homepage-upload.bin';
const HOMEPAGE_UPLOAD_MAX_LABEL = '50 MiB';

function normalizeLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 50;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(100, Math.max(1, parsed));
}

function normalizeSlug(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return '';
  }
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  return normalizeName(Array.isArray(value) ? value[0] : value);
}

function normalizeUploadFileName(value: string | null): string {
  const decoded = normalizeName(value);
  const baseName = path.basename(decoded).replace(/\0/gu, '').trim();
  return baseName || HOMEPAGE_UPLOAD_DEFAULT_FILE_NAME;
}

function normalizeUploadContentType(value: string | string[] | undefined): string {
  const contentType = normalizeHeaderValue(value).split(';')[0]?.trim();
  return contentType || 'application/octet-stream';
}

export const handleBotRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/bot/stats' && req.method === 'GET') {
    const result = handlers.bot?.getStats
      ? await handlers.bot.getStats()
      : commandFailed('not_implemented', 'MetaBot stats handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/profiles' && req.method === 'GET') {
    const result = handlers.bot?.listProfiles
      ? await handlers.bot.listProfiles()
      : commandFailed('not_implemented', 'MetaBot profile list handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/profiles' && req.method === 'POST') {
    const body = await context.readJsonBody();
    if (!normalizeName(body.name)) {
      context.sendJson(400, commandFailed('missing_name', 'MetaBot name is required.'));
      return true;
    }
    const result = handlers.bot?.createProfile
      ? await handlers.bot.createProfile(body)
      : commandFailed('not_implemented', 'MetaBot profile create handler not configured.');
    context.sendJson(result.ok ? 201 : 400, result);
    return true;
  }

  const setupRetryMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/setup\/retry$/);
  if (setupRetryMatch && req.method === 'POST') {
    const slug = normalizeSlug(setupRetryMatch[1]);
    const result = handlers.bot?.retryProfileSetup
      ? await handlers.bot.retryProfileSetup({ slug })
      : commandFailed('not_implemented', 'MetaBot setup retry handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  const walletMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet$/);
  if (walletMatch && req.method === 'GET') {
    const slug = normalizeSlug(walletMatch[1]);
    const result = handlers.bot?.getWallet
      ? await handlers.bot.getWallet({ slug })
      : commandFailed('not_implemented', 'MetaBot wallet handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400, result);
    return true;
  }

  const walletTransferPreviewMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet\/transfer\/preview$/);
  if (walletTransferPreviewMatch && req.method === 'POST') {
    const slug = normalizeSlug(walletTransferPreviewMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.previewWalletTransfer
      ? await handlers.bot.previewWalletTransfer({
          slug,
          chain: normalizeName(body.chain),
          toAddress: normalizeName(body.toAddress),
          amount: normalizeName(body.amount),
        })
      : commandFailed('not_implemented', 'MetaBot wallet transfer preview handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  const walletTransferConfirmMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet\/transfer\/confirm$/);
  if (walletTransferConfirmMatch && req.method === 'POST') {
    const slug = normalizeSlug(walletTransferConfirmMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.confirmWalletTransfer
      ? await handlers.bot.confirmWalletTransfer({
          slug,
          chain: normalizeName(body.chain),
          toAddress: normalizeName(body.toAddress),
          amount: normalizeName(body.amount),
        })
      : commandFailed('not_implemented', 'MetaBot wallet transfer confirm handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  const backupMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/backup$/);
  if (backupMatch && req.method === 'GET') {
    const slug = normalizeSlug(backupMatch[1]);
    const result = handlers.bot?.getBackup
      ? await handlers.bot.getBackup({ slug })
      : commandFailed('not_implemented', 'MetaBot backup handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400, result);
    return true;
  }

  const configMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/config$/);
  if (configMatch && req.method === 'GET') {
    const slug = normalizeSlug(configMatch[1]);
    const result = handlers.bot?.getConfig
      ? await handlers.bot.getConfig({ slug })
      : commandFailed('not_implemented', 'MetaBot config handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400, result);
    return true;
  }

  if (configMatch && req.method === 'PUT') {
    const slug = normalizeSlug(configMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.setConfig
      ? await handlers.bot.setConfig({ ...body, slug })
      : commandFailed('not_implemented', 'MetaBot config handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  const homepageUploadMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/homepage\/upload$/);
  if (homepageUploadMatch && req.method === 'POST') {
    const slug = normalizeSlug(homepageUploadMatch[1]);
    const handler = handlers.bot?.uploadHomepageFile;
    if (!handler) {
      context.sendJson(400, commandFailed('not_implemented', 'MetaBot homepage upload handler not configured.'));
      return true;
    }

    const fileName = normalizeUploadFileName(url.searchParams.get('fileName'));
    const contentType = normalizeUploadContentType(req.headers['content-type']);
    let tempDir = '';
    try {
      tempDir = await mkdtemp(path.join(os.tmpdir(), HOMEPAGE_UPLOAD_TEMP_PREFIX));
      const filePath = path.join(tempDir, fileName);
      const { bytes } = await context.streamRawBodyToFile(filePath, LARGE_UPLOAD_MAX_BYTES);
      if (bytes === 0) {
        context.sendJson(400, commandFailed('homepage_upload_empty', 'Homepage upload requires non-empty file data.'));
        return true;
      }

      const result = await handler({
        slug,
        filePath,
        fileName,
        contentType,
      });
      const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
      context.sendJson(status, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/too large/iu.test(message)) {
        context.sendJson(
          413,
          commandFailed('homepage_upload_too_large', `Homepage file must be ${HOMEPAGE_UPLOAD_MAX_LABEL} or smaller.`),
        );
        return true;
      }
      throw error;
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
    return true;
  }

  const profileMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)$/);
  if (profileMatch && req.method === 'GET') {
    const slug = normalizeSlug(profileMatch[1]);
    const result = handlers.bot?.getProfile
      ? await handlers.bot.getProfile({ slug })
      : commandFailed('not_implemented', 'MetaBot profile handler not configured.');
    context.sendJson(result.ok ? 200 : 404, result);
    return true;
  }

  if (profileMatch && req.method === 'PUT') {
    const slug = normalizeSlug(profileMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.updateProfile
      ? await handlers.bot.updateProfile({ ...body, slug })
      : commandFailed('not_implemented', 'MetaBot profile update handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  if (profileMatch && req.method === 'DELETE') {
    const slug = normalizeSlug(profileMatch[1]);
    const result = handlers.bot?.deleteProfile
      ? await handlers.bot.deleteProfile({ slug })
      : commandFailed('not_implemented', 'MetaBot profile delete handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  if (url.pathname === '/api/bot/runtimes' && req.method === 'GET') {
    const result = handlers.bot?.listRuntimes
      ? await handlers.bot.listRuntimes({
          ...(normalizeSlug(url.searchParams.get('from') ?? '') ? { from: normalizeSlug(url.searchParams.get('from') ?? '') } : {}),
        })
      : commandFailed('not_implemented', 'MetaBot runtime handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/runtimes/discover' && req.method === 'POST') {
    const result = handlers.bot?.discoverRuntimes
      ? await handlers.bot.discoverRuntimes({
          ...(normalizeSlug(url.searchParams.get('from') ?? '') ? { from: normalizeSlug(url.searchParams.get('from') ?? '') } : {}),
        })
      : commandFailed('not_implemented', 'MetaBot runtime discovery handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  const runtimeTestMatch = url.pathname.match(/^\/api\/bot\/runtimes\/([^/]+)\/test$/);
  if (runtimeTestMatch && req.method === 'POST') {
    const runtimeId = normalizeSlug(runtimeTestMatch[1]);
    const from = normalizeSlug(url.searchParams.get('from') ?? '');
    const result = handlers.bot?.testRuntime
      ? await handlers.bot.testRuntime({
          runtimeId,
          ...(from ? { from } : {}),
        })
      : commandFailed('not_implemented', 'MetaBot runtime test handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'runtime_not_found' ? 404 : 400, result);
    return true;
  }

  if (url.pathname === '/api/bot/sessions' && req.method === 'GET') {
    const slug = normalizeSlug(url.searchParams.get('slug') ?? '');
    const limit = normalizeLimit(url.searchParams.get('limit'));
    const result = handlers.bot?.listSessions
      ? await handlers.bot.listSessions({ ...(slug ? { slug } : {}), limit })
      : commandFailed('not_implemented', 'MetaBot session list handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
