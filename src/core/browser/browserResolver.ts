import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppGalleryRecord } from '../metaapp/types';
import { createBotHomepageClient } from './botHomepageClient';
import { buildBotPageResolveResult } from './botPageResolver';
import { buildMetaAppResolveResult } from './metaAppResolver';
import { parseBrowserUri } from './uri';
import type { BotBrowserConfig, BrowserResolveResult } from './types';

export interface ResolveBrowserResourceInput {
  uri: string;
  config: BotBrowserConfig;
  fetch?: typeof fetch;
  metaAppLookup?: (pinId: string) => Promise<MetaAppGalleryRecord | null>;
  metaAppResolve?: (pinId: string) => Promise<MetabotCommandResult<MetaAppGalleryRecord>>;
}

export async function resolveBrowserResource(input: ResolveBrowserResourceInput): Promise<MetabotCommandResult<BrowserResolveResult>> {
  let parsed;
  try {
    parsed = parseBrowserUri(input.uri);
  } catch (error) {
    return commandFailed('invalid_browser_uri', error instanceof Error ? error.message : String(error));
  }

  if (parsed.scheme === 'metaid') {
    if (!input.config.metasoP2PBaseUrl.trim()) {
      return commandFailed('browser_config_missing', 'Browser metaso-p2p base URL is not configured.');
    }

    const client = createBotHomepageClient({
      baseUrl: input.config.metasoP2PBaseUrl,
      fetch: input.fetch,
    });
    const homepage = await client.getByGlobalMetaId(parsed.id);
    if (!homepage.ok) {
      if (homepage.code === 'bot_homepage_not_found') {
        return commandFailed('browser_resource_not_found', homepage.message);
      }
      return commandFailed('browser_resolve_failed', homepage.message);
    }

    return commandSuccess(buildBotPageResolveResult({
      uri: parsed.originalUri,
      normalizedUri: parsed.normalizedUri,
      homepage: homepage.data,
      resolverUrl: homepage.url,
      templateId: input.config.botHomepageTemplateId,
    }));
  }

  let record: MetaAppGalleryRecord | null;
  if (input.metaAppResolve) {
    const resolved = await input.metaAppResolve(parsed.id);
    if (!resolved.ok) {
      return resolved;
    }
    record = resolved.data;
  } else if (input.metaAppLookup) {
    record = await input.metaAppLookup(parsed.id);
  } else {
    record = null;
  }
  if (!record) {
    return commandFailed('browser_resource_not_found', 'Resource not found.');
  }

  return commandSuccess(buildMetaAppResolveResult({
    uri: parsed.originalUri,
    normalizedUri: parsed.normalizedUri,
    record,
    fetchedAt: Date.now(),
  }));
}
