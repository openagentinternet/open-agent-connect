import {
  renderBrowserPageHtml as renderAbcBrowserPageHtml,
} from '@openagentinternet/agent-browser-ui/browser';
import type { BrowserPageDefinition } from './app';

export type { BrowserPageDefinition } from './app';

export function renderBrowserPageHtml(
  definition?: BrowserPageDefinition,
  languagePreference?: string | null,
): Promise<string> {
  return renderAbcBrowserPageHtml(definition, languagePreference);
}
