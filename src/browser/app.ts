import {
  buildBrowserPageDefinition as buildAbcBrowserPageDefinition,
} from '@openagentinternet/agent-browser-ui/browser';

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

export function buildBrowserPageDefinition(): BrowserPageDefinition {
  return buildAbcBrowserPageDefinition() as BrowserPageDefinition;
}
