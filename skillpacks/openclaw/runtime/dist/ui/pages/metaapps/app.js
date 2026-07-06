"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetaAppsPageDefinition = buildMetaAppsPageDefinition;
const i18n_1 = require("../../i18n");
const share_1 = require("../../../core/metaapp/share");
function buildMetaAppsPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
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
        script: buildMetaAppsPageScript(i18n.t('action.openInBrowser')),
    };
}
function buildMetaAppsPageScript(openInBrowserLabel) {
    return `(() => {
  const queryParams = new URLSearchParams(window.location.search);
  const METAAPP_PUBLIC_BASE_URL = ${JSON.stringify(share_1.METAAPP_PUBLIC_BASE_URL)};
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

  function safeUrl(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return '';
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try {
      const allowed = new URL(value);
      return allowed.protocol === 'http:' || allowed.protocol === 'https:' ? allowed.href : '';
    } catch {
      return '';
    }
  }

  function isMetaAppsGalleryUrl(rawValue) {
    const value = safeUrl(rawValue);
    if (!value) return false;
    try {
      const parsed = new URL(value, window.location.origin);
      return parsed.pathname === '/ui/metaapps' || parsed.pathname.startsWith('/ui/metaapps/');
    } catch {
      return false;
    }
  }

  function nonGalleryUrl(rawValue) {
    const value = safeUrl(rawValue);
    return value && !isMetaAppsGalleryUrl(value) ? value : '';
  }

  function isMetaAppPinId(value) {
    return /^[0-9a-f]{64}i0$/i.test(String(value ?? '').trim());
  }

  function apiUrl(refresh) {
    const apiParams = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(window.location.search).entries()) {
      if (value) apiParams.append(key, value);
    }
    if (refresh) apiParams.set('refresh', 'true');
    const query = apiParams.toString();
    return query ? '/api/metaapps?' + query : '/api/metaapps';
  }

  function formatDate(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
    return new Date(timestamp).toLocaleString();
  }

  function label(record) {
    if (!record || typeof record !== 'object') return 'Untitled MetaApp';
    return record.title || record.appName || record.pinId || 'Untitled MetaApp';
  }

  function textValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  function flagValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'latest', 'current'].includes(normalized)) return true;
    if (['false', 'no', '0', 'previous', 'outdated', 'disabled'].includes(normalized)) return false;
    return null;
  }

  function statusLabel(record) {
    if (!record || typeof record !== 'object') return '';
    if (flagValue(record.disabled) === true) return 'Disabled';
    if (flagValue(record.enabled) === false) return 'Disabled';
    return textValue(record.status);
  }

  function latestLabel(record) {
    if (!record || typeof record !== 'object') return '';
    const latest = flagValue(record.latest);
    const isLatest = flagValue(record.isLatest);
    if (latest === true || isLatest === true) return 'Latest';
    if (latest === false || isLatest === false) return 'Previous version';
    const latestText = textValue(record.latest);
    if (latestText) return 'Latest ' + latestText;
    const latestRecord = record.latest && typeof record.latest === 'object' ? record.latest : null;
    const latestRecordVersion = latestRecord ? textValue(latestRecord.version || latestRecord.pinId || latestRecord.id) : '';
    if (latestRecordVersion) return 'Latest ' + latestRecordVersion;
    const latestVersion = textValue(record.latestVersion || record.latest_version || record.currentVersion || record.current_version);
    return latestVersion ? 'Latest ' + latestVersion : '';
  }

  function stateLabels(record) {
    return [statusLabel(record), latestLabel(record)].filter(Boolean);
  }

  function versionHistory(record) {
    if (!record || typeof record !== 'object') return [];
    const candidates = [
      record.versionHistory,
      record.version_history,
      record.history,
      record.versions,
      record.indexerHistory,
      record.raw?.versionHistory,
      record.raw?.version_history,
      record.raw?.history,
      record.raw?.versions,
      record.raw?.indexerHistory,
      record.raw?.indexer?.versionHistory,
      record.raw?.indexer?.history,
      record.raw?.data?.versionHistory,
      record.raw?.data?.history,
      record.indexer?.versionHistory,
      record.indexer?.history,
      record.indexerRaw?.versionHistory,
      record.indexerRaw?.history,
      record.metadata?.versionHistory,
      record.metadata?.history,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate.filter(Boolean);
    }
    return [];
  }

  function historyEntryLabel(entry, index) {
    if (!entry || typeof entry !== 'object') {
      return textValue(entry) || 'Version ' + (index + 1);
    }
    const version = textValue(entry.version || entry.appVersion || entry.versionLabel || entry.name) || 'Version ' + (index + 1);
    const pin = textValue(entry.pinId || entry.metaappPinId || entry.pin || entry.id);
    const labels = [statusLabel(entry), latestLabel(entry)].filter(Boolean).join(' - ');
    return [version, pin, labels].filter(Boolean).join(' - ');
  }

  function renderVersionHistory(record) {
    const entries = versionHistory(record).slice(0, 8);
    if (!entries.length) return '';
    return '<section class="metaapps-history" data-metaapps-history>'
      + '<h3>Version history</h3>'
      + '<ol>' + entries.map((entry, index) => '<li>' + escapeHtml(historyEntryLabel(entry, index)) + '</li>').join('') + '</ol>'
      + '</section>';
  }

  function primaryRunUrl(record) {
    return safeUrl(record.runUrl) || safeUrl(canonicalMetaAppUrl(record.pinId)) || safeUrl(record.metawebUrl) || nonGalleryUrl(record.localUiUrl);
  }

  function openUrl(record) {
    return safeUrl(canonicalMetaAppUrl(record.pinId)) || safeUrl(record.metawebUrl) || safeUrl(record.runUrl) || nonGalleryUrl(record.localUiUrl);
  }

  function downloadUrl(record) {
    if (record.downloadUrl) return safeUrl(record.downloadUrl);
    if (typeof record.code === 'string') return safeUrl(record.code);
    if (typeof record.content === 'string') return safeUrl(record.content);
    return '';
  }

  function browserMetaAppUrl(pinId) {
    return isMetaAppPinId(pinId) ? '/browser/metaapp/' + encodeURIComponent(String(pinId).trim()) : '';
  }

  function canonicalMetaAppUrl(pinId) {
    return isMetaAppPinId(pinId) ? METAAPP_PUBLIC_BASE_URL + '/' + encodeURIComponent(String(pinId).trim()) : '';
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
      const states = stateLabels(record);
      return '<button type="button" class="metaapps-row" data-metaapps-pin="' + escapeHtml(record.pinId) + '"' + active + '>'
        + '<span class="metaapps-row-title">' + escapeHtml(label(record)) + '</span>'
        + '<span class="metaapps-row-meta">' + escapeHtml(record.version || 'v?') + ' - ' + escapeHtml(record.network || 'network?') + ' - ' + escapeHtml(record.source || 'source?') + '</span>'
        + (states.length ? '<span class="metaapps-row-state">' + states.map((state) => '<span>' + escapeHtml(state) + '</span>').join('') + '</span>' : '')
        + (tags.length ? '<span class="metaapps-tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</span>' : '')
        + '</button>';
    }).join('');
  }

  function actionLink(href, labelText) {
    const safeHref = safeUrl(href);
    return safeHref
      ? '<a class="metaapps-action" href="' + escapeHtml(safeHref) + '" target="_blank" rel="noreferrer">' + escapeHtml(labelText) + '</a>'
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
    const open = openUrl(record);
    const localDetail = nonGalleryUrl(record.localUiUrl);
    const download = downloadUrl(record);
    const safeShareTarget = safeUrl(canonicalMetaAppUrl(record.pinId)) || safeUrl(record.metawebUrl) || localDetail;
    const validPinId = isMetaAppPinId(record.pinId) ? String(record.pinId).trim() : '';
    const browserMetaApp = browserMetaAppUrl(validPinId);
    const commentCommand = validPinId ? 'metabot metaapp comment --pin-id ' + validPinId + ' --comment ""' : '';
    const status = statusLabel(record);
    const latest = latestLabel(record);
    const badges = [record.operation || 'metaapp', status, latest].filter(Boolean);
    const fields = [
      ['Pin', record.pinId],
      ['First pin', record.firstPinId],
      ['Version', record.version],
      ['Status', status],
      ['Latest', latest],
      ['Latest version', record.latestVersion || record.latest_version],
      ['Runtime', record.runtime],
      ['Owner', record.ownerGlobalMetaId],
      ['Updated', formatDate(record.updatedAt)],
      ['Source', record.source],
    ];
    elements.detail.innerHTML = '<header class="metaapps-detail-head">'
      + '<div><span class="metaapps-kicker">Selected</span><h2>' + escapeHtml(label(record)) + '</h2></div>'
      + '<div class="metaapps-badges">' + badges.map((badge) => '<span class="metaapps-version">' + escapeHtml(badge) + '</span>').join('') + '</div>'
      + '</header>'
      + (record.intro || record.prompt ? '<p class="metaapps-summary">' + escapeHtml(record.intro || record.prompt) + '</p>' : '')
      + '<div class="metaapps-actions">'
      + actionLink(browserMetaApp, ${JSON.stringify(openInBrowserLabel)})
      + actionLink(open, 'Open')
      + actionLink(run, 'Run')
      + (localDetail && localDetail !== open && localDetail !== run ? actionLink(localDetail, 'Local detail') : '')
      + actionLink(download, 'Download')
      + (record.pinId ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(record.pinId) + '">Copy pin</button>' : '')
      + (safeShareTarget ? '<button type="button" class="metaapps-action" data-metaapps-share="' + escapeHtml(safeShareTarget) + '">Share</button>' : '')
      + (commentCommand ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(commentCommand) + '">Copy comment command</button>' : '')
      + '</div>'
      + '<dl class="metaapps-fields">' + fields.map(([name, value]) => '<div><dt>' + escapeHtml(name) + '</dt><dd>' + escapeHtml(value || 'Unknown') + '</dd></div>').join('') + '</dl>'
      + renderVersionHistory(record);
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
      setStatus('Loaded ' + records.length + ' MetaApp' + (records.length === 1 ? '' : 's') + '.');
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
