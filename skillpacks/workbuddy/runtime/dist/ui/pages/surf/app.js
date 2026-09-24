"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSurfPageDefinition = buildSurfPageDefinition;
const i18n_1 = require("../../i18n");
function buildSurfPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    return {
        page: 'surf',
        title: i18n.t('surf.title'),
        eyebrow: i18n.t('surf.eyebrow'),
        heading: i18n.t('surf.heading'),
        description: i18n.t('surf.description'),
        panels: [],
        contentHtml: `
      <section class="surf-shell" data-surf-shell>
        <div class="surf-toolbar">
          <div>
            <h1 data-i18n-key="surf.heading">${i18n.t('surf.heading')}</h1>
            <p data-surf-status data-i18n-key="surf.status.loading">${i18n.t('surf.status.loading')}</p>
          </div>
          <div class="surf-toolbar-actions">
            <button class="btn btn-sm" type="button" data-surf-refresh data-i18n-key="surf.refresh">${i18n.t('surf.refresh')}</button>
            <button class="btn btn-primary" type="button" data-surf-run data-i18n-key="surf.runNow">${i18n.t('surf.runNow')}</button>
          </div>
        </div>
        <div class="surf-grid">
          <article class="card">
            <h2 class="card-title" data-i18n-key="surf.cardStatus">${i18n.t('surf.cardStatus')}</h2>
            <dl class="def-list" data-surf-status-list></dl>
          </article>
          <article class="card">
            <h2 class="card-title" data-i18n-key="surf.cardSettings">${i18n.t('surf.cardSettings')}</h2>
            <div class="surf-settings">
              <div class="surf-settings-row">
                <div>
                  <strong data-i18n-key="surf.enabledLabel">${i18n.t('surf.enabledLabel')}</strong>
                  <p class="field-hint" data-surf-enabled-hint></p>
                </div>
                <button class="btn btn-sm" type="button" data-surf-toggle></button>
              </div>
              <form class="surf-settings-row" data-surf-budget-form>
                <label class="field surf-budget-field">
                  <span data-i18n-key="surf.budgetLabel">${i18n.t('surf.budgetLabel')}</span>
                  <input type="number" min="1" step="1" data-surf-budget-input />
                </label>
                <button class="btn btn-sm" type="submit" data-surf-budget-save data-i18n-key="surf.budgetSave">${i18n.t('surf.budgetSave')}</button>
              </form>
              <p class="field-hint" data-i18n-key="surf.budgetHint">${i18n.t('surf.budgetHint')}</p>
              <p class="status-msg" data-surf-settings-status role="status" aria-live="polite"></p>
            </div>
          </article>
        </div>
        <div class="surf-reports">
          <div class="section-header">
            <h2 class="section-title" data-i18n-key="surf.reportsTitle">${i18n.t('surf.reportsTitle')}</h2>
          </div>
          <div class="table-wrap" data-surf-reports-table></div>
          <article class="card surf-report-viewer" data-surf-report-viewer></article>
        </div>
      </section>
    `,
        script: `(() => {
  const elements = {
    status: document.querySelector('[data-surf-status]'),
    refresh: document.querySelector('[data-surf-refresh]'),
    run: document.querySelector('[data-surf-run]'),
    statusList: document.querySelector('[data-surf-status-list]'),
    enabledHint: document.querySelector('[data-surf-enabled-hint]'),
    toggle: document.querySelector('[data-surf-toggle]'),
    budgetForm: document.querySelector('[data-surf-budget-form]'),
    budgetInput: document.querySelector('[data-surf-budget-input]'),
    budgetSave: document.querySelector('[data-surf-budget-save]'),
    settingsStatus: document.querySelector('[data-surf-settings-status]'),
    reportsTable: document.querySelector('[data-surf-reports-table]'),
    reportViewer: document.querySelector('[data-surf-report-viewer]'),
  };
  const query = new URLSearchParams(window.location.search);
  const fromBot = (query.get('from') || '').trim();
  const withFrom = (body) => {
    const payload = body || {};
    return fromBot ? Object.assign({}, payload, { from: fromBot }) : payload;
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const formatText = (template, replacements) => Object.keys(replacements || {}).reduce(
    (text, name) => text.split('{' + name + '}').join(String(replacements[name])),
    String(template == null ? '' : template)
  );
  const uiText = (key, fallback, replacements) => {
    try {
      if (typeof window !== 'undefined' && window.__oacLocalUiI18n && typeof window.__oacLocalUiI18n.t === 'function') {
        const translated = window.__oacLocalUiI18n.t(key, replacements || {});
        if (translated && translated !== key) return translated;
      }
    } catch {}
    return formatText(fallback, replacements || {});
  };
  const parseTime = (value) => {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  };
  const formatDateTime = (value) => {
    const ms = parseTime(value);
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (part) => String(part).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };
  const formatRelative = (value) => {
    const ms = parseTime(value);
    if (!ms) return '';
    const minutes = Math.floor((Date.now() - ms) / 60000);
    if (minutes < 1) return uiText('time.justNow', 'Just now');
    if (minutes < 60) return uiText('time.minutesAgo', '{n} min ago', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return uiText('time.hoursAgo', '{n} hr ago', { n: hours });
    return uiText('time.daysAgo', '{n} d ago', { n: Math.floor(hours / 24) });
  };

  const state = {
    loading: true,
    error: '',
    running: false,
    enabled: false,
    budget: 0,
    preDreamDue: false,
    runs: [],
    selectedRunId: '',
    busyRun: false,
    busySettings: false,
    settingsMessage: '',
    settingsMessageKind: '',
  };
  let pollTimer = 0;
  const statusState = { key: 'surf.status.loading', replacements: null, text: '' };

  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withFrom(body)),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('surf.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };

  const renderStatusLine = () => {
    if (!elements.status) return;
    if (statusState.key) {
      elements.status.textContent = uiText(statusState.key, statusState.key, statusState.replacements || {});
      return;
    }
    elements.status.textContent = statusState.text;
  };
  const setStatusKey = (key, replacements) => {
    statusState.key = key;
    statusState.replacements = replacements || null;
    statusState.text = '';
    renderStatusLine();
  };
  const setStatusText = (text) => {
    statusState.key = '';
    statusState.replacements = null;
    statusState.text = String(text || '');
    renderStatusLine();
  };

  const setSettingsMessage = (kind, key, fallback, replacements) => {
    state.settingsMessageKind = kind;
    state.settingsMessage = key ? uiText(key, fallback, replacements || {}) : String(fallback || '');
    renderSettings();
  };

  const statusPill = (kind, label, pulse) => {
    const pulseAttr = pulse ? ' data-surf-pulse="true"' : '';
    return '<span class="status-pill ' + kind + '"' + pulseAttr + '><span class="status-dot"></span>' + escapeHtml(label) + '</span>';
  };

  const renderStatusList = () => {
    if (!elements.statusList) return;
    const lastFinished = state.runs.find((run) => run.status !== 'running' && run.finishedAt) || null;
    const lastRunLabel = lastFinished
      ? formatRelative(lastFinished.finishedAt) || formatDateTime(lastFinished.finishedAt)
      : uiText('surf.never', 'Never');
    const lastRunTitle = lastFinished ? formatDateTime(lastFinished.finishedAt) : '';
    let nextRunLabel = uiText('surf.nextOff', 'Off');
    if (state.enabled) {
      nextRunLabel = state.preDreamDue
        ? uiText('surf.nextDueTonight', 'Due tonight, before the dream')
        : uiText('surf.nextTonight', 'Tonight, before the dream');
    }
    const statePill = state.running
      ? statusPill('status-active', uiText('surf.running', 'Running'), true)
      : statusPill('', uiText('surf.idle', 'Idle'), false);
    const enabledPill = state.enabled
      ? statusPill('status-online', uiText('surf.on', 'On'), false)
      : statusPill('status-offline', uiText('surf.off', 'Off'), false);
    const rows = [
      ['surf.stateLabel', 'State', statePill],
      ['surf.enabledLabel', 'Surf before dream', enabledPill],
      ['surf.budgetLabel', 'Interaction budget', escapeHtml(String(state.budget))],
      ['surf.lastRunLabel', 'Last run', '<span title="' + escapeHtml(lastRunTitle) + '">' + escapeHtml(lastRunLabel) + '</span>'],
      ['surf.nextRunLabel', 'Next run', escapeHtml(nextRunLabel)],
    ];
    elements.statusList.innerHTML = rows.map((row) => (
      '<div class="def-row"><dt>' + escapeHtml(uiText(row[0], row[1])) + '</dt><dd>' + row[2] + '</dd></div>'
    )).join('');
  };

  const renderSettings = () => {
    if (!elements.toggle) return;
    elements.toggle.textContent = state.enabled
      ? uiText('surf.disable', 'Disable surf')
      : uiText('surf.enable', 'Enable surf');
    elements.toggle.disabled = state.busySettings;
    if (elements.enabledHint) {
      elements.enabledHint.textContent = state.enabled
        ? uiText('surf.nextTonight', 'Tonight, before the dream')
        : uiText('surf.nextOff', 'Off');
    }
    if (elements.budgetInput && document.activeElement !== elements.budgetInput) {
      elements.budgetInput.value = String(state.budget || '');
    }
    if (elements.budgetInput) elements.budgetInput.disabled = state.busySettings;
    if (elements.budgetSave) elements.budgetSave.disabled = state.busySettings;
    if (elements.settingsStatus) {
      elements.settingsStatus.textContent = state.settingsMessage;
      elements.settingsStatus.className = 'status-msg' + (state.settingsMessageKind ? ' ' + state.settingsMessageKind : '');
    }
  };

  const runSummary = (run) => {
    const stats = run.stats || {};
    return uiText('surf.summary', 'fetched {fetched} · deep-read {read} · saved {saved}', {
      fetched: Number(stats.fetched) || 0,
      read: Number(stats.deepRead) || 0,
      saved: Number(stats.savedToKb) || 0,
    });
  };
  const triggerLabel = (trigger) => uiText('surf.trigger.' + trigger, trigger);
  const runStatusLabel = (status) => uiText('surf.runStatus.' + status, status);

  const safeHref = (rawHref) => {
    const href = String(rawHref || '').trim().replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|file:)/iu.test(href)) return escapeHtml(href);
    return '';
  };
  const renderInlineMarkdown = (raw) => {
    const tick = String.fromCharCode(96);
    let html = escapeHtml(raw);
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/gu, (_, label, href) => {
      const safe = safeHref(href);
      return safe
        ? '<a href="' + safe + '" target="_blank" rel="noopener">' + label + '</a>'
        : label;
    });
    const inlineCodePattern = new RegExp(tick + '([^' + tick + '\\\\n]+)' + tick, 'gu');
    html = html.replace(inlineCodePattern, '<code class="md-inline-code">$1</code>');
    html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/gu, '<strong>$1</strong>');
    html = html.replace(/\\*([^*\\n]+)\\*/gu, '<em>$1</em>');
    return html;
  };
  const renderMarkdown = (content) => {
    const source = String(content || '').replace(/\\r\\n?/gu, '\\n');
    if (!source.trim()) return '<span class="muted">' + escapeHtml(uiText('surf.noReport', 'This run produced no report.')) + '</span>';
    const lines = source.split('\\n');
    const html = [];
    let paragraph = [];
    let listType = '';
    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push('<p>' + paragraph.map(renderInlineMarkdown).join('<br>') + '</p>');
      paragraph = [];
    };
    const flushList = () => {
      if (!listType) return;
      html.push('</' + listType + '>');
      listType = '';
    };
    const openList = (type) => {
      if (listType === type) return;
      flushParagraph();
      flushList();
      listType = type;
      html.push('<' + type + '>');
    };
    lines.forEach((line) => {
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }
      const heading = line.match(/^\\s*(#{1,6})\\s+(.+)$/u);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(6, heading[1].length);
        html.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
        return;
      }
      const quote = line.match(/^\\s*>\\s?(.+)$/u);
      if (quote) {
        flushParagraph();
        flushList();
        html.push('<blockquote>' + renderInlineMarkdown(quote[1]) + '</blockquote>');
        return;
      }
      const unordered = line.match(/^\\s*[-*]\\s+(.+)$/u);
      if (unordered) {
        openList('ul');
        html.push('<li>' + renderInlineMarkdown(unordered[1]) + '</li>');
        return;
      }
      const ordered = line.match(/^\\s*\\d+[.]\\s+(.+)$/u);
      if (ordered) {
        openList('ol');
        html.push('<li>' + renderInlineMarkdown(ordered[1]) + '</li>');
        return;
      }
      flushList();
      paragraph.push(line);
    });
    flushParagraph();
    flushList();
    return html.join('');
  };

  const renderReports = () => {
    if (!elements.reportsTable) return;
    if (!state.runs.length) {
      elements.reportsTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('surf.reportsEmpty', 'No surf runs yet'))
        + '</strong>' + escapeHtml(uiText('surf.reportsEmptyHint', 'Run surf now to explore the MetaWeb, or enable surf before dream for a nightly run.'))
        + '</div>';
    } else {
      const head = '<thead><tr>'
        + '<th>' + escapeHtml(uiText('surf.colStatus', 'Status')) + '</th>'
        + '<th>' + escapeHtml(uiText('surf.colTrigger', 'Trigger')) + '</th>'
        + '<th>' + escapeHtml(uiText('surf.colStarted', 'Started')) + '</th>'
        + '<th>' + escapeHtml(uiText('surf.colSummary', 'Summary')) + '</th>'
        + '<th>' + escapeHtml(uiText('surf.colActions', 'Actions')) + '</th>'
        + '</tr></thead>';
      const rows = state.runs.map((run) => {
        const pillKind = run.status === 'running' ? 'status-active' : (run.status === 'done' ? 'status-completed' : 'status-failure');
        const pulse = run.status === 'running' ? ' data-surf-pulse="true"' : '';
        const startedAt = formatRelative(run.startedAt) || formatDateTime(run.startedAt);
        const errorLine = run.error
          ? '<div class="surf-run-error">' + escapeHtml(uiText('surf.runError', 'Error: {message}', { message: run.error })) + '</div>'
          : '';
        return '<tr data-run-id="' + escapeHtml(run.id) + '" data-selected="' + (run.id === state.selectedRunId ? 'true' : 'false') + '">'
          + '<td><span class="status-pill ' + pillKind + '"' + pulse + '><span class="status-dot"></span>' + escapeHtml(runStatusLabel(run.status)) + '</span></td>'
          + '<td>' + escapeHtml(triggerLabel(run.trigger)) + '</td>'
          + '<td class="mono" title="' + escapeHtml(formatDateTime(run.startedAt)) + '">' + escapeHtml(startedAt) + '</td>'
          + '<td>' + escapeHtml(runSummary(run)) + errorLine + '</td>'
          + '<td><button class="btn btn-sm" type="button" data-view-report="' + escapeHtml(run.id) + '">' + escapeHtml(uiText('surf.viewReport', 'View report')) + '</button></td>'
          + '</tr>';
      }).join('');
      elements.reportsTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
    }
    elements.reportsTable.querySelectorAll('[data-view-report]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedRunId = button.getAttribute('data-view-report') || '';
        renderReports();
      });
    });
  };

  const renderViewer = () => {
    if (!elements.reportViewer) return;
    const run = state.runs.find((candidate) => candidate.id === state.selectedRunId) || null;
    if (!run) {
      elements.reportViewer.innerHTML = '<div class="session-empty"><strong>'
        + escapeHtml(uiText('surf.selectReport', 'Select a run to read its report.'))
        + '</strong></div>';
      return;
    }
    const title = triggerLabel(run.trigger) + ' · ' + (formatDateTime(run.startedAt) || run.startedAt);
    let bodyHtml;
    if (run.error) {
      bodyHtml = '<p class="status-msg error">' + escapeHtml(uiText('surf.runError', 'Error: {message}', { message: run.error })) + '</p>';
      if (run.reportMarkdown) bodyHtml += '<div class="report-body">' + renderMarkdown(run.reportMarkdown) + '</div>';
    } else {
      bodyHtml = '<div class="report-body">' + renderMarkdown(run.reportMarkdown) + '</div>';
    }
    elements.reportViewer.innerHTML = '<h2 class="card-title">' + escapeHtml(title) + '</h2>' + bodyHtml;
  };

  const render = () => {
    if (elements.status) {
      if (state.error) setStatusText(state.error);
    }
    renderStatusList();
    renderSettings();
    renderReports();
    renderViewer();
  };

  const load = async (options) => {
    const silent = Boolean(options && options.silent);
    if (!silent) {
      state.loading = true;
      state.error = '';
      setStatusKey('surf.status.loading');
    }
    try {
      const data = await postJson('/api/surf/status', { limit: 10 });
      state.running = data.running === true;
      state.enabled = data.surfBeforeDreamEnabled === true;
      state.budget = Number(data.interactionBudget) || 0;
      state.preDreamDue = data.preDreamDue === true;
      state.runs = Array.isArray(data.runs) ? data.runs : [];
      if (!state.selectedRunId && state.runs.length) {
        state.selectedRunId = state.runs[0].id;
      }
      state.loading = false;
      if (!silent) setStatusKey('surf.status.loaded');
      if (!silent) state.error = '';
      render();
      if (state.running) schedulePoll();
    } catch (error) {
      if (!silent) {
        state.loading = false;
        state.error = (error && error.message) || uiText('surf.status.failed', 'Surf status failed to load.');
        setStatusText(state.error);
        render();
      } else if (state.running) {
        schedulePoll();
      }
    }
  };

  const schedulePoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = 0;
      load({ silent: true }).catch(() => undefined);
    }, 3000);
  };

  const runSurf = async () => {
    if (state.busyRun) return;
    state.busyRun = true;
    if (elements.run) elements.run.disabled = true;
    setStatusKey('surf.runStarting');
    try {
      await postJson('/api/surf/run', { trigger: 'manual-ui' });
      setStatusKey('surf.runStarted');
      await load({ silent: true });
    } catch (error) {
      setStatusText((error && error.message) || uiText('surf.runStartFailed', 'Failed to start the surf run.'));
    } finally {
      state.busyRun = false;
      if (elements.run) elements.run.disabled = false;
      render();
    }
  };

  const toggleEnabled = async () => {
    if (state.busySettings) return;
    state.busySettings = true;
    setSettingsMessage('', '', '');
    renderSettings();
    try {
      await postJson(state.enabled ? '/api/surf/disable' : '/api/surf/enable', {});
      setSettingsMessage('success', 'surf.settingsSaved', 'Surf setting saved.');
      await load({ silent: true });
    } catch (error) {
      setSettingsMessage('error', 'surf.settingsSaveFailed', (error && error.message) || 'Failed to save the surf setting.');
    } finally {
      state.busySettings = false;
      render();
    }
  };

  const saveBudget = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busySettings) return;
    const raw = elements.budgetInput ? String(elements.budgetInput.value || '').trim() : '';
    const budget = Number(raw);
    if (!raw || !Number.isInteger(budget) || budget < 1) {
      setSettingsMessage('error', 'surf.budgetInvalid', 'Enter a whole number of 1 or more.');
      return;
    }
    state.busySettings = true;
    setSettingsMessage('', '', '');
    renderSettings();
    try {
      await postJson('/api/surf/budget', { budget });
      setSettingsMessage('success', 'surf.settingsSaved', 'Surf setting saved.');
      await load({ silent: true });
    } catch (error) {
      setSettingsMessage('error', 'surf.settingsSaveFailed', (error && error.message) || 'Failed to save the surf setting.');
    } finally {
      state.busySettings = false;
      render();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', () => { load(); });
  if (elements.run) elements.run.addEventListener('click', runSurf);
  if (elements.toggle) elements.toggle.addEventListener('click', toggleEnabled);
  if (elements.budgetForm) elements.budgetForm.addEventListener('submit', saveBudget);
  window.addEventListener('oac:i18n-changed', () => {
    renderStatusLine();
    render();
  });
  window.addEventListener('beforeunload', () => { if (pollTimer) clearTimeout(pollTimer); });

  load();
})();`,
    };
}
