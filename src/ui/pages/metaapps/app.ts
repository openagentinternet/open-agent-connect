import type { LocalUiPageDefinition } from '../types';

export function buildMetaAppsPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'metaapps',
    title: 'MetaApps',
    eyebrow: 'MetaApps',
    heading: 'MetaApps',
    description: 'Local MetaApp gallery entry point.',
    panels: [],
    contentHtml: `
      <section class="metaapps-shell" data-metaapps-shell>
        <header class="metaapps-header">
          <div>
            <span class="metaapps-kicker">Gallery</span>
            <h1>MetaApps</h1>
          </div>
          <button type="button" class="metaapps-refresh" data-metaapps-refresh>Refresh</button>
        </header>
        <div class="metaapps-status" data-metaapps-status>Loading MetaApps...</div>
        <section class="metaapps-workspace" aria-label="MetaApps gallery">
          <div class="metaapps-list" data-metaapps-list aria-label="MetaApps list"></div>
          <section class="metaapps-detail" data-metaapps-detail aria-label="MetaApp detail">
            <div class="metaapps-empty">Select a MetaApp to inspect its runtime links and metadata.</div>
          </section>
        </section>
      </section>
    `,
    script: buildMetaAppsPageScript(),
  };
}

function buildMetaAppsPageScript(): string {
  return `(() => {
  const queryParams = new URLSearchParams(window.location.search);
  const elements = {
    list: document.querySelector('[data-metaapps-list]'),
    detail: document.querySelector('[data-metaapps-detail]'),
    refresh: document.querySelector('[data-metaapps-refresh]'),
    status: document.querySelector('[data-metaapps-status]'),
  };
  let records = [];
  let selectedPinId = queryParams.get('pinId') || '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function apiUrl(refresh) {
    const apiParams = new URLSearchParams();
    for (const key of ['pinId', 'firstPinId', 'mine', 'from']) {
      const value = queryParams.get(key);
      if (value) apiParams.set(key, value);
    }
    if (refresh) {
      const refreshParams = apiParams;
      refreshParams.set('refresh', 'true');
    }
    const query = apiParams.toString();
    return query ? '/api/metaapps?' + query : '/api/metaapps';
  }

  function formatDate(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
    return new Date(timestamp).toLocaleString();
  }

  function label(record) {
    return record.title || record.appName || record.pinId || 'Untitled MetaApp';
  }

  function primaryRunUrl(record) {
    return record.runUrl || record.localUiUrl || record.metawebUrl || '';
  }

  function downloadUrl(record) {
    if (record.downloadUrl) return record.downloadUrl;
    if (typeof record.code === 'string' && /^https?:\\/\\//i.test(record.code)) return record.code;
    if (typeof record.content === 'string' && /^https?:\\/\\//i.test(record.content)) return record.content;
    return '';
  }

  function setStatus(message, mode) {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = mode || '';
  }

  async function copyText(value) {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      setStatus('Copied to clipboard.');
      return;
    }
    setStatus(value);
  }

  function renderList() {
    if (!elements.list) return;
    if (records.length === 0) {
      elements.list.innerHTML = '<div class="metaapps-empty">No MetaApps matched this view.</div>';
      return;
    }
    elements.list.innerHTML = records.map((record) => {
      const active = record.pinId === selectedPinId ? ' aria-current="true"' : '';
      const tags = Array.isArray(record.tags) ? record.tags.slice(0, 4) : [];
      return '<button type="button" class="metaapps-row" data-metaapps-pin="' + escapeHtml(record.pinId) + '"' + active + '>'
        + '<span class="metaapps-row-title">' + escapeHtml(label(record)) + '</span>'
        + '<span class="metaapps-row-meta">' + escapeHtml(record.version || 'v?') + ' - ' + escapeHtml(record.network || 'network?') + ' - ' + escapeHtml(record.source || 'source?') + '</span>'
        + (tags.length ? '<span class="metaapps-tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</span>' : '')
        + '</button>';
    }).join('');
  }

  function actionLink(href, labelText) {
    return href
      ? '<a class="metaapps-action" href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(labelText) + '</a>'
      : '';
  }

  function renderDetail() {
    if (!elements.detail) return;
    const record = records.find((item) => item.pinId === selectedPinId) || records[0];
    if (!record) {
      elements.detail.innerHTML = '<div class="metaapps-empty">No MetaApp selected.</div>';
      return;
    }
    selectedPinId = record.pinId;
    const run = primaryRunUrl(record);
    const download = downloadUrl(record);
    const shareTarget = record.metawebUrl || record.localUiUrl || record.pinId || '';
    const commentCommand = record.pinId ? 'metabot metaapp comment --pin-id ' + record.pinId + ' --comment ""' : '';
    const fields = [
      ['Pin', record.pinId],
      ['First pin', record.firstPinId],
      ['Version', record.version],
      ['Runtime', record.runtime],
      ['Owner', record.ownerGlobalMetaId],
      ['Updated', formatDate(record.updatedAt)],
      ['Source', record.source],
    ];
    elements.detail.innerHTML = '<header class="metaapps-detail-head">'
      + '<div><span class="metaapps-kicker">Selected</span><h2>' + escapeHtml(label(record)) + '</h2></div>'
      + '<span class="metaapps-version">' + escapeHtml(record.operation || 'metaapp') + '</span>'
      + '</header>'
      + (record.intro || record.prompt ? '<p class="metaapps-summary">' + escapeHtml(record.intro || record.prompt) + '</p>' : '')
      + '<div class="metaapps-actions">'
      + actionLink(record.localUiUrl || record.metawebUrl, 'Open')
      + actionLink(run, 'Run')
      + actionLink(download, 'Download')
      + (record.pinId ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(record.pinId) + '">Copy pin</button>' : '')
      + (shareTarget ? '<button type="button" class="metaapps-action" data-metaapps-share="' + escapeHtml(shareTarget) + '">Share</button>' : '')
      + (commentCommand ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(commentCommand) + '">Comment</button>' : '')
      + '</div>'
      + '<dl class="metaapps-fields">' + fields.map(([name, value]) => '<div><dt>' + escapeHtml(name) + '</dt><dd>' + escapeHtml(value || 'Unknown') + '</dd></div>').join('') + '</dl>';
  }

  async function load(refresh = false) {
    setStatus(refresh ? 'Refreshing MetaApps...' : 'Loading MetaApps...');
    if (elements.refresh) elements.refresh.disabled = true;
    try {
      const response = await fetch(apiUrl(refresh), { headers: { accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || payload.code || 'Unable to load MetaApps.');
      }
      records = Array.isArray(payload.data?.records) ? payload.data.records : [];
      if (!selectedPinId && records[0]?.pinId) selectedPinId = records[0].pinId;
      renderList();
      renderDetail();
      const refreshError = payload.data?.indexerRefreshError;
      setStatus(refreshError ? 'Loaded local cache; refresh failed: ' + refreshError.message : 'Loaded ' + records.length + ' MetaApp' + (records.length === 1 ? '' : 's') + '.', refreshError ? 'warning' : '');
    } catch (error) {
      records = [];
      if (elements.list) elements.list.innerHTML = '<div class="metaapps-empty">No MetaApps loaded.</div>';
      if (elements.detail) elements.detail.innerHTML = '<div class="metaapps-error">' + escapeHtml(error.message || String(error)) + '</div>';
      setStatus(error.message || String(error), 'error');
    } finally {
      if (elements.refresh) elements.refresh.disabled = false;
    }
  }

  elements.list?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-metaapps-pin]');
    if (!row) return;
    selectedPinId = row.dataset.metaappsPin || '';
    renderList();
    renderDetail();
  });

  elements.detail?.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-metaapps-copy]');
    if (copy) {
      await copyText(copy.dataset.metaappsCopy || '');
      return;
    }
    const share = event.target.closest('[data-metaapps-share]');
    if (share) {
      const url = share.dataset.metaappsShare || '';
      if (navigator.share) {
        await navigator.share({ title: 'MetaApp', url }).catch(() => copyText(url));
      } else {
        await copyText(url);
      }
    }
  });

  elements.refresh?.addEventListener('click', () => load(true));
  load(false);
})();`;
}
