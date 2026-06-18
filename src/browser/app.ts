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

const OAC_BROWSER_SCRIPT_ADAPTERS = `
if (typeof endpointWithActor === 'function' && typeof browserEndpoints === 'object') {
  browserSettingsEndpoint = function browserSettingsEndpoint() {
    return endpointWithActor(browserEndpoints.settings);
  };
}
`;

export function buildBrowserPageDefinition(): BrowserPageDefinition {
  const definition = buildAbcBrowserPageDefinition() as BrowserPageDefinition;
  return {
    ...definition,
    script: `${definition.script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`,
  };
}
