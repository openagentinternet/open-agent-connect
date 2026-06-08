import {
  createDefaultConfig,
  type BrowserConfig,
  type MetabotConfig,
} from '../config/configTypes';
import { resolveBrowserConfig } from './config';

export const BROWSER_BASE_URL_KEYS = [
  'metasoP2PBaseUrl',
  'metafileContentBaseUrl',
  'manApiBaseUrl',
  'blockExplorerBaseUrl',
  'walletApiBaseUrl',
] as const;

export type BrowserBaseUrlKey = typeof BROWSER_BASE_URL_KEYS[number];

export interface BrowserSettingsSnapshot {
  browser: BrowserConfig;
  effectiveBrowser: BrowserConfig;
  defaults: BrowserConfig;
  configPath?: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value: unknown): string {
  return normalizeText(value).replace(/\/+$/, '');
}

function validateHttpBaseUrl(key: BrowserBaseUrlKey, value: string): string {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported_protocol');
    }
    return parsed.href.replace(/\/+$/, '');
  } catch {
    throw new Error(`browser.${key} must be an http(s) base URL.`);
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createBrowserSettingsSnapshot(input: {
  config: MetabotConfig;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): BrowserSettingsSnapshot {
  const defaults = createDefaultConfig().browser;
  return {
    browser: input.config.browser,
    effectiveBrowser: resolveBrowserConfig(input.config, input.env ?? process.env),
    defaults,
    ...(input.configPath ? { configPath: input.configPath } : {}),
  };
}

export function applyBrowserSettingsUpdate(current: MetabotConfig, rawBrowserInput: unknown): MetabotConfig {
  const browserInput = readObject(rawBrowserInput);
  const defaults = createDefaultConfig().browser;
  const nextBrowser: BrowserConfig = {
    ...current.browser,
  };

  for (const key of BROWSER_BASE_URL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(browserInput, key)) {
      continue;
    }
    const normalized = validateHttpBaseUrl(key, normalizeBaseUrl(browserInput[key]));
    if (!normalized) {
      const fallback = defaults[key];
      if (fallback) {
        nextBrowser[key] = fallback;
      } else {
        delete nextBrowser[key];
      }
    } else {
      nextBrowser[key] = normalized;
    }
  }

  return {
    ...current,
    browser: nextBrowser,
  };
}
