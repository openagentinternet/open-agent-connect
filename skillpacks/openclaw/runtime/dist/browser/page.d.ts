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
export declare function renderBrowserPageHtml(definition?: BrowserPageDefinition, _languagePreference?: string | null, options?: RenderBrowserPageOptions): Promise<string>;
