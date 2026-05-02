import type { LocalUiPageDefinition } from '../types';

export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot' as never,
    title: 'Bot Management — Open Agent Connect',
    eyebrow: 'LLM Runtime Bindings',
    heading: 'Bot Management',
    description: 'Configure which LLM runtimes each MetaBot uses.',
    panels: [
      {
        title: 'LLM Runtimes',
        body: '<div id="llm-runtimes-panel">Loading runtimes…</div>',
      },
      {
        title: 'MetaBot Bindings',
        body: '<div id="llm-bindings-panel">Select a MetaBot to view bindings.</div>',
      },
    ],
    script: `(${botViewModelScript.toString()})()`,
  };
}

function botViewModelScript() {
  async function fetchJson(url: string) {
    const res = await fetch(url);
    return res.json();
  }

  async function loadRuntimes() {
    const panel = document.getElementById('llm-runtimes-panel');
    if (!panel) return;
    try {
      const result = await fetchJson('/api/llm/runtimes');
      if (!result.ok) {
        panel.innerHTML = '<p class="dim">No runtimes discovered yet.</p>';
        return;
      }
      const runtimes = result.data.runtimes || [];
      if (runtimes.length === 0) {
        panel.innerHTML = '<p class="dim">No runtimes discovered. Run <code>metabot llm discover</code>.</p>';
        return;
      }
      panel.innerHTML = runtimes.map((r: { displayName: string; provider: string; version?: string; health: string; binaryPath?: string }) =>
        `<div class="runtime-card">
          <div class="name">${r.displayName || r.provider}</div>
          <div class="meta"><span class="health-dot ${r.health || 'unknown'}"></span>${r.health || 'unknown'} &middot; ${r.version || '?'} &middot; ${r.binaryPath || ''}</div>
        </div>`
      ).join('');
    } catch {
      panel.innerHTML = '<p class="dim">Could not load runtimes.</p>';
    }
  }

  loadRuntimes();
}
