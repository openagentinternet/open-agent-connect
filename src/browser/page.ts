import {
  renderBrowserPageHtml as renderAbcBrowserPageHtml,
} from '@openagentinternet/agent-browser-ui/browser';
import { buildBrowserPageDefinition } from './app';
import type { BrowserPageDefinition } from './app';

export type { BrowserPageDefinition } from './app';

export function renderBrowserPageHtml(
  definition?: BrowserPageDefinition,
  _languagePreference?: string | null,
): Promise<string> {
  // Default to OAC's own page definition (not ABC's vanilla one): it injects the
  // OAC bridge adapters via buildBrowserPageDefinition(). Callers that pass an
  // explicit definition (e.g. tests) keep full control.
  return renderAbcBrowserPageHtml(definition ?? buildBrowserPageDefinition());
}
