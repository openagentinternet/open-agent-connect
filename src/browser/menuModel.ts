import type { BotHomepageTemplateDefinition } from '@openagentinternet/agent-browser-core';
import {
  BROWSER_BASE_URL_FIELDS as ABC_BROWSER_BASE_URL_FIELDS,
  BROWSER_BOT_HOMEPAGE_TEMPLATES as ABC_BROWSER_BOT_HOMEPAGE_TEMPLATES,
  BROWSER_MENU_SECTIONS as ABC_BROWSER_MENU_SECTIONS,
  BROWSER_SETTINGS_TABS as ABC_BROWSER_SETTINGS_TABS,
} from '@openagentinternet/agent-browser-ui/browser';

export interface BrowserMenuItemDefinition {
  id: string;
  label: string;
  icon: string;
  action: 'open-settings';
  settingsTab: 'baseUrls' | 'templates' | 'cache';
}

export interface BrowserMenuSectionDefinition {
  id: string;
  items: BrowserMenuItemDefinition[];
}

export interface BrowserSettingsTabDefinition {
  id: 'baseUrls' | 'templates' | 'cache';
  label: string;
}

export interface BrowserBaseUrlFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
}

export const BROWSER_BASE_URL_FIELDS: BrowserBaseUrlFieldDefinition[] =
  ABC_BROWSER_BASE_URL_FIELDS;
export const BROWSER_BOT_HOMEPAGE_TEMPLATES: readonly BotHomepageTemplateDefinition[] =
  ABC_BROWSER_BOT_HOMEPAGE_TEMPLATES;
export const BROWSER_MENU_SECTIONS: BrowserMenuSectionDefinition[] =
  ABC_BROWSER_MENU_SECTIONS;
export const BROWSER_SETTINGS_TABS: BrowserSettingsTabDefinition[] =
  ABC_BROWSER_SETTINGS_TABS;
