"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTrackingPageDefinition = buildTrackingPageDefinition;
const i18n_1 = require("../../i18n");
function buildTrackingPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    const t = i18n.t.bind(i18n);
    return {
        page: 'tracking',
        title: t('tracking.title'),
        titleKey: 'tracking.title',
        eyebrow: t('tracking.heading'),
        heading: t('tracking.heading'),
        description: t('tracking.description'),
        panels: [],
        contentHtml: `
      <section class="tracking-shell" data-tracking-shell>
        <div class="tracking-toolbar">
          <div>
            <h1 data-i18n-key="tracking.heading">${t('tracking.heading')}</h1>
            <p data-tracking-status data-i18n-key="tracking.status.loading">${t('tracking.status.loading')}</p>
          </div>
          <div class="tracking-toolbar-actions">
            <div class="tracking-tabs" role="tablist" aria-label="${t('tracking.heading')}">
              <button class="btn btn-sm" type="button" role="tab" aria-selected="true" data-tracking-tab-metatask data-i18n-key="tracking.tabMetatask">${t('tracking.tabMetatask')}</button>
              <button class="btn btn-sm" type="button" role="tab" aria-selected="false" disabled data-i18n-key="tracking.tabLongTerm">${t('tracking.tabLongTerm')}</button>
            </div>
            <button class="btn btn-primary btn-sm" type="button" data-tracking-refresh data-i18n-key="tracking.refresh">${t('tracking.refresh')}</button>
          </div>
        </div>
        <p class="tracking-notice" data-tracking-activation hidden></p>
        <div class="tracking-board" data-tracking-board></div>
        <div class="tracking-detail" data-tracking-detail hidden></div>
      </section>
    `,
        script: `(() => {
  const els = {
    status: document.querySelector('[data-tracking-status]'),
    refresh: document.querySelector('[data-tracking-refresh]'),
    activation: document.querySelector('[data-tracking-activation]'),
    board: document.querySelector('[data-tracking-board]'),
    detail: document.querySelector('[data-tracking-detail]'),
  };
  // Client fallbacks are byte-identical to the en dictionary values of their
  // keys (enforced by tests/ui/pageI18nCoverage.test.mjs).
  const uiText = (key, fallback, vars) => {
    let value = fallback;
    try {
      const applied = window.__oacI18n && window.__oacI18n(key);
      if (typeof applied === 'string' && applied) value = applied;
    } catch (_) { /* i18n bridge absent — fallback stays */ }
    if (vars) for (const [name, val] of Object.entries(vars)) value = value.split('{' + name + '}').join(String(val));
    return value;
  };
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const shortPin = (pin) => (pin && pin.length > 10 ? pin.slice(0, 5) + '…' + pin.slice(-3) : pin || '—');
  const nameOf = (identities, metaId) => {
    const identity = identities && identities[metaId];
    const name = identity && identity.name;
    return name || (metaId && metaId.length > 14 ? metaId.slice(0, 8) + '…' + metaId.slice(-4) : metaId || '—');
  };
  const lifecycleOf = (task) => task.settlementFinalized ? 'settled' : task.taskComplete ? 'completed' : (task.progress && task.progress.claimed > 0) ? 'inProgress' : 'open';

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!payload || payload.ok === false || payload.state === 'failed') {
      throw new Error((payload && (payload.message || payload.error)) || ('HTTP ' + response.status));
    }
    return payload.data;
  }

  function renderBoard(board) {
    const tasks = board.tasks || [];
    const activation = board.activation || {};
    const refresh = board.refresh || {};
    const pending = activation.hAct3 != null && refresh.boundaryBlock != null && refresh.boundaryBlock < activation.hAct3;
    els.activation.hidden = !pending;
    if (pending) {
      els.activation.textContent = uiText('tracking.activationNotice', 'Competitive mode activates at H_ACT3={hAct3}; current boundary {boundary}.', { hAct3: activation.hAct3, boundary: refresh.boundaryBlock });
    }
    if (tasks.length === 0) {
      els.board.innerHTML = '<div class="card"><p class="table-empty">' + esc(uiText('tracking.empty', 'No on-chain tasks yet')) + '</p></div>';
      return;
    }
    els.board.innerHTML = tasks.map((task) => {
      const progress = task.progress || { total: 0, verified: 0 };
      const satisfied = progress.satisfied != null ? progress.satisfied : progress.verified;
      const pct = progress.total > 0 ? Math.round((satisfied / progress.total) * 100) : 0;
      const lifecycle = lifecycleOf(task);
      const myRole = task.myRoles && task.myRoles.length
        ? '<span class="status-pill">' + esc(uiText(task.myRoles.includes('publisher') ? 'tracking.rolePublisher' : 'tracking.roleParticipant', task.myRoles.includes('publisher') ? 'Publisher' : 'Participant')) + '</span>'
        : '';
      return '' +
        '<article class="card tracking-card" data-tracking-open="' + esc(task.rootPinId) + '">' +
          '<div class="stats-row">' +
            '<span class="status-pill"><span class="status-dot status-' + lifecycle + '"></span>' + esc(uiText('tracking.lifecycle' + lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1), lifecycle)) + '</span>' +
            '<span class="status-pill">' + esc(uiText(task.mode === 'competitive' ? 'tracking.modeCompetitive' : 'tracking.modeTree', task.mode)) + '</span>' +
            myRole +
          '</div>' +
          '<h3 class="tracking-card-title">' + esc(task.title) + '</h3>' +
          '<p class="tracking-card-brief">' + esc(task.brief) + '</p>' +
          '<div class="tracking-progress"><div class="tracking-progress-bar"><div class="tracking-progress-fill" style="width:' + pct + '%"></div></div><span>' + satisfied + '/' + progress.total + '</span></div>' +
          '<div class="tracking-card-foot">' +
            '<span>' + esc(uiText('tracking.publisher', 'Publisher')) + ': ' + esc(nameOf(board.identities, task.publisher)) + '</span>' +
            '<span>' + esc(uiText('tracking.participants', '{count} participants', { count: task.participantCount })) + '</span>' +
            '<span class="muted">' + esc(uiText('tracking.events', '{count} events', { count: task.freshness.eventCount })) + ' ' + esc(uiText('tracking.boundary', '@ block {block}', { block: task.freshness.boundaryBlock })) + '</span>' +
          '</div>' +
        '</article>';
    }).join('');
    els.board.querySelectorAll('[data-tracking-open]').forEach((card) => {
      card.addEventListener('click', () => { void loadDetail(card.getAttribute('data-tracking-open')); });
    });
  }

  async function loadBoard() {
    els.status.textContent = uiText('tracking.status.loading', 'Loading…');
    try {
      const board = await fetchJson('/api/metatask/board');
      renderBoard(board);
      const block = board.refresh && board.refresh.boundaryBlock;
      els.status.textContent = block != null ? uiText('tracking.boundary', '@ block {block}', { block }) : '';
    } catch (error) {
      els.status.textContent = uiText('tracking.loadError', 'Could not load tracking data: {message}', { message: error.message });
    }
  }

  async function loadDetail(root) {
    els.board.hidden = true;
    els.detail.hidden = false;
    els.detail.innerHTML = '<div class="card"><p class="table-empty">' + esc(uiText('tracking.status.loading', 'Loading…')) + '</p></div>';
    try {
      const task = await fetchJson('/api/metatask/task?root=' + encodeURIComponent(root));
      const identities = task.identities || {};
      const nodes = Object.values(task.nodeStates || {});
      const progress = task.progress || { total: 0, verified: 0 };
      const quorum = task.policy ? task.policy.verifyQuorum : '—';
      const rows = nodes.map((node) => {
        const lifecycle = node.status === 'verified' ? 'settled' : node.status === 'claimed' ? 'inProgress' : 'open';
        const actor = node.holder ? nameOf(identities, node.holder.claimant) : node.submission ? nameOf(identities, node.submission.submitter) : '—';
        return '<tr><td><span class="status-pill"><span class="status-dot status-' + lifecycle + '"></span>' + esc(node.id) + '</span></td><td>' + esc(node.title) + '</td><td>' + esc(node.status) + (node.disputed ? ' ⚠' : '') + '</td><td>' + (node.weight != null ? node.weight : '—') + '</td><td>' + esc(actor) + '</td><td>' + node.passVotes + '/' + quorum + '</td></tr>';
      }).join('');
      const ignoredRows = (task.ignoredEvents || []).map((entry) => '<tr><td>' + esc(shortPin(entry.pinId)) + '</td><td>' + esc(entry.reason) + '</td></tr>').join('');
      const settlement = task.settlement;
      const shares = settlement ? settlement.shares.map((share) => '<tr><td>' + esc(nameOf(identities, share.metaId)) + '</td><td>' + share.shareBP + ' bp</td><td>' + share.from.submittedBP + ' + ' + share.from.reviewedBP + '</td></tr>').join('') : '';
      const satisfiedCount = task.taskComplete && settlement && settlement.winningChain ? settlement.winningChain.length : progress.satisfied != null ? progress.satisfied : progress.verified;
      els.detail.innerHTML = '' +
        '<button class="btn btn-sm" type="button" data-tracking-back>' + esc(uiText('tracking.back', '← Back to board')) + '</button>' +
        '<div class="card"><div class="section-header"><h2 class="section-title">' + esc(task.title) + '</h2>' +
        '<span class="status-pill">' + esc(shortPin(task.rootPinId)) + '</span>' +
        '<span class="muted">' + esc(uiText('tracking.publisher', 'Publisher')) + ': ' + esc(nameOf(identities, task.publisher)) + '</span></div>' +
        '<div class="stats-row"><span>' + esc(uiText('tracking.verifiedLabel', 'verified')) + ' ' + progress.verified + '/' + progress.total + '</span><span>' + esc(uiText('tracking.chainVerified', 'Verified chain: {count} steps', { count: satisfiedCount })) + '</span>' + (task.taskComplete ? '<span class="status-pill"><span class="status-dot status-settled"></span>' + esc(uiText('tracking.settledBadge', 'settled')) + '</span>' : '') + '</div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>' + esc(uiText('tracking.nodeCol', 'Node')) + '</th><th>' + esc(uiText('tracking.titleCol', 'Title')) + '</th><th>' + esc(uiText('tracking.statusCol', 'Status')) + '</th><th>' + esc(uiText('tracking.weightCol', 'Weight')) + '</th><th>' + esc(uiText('tracking.actorCol', 'Actor')) + '</th><th>' + esc(uiText('tracking.policyQuorum', 'quorum')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (settlement ? '<div class="section-header"><h3 class="section-title">' + esc(uiText('tracking.settlementTitle', 'Settlement')) + '</h3></div><div class="table-wrap"><table class="data-table"><thead><tr><th>' + esc(uiText('tracking.identityCol', 'Identity')) + '</th><th>bp</th><th>' + esc(uiText('tracking.fromCol', 'sub + rev')) + '</th></tr></thead><tbody>' + shares + '</tbody></table></div>' : '') +
        (ignoredRows ? '<div class="section-header"><h3 class="section-title">' + esc(uiText('tracking.ignored', 'Ignored chain events')) + '</h3></div><div class="table-wrap"><table class="data-table"><thead><tr><th>pin</th><th>reason</th></tr></thead><tbody>' + ignoredRows + '</tbody></table></div>' : '') +
        '</div>';
      const back = els.detail.querySelector('[data-tracking-back]');
      if (back) back.addEventListener('click', () => { els.detail.hidden = true; els.board.hidden = false; });
    } catch (error) {
      els.detail.innerHTML = '<div class="card"><p class="table-empty">' + esc(uiText('tracking.loadError', 'Could not load tracking data: {message}', { message: error.message })) + '</p></div>';
    }
  }

  els.refresh.addEventListener('click', async () => {
    try {
      await fetchJson('/api/metatask/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (els.detail.hidden) await loadBoard();
    } catch (error) {
      els.status.textContent = uiText('tracking.refreshFailed', 'Refresh failed: {message}', { message: error.message });
    }
  });

  const timer = window.setInterval(() => { if (!document.hidden && els.detail.hidden) void loadBoard(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadBoard(); });
  window.addEventListener('beforeunload', () => { window.clearInterval(timer); });

  void loadBoard();
})();
`,
    };
}
