import type { LocalUiPageDefinition } from '../types';

export function buildSettingsPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'settings',
    title: 'Settings — Open Agent Connect',
    eyebrow: 'Provider Console',
    heading: 'Settings',
    description: 'Review Bot provider runtime, network, wallet, and browser settings.',
    panels: [],
    contentHtml: `
      <section class="settings-shell" data-settings-shell>
        <div class="settings-toolbar">
          <div>
            <h1>Settings</h1>
            <p data-settings-status>Loading local runtime settings...</p>
          </div>
          <button class="btn" type="button" data-settings-refresh>Refresh</button>
        </div>
        <div class="settings-grid">
          <article class="settings-panel">
            <div>
              <h2>Network and Indexers</h2>
              <p>Directory sources, MetaID gateway, and indexer connectivity.</p>
            </div>
            <code data-settings-config-status>/api/config</code>
          </article>
          <article class="settings-panel">
            <div>
              <h2>Wallet and Payments</h2>
              <p>Bot wallet readiness and payment-sensitive operations remain under Bot Page actions.</p>
            </div>
            <a class="btn btn-sm" href="/ui/bot">Open Bot Page</a>
          </article>
          <article class="settings-panel">
            <div>
              <h2>LLM Providers</h2>
              <p>Detected local runtimes and provider health for service execution.</p>
            </div>
            <code data-settings-llm-status>/api/llm/runtimes</code>
          </article>
          <article class="settings-panel">
            <div>
              <h2>Browser and Gateway</h2>
              <p>Browser is a high-level tool outside the Provider Console tab set.</p>
            </div>
            <a class="btn btn-sm" href="/browser">Open Browser</a>
          </article>
          <article class="settings-panel">
            <div>
              <h2>Service Discovery</h2>
              <p>Network source health for online Bot and service listings.</p>
            </div>
            <code data-settings-network-status>/api/network/sources</code>
          </article>
          <article class="settings-panel">
            <div>
              <h2>Advanced Diagnostics</h2>
              <p>Legacy diagnostics remain directly available without becoming top-level navigation.</p>
            </div>
            <div class="settings-links">
              <a href="/ui/trace">Trace</a>
              <a href="/ui/refund">Refund</a>
              <a href="/ui/hub">Hub</a>
            </div>
          </article>
        </div>
      </section>
    `,
    script: `(() => {
  const status = document.querySelector('[data-settings-status]');
  const refresh = document.querySelector('[data-settings-refresh]');
  const configStatus = document.querySelector('[data-settings-config-status]');
  const llmStatus = document.querySelector('[data-settings-llm-status]');
  const networkStatus = document.querySelector('[data-settings-network-status]');
  const setText = (element, value) => { if (element) element.textContent = value; };

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return response.json();
  };

  const load = async () => {
    setText(status, 'Loading local runtime settings...');
    try {
      const [config, runtimes, networkSources] = await Promise.all([
        fetchJson('/api/config'),
        fetchJson('/api/llm/runtimes'),
        fetchJson('/api/network/sources'),
      ]);
      setText(configStatus, config && config.ok !== false ? 'Config loaded from /api/config' : 'Config unavailable at /api/config');
      const runtimeCount = Array.isArray(runtimes && runtimes.data && runtimes.data.runtimes) ? runtimes.data.runtimes.length : 0;
      setText(llmStatus, runtimeCount + ' runtime' + (runtimeCount === 1 ? '' : 's') + ' from /api/llm/runtimes');
      const sourceCount = Array.isArray(networkSources && networkSources.data && networkSources.data.sources) ? networkSources.data.sources.length : 0;
      setText(networkStatus, sourceCount + ' source' + (sourceCount === 1 ? '' : 's') + ' from /api/network/sources');
      setText(status, 'Settings snapshot loaded.');
    } catch (error) {
      setText(status, (error && error.message) || 'Settings snapshot failed to load.');
    }
  };

  if (refresh) refresh.addEventListener('click', load);
  load();
})();`,
  };
}
