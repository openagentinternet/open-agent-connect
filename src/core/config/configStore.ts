import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeBotHomepageTemplateId } from '@openagentinternet/agent-browser-core';

import { resolveMetabotHomeSelection } from '../state/homeSelection';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import {
  createDefaultConfig,
  type DefaultWriteNetwork,
  isDefaultWriteNetwork,
  type MetabotConfig,
} from './configTypes';

async function ensureLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
  try {
    await fs.access(paths.configPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
    await fs.writeFile(paths.configPath, `${JSON.stringify(createDefaultConfig(), null, 2)}\n`, 'utf8');
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeNameResolutionConfig(
  input: unknown,
  fallback: NonNullable<MetabotConfig['browser']['nameResolution']>,
): NonNullable<MetabotConfig['browser']['nameResolution']> {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const ensSource = source.ens && typeof source.ens === 'object' && !Array.isArray(source.ens)
    ? source.ens as Record<string, unknown>
    : {};
  const normalizedRpcUrls = hasOwn(ensSource, 'rpcUrls')
    ? normalizeStringList(ensSource.rpcUrls)
    : null;

  return {
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    ens: {
      enabled: normalizeBoolean(ensSource.enabled, fallback.ens.enabled),
      chainId: 1,
      rpcUrls: normalizedRpcUrls ?? [...fallback.ens.rpcUrls],
      textKey: normalizeString(ensSource.textKey) || fallback.ens.textKey,
    },
  };
}

function normalizeConfig(input: unknown): MetabotConfig {
  const defaults = createDefaultConfig();
  if (!input || typeof input !== 'object') {
    return defaults;
  }

  const root = input as Record<string, unknown>;
  const maybeA2A = root['a2a'];
  const maybeBrowser = root['browser'];
  const maybeChain = root['chain'];

  const a2aSource = maybeA2A && typeof maybeA2A === 'object'
    ? maybeA2A as Record<string, unknown>
    : {};
  const browserSource = maybeBrowser && typeof maybeBrowser === 'object'
    ? maybeBrowser as Record<string, unknown>
    : {};
  const chainSource = maybeChain && typeof maybeChain === 'object'
    ? maybeChain as Record<string, unknown>
    : {};

  const defaultWriteNetwork = normalizeString(chainSource.defaultWriteNetwork).toLowerCase();
  const browserDefaultChainName = normalizeString(browserSource.defaultChainName).toLowerCase();
  const walletApiBaseUrl = normalizeString(browserSource.walletApiBaseUrl) || defaults.browser.walletApiBaseUrl;
  const manApiBaseUrl = normalizeString(browserSource.manApiBaseUrl) || defaults.browser.manApiBaseUrl;

  const normalizedConfig: MetabotConfig = {
    chain: {
      defaultWriteNetwork: isDefaultWriteNetwork(defaultWriteNetwork)
        ? defaultWriteNetwork
        : defaults.chain.defaultWriteNetwork,
      mvcSponsorUploadEnabled: normalizeBoolean(
        chainSource.mvcSponsorUploadEnabled,
        defaults.chain.mvcSponsorUploadEnabled,
      ),
    },
    a2a: {
      simplemsgListenerEnabled: normalizeBoolean(
        a2aSource.simplemsgListenerEnabled,
        defaults.a2a.simplemsgListenerEnabled,
      ),
    },
    browser: {
      metasoP2PBaseUrl: normalizeString(browserSource.metasoP2PBaseUrl) || defaults.browser.metasoP2PBaseUrl,
      metafileContentBaseUrl: normalizeString(browserSource.metafileContentBaseUrl) || defaults.browser.metafileContentBaseUrl,
      manApiBaseUrl,
      blockExplorerBaseUrl: normalizeString(browserSource.blockExplorerBaseUrl) || defaults.browser.blockExplorerBaseUrl,
      botHomepageTemplateId: normalizeBotHomepageTemplateId(
        browserSource.botHomepageTemplateId,
        defaults.browser.botHomepageTemplateId,
      ),
      renderCustomBotPages: normalizeBoolean(
        browserSource.renderCustomBotPages,
        defaults.browser.renderCustomBotPages,
      ),
      nameResolution: normalizeNameResolutionConfig(
        browserSource.nameResolution,
        defaults.browser.nameResolution,
      ),
      defaultChainName: isDefaultWriteNetwork(browserDefaultChainName)
        ? browserDefaultChainName as DefaultWriteNetwork
        : defaults.chain.defaultWriteNetwork,
      localMode: normalizeBoolean(browserSource.localMode, defaults.browser.localMode),
    },
  };

  if (walletApiBaseUrl) {
    normalizedConfig.browser.walletApiBaseUrl = walletApiBaseUrl;
  }

  return normalizedConfig;
}

function resolvePaths(homeDirOrPaths?: string | MetabotPaths): MetabotPaths {
  if (typeof homeDirOrPaths === 'string') {
    return resolveMetabotPaths(homeDirOrPaths);
  }

  if (homeDirOrPaths) {
    return homeDirOrPaths;
  }

  const selection = resolveMetabotHomeSelection({
    env: process.env,
    cwd: process.cwd(),
  });
  return selection.paths ?? resolveMetabotPaths(selection.homeDir);
}

export interface ConfigStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  read(): Promise<MetabotConfig>;
  set(value: MetabotConfig): Promise<void>;
}

export function createConfigStore(homeDirOrPaths?: string | MetabotPaths): ConfigStore {
  const paths = resolvePaths(homeDirOrPaths);

  return {
    paths,
    async ensureLayout() {
      await ensureLayout(paths);
      return paths;
    },
    async read() {
      await ensureLayout(paths);
      const data = await readJsonFile(paths.configPath);
      return normalizeConfig(data);
    },
    async set(value: MetabotConfig) {
      await ensureLayout(paths);
      const normalized = normalizeConfig(value);
      await fs.writeFile(paths.configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }
  };
}
