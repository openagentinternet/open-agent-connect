import type { LocalUiPageDefinition } from '../types';

export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot',
    title: 'Bot Management — Open Agent Connect',
    eyebrow: 'LLM Runtime Bindings',
    heading: 'Bot Management',
    description: 'Discover local LLM runtimes and manage MetaBot bindings.',
    panels: [],
    script: buildBotPageScript(),
  };
}

function buildBotPageScript(): string {
  return `(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function html(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v != null) el.setAttribute(k, String(v)); });
    if (children) {
      if (typeof children === 'string') el.innerHTML = children;
      else children.forEach(c => el.appendChild(c));
    }
    return el;
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    return res.json();
  }

  function healthDot(health) {
    return '<span class="health-dot ' + health + '" title="' + health + '"></span>';
  }

  // ---- Runtimes Panel ----
  async function loadRuntimes() {
    const panel = $('[data-runtimes-panel]');
    if (!panel) return;
    panel.innerHTML = '<p class="dim">Loading runtimes…</p>';
    try {
      const result = await fetchJson('/api/llm/runtimes');
      if (!result.ok || !result.data.runtimes.length) {
        panel.innerHTML = '<p class="dim">No runtimes discovered yet. Click "Discover" to scan PATH.</p>';
        return;
      }
      const runtimes = result.data.runtimes;
      panel.innerHTML = runtimes.map(r => [
        '<div class="runtime-card">',
        '<div class="flex-row">',
        '<span class="name">', healthDot(r.health), r.displayName || r.provider, '</span>',
        '<span class="meta">v', r.version || '?', '</span>',
        '</div>',
        '<div class="meta">', r.binaryPath || '', ' &middot; ', r.authState, '</div>',
        '</div>',
      ].join('')).join('');
    } catch {
      panel.innerHTML = '<p class="dim">Failed to load runtimes. Is the daemon running?</p>';
    }
  }

  async function discoverRuntimes() {
    const btn = $('[data-discover-btn]');
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      await fetchJson('/api/llm/runtimes/discover', { method: 'POST' });
      await loadRuntimes();
      loadBindings();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Discover Runtimes';
    }
  }

  // ---- Bindings Panel ----
  let currentSlug = '';
  async function loadBindings() {
    const slug = ($('[data-slug-input]') || {}).value || currentSlug;
    if (!slug) return;
    currentSlug = slug;

    const panel = $('[data-bindings-panel]');
    const slugLabel = $('[data-slug-label]');
    if (slugLabel) slugLabel.textContent = slug;

    panel.innerHTML = '<p class="dim">Loading bindings…</p>';
    try {
      const result = await fetchJson('/api/llm/bindings/' + encodeURIComponent(slug));
      if (!result.ok) {
        panel.innerHTML = '<p class="dim">Profile not found or no bindings.</p>';
        return;
      }
      const bindings = result.data.bindings || [];
      if (!bindings.length) {
        panel.innerHTML = '<p class="dim">No bindings configured for <strong>' + slug + '</strong>.</p>';
        return;
      }
      panel.innerHTML = bindings.map(function(b) {
        var lastUsed = b.lastUsedAt ? ' Last used: ' + b.lastUsedAt : ' Never used';
        return '<div class="binding-row">' +
          '<span class="binding-role">' + b.role + '</span>' +
          '<span>Runtime: ' + b.llmRuntimeId + '</span>' +
          '<span class="meta">priority=' + b.priority + (b.enabled ? '' : ' (disabled)') + lastUsed + '</span>' +
          '</div>';
      }).join('');
    } catch {
      panel.innerHTML = '<p class="dim">Failed to load bindings.</p>';
    }
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function() {
    loadRuntimes();
    var discoverBtn = $('[data-discover-btn]');
    if (discoverBtn) discoverBtn.addEventListener('click', discoverRuntimes);
    var loadBtn = $('[data-load-bindings-btn]');
    if (loadBtn) loadBtn.addEventListener('click', loadBindings);
  });
})()`;
}
