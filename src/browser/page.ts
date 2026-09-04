import {
  renderBrowserPageHtml as renderAbcBrowserPageHtml,
} from '@openagentinternet/agent-browser-ui/browser';
import { buildBrowserPageDefinition } from './app';
import type { BrowserPageDefinition } from './app';

export type { BrowserPageDefinition } from './app';

/**
 * Initial Browser theme selection, mirroring ABC's `BrowserTheme`. Declared
 * locally (not re-exported from the ABC UI subpath) so the emitted
 * `page.d.ts` keeps the ABC package subpath private.
 */
export type BrowserPageTheme = 'light' | 'dark' | 'system';

export interface RenderBrowserPageOptions {
  /**
   * Initial Browser theme. Baked into the HTML so the first paint already
   * matches; defaults to `light` (ABC's legacy behavior) when omitted.
   */
  theme?: BrowserPageTheme;
}

export function renderBrowserPageHtml(
  definition?: BrowserPageDefinition,
  _languagePreference?: string | null,
  options?: RenderBrowserPageOptions,
): Promise<string> {
  // Default to OAC's own page definition (not ABC's vanilla one): it injects the
  // OAC bridge adapters via buildBrowserPageDefinition(). Callers that pass an
  // explicit definition (e.g. tests) keep full control.
  return renderAbcBrowserPageHtml(definition ?? buildBrowserPageDefinition(), undefined, options);
}
