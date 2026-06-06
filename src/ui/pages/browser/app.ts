import type { LocalUiPageDefinition } from '../types';

export function buildBrowserPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'browser',
    title: 'Agent Internet Browser',
    eyebrow: 'Bot Browser',
    heading: 'Agent Internet Browser',
    description: 'Visit Agent Internet resources by URI.',
    panels: [],
    contentHtml: `
      <section class="browser-shell" data-browser-shell>
        <header class="browser-topbar" data-browser-topbar>
          <nav class="browser-nav" aria-label="Browser navigation">
            <button type="button" data-browser-back aria-label="Back">Back</button>
            <button type="button" data-browser-forward aria-label="Forward">Forward</button>
            <button type="button" data-browser-reload aria-label="Reload">Reload</button>
            <button type="button" data-browser-drawer-toggle aria-label="Bookmarks and history">Bookmarks</button>
          </nav>
          <form class="browser-address-form" data-browser-address-form>
            <input data-browser-uri-input aria-label="Agent Internet URI" placeholder="metaid://idq1example" />
            <button type="submit">Open</button>
          </form>
          <button type="button" class="browser-resource-chip" data-browser-resource-chip>Resource</button>
          <button type="button" class="browser-using-chip" data-browser-using-selector>Using: My Bot</button>
        </header>
        <aside class="browser-drawer" data-browser-drawer hidden></aside>
        <main class="browser-viewport" data-browser-viewport></main>
        <footer class="browser-status-strip" data-browser-status-strip>
          <button type="button" data-browser-status-state>loading</button>
          <button type="button" data-browser-status-proof>unverified</button>
          <span data-browser-status-renderer>renderer: unsupported</span>
          <button type="button" data-browser-status-txid>TXID: -</button>
        </footer>
        <aside class="browser-inspector" data-browser-inspector hidden></aside>
        <div class="browser-modal" data-browser-modal-root hidden></div>
      </section>
    `,
    script: buildBrowserPageScript(),
  };
}

function buildBrowserPageScript(): string {
  return `(() => {
  const endpoints = {
    context: '/api/browser/context',
    resolve: '/api/browser/resolve',
    privateChat: '/api/chat/private',
    serviceCall: '/api/services/call',
  };
  window.__oacBrowserEndpoints = endpoints;
})();`;
}
