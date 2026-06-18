// Temporary compile-only compatibility shim for OAC's current moduleResolution: "Node".
// OAC public declarations should not re-export this ABC UI package subpath.
declare module '@openagentinternet/agent-browser-ui/browser' {
  import type { BotHomepageTemplateDefinition } from '@openagentinternet/agent-browser-core';

  export interface BrowserPagePanelDefinition {
    title: string;
    body: string;
    items?: string[];
    actionLabel?: string;
    actionHref?: string;
  }

  export interface BrowserPageDefinition {
    page: 'browser';
    title: string;
    eyebrow: string;
    heading: string;
    description: string;
    panels: BrowserPagePanelDefinition[];
    contentHtml?: string;
    script: string;
  }

  export interface BrowserMenuItemDefinition {
    id: string;
    label: string;
    icon: string;
    action: 'open-settings';
    settingsTab: 'baseUrls' | 'templates' | 'nameResolution' | 'cache';
  }

  export interface BrowserMenuSectionDefinition {
    id: string;
    items: BrowserMenuItemDefinition[];
  }

  export interface BrowserSettingsTabDefinition {
    id: 'baseUrls' | 'templates' | 'nameResolution' | 'cache';
    label: string;
  }

  export interface BrowserBaseUrlFieldDefinition {
    key: string;
    label: string;
    placeholder: string;
  }

  export const BROWSER_BASE_URL_FIELDS: BrowserBaseUrlFieldDefinition[];
  export const BROWSER_BOT_HOMEPAGE_TEMPLATES: readonly BotHomepageTemplateDefinition[];
  export const BROWSER_MENU_SECTIONS: BrowserMenuSectionDefinition[];
  export const BROWSER_SETTINGS_TABS: BrowserSettingsTabDefinition[];

  export function buildBrowserPageDefinition(): BrowserPageDefinition;
  export function renderBrowserPageHtml(
    definition?: BrowserPageDefinition,
    languagePreference?: string | null,
  ): Promise<string>;
}
