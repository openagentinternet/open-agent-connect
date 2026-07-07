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
if (
  typeof endpointWithActor === 'function'
  && typeof browserSettingsEndpoint === 'function'
  && browserEndpoints
  && typeof browserEndpoints === 'object'
  && typeof browserEndpoints.settings === 'string'
) {
  browserSettingsEndpoint = function browserSettingsEndpoint() {
    return endpointWithActor(browserEndpoints.settings);
  };
}
`;

const BROWSER_INITIALIZATION_MARKER = `
if (document.readyState === 'loading') {`;

function injectOacBrowserScriptAdapters(script: string): string {
  if (script.includes(BROWSER_INITIALIZATION_MARKER)) {
    return script.replace(
      BROWSER_INITIALIZATION_MARKER,
      `${OAC_BROWSER_SCRIPT_ADAPTERS}${BROWSER_INITIALIZATION_MARKER}`,
    );
  }
  return `${script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`;
}

export function buildBrowserPageDefinition(): BrowserPageDefinition {
  const definition = buildAbcBrowserPageDefinition() as BrowserPageDefinition;
  return {
    ...definition,
    script: injectOacBrowserScriptAdapters(definition.script),
  };
}
