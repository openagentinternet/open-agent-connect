"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTrafficPageDefinition = buildTrafficPageDefinition;
const i18n_1 = require("../../i18n");
function buildTrafficPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    return {
        page: 'traffic',
        title: i18n.t('traffic.title'),
        titleKey: 'traffic.title',
        eyebrow: i18n.t('traffic.eyebrow'),
        heading: i18n.t('traffic.heading'),
        description: i18n.t('traffic.description'),
        panels: [],
        contentHtml: `
      <section class="traffic-shell" data-traffic-shell>
        <div class="traffic-toolbar">
          <div>
            <h1 data-i18n-key="traffic.heading">${i18n.t('traffic.heading')}</h1>
            <p data-traffic-status data-i18n-key="traffic.status.loading">${i18n.t('traffic.status.loading')}</p>
          </div>
          <button class="btn" type="button" data-traffic-refresh data-i18n-key="traffic.refresh">${i18n.t('traffic.refresh')}</button>
        </div>
        <article class="card traffic-card" data-traffic-gate hidden>
          <h2 class="card-title" data-i18n-key="traffic.identityRequired.title">${i18n.t('traffic.identityRequired.title')}</h2>
          <p class="field-hint" data-i18n-key="traffic.identityRequired.body">${i18n.t('traffic.identityRequired.body')}</p>
          <p><a class="btn btn-sm" href="/ui/settings" data-i18n-key="traffic.identityRequired.action">${i18n.t('traffic.identityRequired.action')}</a></p>
        </article>
        <div class="traffic-grid" data-traffic-content hidden>
          <article class="card traffic-card">
            <h2 class="card-title" data-i18n-key="traffic.modeTitle">${i18n.t('traffic.modeTitle')}</h2>
            <div class="traffic-seg" role="group" data-traffic-mode-seg>
              <button class="traffic-seg-btn" type="button" data-traffic-mode="traffic" data-active="false" data-i18n-key="traffic.modeTraffic">${i18n.t('traffic.modeTraffic')}</button>
              <button class="traffic-seg-btn" type="button" data-traffic-mode="selfpay" data-active="false" data-i18n-key="traffic.modeSelfpay">${i18n.t('traffic.modeSelfpay')}</button>
            </div>
            <p class="field-hint" data-traffic-mode-hint></p>
            <p class="status-msg" data-traffic-mode-status role="status" aria-live="polite"></p>
          </article>
          <article class="card traffic-card">
            <h2 class="card-title" data-i18n-key="traffic.balanceTitle">${i18n.t('traffic.balanceTitle')}</h2>
            <div class="traffic-balance-value" data-traffic-balance-value title="">—</div>
            <div class="traffic-meter" data-traffic-meter hidden><div class="traffic-meter-fill" data-traffic-meter-fill style="width:0%"></div></div>
            <p class="traffic-balance-stats" data-traffic-balance-stats></p>
            <div class="schedule-row-actions">
              <button class="btn btn-sm" type="button" data-traffic-balance-refresh data-i18n-key="traffic.balanceRefresh">${i18n.t('traffic.balanceRefresh')}</button>
            </div>
            <div class="traffic-grant" data-traffic-grant hidden>
              <span data-traffic-grant-hint></span>
              <button class="btn btn-primary btn-sm" type="button" data-traffic-claim></button>
            </div>
            <p class="status-msg" data-traffic-balance-status role="status" aria-live="polite"></p>
            <div class="traffic-warning" data-traffic-low hidden>
              <span data-i18n-key="traffic.lowBalance">${i18n.t('traffic.lowBalance')}</span>
            </div>
          </article>
        </div>
        <article class="card traffic-card" data-traffic-redeem-card hidden>
          <h2 class="card-title" data-i18n-key="traffic.redeemTitle">${i18n.t('traffic.redeemTitle')}</h2>
          <p class="field-hint" data-i18n-key="traffic.redeemBody">${i18n.t('traffic.redeemBody')}</p>
          <form class="traffic-redeem-row" data-traffic-redeem-form>
            <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-traffic-redeem-input />
            <button class="btn btn-primary btn-sm" type="submit" data-traffic-redeem-submit data-i18n-key="traffic.redeemSubmit">${i18n.t('traffic.redeemSubmit')}</button>
          </form>
          <p class="status-msg" data-traffic-redeem-status role="status" aria-live="polite"></p>
        </article>
        <article class="card traffic-card" data-traffic-usage-card hidden>
          <h2 class="card-title" data-i18n-key="traffic.usageTitle">${i18n.t('traffic.usageTitle')}</h2>
          <div class="traffic-summary-grid" data-traffic-summary></div>
          <p class="field-hint" data-traffic-usage-note></p>
          <div class="table-wrap" data-traffic-usage-table></div>
        </article>
        <article class="card traffic-card" data-traffic-ledger-card hidden>
          <h2 class="card-title" data-i18n-key="traffic.ledgerTitle">${i18n.t('traffic.ledgerTitle')}</h2>
          <div class="table-wrap" data-traffic-ledger-table></div>
          <div class="traffic-ledger-more" data-traffic-ledger-more hidden>
            <button class="btn btn-sm" type="button" data-traffic-ledger-load-more data-i18n-key="traffic.ledgerLoadMore">${i18n.t('traffic.ledgerLoadMore')}</button>
          </div>
          <p class="status-msg" data-traffic-ledger-status role="status" aria-live="polite"></p>
        </article>
        <article class="card traffic-card" data-traffic-api-card hidden>
          <h2 class="card-title" data-i18n-key="traffic.apiBaseTitle">${i18n.t('traffic.apiBaseTitle')}</h2>
          <p class="traffic-code" data-traffic-api-current></p>
          <p class="field-hint" data-i18n-key="traffic.apiBaseDesc">${i18n.t('traffic.apiBaseDesc')}</p>
          <form class="traffic-api-base-row" data-traffic-api-form>
            <input type="text" autocomplete="off" spellcheck="false" data-traffic-api-input />
            <button class="btn btn-primary btn-sm" type="submit" data-traffic-api-save data-i18n-key="traffic.apiBaseSave">${i18n.t('traffic.apiBaseSave')}</button>
            <button class="btn btn-sm" type="button" data-traffic-api-reset data-i18n-key="traffic.apiBaseReset">${i18n.t('traffic.apiBaseReset')}</button>
          </form>
          <p class="status-msg" data-traffic-api-status role="status" aria-live="polite"></p>
        </article>
      </section>
    `,
        script: `(() => {
  const elements = {
    status: document.querySelector('[data-traffic-status]'),
    refresh: document.querySelector('[data-traffic-refresh]'),
    gate: document.querySelector('[data-traffic-gate]'),
    content: document.querySelector('[data-traffic-content]'),
    modeSeg: document.querySelector('[data-traffic-mode-seg]'),
    modeHint: document.querySelector('[data-traffic-mode-hint]'),
    modeStatus: document.querySelector('[data-traffic-mode-status]'),
    balanceValue: document.querySelector('[data-traffic-balance-value]'),
    balanceMeter: document.querySelector('[data-traffic-meter]'),
    balanceMeterFill: document.querySelector('[data-traffic-meter-fill]'),
    balanceStats: document.querySelector('[data-traffic-balance-stats]'),
    balanceRefresh: document.querySelector('[data-traffic-balance-refresh]'),
    balanceStatus: document.querySelector('[data-traffic-balance-status]'),
    grant: document.querySelector('[data-traffic-grant]'),
    grantHint: document.querySelector('[data-traffic-grant-hint]'),
    claim: document.querySelector('[data-traffic-claim]'),
    low: document.querySelector('[data-traffic-low]'),
    redeemCard: document.querySelector('[data-traffic-redeem-card]'),
    redeemForm: document.querySelector('[data-traffic-redeem-form]'),
    redeemInput: document.querySelector('[data-traffic-redeem-input]'),
    redeemSubmit: document.querySelector('[data-traffic-redeem-submit]'),
    redeemStatus: document.querySelector('[data-traffic-redeem-status]'),
    usageCard: document.querySelector('[data-traffic-usage-card]'),
    usageSummary: document.querySelector('[data-traffic-summary]'),
    usageNote: document.querySelector('[data-traffic-usage-note]'),
    usageTable: document.querySelector('[data-traffic-usage-table]'),
    ledgerCard: document.querySelector('[data-traffic-ledger-card]'),
    ledgerTable: document.querySelector('[data-traffic-ledger-table]'),
    ledgerMore: document.querySelector('[data-traffic-ledger-more]'),
    ledgerLoadMore: document.querySelector('[data-traffic-ledger-load-more]'),
    ledgerStatus: document.querySelector('[data-traffic-ledger-status]'),
    apiCard: document.querySelector('[data-traffic-api-card]'),
    apiCurrent: document.querySelector('[data-traffic-api-current]'),
    apiForm: document.querySelector('[data-traffic-api-form]'),
    apiInput: document.querySelector('[data-traffic-api-input]'),
    apiSave: document.querySelector('[data-traffic-api-save]'),
    apiReset: document.querySelector('[data-traffic-api-reset]'),
    apiStatus: document.querySelector('[data-traffic-api-status]'),
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
    if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : 0;
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

  const state = {
    loading: false,
    identityChecked: false,
    hasIdentity: false,
    featureUnavailable: false,
    mode: 'traffic',
    modeBusy: false,
    identityAddress: '',
    account: null,
    freeGrant: null,
    balanceBusy: false,
    claimBusy: false,
    redeemBusy: false,
    redeemNote: { kind: '', text: '' },
    summary: null,
    daily: [],
    usageNote: '',
    ledger: [],
    ledgerCursor: '',
    ledgerDone: true,
    ledgerBusy: false,
    ledgerNote: '',
    ledgerNoteKind: '',
    apiBase: '',
    apiBaseBusy: false,
  };
  const modeNote = { kind: '', text: '' };
  const balanceNote = { kind: '', text: '' };
  const apiBaseNote = { kind: '', text: '' };
  const statusState = { key: 'traffic.status.loading', replacements: null, text: '' };

  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      const error = new Error((payload && payload.message) || uiText('traffic.requestFailed', 'Request failed.'));
      if (payload && typeof payload.data === 'object' && payload.data && typeof payload.data.errorCode === 'string') {
        error.errorCode = payload.data.errorCode;
      }
      throw error;
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

  const formatScaled = (value, roundAt) => {
    if (roundAt !== undefined && Math.abs(value) >= roundAt) return String(Math.round(value));
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1);
  };
  const splitAmount = (bytes) => {
    const value = Number(bytes) || 0;
    const abs = Math.abs(value);
    if (abs < 1000) return { amount: String(value), unit: 'bytes' };
    if (abs < 1000000) return { amount: formatScaled(value / 1000), unit: 'kb' };
    return { amount: formatScaled(value / 1000000, 100), unit: 'mb' };
  };
  const formatTraffic = (bytes) => {
    const parts = splitAmount(bytes);
    return parts.amount + ' ' + uiText('traffic.unit.' + parts.unit, parts.unit.toUpperCase());
  };
  const formatBytesExact = (bytes) => (Number(bytes) || 0).toLocaleString() + ' ' + uiText('traffic.unit.bytes', 'B');
  const shortAddress = (value) => {
    const text = String(value || '');
    return text.length > 16 ? text.slice(0, 8) + '…' + text.slice(-6) : text;
  };

  const renderMode = () => {
    if (!elements.modeSeg) return;
    elements.modeSeg.querySelectorAll('[data-traffic-mode]').forEach((button) => {
      button.setAttribute('data-active', button.getAttribute('data-traffic-mode') === state.mode ? 'true' : 'false');
      button.disabled = state.modeBusy;
    });
    if (elements.modeHint) {
      elements.modeHint.textContent = state.mode === 'selfpay'
        ? uiText('traffic.modeSelfpayHint', 'Each Bot pays pin fees from its own wallet.')
        : uiText('traffic.modeTrafficHint', 'Pin fees are billed to the shared traffic account and every Bot writes through it.');
    }
    if (elements.modeStatus) {
      elements.modeStatus.textContent = modeNote.text;
      elements.modeStatus.className = 'status-msg' + (modeNote.kind ? ' ' + modeNote.kind : '');
    }
  };

  const renderBalance = () => {
    if (!elements.balanceValue) return;
    const account = state.account;
    if (account) {
      elements.balanceValue.textContent = formatTraffic(account.balanceBytes);
      elements.balanceValue.setAttribute('title', formatBytesExact(account.balanceBytes));
      if (elements.balanceMeter && elements.balanceMeterFill) {
        const total = (Number(account.balanceBytes) || 0) + (Number(account.spentBytesTotal) || 0);
        const share = total > 0 ? Math.max(0, Math.min(100, Math.round((Number(account.balanceBytes) || 0) * 100 / total))) : 0;
        elements.balanceMeter.hidden = false;
        elements.balanceMeterFill.style.width = share + '%';
      }
      if (elements.balanceStats) {
        elements.balanceStats.textContent = uiText('traffic.balanceStats', 'Reserved {reserved} · Total spent {spent}', {
          reserved: formatTraffic(account.reservedBytes),
          spent: formatTraffic(account.spentBytesTotal),
        });
      }
      if (elements.low) elements.low.hidden = (Number(account.balanceBytes) || 0) >= 5000000;
    } else {
      elements.balanceValue.textContent = '—';
      elements.balanceValue.setAttribute('title', '');
      if (elements.balanceMeter) elements.balanceMeter.hidden = true;
      if (elements.balanceStats) elements.balanceStats.textContent = '';
      if (elements.low) elements.low.hidden = true;
    }
    if (elements.balanceRefresh) elements.balanceRefresh.disabled = state.balanceBusy;
    if (elements.balanceStatus) {
      elements.balanceStatus.textContent = balanceNote.text;
      elements.balanceStatus.className = 'status-msg' + (balanceNote.kind ? ' ' + balanceNote.kind : '');
    }
    const campaign = state.freeGrant;
    const canClaim = state.hasIdentity && !state.featureUnavailable
      && (campaign ? !campaign.claimed && (campaign.claimable === true || campaign.enabled === true)
        : state.account !== null);
    if (elements.grant) {
      elements.grant.hidden = !canClaim;
      if (canClaim) {
        const grantBytes = Number(campaign && campaign.grantBytes) || 10000000;
        if (elements.grantHint) {
          elements.grantHint.textContent = uiText('traffic.grantHint', 'A one-time free grant is available for this account.');
        }
        if (elements.claim) {
          elements.claim.textContent = state.claimBusy
            ? uiText('traffic.grantClaiming', 'Claiming...')
            : uiText('traffic.grantClaim', 'Claim {amount} free', { amount: formatTraffic(grantBytes) });
          elements.claim.disabled = state.claimBusy;
        }
      }
    }
  };

  const botLabel = (address, hint) => {
    const normalized = String(address || '').trim().toLowerCase();
    if (!normalized) return '—';
    if (state.identityAddress && normalized === String(state.identityAddress).toLowerCase()) {
      return uiText('traffic.youIdentity', 'You') + ' · ' + shortAddress(address);
    }
    const name = String(hint || '').trim();
    return name ? name + ' · ' + shortAddress(address) : shortAddress(address);
  };

  const renderUsage = () => {
    if (!elements.usageSummary) return;
    const summary = state.summary;
    if (summary) {
      elements.usageSummary.hidden = false;
      const stats = [
        { label: uiText('traffic.summaryToday', 'Today'), value: formatTraffic(summary.todayBytes) },
        { label: uiText('traffic.summaryWeek', 'This week'), value: formatTraffic(summary.weekBytes) },
        { label: uiText('traffic.summaryMonth', 'This month'), value: formatTraffic(summary.monthBytes) },
      ];
      elements.usageSummary.innerHTML = stats.map((stat) => (
        '<div class="traffic-stat"><div class="traffic-stat-value">' + escapeHtml(stat.value)
        + '</div><div class="traffic-stat-label">' + escapeHtml(stat.label) + '</div></div>'
      )).join('');
    } else {
      elements.usageSummary.hidden = true;
      elements.usageSummary.innerHTML = '';
    }
    if (elements.usageNote) elements.usageNote.textContent = state.usageNote;
    if (!elements.usageTable) return;
    if (!state.daily.length) {
      elements.usageTable.innerHTML = state.usageNote
        ? ''
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('traffic.usageEmpty', 'No usage recorded yet.')) + '</strong></div>';
      return;
    }
    const head = '<thead><tr>'
      + '<th>' + escapeHtml(uiText('traffic.colDate', 'Date')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colBot', 'Bot')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colTraffic', 'Traffic')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colWrites', 'Writes')) + '</th>'
      + '</tr></thead>';
    const rows = state.daily.map((row) => (
      '<tr>'
      + '<td class="mono">' + escapeHtml(String(row.date || '')) + '</td>'
      + '<td>' + escapeHtml(botLabel(row.botAddress, row.botName)) + '</td>'
      + '<td class="mono" title="' + escapeHtml(formatBytesExact(row.bytes)) + '">' + escapeHtml(formatTraffic(row.bytes)) + '</td>'
      + '<td class="mono">' + escapeHtml(String(Number(row.txCount) || 0)) + '</td>'
      + '</tr>'
    )).join('');
    elements.usageTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
  };

  const ledgerKindLabel = (kind) => {
    const normalized = String(kind || '').trim().toLowerCase();
    if (!normalized) return '';
    const translated = uiText('traffic.kind.' + normalized, '');
    if (translated) return translated;
    if (normalized.indexOf('/protocols/') === 0) return normalized.slice('/protocols/'.length);
    return normalized;
  };
  const ledgerDirectionLabel = (direction) => {
    const key = 'traffic.direction.' + direction;
    const translated = uiText(key, '');
    if (translated) return translated;
    return uiText('traffic.direction.unknown', 'Type {direction}', { direction });
  };
  const ledgerSourceLabel = (entry) => {
    const parts = [];
    const kindLabel = ledgerKindLabel(entry.kind);
    if (kindLabel) parts.push(kindLabel);
    if (entry.botAddress) parts.push(botLabel(entry.botAddress, entry.botName));
    if (parts.length) return parts.join(' · ');
    const sourceKey = 'traffic.source.' + String(entry.sourceType || '').trim().toLowerCase();
    const sourceLabel = uiText(sourceKey, String(entry.sourceType || ''));
    return entry.remark ? sourceLabel + ' · ' + entry.remark : sourceLabel;
  };
  const ledgerAmount = (entry) => {
    const direction = Number(entry.direction) || 0;
    const sign = direction === 1 || direction === 4 ? '+' : '-';
    return sign + formatTraffic(entry.amountBytes);
  };

  const renderLedger = () => {
    if (!elements.ledgerTable) return;
    if (!state.ledger.length) {
      elements.ledgerTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('traffic.ledgerEmpty', 'No ledger entries yet.')) + '</strong></div>';
    } else {
      const head = '<thead><tr>'
        + '<th>' + escapeHtml(uiText('traffic.colTime', 'Time')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colDirection', 'Type')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colSource', 'Source')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colAmount', 'Amount')) + '</th>'
        + '</tr></thead>';
      const rows = state.ledger.map((entry) => (
        '<tr>'
        + '<td class="mono">' + escapeHtml(formatDateTime(entry.timestamp) || '—') + '</td>'
        + '<td>' + escapeHtml(ledgerDirectionLabel(entry.direction)) + '</td>'
        + '<td>' + escapeHtml(ledgerSourceLabel(entry)) + '</td>'
        + '<td class="mono">' + escapeHtml(ledgerAmount(entry)) + '</td>'
        + '</tr>'
      )).join('');
      elements.ledgerTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
    }
    if (elements.ledgerMore) elements.ledgerMore.hidden = state.ledgerDone || !state.ledger.length;
    if (elements.ledgerLoadMore) {
      elements.ledgerLoadMore.disabled = state.ledgerBusy;
      elements.ledgerLoadMore.textContent = state.ledgerBusy
        ? uiText('traffic.ledgerLoading', 'Loading...')
        : uiText('traffic.ledgerLoadMore', 'Load more');
    }
    if (elements.ledgerStatus) {
      elements.ledgerStatus.textContent = state.ledgerNote || '';
      elements.ledgerStatus.className = 'status-msg' + (state.ledgerNoteKind ? ' ' + state.ledgerNoteKind : '');
    }
  };

  const renderApiBase = () => {
    if (!elements.apiCurrent) return;
    const configured = String(state.apiBase || '');
    elements.apiCurrent.textContent = uiText('traffic.apiBaseCurrent', 'Current: {value}', {
      value: configured || uiText('traffic.apiBaseDefault', 'production default'),
    });
    if (elements.apiSave) elements.apiSave.disabled = state.apiBaseBusy;
    if (elements.apiReset) {
      elements.apiReset.disabled = state.apiBaseBusy || !configured;
      elements.apiReset.hidden = !configured;
    }
    if (elements.apiInput) elements.apiInput.disabled = state.apiBaseBusy;
    if (elements.apiStatus) {
      elements.apiStatus.textContent = apiBaseNote.text;
      elements.apiStatus.className = 'status-msg' + (apiBaseNote.kind ? ' ' + apiBaseNote.kind : '');
    }
  };

  const render = () => {
    const gated = state.identityChecked && !state.hasIdentity;
    if (elements.gate) elements.gate.hidden = !gated;
    const showContent = state.hasIdentity && !state.featureUnavailable;
    if (elements.content) elements.content.hidden = !showContent;
    if (elements.redeemCard) elements.redeemCard.hidden = !showContent;
    if (elements.usageCard) elements.usageCard.hidden = !showContent;
    if (elements.ledgerCard) elements.ledgerCard.hidden = !showContent;
    if (elements.apiCard) elements.apiCard.hidden = !showContent;
    renderMode();
    renderBalance();
    renderUsage();
    renderLedger();
    renderApiBase();
    if (elements.refresh) elements.refresh.disabled = state.loading;
  };

  const describeError = (error, fallbackKey, fallback) => {
    const errorCode = error && error.errorCode ? String(error.errorCode) : '';
    if (errorCode) {
      const mapped = uiText('traffic.error.' + errorCode, '');
      if (mapped) return mapped;
    }
    const message = error && error.message ? String(error.message) : '';
    return message || uiText(fallbackKey, fallback);
  };

  const applyStatus = (data) => {
    state.mode = data.mode === 'selfpay' ? 'selfpay' : 'traffic';
    state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : state.apiBase;
    state.account = data.account || null;
    state.freeGrant = data.freeGrant || null;
    state.featureUnavailable = data.featureUnavailable === true;
    const identity = data.identity || null;
    state.identityAddress = identity && identity.mvcAddress ? String(identity.mvcAddress) : '';
    state.hasIdentity = !!identity;
  };

  const loadBalance = async (silent) => {
    state.balanceBusy = !silent;
    renderBalance();
    try {
      const data = await postJson('/api/traffic/balance', {});
      if (data.account) state.account = data.account;
      if (data.featureUnavailable) state.featureUnavailable = true;
      balanceNote.kind = '';
      balanceNote.text = '';
    } catch (error) {
      balanceNote.kind = 'error';
      balanceNote.text = describeError(error, 'traffic.balanceFailed', 'Balance failed to load.');
    } finally {
      state.balanceBusy = false;
      renderBalance();
    }
  };

  const loadUsage = async () => {
    try {
      const data = await postJson('/api/traffic/usage', {});
      state.summary = data.summary || null;
      state.daily = Array.isArray(data.daily) ? data.daily : [];
      state.usageNote = data.source === 'service' ? '' : uiText('traffic.usageUnavailable', 'Usage is unavailable from the assist service right now.');
    } catch (error) {
      state.summary = null;
      state.daily = [];
      state.usageNote = describeError(error, 'traffic.usageUnavailable', 'Usage is unavailable from the assist service right now.');
    }
    renderUsage();
  };

  const loadLedger = async (cursor) => {
    state.ledgerBusy = true;
    state.ledgerNote = '';
    state.ledgerNoteKind = '';
    renderLedger();
    try {
      const data = await postJson('/api/traffic/ledger', { ...(cursor ? { cursor } : {}), limit: 20 });
      const entries = Array.isArray(data.entries) ? data.entries : [];
      state.ledger = cursor ? state.ledger.concat(entries) : entries;
      state.ledgerCursor = data.nextCursor ? String(data.nextCursor) : '';
      state.ledgerDone = !state.ledgerCursor || entries.length === 0;
    } catch (error) {
      state.ledgerNote = describeError(error, 'traffic.ledgerFailed', 'Ledger failed to load.');
      state.ledgerNoteKind = 'error';
      if (!cursor) {
        state.ledger = [];
        state.ledgerDone = true;
      }
    } finally {
      state.ledgerBusy = false;
      renderLedger();
    }
  };

  const loadApiBase = async () => {
    try {
      const data = await postJson('/api/traffic/api-base', { action: 'get' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseFailed', 'Endpoint setting failed to load.');
    }
    renderApiBase();
  };

  const load = async () => {
    state.loading = true;
    setStatusKey('traffic.status.loading');
    render();
    try {
      const data = await postJson('/api/traffic/status', {});
      applyStatus(data);
      state.identityChecked = true;
      state.loading = false;
      if (!state.hasIdentity) {
        setStatusKey('traffic.status.noIdentity');
        render();
        return;
      }
      if (state.featureUnavailable) {
        setStatusText(uiText('traffic.featureUnavailable', 'The assist service does not expose traffic APIs for this deployment.'));
        render();
        return;
      }
      setStatusKey('traffic.status.loaded');
      render();
      await Promise.all([
        loadBalance(true),
        loadUsage(),
        loadLedger(''),
        loadApiBase(),
      ]);
      render();
    } catch (error) {
      state.loading = false;
      state.identityChecked = false;
      setStatusText((error && error.message) || uiText('traffic.status.failed', 'Traffic account failed to load.'));
      render();
    }
  };

  const switchMode = async (mode) => {
    if (state.modeBusy || !state.hasIdentity || mode === state.mode) return;
    state.modeBusy = true;
    modeNote.kind = '';
    modeNote.text = '';
    render();
    try {
      const data = await postJson('/api/traffic/mode', { mode });
      state.mode = data.mode === 'selfpay' ? 'selfpay' : 'traffic';
      if (state.mode === 'traffic') {
        const bindSummary = data.bindSummary || null;
        if (bindSummary) {
          const conflictText = Number(bindSummary.conflictCount) > 0
            ? ' ' + uiText('traffic.bindSummaryConflicts', '{count} conflicted', { count: Number(bindSummary.conflictCount) })
            : '';
          modeNote.kind = 'success';
          modeNote.text = uiText('traffic.bindSummary', 'Traffic mode on. Bound {bound} Bots to the account.', { bound: Number(bindSummary.boundCount) || 0 }) + conflictText;
        } else {
          modeNote.kind = 'success';
          modeNote.text = uiText('traffic.modeSaved', 'Billing mode updated.');
        }
        const fresh = await postJson('/api/traffic/status', {}).catch(() => null);
        if (fresh) applyStatus(fresh);
        await loadBalance(true).catch(() => undefined);
      } else {
        modeNote.kind = 'success';
        modeNote.text = uiText('traffic.modeSaved', 'Billing mode updated.');
      }
    } catch (error) {
      modeNote.kind = 'error';
      modeNote.text = describeError(error, 'traffic.modeFailed', 'Billing mode failed to update.');
    } finally {
      state.modeBusy = false;
      render();
    }
  };

  const claimGrant = async () => {
    if (state.claimBusy) return;
    state.claimBusy = true;
    balanceNote.kind = '';
    balanceNote.text = '';
    renderBalance();
    try {
      const data = await postJson('/api/traffic/claim', {});
      balanceNote.kind = 'success';
      balanceNote.text = uiText('traffic.grantClaimed', 'Claimed {amount}. New balance {balance}.', {
        amount: formatTraffic(data.grantBytes),
        balance: formatTraffic(data.balanceAfter),
      });
      state.freeGrant = state.freeGrant ? Object.assign({}, state.freeGrant, { claimed: true, claimable: false }) : state.freeGrant;
      const fresh = await postJson('/api/traffic/status', {}).catch(() => null);
      if (fresh) applyStatus(fresh);
      await loadLedger('').catch(() => undefined);
    } catch (error) {
      balanceNote.kind = 'error';
      balanceNote.text = describeError(error, 'traffic.claimFailed', 'Free grant claim failed.');
    } finally {
      state.claimBusy = false;
      render();
    }
  };

  const submitRedeem = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.redeemBusy) return;
    const code = elements.redeemInput ? String(elements.redeemInput.value || '').trim() : '';
    if (!code) {
      state.redeemNote = { kind: 'error', text: uiText('traffic.redeemCodeRequired', 'Enter a redeem code first.') };
      renderRedeem();
      return;
    }
    state.redeemBusy = true;
    state.redeemNote = { kind: '', text: '' };
    renderRedeem();
    try {
      const data = await postJson('/api/traffic/redeem', { code });
      state.redeemNote = {
        kind: 'success',
        text: uiText('traffic.redeemSuccess', 'Code redeemed: +{traffic}. New balance {balance}.', {
          traffic: formatTraffic(data.trafficBytes),
          balance: formatTraffic(data.balanceAfter),
        }),
      };
      if (elements.redeemInput) elements.redeemInput.value = '';
      await loadBalance(true).catch(() => undefined);
      await loadLedger('').catch(() => undefined);
    } catch (error) {
      state.redeemNote = { kind: 'error', text: describeError(error, 'traffic.redeemFailed', 'Code redeem failed.') };
    } finally {
      state.redeemBusy = false;
      renderRedeem();
      renderBalance();
    }
  };
  const renderRedeem = () => {
    if (elements.redeemInput) {
      elements.redeemInput.disabled = state.redeemBusy;
      elements.redeemInput.setAttribute('placeholder', uiText('traffic.redeemPlaceholder', 'ENTER-CODE'));
    }
    if (elements.redeemSubmit) {
      elements.redeemSubmit.disabled = state.redeemBusy;
      elements.redeemSubmit.textContent = state.redeemBusy
        ? uiText('traffic.redeeming', 'Redeeming...')
        : uiText('traffic.redeemSubmit', 'Redeem');
    }
    if (elements.redeemStatus) {
      elements.redeemStatus.textContent = state.redeemNote.text;
      elements.redeemStatus.className = 'status-msg' + (state.redeemNote.kind ? ' ' + state.redeemNote.kind : '');
    }
  };

  const saveApiBase = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.apiBaseBusy) return;
    const value = elements.apiInput ? String(elements.apiInput.value || '').trim() : '';
    state.apiBaseBusy = true;
    apiBaseNote.kind = '';
    apiBaseNote.text = '';
    renderApiBase();
    try {
      const data = value
        ? await postJson('/api/traffic/api-base', { action: 'set', value })
        : await postJson('/api/traffic/api-base', { action: 'reset' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
      if (elements.apiInput) elements.apiInput.value = '';
      apiBaseNote.kind = 'success';
      apiBaseNote.text = uiText('traffic.apiBaseSaved', 'Endpoint saved.');
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseSaveFailed', 'Endpoint failed to save.');
    } finally {
      state.apiBaseBusy = false;
      renderApiBase();
    }
  };
  const resetApiBase = async () => {
    if (state.apiBaseBusy) return;
    state.apiBaseBusy = true;
    apiBaseNote.kind = '';
    apiBaseNote.text = '';
    renderApiBase();
    try {
      const data = await postJson('/api/traffic/api-base', { action: 'reset' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
      if (elements.apiInput) elements.apiInput.value = '';
      apiBaseNote.kind = 'success';
      apiBaseNote.text = uiText('traffic.apiBaseSaved', 'Endpoint saved.');
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseSaveFailed', 'Endpoint failed to save.');
    } finally {
      state.apiBaseBusy = false;
      renderApiBase();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', () => {
    load().catch(() => undefined);
  });
  if (elements.modeSeg) {
    elements.modeSeg.querySelectorAll('[data-traffic-mode]').forEach((button) => {
      button.addEventListener('click', () => { switchMode(button.getAttribute('data-traffic-mode')); });
    });
  }
  if (elements.balanceRefresh) elements.balanceRefresh.addEventListener('click', () => { loadBalance(false).catch(() => undefined); });
  if (elements.claim) elements.claim.addEventListener('click', () => { claimGrant().catch(() => undefined); });
  if (elements.redeemForm) elements.redeemForm.addEventListener('submit', submitRedeem);
  if (elements.ledgerLoadMore) elements.ledgerLoadMore.addEventListener('click', () => { loadLedger(state.ledgerCursor).catch(() => undefined); });
  if (elements.apiForm) elements.apiForm.addEventListener('submit', saveApiBase);
  if (elements.apiReset) elements.apiReset.addEventListener('click', () => { resetApiBase().catch(() => undefined); });
  window.addEventListener('oac:i18n-changed', () => {
    renderStatusLine();
    render();
    renderRedeem();
  });

  renderRedeem();
  load();
})();`,
    };
}
