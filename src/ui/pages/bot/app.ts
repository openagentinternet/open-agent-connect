import type { LocalUiPageDefinition } from '../types';

export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot',
    title: 'Bot Management — Open Agent Connect',
    eyebrow: 'LLM Runtime Bindings',
    heading: 'Bot Management',
    description: 'Discover local LLM runtimes and manage which MetaBot uses which LLM.',
    panels: [],
    script: buildBotPageScript(),
  };
}

function buildBotPageScript(): string {
  return `(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v != null) e.setAttribute(k, String(v)); });
    if (typeof children === 'string') e.innerHTML = children;
    else if (children) children.forEach(c => e.appendChild(c));
    return e;
  }

  function healthDot(h) {
    return '<span class="health-dot ' + (h || 'unknown') + '" title="' + (h || 'unknown') + '"></span>';
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---- State ----
  let state = { profiles: [], runtimes: [], bindings: [], preferredRuntimeId: null, selectedSlug: '' };

  // ---- Render helpers ----
  function renderRuntimes() {
    const panel = $('[data-runtimes-panel]');
    if (!panel) return;
    if (!state.runtimes.length) {
      panel.innerHTML = '<p class="dim">No runtimes discovered. Click Discover.</p>';
      return;
    }
    panel.innerHTML = state.runtimes.map(r =>
      '<div class="runtime-card" data-runtime-id="' + r.id + '">' +
        '<div class="flex-row">' +
          '<span class="name">' + healthDot(r.health) + (r.displayName || r.provider) + '</span>' +
          '<span class="meta">v' + (r.version || '?') + '</span>' +
        '</div>' +
        '<div class="meta">' + (r.binaryPath || 'no binary') + ' &middot; ' + (r.authState || 'unknown') + '</div>' +
      '</div>'
    ).join('');
  }

  function renderBindings() {
    const panel = $('[data-bindings-panel]');
    const slugLabel = $('[data-slug-label]');
    if (!panel) return;
    if (slugLabel) slugLabel.textContent = state.selectedSlug ? 'Bindings for: ' + state.selectedSlug : '';

    if (!state.selectedSlug) {
      panel.innerHTML = '<p class="dim">Select a profile to manage its bindings.</p>';
      renderAddBinding(false);
      return;
    }

    if (!state.bindings.length) {
      panel.innerHTML = '<p class="dim">No bindings. Add one below.</p>';
      renderAddBinding(true);
      return;
    }

    var html = '';
    for (var i = 0; i < state.bindings.length; i++) {
      var b = state.bindings[i];
      var runtimeName = b.llmRuntimeId;
      var rt = state.runtimes.find(function(r) { return r.id === b.llmRuntimeId; });
      if (rt) runtimeName = rt.displayName || rt.provider;

      html += '<div class="binding-row' + (b.enabled ? '' : ' disabled-row') + '" data-binding-id="' + b.id + '">' +
        '<span class="binding-role ' + b.role + '">' + b.role + '</span>' +
        '<span class="binding-runtime">' + runtimeName + '</span>' +
        '<span class="meta">priority=' + b.priority + '</span>' +
        '<label class="toggle-label"><input type="checkbox" data-toggle-binding data-binding-id="' + b.id + '"' + (b.enabled ? ' checked' : '') + '> enabled</label>' +
        '<button class="btn-sm" data-delete-binding data-binding-id="' + b.id + '">Remove</button>' +
      '</div>';
    }
    panel.innerHTML = html;

    // Wire up toggle checkboxes
    $$('[data-toggle-binding]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var id = this.getAttribute('data-binding-id');
        var binding = state.bindings.find(function(b) { return b.id === id; });
        if (binding) { binding.enabled = this.checked; saveBindings(); }
      });
    });

    // Wire up delete buttons
    $$('[data-delete-binding]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-binding-id');
        state.bindings = state.bindings.filter(function(b) { return b.id !== id; });
        saveBindings();
      });
    });

    renderAddBinding(true);
    renderPreferredRuntime();
  }

  function renderAddBinding(show) {
    var panel = $('[data-add-binding-panel]');
    if (!panel) return;
    if (!show) { panel.innerHTML = ''; return; }

    var runtimeOpts = state.runtimes.map(function(r) {
      return '<option value="' + r.id + '">' + (r.displayName || r.provider) + ' (' + r.health + ')</option>';
    }).join('');

    panel.innerHTML =
      '<div class="add-binding-row">' +
        '<select data-new-binding-runtime>' + runtimeOpts + '</select>' +
        '<select data-new-binding-role>' +
          '<option value="primary">primary</option>' +
          '<option value="fallback">fallback</option>' +
          '<option value="reviewer">reviewer</option>' +
          '<option value="specialist">specialist</option>' +
        '</select>' +
        '<input type="number" data-new-binding-priority value="0" min="0" style="width:60px" />' +
        '<button class="btn" data-add-binding-btn>Add Binding</button>' +
      '</div>';

    $('[data-add-binding-btn]').addEventListener('click', function() {
      var runtimeId = $('[data-new-binding-runtime]').value;
      var role = $('[data-new-binding-role]').value;
      var priority = parseInt($('[data-new-binding-priority]').value, 10) || 0;
      if (!runtimeId) return;

      var id = 'lb_' + state.selectedSlug + '_' + runtimeId + '_' + role;
      // Replace if same composite key exists
      state.bindings = state.bindings.filter(function(b) {
        return !(b.llmRuntimeId === runtimeId && b.role === role);
      });
      state.bindings.push({
        id: id,
        metaBotSlug: state.selectedSlug,
        llmRuntimeId: runtimeId,
        role: role,
        priority: priority,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      saveBindings();
    });
  }

  function renderPreferredRuntime() {
    var panel = $('[data-preferred-panel]');
    if (!panel) return;

    var runtimeOpts = '<option value="">(none)</option>' + state.runtimes.map(function(r) {
      var sel = state.preferredRuntimeId === r.id ? ' selected' : '';
      return '<option value="' + r.id + '"' + sel + '>' + (r.displayName || r.provider) + '</option>';
    }).join('');

    panel.innerHTML =
      '<div class="add-binding-row">' +
        '<label>Preferred Runtime: </label>' +
        '<select data-preferred-runtime>' + runtimeOpts + '</select>' +
        '<button class="btn" data-save-preferred-btn>Save</button>' +
      '</div>';

    $('[data-save-preferred-btn]').addEventListener('click', function() {
      var val = $('[data-preferred-runtime]').value || null;
      savePreferred(val);
    });
  }

  // ---- API calls ----
  async function loadRuntimes() {
    var panel = $('[data-runtimes-panel]');
    if (panel) panel.innerHTML = '<p class="dim">Loading…</p>';
    try {
      var result = await fetchJson('/api/llm/runtimes');
      state.runtimes = result.data.runtimes || [];
      renderRuntimes();
      if (state.selectedSlug) loadBindingsFor(state.selectedSlug);
    } catch (e) {
      if (panel) panel.innerHTML = '<p class="dim">Failed to load runtimes.</p>';
    }
  }

  async function loadProfiles() {
    try {
      var result = await fetchJson('/api/identity/profiles');
      state.profiles = result.data.profiles || [];
      renderProfileSelector();
    } catch (e) {
      // Profiles endpoint might not be available yet
    }
  }

  async function loadBindingsFor(slug) {
    state.selectedSlug = slug;
    try {
      var result = await fetchJson('/api/llm/bindings/' + encodeURIComponent(slug));
      state.bindings = result.data.bindings || [];
    } catch (e) {
      state.bindings = [];
    }
    try {
      var pref = await fetchJson('/api/llm/preferred-runtime/' + encodeURIComponent(slug));
      state.preferredRuntimeId = pref.data.runtimeId || null;
    } catch (e) {
      state.preferredRuntimeId = null;
    }
    renderBindings();
  }

  async function saveBindings() {
    try {
      await fetchJson('/api/llm/bindings/' + encodeURIComponent(state.selectedSlug), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bindings: state.bindings }),
      });
      renderBindings();
    } catch (e) {
      alert('Failed to save bindings: ' + e.message);
    }
  }

  async function savePreferred(runtimeId) {
    try {
      await fetchJson('/api/llm/preferred-runtime/' + encodeURIComponent(state.selectedSlug), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runtimeId: runtimeId }),
      });
      state.preferredRuntimeId = runtimeId;
      renderPreferredRuntime();
    } catch (e) {
      alert('Failed to save preferred runtime: ' + e.message);
    }
  }

  async function discoverRuntimes() {
    var btn = $('[data-discover-btn]');
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      await fetchJson('/api/llm/runtimes/discover', { method: 'POST' });
      await loadRuntimes();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Discover Runtimes';
    }
  }

  function renderProfileSelector() {
    var container = $('[data-profile-selector]');
    if (!container || !state.profiles.length) return;

    var opts = state.profiles.map(function(p) {
      var sel = state.selectedSlug === p.slug ? ' selected' : '';
      return '<option value="' + p.slug + '"' + sel + '>' + p.name + ' (' + p.slug + ')</option>';
    }).join('');

    container.innerHTML =
      '<label>MetaBot Profile: </label>' +
      '<select data-profile-select>' +
        '<option value="">-- select --</option>' +
        opts +
      '</select>';

    $('[data-profile-select]').addEventListener('change', function() {
      var slug = this.value;
      if (slug) loadBindingsFor(slug);
    });
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function() {
    loadRuntimes();
    loadProfiles();
    $('[data-discover-btn]').addEventListener('click', discoverRuntimes);
  });
})()`;
}
