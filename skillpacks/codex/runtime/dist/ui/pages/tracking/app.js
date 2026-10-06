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
        <div class="oac-mt-drawer-root" data-tracking-drawer hidden></div>
        <div class="tracking-draft" data-tracking-draft hidden>
          <div class="card">
            <div class="section-header"><h2 class="section-title" data-tracking-draft-title></h2>
            <button class="btn btn-sm" type="button" data-tracking-draft-close>✕</button></div>
            <p class="field-hint" data-tracking-draft-hint></p>
            <textarea class="tracking-draft-text" readonly rows="8" data-tracking-draft-text></textarea>
            <div><button class="btn btn-primary btn-sm" type="button" data-tracking-draft-copy></button></div>
          </div>
        </div>
      </section>
    `,
        // The MetaTask UI below is a vanilla port of the DSH plugin panel
        // (dsh-plugin/src/client/metatask/*): same blocks, same oac-mt-* classes,
        // same state machine. Embedded as one IIFE string (no template literals
        // inside); i18n copy round-trips through uiText with en fallbacks that
        // tests/ui/pageI18nCoverage.test.mjs pins byte-identical to the dictionary.
        script: `(() => {
  'use strict';
  var els = {
    status: document.querySelector('[data-tracking-status]'),
    refresh: document.querySelector('[data-tracking-refresh]'),
    activation: document.querySelector('[data-tracking-activation]'),
    board: document.querySelector('[data-tracking-board]'),
    detail: document.querySelector('[data-tracking-detail]'),
    drawer: document.querySelector('[data-tracking-drawer]'),
    draft: document.querySelector('[data-tracking-draft]'),
    draftTitle: document.querySelector('[data-tracking-draft-title]'),
    draftHint: document.querySelector('[data-tracking-draft-hint]'),
    draftText: document.querySelector('[data-tracking-draft-text]'),
    draftCopy: document.querySelector('[data-tracking-draft-copy]'),
    draftClose: document.querySelector('[data-tracking-draft-close]'),
  };
  // Client fallbacks are byte-identical to the en dictionary values of their
  // keys (enforced by tests/ui/pageI18nCoverage.test.mjs).
  var uiText = function (key, fallback, vars) {
    var value = fallback;
    try {
      var applied = window.__oacI18n && window.__oacI18n(key);
      if (typeof applied === 'string' && applied) value = applied;
    } catch (_) { /* i18n bridge absent — fallback stays */ }
    if (vars) for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        value = value.split('{' + name + '}').join(String(vars[name]));
      }
    }
    return value;
  };
  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var shortPin = function (pin) { return pin && pin.length > 10 ? pin.slice(0, 5) + '…' + pin.slice(-3) : (pin || '—'); };
  var shortId = function (metaId) { return metaId && metaId.length > 14 ? metaId.slice(0, 8) + '…' + metaId.slice(-4) : (metaId || '—'); };
  var shortHash = function (hash) { return hash && hash.length > 16 ? hash.slice(0, 12) + '…' : hash; };
  var relTime = function (ms) {
    if (!ms) return '—';
    var delta = Date.now() - ms;
    var minutes = Math.round(delta / 60000);
    if (minutes < 1) return uiText('tracking.justNow', 'just now');
    if (minutes < 60) return uiText('tracking.minutesAgo', '{count}m ago', { count: minutes });
    var hours = Math.round(minutes / 60);
    if (hours < 24) return uiText('tracking.hoursAgo', '{count}h ago', { count: hours });
    return uiText('tracking.daysAgo', '{count}d ago', { count: Math.round(hours / 24) });
  };
  var lifecycleOf = function (task) {
    return task.settlementFinalized ? 'settled' : task.taskComplete ? 'completed' : (task.progress && task.progress.claimed > 0) ? 'inProgress' : 'open';
  };
  var percentOf = function (part, total) { return total > 0 ? Math.round((part / total) * 100) : 0; };
  var copyMini = function (value) {
    return '<button type="button" class="oac-mt-btn oac-mt-btn-xs" data-mt-copy="' + esc(value) + '">' + esc(uiText('tracking.copy', 'Copy')) + '</button>';
  };

  // ── identity badge (DSH MtBadge port: avatar via the daemon proxy, colored
  // initial disc fallback, local chip) ──────────────────────────────────────
  var AVATAR_COLORS = ['#f59e0b', '#0ea5e9', '#8b5cf6', '#10b981', '#ef4444', '#6366f1', '#ec4899', '#14b8a6'];
  var colorOfId = function (metaId) {
    var hash = 0;
    for (var i = 0; i < metaId.length; i++) hash = (hash * 31 + metaId.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  };
  var avatarUrl = function (raw) {
    if (!raw) return '';
    if (/^(data:|blob:)/i.test(raw)) return raw;
    var trimmed = String(raw).trim();
    if (trimmed.toLowerCase().indexOf('metafile://') === 0) {
      return '/api/file/avatar?ref=' + encodeURIComponent(trimmed);
    }
    if (/^[0-9a-f]{64}(i[0-9]+)?$/i.test(trimmed)) return '/api/file/avatar?ref=' + encodeURIComponent(trimmed);
    if (/^https?:\\/\\//i.test(trimmed) || trimmed.charAt(0) === '/') return trimmed;
    return '';
  };
  var badgeHtml = function (metaId, identities, opts) {
    opts = opts || {};
    var identity = (identities && identities[metaId]) || null;
    var name = identity && identity.name && identity.name.trim();
    var display = name || shortId(metaId);
    var initial = (name || metaId || '?').charAt(0).toUpperCase();
    var url = avatarUrl(identity && identity.avatar);
    var sizeClass = opts.md ? ' oac-mt-badge-id-md' : '';
    var avatar = url
      ? '<img class="oac-mt-badge-avatar" src="' + esc(url) + '" alt="" data-mt-avatar-fallback="' + esc(metaId + '|' + initial) + '">'
      : '<span class="oac-mt-badge-avatar oac-mt-badge-initial" style="background:' + colorOfId(metaId || '?') + '">' + esc(initial) + '</span>';
    var you = opts.you ? '<span class="oac-mt-you">' + esc(uiText('tracking.you', 'local')) + '</span>' : '';
    return '<span class="oac-mt-badge-id' + sizeClass + '" title="' + esc(metaId) + '">' + avatar + '<span class="oac-mt-badge-name">' + esc(display) + '</span>' + you + '</span>';
  };

  // ── candidate display state (embedded copy of dsh-plugin metatask-logic;
  // the pure twin lives in tests via the same algorithms) ───────────────────
  var candidateState = function (node, cand, byPin, winningSet) {
    if (cand.failed) return 'rejected';
    if (cand.superseded) return 'replaced';
    if (winningSet && winningSet.has(cand.pinId)) return 'winner';
    var refs = cand.parentrefs || {};
    var refPins = [];
    for (var k in refs) if (Object.prototype.hasOwnProperty.call(refs, k)) refPins.push(refs[k]);
    for (var i = 0; i < refPins.length; i++) {
      var parent = byPin.get(refPins[i]);
      if (parent && (parent.failed || parent.superseded)) return 'stalled';
    }
    if (cand.verified && cand.chainValid) {
      return node.submission && node.submission.pinId === cand.pinId ? 'leading' : 'behind';
    }
    if (cand.verified) return 'awaitingDeps';
    var allChainValid = true;
    for (var j = 0; j < refPins.length; j++) {
      if (!(byPin.get(refPins[j]) && byPin.get(refPins[j]).chainValid === true)) { allChainValid = false; break; }
    }
    return allChainValid ? 'inReview' : 'optimistic';
  };
  var candidatesByPin = function (nodes) {
    var map = new Map();
    for (var i = 0; i < nodes.length; i++) {
      var subs = nodes[i].submissions || [];
      for (var j = 0; j < subs.length; j++) map.set(subs[j].pinId, subs[j]);
    }
    return map;
  };
  var stateRank = { winner: 0, leading: 1, inReview: 2, optimistic: 3, awaitingDeps: 4, behind: 5, stalled: 6, replaced: 7, rejected: 8 };
  var candStateRank = function (state) { return stateRank[state] != null ? stateRank[state] : 9; };
  var raceFrontTip = function (nodes, byPin) {
    var live = [];
    for (var i = 0; i < nodes.length; i++) {
      var subs = nodes[i].submissions || [];
      for (var j = 0; j < subs.length; j++) {
        var c = subs[j];
        if (!c.failed && !c.superseded && !c.verified) live.push(c);
      }
    }
    if (!live.length) return null;
    var liveSet = new Set(live.map(function (c) { return c.pinId; }));
    var coverage = function (cand, seen) {
      var count = 0;
      var refs = cand.parentrefs || {};
      for (var dep in refs) {
        if (!Object.prototype.hasOwnProperty.call(refs, dep)) continue;
        var pin = refs[dep];
        if (seen.has(pin) || !liveSet.has(pin)) continue;
        seen.add(pin);
        var parent = byPin.get(pin);
        if (!parent) continue;
        count += 1 + coverage(parent, seen);
      }
      return count;
    };
    var best = null;
    var bestKey = { cov: -1, votes: -1, at: Infinity };
    for (var m = 0; m < live.length; m++) {
      var key = { cov: coverage(live[m], new Set()), votes: live[m].passVotes || 0, at: live[m].atMs || Infinity };
      if (key.cov > bestKey.cov || (key.cov === bestKey.cov && key.votes > bestKey.votes) || (key.cov === bestKey.cov && key.votes === bestKey.votes && key.at < bestKey.at)) {
        best = live[m];
        bestKey = key;
      }
    }
    return best;
  };
  var raceFrontPath = function (tip, byPin) {
    var path = new Set();
    var stack = [tip.pinId];
    while (stack.length) {
      var pin = stack.pop();
      if (path.has(pin)) continue;
      var cand = byPin.get(pin);
      if (!cand || cand.failed || cand.superseded) continue;
      path.add(pin);
      var refs = cand.parentrefs || {};
      for (var dep in refs) if (Object.prototype.hasOwnProperty.call(refs, dep)) stack.push(refs[dep]);
    }
    return path;
  };

  // ── artifacts ────────────────────────────────────────────────────────────
  var METAWEB_BASE = 'https://openagentinternet.org/browser';
  var pinViewUrl = function (pinId) { return METAWEB_BASE + '/pin/' + pinId; };
  var metafileViewUrl = function (uri) {
    if (!uri || uri.toLowerCase().indexOf('metafile://') !== 0) return '';
    var base = uri.slice('metafile://'.length).trim().split(/[?#]/)[0] || '';
    var pinId = base.split('.')[0] || '';
    return pinId ? METAWEB_BASE + '/metafile/' + pinId : '';
  };
  var normalizeMetafile = function (value) {
    var trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase().indexOf('metafile://') === 0) return trimmed;
    if (/^[0-9a-zA-Z]+(\\.[0-9a-zA-Z]+)*$/.test(trimmed)) return 'metafile://' + trimmed;
    return '';
  };
  var artifactOf = function (cand) {
    var result = cand.result || null;
    var resultType = result && typeof result.type === 'string' ? result.type : null;
    var metafileUri = '';
    if (resultType === 'metafile' && typeof result.artifactPin === 'string') metafileUri = normalizeMetafile(result.artifactPin);
    if (!metafileUri && result && typeof result.uri === 'string') metafileUri = normalizeMetafile(result.uri);
    if (!metafileUri && typeof cand.attachment === 'string') metafileUri = normalizeMetafile(cand.attachment);
    if (!metafileUri && resultType === 'git-bundle' && typeof cand.attachment === 'string' && cand.attachment.indexOf('metafile://') === 0) metafileUri = cand.attachment;
    var metaAppUri = '';
    if (result) {
      for (var key in result) {
        var v = result[key];
        if (typeof v === 'string' && v.trim().toLowerCase().indexOf('metaapp://') === 0) { metaAppUri = v.trim(); break; }
      }
    }
    var kind = resultType === 'git-bundle' ? 'git' : (resultType === 'metafile' || metafileUri) ? 'metafile' : metaAppUri ? 'metaapp' : 'other';
    return {
      kind: kind,
      resultType: resultType,
      metafileUri: metafileUri,
      metafileViewUrl: metafileUri ? metafileViewUrl(metafileUri) : '',
      metaAppUri: metaAppUri,
    };
  };
  var TYPE_BADGE = { git: '⌥', metafile: '▤', metaapp: '▦', other: '·' };

  // ── tree helpers ─────────────────────────────────────────────────────────
  var treeChildrenOf = function (nodes) {
    var byId = new Map();
    for (var i = 0; i < nodes.length; i++) byId.set(nodes[i].id, nodes[i]);
    var childrenOf = new Map();
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (node.parent && byId.has(node.parent)) {
        var list = childrenOf.get(node.parent) || [];
        list.push(node);
        childrenOf.set(node.parent, list);
      }
    }
    childrenOf.forEach(function (list) {
      list.sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); });
    });
    return childrenOf;
  };
  var treeSubtreeStats = function (childrenOf, id) {
    var verified = 0, total = 0;
    var walk = function (nid) {
      var children = childrenOf.get(nid) || [];
      for (var i = 0; i < children.length; i++) {
        total += 1;
        if (children[i].status === 'verified') verified += 1;
        walk(children[i].id);
      }
    };
    walk(id);
    return { verified: verified, total: total };
  };
  var treeSubtreeHasAttention = function (childrenOf, id) {
    var children = childrenOf.get(id) || [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.status === 'claimed' || child.disputed || treeSubtreeHasAttention(childrenOf, child.id)) return true;
    }
    return false;
  };

  // ── shared state ─────────────────────────────────────────────────────────
  var state = {
    view: 'board',
    root: null,
    board: null,
    task: null,
    drawerPin: null,
    expandedNode: null,
    expandedGroups: {},
    groupsInitFor: null,
    briefOpen: false,
    mineOnly: false,
  };
  var rosterSet = function () {
    var ids = state.board && state.board.localRosterMetaIds ? state.board.localRosterMetaIds : [];
    return new Set(ids);
  };
  var identitiesOf = function () {
    if (state.task && state.task.identities) return state.task.identities;
    if (state.board && state.board.identities) return state.board.identities;
    return {};
  };
  var identityOf = function (metaId) {
    var identity = identitiesOf()[metaId];
    return identity || null;
  };
  var nameOf = function (metaId) {
    var identity = identityOf(metaId);
    return (identity && identity.name && identity.name.trim()) || shortId(metaId);
  };

  async function fetchJson(url, options) {
    var response = await fetch(url, options);
    var payload = await response.json();
    if (!payload || payload.ok === false || payload.state === 'failed') {
      throw new Error((payload && (payload.message || payload.error)) || ('HTTP ' + response.status));
    }
    return payload.data;
  }

  // ── board ────────────────────────────────────────────────────────────────
  function renderBoard(board) {
    state.board = board;
    var activation = board.activation || {};
    var refresh = board.refresh || {};
    var pending = activation.hAct3 != null && refresh.boundaryBlock != null && refresh.boundaryBlock < activation.hAct3;
    els.activation.hidden = !pending;
    if (pending) {
      els.activation.textContent = uiText('tracking.activationNotice', 'Competitive mode activates at H_ACT3={hAct3}; current boundary {boundary}.', { hAct3: activation.hAct3, boundary: refresh.boundaryBlock });
    }
    var allTasks = board.tasks || [];
    var tasks = allTasks.filter(function (task) { return !state.mineOnly || (task.myRoles && task.myRoles.length > 0); });
    var alerts = board.alerts || [];
    var html = '<div class="oac-mt-board">';
    html += '<div class="oac-mt-board-bar"><div class="tracking-tabs" role="tablist">';
    html += '<button type="button" class="btn btn-sm' + (state.mineOnly ? '' : ' btn-primary') + '" data-mt-view="square">' + esc(uiText('tracking.viewSquare', 'Square')) + '</button>';
    html += '<button type="button" class="btn btn-sm' + (state.mineOnly ? ' btn-primary' : '') + '" data-mt-view="mine">' + esc(uiText('tracking.viewMine', 'My participation')) + '</button>';
    html += '</div><div class="oac-mt-board-meta">';
    if (refresh.boundaryBlock != null) html += '<span class="oac-mt-chip">' + esc(uiText('tracking.boundary', '@ block {block}', { block: refresh.boundaryBlock })) + '</span>';
    html += '</div></div>';
    if (refresh.lastError) {
      html += '<div class="oac-mt-notice oac-mt-notice-warn">' + esc(uiText('tracking.refreshFailed', 'Refresh failed: {message}', { message: refresh.lastError })) + '</div>';
    }
    if (alerts.length > 0) {
      html += '<div class="oac-mt-alerts">';
      for (var a = 0; a < Math.min(alerts.length, 4); a++) {
        var alert = alerts[a];
        var kindKey = 'tracking.alert' + alert.kind.replace(/_/g, ' ').replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }).replace(/ /g, '');
        html += '<div class="oac-mt-alert"><span class="oac-mt-alert-kind">' + esc(uiText(kindKey, alert.kind)) + '</span>' +
          '<span class="oac-mt-dim">' + esc(alert.node ? shortPin(alert.rootPinId) + ' · ' + alert.node : shortPin(alert.rootPinId)) + '</span>' +
          '<button type="button" class="oac-mt-btn oac-mt-btn-sm" data-tracking-open="' + esc(alert.rootPinId) + '">' + esc(uiText('tracking.alertOpen', 'Open')) + '</button>' +
          '<button type="button" class="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" data-tracking-participate="' + esc(alert.rootPinId) + '">' + esc(uiText('tracking.participate', 'Have my bot join')) + '</button></div>';
      }
      html += '</div>';
    }
    if (!tasks.length) {
      html += '<div class="card"><p class="table-empty">' + esc(uiText(state.mineOnly ? 'tracking.emptyMine' : 'tracking.empty', state.mineOnly ? 'No local Bot participates in any on-chain task yet' : 'No on-chain tasks yet')) + '</p></div>';
    } else {
      html += '<div class="oac-mt-cards">';
      for (var i = 0; i < tasks.length; i++) html += boardCardHtml(tasks[i]);
      html += '</div>';
    }
    html += '</div>';
    els.board.innerHTML = html;
    wireBoard();
  }

  function boardCardHtml(task) {
    var progress = task.progress || { total: 0, verified: 0 };
    var satisfied = progress.satisfied != null ? progress.satisfied : progress.verified;
    var lifecycle = lifecycleOf(task);
    var lifecycleLabel = uiText('tracking.lifecycle' + lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1), lifecycle);
    var html = '<article class="oac-mt-card" data-tracking-open="' + esc(task.rootPinId) + '">';
    html += '<div class="oac-mt-card-head">';
    html += '<span class="oac-mt-badge oac-mt-badge-' + lifecycle + '">' + esc(lifecycleLabel) + '</span>';
    html += '<span class="oac-mt-chip">' + esc(uiText(task.mode === 'competitive' ? 'tracking.modeCompetitive' : 'tracking.modeTree', task.mode === 'competitive' ? 'Competitive' : 'Tree')) + '</span>';
    if (task.myRoles && task.myRoles.length > 0) {
      html += '<span class="oac-mt-chip oac-mt-chip-role">' + esc(uiText(task.myRoles.includes('publisher') ? 'tracking.rolePublisher' : 'tracking.roleParticipant', task.myRoles.includes('publisher') ? 'Publisher' : 'Participant')) + '</span>';
    }
    html += '</div>';
    html += '<div class="oac-mt-card-title">' + esc(task.title) + '</div>';
    html += '<div class="oac-mt-card-brief">' + esc(task.brief) + '</div>';
    html += '<div class="oac-mt-progress"><div class="oac-mt-progress-bar"><div class="oac-mt-progress-fill" style="width:' + percentOf(satisfied, progress.total) + '%"></div></div><span>' + satisfied + '/' + progress.total + (progress.disputed > 0 ? ' · ' + esc(uiText('tracking.disputedCount', '{count} disputed', { count: progress.disputed })) : '') + '</span></div>';
    html += '<div class="oac-mt-card-foot">';
    html += '<span class="oac-mt-card-pub">' + badgeHtml(task.publisher, state.board.identities, { you: (state.board.localRosterMetaIds || []).indexOf(task.publisher) >= 0 }) + '</span>';
    html += '<span>' + esc(uiText('tracking.participants', '{count} participants', { count: task.participantCount })) + '</span>';
    if (task.myStats) {
      html += '<span class="oac-mt-card-share">';
      html += '<span class="oac-mt-chip oac-mt-chip-role">' + esc(task.settlementFinalized
        ? uiText('tracking.shareSettled', 'share {pct}%', { pct: (task.myStats.shareBP / 100).toFixed(2) })
        : uiText('tracking.shareEst', 'est. {pct}%', { pct: (task.myStats.estShareBP / 100).toFixed(2) })) + '</span>';
      html += ' · ' + esc(uiText('tracking.myStats', 'verified {verified} · reviews {reviews}', { verified: task.myStats.verified, reviews: task.myStats.reviewVotes }));
      html += '</span>';
    }
    html += '<span class="oac-mt-card-stamp oac-mt-dim">' + esc(relTime(task.lastActivityMs)) + ' · ' + esc(uiText('tracking.events', '{count} events', { count: task.freshness.eventCount })) + ' @' + task.freshness.boundaryBlock + '</span>';
    if (!task.settlementFinalized) {
      html += '<button type="button" class="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" data-tracking-participate="' + esc(task.rootPinId) + '">' + esc(uiText('tracking.participate', 'Have my bot join')) + '</button>';
    }
    html += '</div></article>';
    return html;
  }

  function wireBoard() {
    els.board.querySelectorAll('[data-tracking-open]').forEach(function (card) {
      card.addEventListener('click', function () { void loadDetail(card.getAttribute('data-tracking-open')); });
    });
    els.board.querySelectorAll('[data-tracking-participate]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
        void loadDraft(button.getAttribute('data-tracking-participate'));
      });
    });
    els.board.querySelectorAll('[data-mt-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.mineOnly = button.getAttribute('data-mt-view') === 'mine';
        if (state.board) renderBoard(state.board);
      });
    });
  }

  async function loadBoard() {
    els.status.textContent = uiText('tracking.status.loading', 'Loading…');
    try {
      var board = await fetchJson('/api/metatask/board');
      els.board.hidden = false;
      els.detail.hidden = true;
      state.view = 'board';
      renderBoard(board);
      var block = board.refresh && board.refresh.boundaryBlock;
      els.status.textContent = block != null ? uiText('tracking.boundary', '@ block {block}', { block }) : '';
    } catch (error) {
      els.status.textContent = uiText('tracking.loadError', 'Could not load tracking data: {message}', { message: error.message });
    }
  }

  // ── detail ───────────────────────────────────────────────────────────────
  function headerHtml(task) {
    var lifecycle = lifecycleOf({ settlementFinalized: Boolean(task.settlement), taskComplete: task.taskComplete, progress: task.progress });
    var html = '<div class="oac-mt-detail-head">';
    html += '<button type="button" class="oac-mt-back" data-mt-back>' + esc(uiText('tracking.back', '← Back to board')) + '</button>';
    html += '<div class="oac-mt-titleline"><span class="oac-mt-title">' + esc(task.title) + '</span>';
    html += '<span class="oac-mt-badge oac-mt-badge-' + lifecycle + '">' + esc(uiText('tracking.lifecycle' + lifecycle.charAt(0).toUpperCase() + lifecycle.slice(1), lifecycle)) + '</span>';
    html += '<span class="oac-mt-chip">' + esc(uiText(task.policy.mode === 'competitive' ? 'tracking.modeCompetitive' : 'tracking.modeTree', task.policy.mode === 'competitive' ? 'Competitive' : 'Tree')) + '</span>';
    if (!task.taskComplete) {
      html += '<button type="button" class="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary oac-mt-head-join" data-mt-draft-root>' + esc(uiText('tracking.participate', 'Have my bot join')) + '</button>';
    }
    html += '</div>';
    html += '<div class="oac-mt-meta">';
    html += '<span class="oac-mt-card-pub">' + badgeHtml(task.publisher, task.identities, { you: rosterSet().has(task.publisher) }) + '</span>';
    html += '<span class="oac-mt-sep">·</span><span>' + esc(uiText('tracking.progressVerified', '{verified}/{total} verified', { verified: task.progress.verified, total: task.progress.total })) + '</span>';
    if (task.lastActivityMs > 0) {
      html += '<span class="oac-mt-sep">·</span><span>' + esc(uiText('tracking.lastActive', 'last active {when}', { when: relTime(task.lastActivityMs) })) + '</span>';
    }
    html += '<span class="oac-mt-sep">·</span><span class="oac-mt-mono">' + esc(uiText('tracking.eventCount', '{count} on-chain events', { count: task.freshness.eventCount })) + ' @' + task.freshness.boundaryBlock + '</span>';
    html += '</div>';
    if (task.brief) {
      html += '<p class="oac-mt-brief' + (state.briefOpen ? '' : ' oac-mt-brief-clamp') + '" data-mt-brief>' + esc(task.brief) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function explainerStatusHtml(task) {
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    var race = null, raceTipId = null;
    if (task.policy.mode === 'competitive' && !task.taskComplete) {
      var tip = raceFrontTip(nodes, byPin);
      if (tip) { race = raceFrontPath(tip, byPin); raceTipId = tip.pinId; }
    }
    var chainNodeIds = nodes.filter(function (node) {
      var lead = node.submission && node.submission.pinId;
      if (!lead) return false;
      if (winningSet) return winningSet.has(lead);
      return (node.submissions || []).some(function (cand) { return cand.pinId === lead && cand.verified && cand.chainValid; });
    }).map(function (node) { return node.id; });
    var frontText = null;
    if (raceTipId) {
      var tipCand = byPin.get(raceTipId);
      var tipNode = null;
      for (var i = 0; i < nodes.length; i++) {
        if ((nodes[i].submissions || []).some(function (c) { return c.pinId === raceTipId; })) { tipNode = nodes[i]; break; }
      }
      if (tipCand && tipNode && tipCand.submitter) frontText = tipNode.id + ' · ' + nameOf(tipCand.submitter);
    }
    var quorum = Math.max(1, task.policy.verifyQuorum);
    var html = '<div class="oac-mt-explainer"><b>' + esc(uiText('tracking.rulesTitle', 'How this race works')) + '</b>';
    html += '<span class="oac-mt-explainer-sep">·</span><span>' + esc(uiText('tracking.rulesRace', 'Bots race through each step; independent review verifies submissions')) + '</span>';
    html += '<span class="oac-mt-explainer-sep">·</span>' + esc(uiText('tracking.rulesGoldA', 'The ')) + '<span class="oac-mt-gold-word">' + esc(uiText('tracking.rulesGoldWord', 'gold thread')) + '</span>' + esc(uiText('tracking.rulesGoldB', ' is the verified chain — the first fully verified path to the finish splits the reward'));
    html += '<span class="oac-mt-explainer-sep">·</span>' + esc(uiText('tracking.rulesRaceA', 'The ')) + '<span class="oac-mt-sky-word">' + esc(uiText('tracking.rulesRaceWord', 'blue line')) + '</span>' + esc(uiText('tracking.rulesRaceB', ' is the race front — the deepest in-review chain by reference (not yet verified)'));
    html += '</div>';
    html += '<div class="oac-mt-statusline">';
    html += '<span class="oac-mt-status-item"><i class="oac-mt-dot-gold"></i><b>' + esc(uiText('tracking.statusVerified', 'Verified chain:')) + '</b><code>' + esc(chainNodeIds.length ? chainNodeIds.join(' → ') : '—') + '</code><span class="oac-mt-dim">(' + chainNodeIds.length + '/' + nodes.length + ')</span></span>';
    html += '<span class="oac-mt-status-item"><i class="oac-mt-dot-sky"></i><b>' + esc(uiText('tracking.statusFront', 'Race front:')) + '</b><code class="' + (frontText ? '' : 'oac-mt-dim') + '">' + esc(frontText || (task.taskComplete ? uiText('tracking.statusSettled', 'settled (task complete)') : uiText('tracking.statusFrontNone', 'none in flight'))) + '</code></span>';
    html += '</div>';
    return html;
  }

  function deliverablesHtml(task) {
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var terminalId = task.policy.finalNode && task.nodeStates[task.policy.finalNode] ? task.policy.finalNode : findUniqueSink(task);
    if (!terminalId) return '';
    var terminal = task.nodeStates[terminalId];
    var hero = terminal && terminal.submission ? byPin.get(terminal.submission.pinId) : null;
    var settled = Boolean(task.settlement);
    var html = '<div class="oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(settled ? uiText('tracking.dlvTitle', 'Deliverables') : uiText('tracking.dlvTitleProgress', 'Deliverables (in progress)')) + '</div>';
    var rendered = false;
    if (hero) {
      rendered = true;
      var artifact = artifactOf(hero);
      var result = hero.result || {};
      var summary = typeof result.summary === 'string' ? result.summary : null;
      var members = Array.isArray(result.members) ? result.members.filter(function (m) { return typeof m === 'string'; }) : [];
      var sha = typeof result.releaseSha256 === 'string' ? result.releaseSha256 : null;
      html += '<div class="oac-mt-dlv-hero"><span class="oac-mt-dlv-type">' + esc(TYPE_BADGE[artifact.kind] || '·') + '</span><div class="oac-mt-dlv-main">';
      html += '<div class="oac-mt-dlv-kicker">' + esc(terminalId) + ' · ' + esc(terminal.title) + (artifact.resultType ? '<span class="oac-mt-chip">' + esc(artifact.resultType) + '</span>' : '') + '</div>';
      html += '<div class="oac-mt-dlv-name">' + esc(summary || uiText('tracking.dlvDefaultName', '{type} artifact', { type: artifact.resultType || '—' })) + '</div>';
      html += '<div>' + badgeHtml(hero.submitter || '', task.identities, {}) + '</div>';
      if (members.length) {
        html += '<div class="oac-mt-dlv-members">';
        for (var i = 0; i < members.length; i++) html += '<span class="oac-mt-memberchip">' + esc(members[i]) + '</span>';
        html += '</div>';
      }
      if (sha) html += '<div class="oac-mt-fact">sha256 <code>' + esc(sha.slice(0, 24)) + '…</code></div>';
      if (artifact.metafileUri) {
        html += '<div class="oac-mt-actions"><code class="oac-mt-uri">' + esc(artifact.metafileUri) + '</code>' + copyMini(artifact.metafileUri);
        html += '<a class="oac-mt-btn oac-mt-btn-sm" href="/api/metatask/file?uri=' + encodeURIComponent(artifact.metafileUri) + '" download>' + esc(uiText('tracking.download', 'Download')) + '</a>';
        if (artifact.metafileViewUrl) html += '<a class="oac-mt-btn oac-mt-btn-sm" href="' + esc(artifact.metafileViewUrl) + '" target="_blank" rel="noreferrer">' + esc(uiText('tracking.openInMetaweb', 'View in MetaWeb')) + '</a>';
        if (artifact.metaAppUri) html += '<a class="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" href="' + esc(artifact.metaAppUri) + '">' + esc(uiText('tracking.openApp', 'Open app')) + '</a>';
        html += '</div>';
      }
      html += '</div></div>';
    }
    var chainRows = (task.settlement && task.settlement.winningChain ? task.settlement.winningChain : [])
      .map(function (pinId) { return { pinId: pinId, cand: byPin.get(pinId) }; })
      .filter(function (row) { return Boolean(row.cand); });
    if (chainRows.length) {
      rendered = true;
      html += '<div class="oac-mt-dlv-rows"><div class="oac-mt-h4">' + esc(uiText('tracking.dlvPerNodeTitle', 'Per-node deliverables')) + '</div>';
      for (var r = 0; r < chainRows.length; r++) {
        var row = chainRows[r];
        var rowArtifact = artifactOf(row.cand);
        var commit = row.cand.result && typeof row.cand.result.commit === 'string' ? row.cand.result.commit : null;
        var baseCommit = row.cand.result && typeof row.cand.result.baseCommit === 'string' ? row.cand.result.baseCommit : null;
        var repoHint = row.cand.result && typeof row.cand.result.repoHint === 'string' ? row.cand.result.repoHint : null;
        var node = null;
        for (var n = 0; n < nodes.length; n++) {
          if ((nodes[n].submissions || []).some(function (c) { return c.pinId === row.pinId; })) { node = nodes[n]; break; }
        }
        html += '<div class="oac-mt-dlv-row"><span class="oac-mt-dlv-rowtype oac-mt-dlv-rowtype-' + rowArtifact.kind + '">' + esc(TYPE_BADGE[rowArtifact.kind] || '·') + '</span>';
        html += '<div class="oac-mt-dlv-rowmain"><b>' + esc(node ? node.id : '—') + ' · ' + esc(node ? node.title : '') + '</b>';
        if (rowArtifact.kind === 'git' && commit) {
          html += '<span class="oac-mt-dlv-git"><code>' + esc(commit.slice(0, 10)) + '</code>' + (baseCommit ? ' @ <code>' + esc(baseCommit.slice(0, 10)) + '</code>' : '') + (repoHint ? ' <a href="' + esc(repoHint) + '" target="_blank" rel="noreferrer">' + esc(uiText('tracking.repo', 'repo')) + '</a>' : '') + '</span>';
        } else if (rowArtifact.metafileUri) {
          html += '<code class="oac-mt-uri">' + esc(rowArtifact.metafileUri) + '</code>';
        } else {
          html += '<span>' + esc(uiText('tracking.dlvNoArtifact', 'no attached artifact')) + '</span>';
        }
        html += '</div>';
        html += badgeHtml(row.cand.submitter || '', task.identities, {});
        html += '<button type="button" class="oac-mt-btn oac-mt-btn-sm" data-mt-cand="' + esc(row.pinId) + '">' + esc(uiText('tracking.detailsBtn', 'Details')) + '</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    if (!settled) {
      var leaders = nodes.filter(function (node) { return node.status === 'verified' && node.submission; })
        .map(function (node) { return { node: node, cand: byPin.get(node.submission.pinId) }; })
        .filter(function (row) { return Boolean(row.cand); });
      if (leaders.length) {
        rendered = true;
        html += '<div class="oac-mt-dlv-progress"><div class="oac-mt-h4">' + esc(uiText('tracking.dlvCurrentOutput', 'Current output (in progress)')) + '</div>';
        for (var l = 0; l < leaders.length; l++) {
          html += '<div class="oac-mt-dlv-row"><b>' + esc(leaders[l].node.id) + '</b>' + badgeHtml(leaders[l].cand.submitter || '', task.identities, {});
          html += '<button type="button" class="oac-mt-btn oac-mt-btn-sm" data-mt-cand="' + esc(leaders[l].node.submission.pinId) + '">' + esc(uiText('tracking.detailsBtn', 'Details')) + '</button></div>';
        }
        html += '</div>';
      }
    }
    html += '<div class="oac-mt-dim oac-mt-mono oac-mt-pinlink">root <code>' + esc(shortPin(task.rootPinId)) + '</code></div>';
    html += '</div>';
    return rendered ? html : '';
  }

  function findUniqueSink(task) {
    var nodes = Object.values(task.nodeStates || {});
    var referenced = new Set();
    nodes.forEach(function (node) { (node.deps || []).forEach(function (dep) { referenced.add(dep); }); });
    var sinks = nodes.filter(function (node) { return !referenced.has(node.id); });
    return sinks.length === 1 ? sinks[0].id : null;
  }

  function howtoHtml(task) {
    if (task.taskComplete) return '';
    var openNodes = Object.values(task.nodeStates || {}).filter(function (node) { return node.status === 'open'; });
    if (!openNodes.length) return '';
    var competitive = task.policy.mode === 'competitive';
    var html = '<section class="oac-mt-howto"><div class="oac-mt-h3">' + esc(uiText('tracking.howToJoin', 'How to join')) + '</div>';
    html += '<p class="oac-mt-dim">' + esc(competitive
      ? uiText('tracking.howToJoinHintCompetitive', '{count} open node(s). This is a competitive task — no claiming needed; any Bot may submit directly and forks compete for review votes. Pick one to have your local bot evaluate it:', { count: openNodes.length })
      : uiText('tracking.howToJoinHintTree', '{count} open node(s) ready to be claimed. Pick one — your local bot will evaluate, claim, and submit the work:', { count: openNodes.length })) + '</p>';
    html += '<div class="oac-mt-openchips">';
    for (var i = 0; i < Math.min(openNodes.length, 8); i++) {
      html += '<button type="button" class="oac-mt-openchip" data-mt-draft-node="' + esc(openNodes[i].id) + '"><code>' + esc(openNodes[i].id) + '</code> ' + esc(openNodes[i].title) + '</button>';
    }
    if (openNodes.length > 8) html += '<span class="oac-mt-dim">' + esc(uiText('tracking.moreOpenNodes', '…and {count} more open nodes', { count: openNodes.length - 8 })) + '</span>';
    html += '</div></section>';
    return html;
  }

  function mineRows(task) {
    var rows = [];
    var roster = rosterSet();
    if (!roster.size) return rows;
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.holder && roster.has(node.holder.claimant)) {
        var remainingMs = task.policy.claimTtlHours * 3600000 - (Date.now() - node.holder.sinceMs);
        rows.push({ key: node.id + '-claim', nodeId: node.id, title: node.title, kind: 'claim', status: uiText('tracking.mineClaimed', 'claimed · ~{hours}h left', { hours: Math.max(0, Math.ceil(remainingMs / 3600000)) }) });
      }
      var subs = node.submissions || [];
      for (var s = 0; s < subs.length; s++) {
        var cand = subs[s];
        if (!roster.has(cand.submitter)) continue;
        var state = winningSet && winningSet.has(cand.pinId) ? 'winner' : (cand.verified && cand.chainValid) ? 'verified' : cand.failed ? 'rejected' : cand.superseded ? 'replaced' : 'live';
        if (state === 'verified' || state === 'winner') {
          rows.push({ key: cand.pinId, nodeId: node.id, title: node.title, kind: 'sub-verified', status: uiText('tracking.mineVerified', 'verified') });
        } else if (state !== 'rejected') {
          rows.push({ key: cand.pinId, nodeId: node.id, title: node.title, kind: 'sub-' + state, status: uiText('tracking.mineSubmitted', 'submitted · review {votes}/{quorum}', { votes: cand.passVotes, quorum: Math.max(1, task.policy.verifyQuorum) }) });
        }
      }
      var effective = node.submission;
      var localVote = effective ? (node.votes || []).filter(function (vote) { return roster.has(vote.voter); })[0] : null;
      if (localVote) {
        var verdict = localVote.verdict === 'pass' ? uiText('tracking.mineVotedPass', 'voted pass') : uiText('tracking.mineVotedFail', 'voted fail');
        rows.push({ key: localVote.pinId, nodeId: node.id, title: node.title, kind: 'vote-' + localVote.verdict, status: localVote.counted ? verdict : verdict + uiText('tracking.mineVoteNotCounted', ' (not counted: {reason})', { reason: localVote.ignoreReason || '—' }) });
      }
    }
    var order = { claim: 0, 'sub-live': 1, 'sub-replaced': 1, 'sub-winner': 1, 'sub-verified': 1, 'vote-pass': 2, 'vote-fail': 2 };
    rows.sort(function (a, b) { return (order[a.kind] != null ? order[a.kind] : 3) - (order[b.kind] != null ? order[b.kind] : 3); });
    return rows;
  }

  function mineHtml(task) {
    var rows = mineRows(task);
    if (!rows.length) {
      return rosterSet().size
        ? '<section class="oac-mt-mine oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(uiText('tracking.mineTitle', 'My bots on this task')) + '</div><div class="oac-mt-dim">' + esc(uiText('tracking.mineEmpty', 'Local bots have not joined this task yet')) + '</div></section>'
        : '';
    }
    var html = '<section class="oac-mt-mine"><div class="oac-mt-h3">' + esc(uiText('tracking.mineTitle', 'My bots on this task')) + '</div><div class="oac-mt-minecard">';
    for (var i = 0; i < Math.min(rows.length, 12); i++) {
      html += '<button type="button" class="oac-mt-minerow" title="' + esc(rows[i].title) + '" data-mt-mine="' + esc(rows[i].nodeId) + '">';
      html += '<i class="oac-mt-minedot oac-mt-minedot-' + rows[i].kind + '"></i>';
      html += '<span class="oac-mt-minenode">' + esc(rows[i].nodeId) + '</span>';
      html += '<span class="oac-mt-minetext">' + esc(rows[i].title) + '</span>';
      html += '<span class="oac-mt-minestatus">' + esc(rows[i].status) + '</span>';
      html += '</button>';
    }
    html += '</div>';
    if (rows.length > 12) html += '<span class="oac-mt-dim">+' + (rows.length - 12) + '</span>';
    html += '</section>';
    return html;
  }

  // ── chain view (competitive) ─────────────────────────────────────────────
  function chainHtml(task) {
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    var race = null, raceTipId = null;
    if (!task.taskComplete) {
      var tip = raceFrontTip(nodes, byPin);
      if (tip) { race = raceFrontPath(tip, byPin); raceTipId = tip.pinId; }
    }
    // deps-depth topological order (the engine guarantees acyclicity)
    var depths = new Map();
    var visit = function (id, stack) {
      if (depths.has(id)) return depths.get(id);
      if (stack.has(id)) return 0;
      stack.add(id);
      var depth = 0;
      var deps = (task.nodeStates[id] && task.nodeStates[id].deps) || [];
      for (var i = 0; i < deps.length; i++) {
        if (task.nodeStates[deps[i]]) depth = Math.max(depth, visit(deps[i], stack) + 1);
      }
      stack.delete(id);
      depths.set(id, depth);
      return depth;
    };
    nodes.forEach(function (node) { visit(node.id, new Set()); });
    var columns = nodes.slice().sort(function (a, b) {
      var da = depths.get(a.id) || 0, db = depths.get(b.id) || 0;
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    var terminalId = task.policy.finalNode && task.nodeStates[task.policy.finalNode] ? task.policy.finalNode : findUniqueSink(task);
    var quorum = Math.max(1, task.policy.verifyQuorum);
    var html = '<div class="oac-mt-chainview"><h3 class="oac-mt-h3">' + esc(uiText('tracking.chainTitle', 'Race chain')) + '<small>' + esc(uiText('tracking.chainHint', 'click a card for that submission’s full story')) + '</small></h3>';
    html += '<div class="oac-mt-chainview-scroll"><div class="oac-mt-columns" data-mt-chain-canvas><svg class="oac-mt-edges" data-mt-edges aria-hidden="true"></svg>';
    for (var c = 0; c < columns.length; c++) {
      var node = columns[c];
      var word = stepWord(node, winningSet, task);
      var isTerminal = node.id === terminalId;
      var hasVerified = (node.submissions || []).some(function (cand) { return cand.verified && cand.chainValid; });
      var ruleClass = word.gold ? (isTerminal ? 'oac-mt-rule-gold' : 'oac-mt-rule-goldgrad') : hasVerified ? 'oac-mt-rule-done' : isTerminal ? 'oac-mt-rule-finish' : '';
      html += '<div class="oac-mt-col">';
      html += '<div class="oac-mt-stephead"><div class="oac-mt-stephead-row"><span class="oac-mt-stepchip' + (isTerminal ? ' oac-mt-stepchip-finish' : '') + '">' + (isTerminal ? esc(uiText('tracking.stepFinish', 'FINISH · {id}', { id: node.id })) : esc(node.id)) + '</span>';
      html += '<span class="oac-mt-steptitle" title="' + esc(node.title) + '">' + esc(node.title) + '</span></div>';
      html += '<div class="oac-mt-stepmeta"><span class="' + (word.gold ? 'oac-mt-stepword-gold' : 'oac-mt-stepword') + '">' + esc(word.text) + '</span>';
      if (node.weight !== null) html += '<span class="oac-mt-stepweight">' + Math.round(node.weight / 100) + '% · ' + node.weight + 'BP</span>';
      html += '</div><div class="oac-mt-rule ' + ruleClass + '"></div></div>';
      var subs = node.submissions || [];
      if (!subs.length) {
        html += '<div class="oac-mt-cand oac-cand-emptybox">' + esc(uiText('tracking.chainEmptyStep', 'No submissions yet — any Bot may try this step')) + '</div>';
      }
      for (var s = 0; s < subs.length; s++) {
        var cand = subs[s];
        var candState = candidateState(node, cand, byPin, winningSet);
        var onRaceLine = race && race.has(cand.pinId) && candState === 'inReview';
        var isTip = raceTipId === cand.pinId && candState !== 'leading' && candState !== 'winner';
        var tagClass = {
          winner: 'oac-tag-solid-gold', leading: 'oac-tag-solid-gold', behind: 'oac-tag-line-emerald',
          inReview: 'oac-tag-line-sky', awaitingDeps: 'oac-tag-line-violet', optimistic: 'oac-tag-line-violet',
          replaced: 'oac-tag-line-slate', rejected: 'oac-tag-line-red', stalled: 'oac-tag-line-slate',
        }[candState] || 'oac-tag-line-slate';
        var cardClass = {
          winner: 'oac-cand-winner', leading: 'oac-cand-leading', behind: 'oac-cand-behind',
          inReview: 'oac-cand-inReview', awaitingDeps: 'oac-cand-awaitingDeps', optimistic: 'oac-cand-optimistic',
          replaced: 'oac-cand-replaced', rejected: 'oac-cand-rejected', stalled: 'oac-cand-stalled',
        }[candState] || '';
        html += '<button type="button" data-cand-pin="' + esc(cand.pinId) + '" data-mt-cand="' + esc(cand.pinId) + '" title="' + esc(cand.pinId) + '" class="oac-mt-cand ' + cardClass + (onRaceLine ? ' oac-cand-onrace' : '') + '">';
        html += '<span class="oac-mt-statetag ' + (isTip ? 'oac-tag-solid-sky' : tagClass) + '">' + esc(isTip ? uiText('tracking.raceTipTag', 'Race front') : uiText('tracking.cand' + candState.charAt(0).toUpperCase() + candState.slice(1), candState)) + '</span>';
        html += badgeHtml(cand.submitter, task.identities, { you: rosterSet().has(cand.submitter) });
        html += '<span class="oac-mt-cand-meta"><code>' + esc(shortPin(cand.pinId)) + '</code><span>' + esc(relTime(cand.atMs)) + '</span>' + pipsHtml(cand, quorum) + '</span>';
        html += '</button>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    html += '<div class="oac-mt-legend">';
    if (winningSet) html += '<span><i class="oac-lg oac-lg-winner"></i>' + esc(uiText('tracking.legendWinner', 'Winner (settled)')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-gold"></i>' + esc(uiText('tracking.legendLeading', 'Verified chain')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-emerald"></i>' + esc(uiText('tracking.legendBehind', 'Verified · runner-up')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-sky-dash"></i>' + esc(uiText('tracking.legendInReview', 'In review')) + '</span>';
    if (race) html += '<span><i class="oac-lg oac-lg-sky"></i>' + esc(uiText('tracking.legendRace', 'Race front (deepest in-review chain)')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-violet"></i>' + esc(uiText('tracking.legendOptimistic', 'Optimistic (parent unverified)')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-replaced"></i>' + esc(uiText('tracking.legendReplaced', 'Replaced')) + '</span>';
    html += '<span><i class="oac-lg oac-lg-rejected"></i>' + esc(uiText('tracking.legendRejected', 'Rejected')) + '</span>';
    html += '<span><i class="oac-pip oac-pip-pass"></i><i class="oac-pip"></i>' + esc(uiText('tracking.legendVotes', 'review votes (quorum {quorum})', { quorum })) + '</span>';
    html += '</div></div>';
    return html;
  }

  function stepWord(node, winningSet, task) {
    var subs = node.submissions || [];
    var winnerCand = winningSet ? subs.filter(function (c) { return winningSet.has(c.pinId); })[0] : null;
    if (winnerCand) return { text: uiText('tracking.stepWinner', 'Winner · {name}', { name: nameOf(winnerCand.submitter) }), gold: true };
    var lead = node.submission && subs.some(function (c) { return c.pinId === node.submission.pinId && c.verified && c.chainValid; });
    if (lead) return { text: uiText('tracking.stepLeading', 'Verified · {name}', { name: nameOf(node.submission.submitter) }), gold: true };
    if (subs.some(function (c) { return c.verified && c.chainValid; })) return { text: uiText('tracking.stepVerified', 'Verified'), gold: false };
    var byPin = candidatesByPin(Object.values(task.nodeStates || {}));
    var optimistic = subs.filter(function (c) {
      var s = candidateState(node, c, byPin, winningSet);
      return s === 'optimistic' || s === 'awaitingDeps';
    });
    if (subs.length && optimistic.length === subs.length) return { text: uiText('tracking.stepOptimistic', '{count} optimistic', { count: subs.length }), gold: false };
    if (subs.length) return { text: uiText('tracking.stepCompeting', '{count} competing', { count: subs.length }), gold: false };
    return { text: uiText('tracking.stepOpen', 'Open'), gold: false };
  }

  function pipsHtml(cand, quorum) {
    var html = '<span class="oac-mt-pips" title="' + esc(cand.passVotes + '/' + quorum + ' · ' + cand.failVotes) + '">';
    for (var i = 0; i < Math.max(quorum, 1); i++) html += '<i class="oac-pip' + (i < cand.passVotes ? ' oac-pip-pass' : '') + '"></i>';
    for (var f = 0; f < cand.failVotes; f++) html += '<i class="oac-pip oac-pip-fail"></i>';
    return html + '</span>';
  }

  // SVG overlay lives INSIDE the w-max canvas: size it to the content box and
  // compute every coordinate against the canvas rect (scroll-invariant).
  var chainDrawScheduled = false;
  function drawChainEdges() {
    chainDrawScheduled = false;
    var task = state.task;
    if (!task || task.policy.mode !== 'competitive') return;
    var canvas = els.detail.querySelector('[data-mt-chain-canvas]');
    if (!canvas) return;
    var svg = canvas.querySelector('[data-mt-edges]');
    if (svg && svg.style) {
      svg.style.width = String(canvas.scrollWidth || 0) + 'px';
      svg.style.height = String(canvas.scrollHeight || 0) + 'px';
    }
    if (!svg) return;
    var base = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (!base) return;
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    var race = null;
    if (!task.taskComplete) {
      var tip = raceFrontTip(nodes, byPin);
      if (tip) race = raceFrontPath(tip, byPin);
    }
    var paths = [];
    for (var i = 0; i < nodes.length; i++) {
      var subs = nodes[i].submissions || [];
      for (var s = 0; s < subs.length; s++) {
        var refs = subs[s].parentrefs || {};
        for (var dep in refs) {
          if (!Object.prototype.hasOwnProperty.call(refs, dep)) continue;
          var parentPin = refs[dep];
          var fromEl = canvas.querySelector('[data-cand-pin="' + cssEscape(parentPin) + '"]');
          var toEl = canvas.querySelector('[data-cand-pin="' + cssEscape(subs[s].pinId) + '"]');
          if (!fromEl || !toEl || !fromEl.getBoundingClientRect || !toEl.getBoundingClientRect) continue;
          var from = fromEl.getBoundingClientRect();
          var to = toEl.getBoundingClientRect();
          var x1 = from.right - base.left;
          var y1 = from.top + from.height / 2 - base.top;
          var x2 = to.left - base.left;
          var y2 = to.top + to.height / 2 - base.top;
          var mid = (x1 + x2) / 2;
          var parentState = byPin.get(parentPin) ? candidateState(nodes[i], byPin.get(parentPin), byPin, winningSet) : null;
          var candState = candidateState(nodes[i], subs[s], byPin, winningSet);
          var gold = winningSet ? (winningSet.has(parentPin) && winningSet.has(subs[s].pinId)) : (parentState === 'leading' && candState === 'leading');
          var onRace = !gold && race && race.has(parentPin) && race.has(subs[s].pinId);
          var opt = !gold && !onRace && (candState === 'optimistic' || candState === 'awaitingDeps');
          paths.push({ d: 'M ' + x1 + ' ' + y1 + ' C ' + mid + ' ' + y1 + ', ' + mid + ' ' + y2 + ', ' + x2 + ' ' + y2, tone: gold ? 'oac-edge-gold' : onRace ? 'oac-edge-race' : opt ? 'oac-edge-optimistic' : 'oac-edge-gray' });
        }
      }
    }
    var markup = '';
    for (var p = 0; p < paths.length; p++) markup += '<path d="' + paths[p].d + '" class="oac-edge ' + paths[p].tone + '"></path>';
    svg.innerHTML = markup;
  }
  function scheduleChainDraw() {
    if (chainDrawScheduled) return;
    chainDrawScheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(drawChainEdges);
    else drawChainEdges();
  }
  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (ch) { return '\\\\' + ch; });
  }
  var chainListenersBound = false;
  function bindChainListeners() {
    if (chainListenersBound) return;
    chainListenersBound = true;
    if (window.addEventListener) window.addEventListener('resize', scheduleChainDraw);
    if (document.addEventListener) document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.drawerPin) closeDrawer();
    });
  }

  // ── node requirement sections (competitive) ─────────────────────────────
  function nodeSectionsHtml(task) {
    var nodes = Object.values(task.nodeStates || {}).sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); });
    var byPin = candidatesByPin(nodes);
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    var quorum = Math.max(1, task.policy.verifyQuorum);
    var roster = rosterSet();
    var html = '<section class="oac-mt-nodesections"><div class="oac-mt-h3">' + esc(uiText('tracking.nodeSectionsTitle', 'Node requirements & candidates')) + '<small>' + esc(uiText('tracking.nodeSectionsHint', 'what each node asks · who tried · outcome')) + '</small></div>';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var subs = (node.submissions || []).slice().sort(function (a, b) {
        return candStateRank(candidateState(node, a, byPin, winningSet)) - candStateRank(candidateState(node, b, byPin, winningSet));
      });
      var collapsed = !state.expandedGroups[node.id];
      var rubric = Array.isArray(node.params && node.params.rubric) ? node.params.rubric.filter(function (r) { return typeof r === 'string' && r.trim(); }) : [];
      var workspace = node.params && typeof node.params.workspace === 'string' && node.params.workspace.trim() ? node.params.workspace.trim() : '';
      var winnerCand = winningSet ? subs.filter(function (c) { return winningSet.has(c.pinId); })[0] : null;
      var leaderCand = !winnerCand && node.submission ? subs.filter(function (c) { return c.pinId === node.submission.pinId && c.verified && c.chainValid; })[0] : null;
      html += '<div class="oac-mt-nodesection">';
      html += '<button type="button" class="oac-mt-nodesection-head" data-mt-nodesec="' + esc(node.id) + '">';
      html += '<span class="oac-mt-chevron' + (collapsed ? ' oac-mt-chevron-closed' : '') + '"></span>';
      html += '<span class="oac-mt-stepchip">' + esc(node.id) + '</span>';
      html += '<span class="oac-mt-nodesection-title" title="' + esc(node.title) + '">' + esc(node.title) + '</span>';
      html += '<span class="oac-mt-mono oac-mt-dim">' + esc(node.kind) + '</span>';
      if (node.weight !== null) html += '<span class="oac-mt-stepweight">' + Math.round(node.weight / 100) + '% · ' + node.weight + 'BP</span>';
      if (winnerCand) html += '<span class="oac-mt-headtag oac-mt-headtag-winner">' + esc(uiText('tracking.nodeWinner', 'Winner · {name}', { name: nameOf(winnerCand.submitter) })) + '</span>';
      else if (leaderCand) html += '<span class="oac-mt-headtag oac-mt-headtag-leading">' + esc(uiText('tracking.nodeVerified', 'Verified · {name}', { name: nameOf(node.submission.submitter) })) + '</span>';
      else if (subs.length) html += '<span class="oac-mt-headtag oac-mt-headtag-competing">' + esc(uiText('tracking.nodeCandidates', '{count} competing submissions', { count: subs.length })) + '</span>';
      else html += '<span class="oac-mt-headtag oac-mt-headtag-open">' + esc(uiText('tracking.nodeOpen', 'Open')) + '</span>';
      if (node.disputed) html += '<span class="oac-mt-headtag oac-mt-headtag-disputed">' + esc(uiText('tracking.disputed', 'Disputed')) + '</span>';
      html += '</button>';
      if (!collapsed) {
        html += '<div class="oac-mt-nodesection-body"><div class="oac-mt-rubric">';
        html += '<div class="oac-mt-h4">' + esc(uiText('tracking.nodeRubricTitle', 'Acceptance criteria (rubric)')) + '</div>';
        if (rubric.length) {
          for (var r = 0; r < rubric.length; r++) html += '<div class="oac-mt-rubric-item"><span class="oac-mt-rubric-n">' + (r + 1) + '</span>' + esc(rubric[r]) + '</div>';
        } else if (node.params && Object.keys(node.params).length) {
          html += '<details class="oac-mt-params"><summary>' + esc(uiText('tracking.nodeParamsJson', 'params (JSON)')) + '</summary><pre>' + esc(JSON.stringify(node.params, null, 2)) + '</pre></details>';
        } else {
          html += '<div class="oac-mt-rubric-item oac-mt-empty-inline">' + esc(uiText('tracking.rubricNone', 'No rubric on this node (inherits the task spec)')) + '</div>';
        }
        if (node.specid || workspace) {
          html += '<div class="oac-mt-fact oac-mt-mono oac-mt-dim">';
          if (node.specid) html += '<span>' + esc(uiText('tracking.nodeSpec', 'spec {spec}', { spec: shortPin(node.specid) })) + '</span>';
          html += '</div>';
        }
        html += '</div><div class="oac-mt-node-cands"><div class="oac-mt-h4">' + esc(uiText('tracking.nodeCandsTitle', 'Candidate submissions ({count})', { count: subs.length })) + '</div>';
        if (!subs.length) {
          html += '<div class="oac-mt-empty-inline">' + esc(uiText('tracking.nodeNoCandidates', 'No submissions yet')) + '</div>';
        }
        for (var c = 0; c < subs.length; c++) {
          var cand = subs[c];
          var candState = candidateState(node, cand, byPin, winningSet);
          var gold = candState === 'winner' || candState === 'leading';
          html += '<button type="button" class="oac-mt-node-cand' + (gold ? ' oac-mt-node-cand-gold' : '') + '" data-mt-cand="' + esc(cand.pinId) + '" title="' + esc(cand.pinId) + '">';
          html += '<span class="oac-mt-node-cand-id">' + badgeHtml(cand.submitter, task.identities, { you: roster.has(cand.submitter) }) + '<code class="oac-mt-mono oac-mt-dim">' + esc(shortPin(cand.pinId)) + '</code></span>';
          html += pipsHtml(cand, quorum);
          html += '<span class="oac-mt-headtag oac-tag-cand-' + candState + '">' + esc(uiText('tracking.cand' + candState.charAt(0).toUpperCase() + candState.slice(1), candState)) + '</span>';
          html += '<span class="oac-mt-dim">' + esc(relTime(cand.atMs)) + '</span>';
          html += '</button>';
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  // ── candidate drawer ─────────────────────────────────────────────────────
  function openDrawer(pinId) {
    state.drawerPin = pinId;
    renderDrawer();
  }
  function closeDrawer() {
    state.drawerPin = null;
    if (els.drawer) els.drawer.hidden = true;
  }
  function drawerCandidate(task, pinId) {
    var nodes = Object.values(task.nodeStates || {});
    var byPin = candidatesByPin(nodes);
    var cand = byPin.get(pinId);
    if (!cand) return null;
    var node = null;
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].submissions || []).some(function (c) { return c.pinId === pinId; })) { node = nodes[i]; break; }
    }
    return { cand: cand, node: node, byPin: byPin };
  }
  function renderDrawer() {
    var task = state.task;
    if (!els.drawer) return;
    if (!task || !state.drawerPin) { els.drawer.hidden = true; return; }
    var found = drawerCandidate(task, state.drawerPin);
    if (!found || !found.node) { els.drawer.hidden = true; return; }
    var cand = found.cand, node = found.node, byPin = found.byPin;
    var winningSet = task.settlement && task.settlement.winningChain ? new Set(task.settlement.winningChain) : null;
    var candState = candidateState(node, cand, byPin, winningSet);
    var artifact = artifactOf(cand);
    var result = cand.result || {};
    var summary = typeof result.summary === 'string' ? result.summary : typeof result.note === 'string' ? result.note : typeof result.verdict_text === 'string' ? result.verdict_text : null;
    var commit = typeof result.commit === 'string' ? result.commit : null;
    var baseCommit = typeof result.baseCommit === 'string' ? result.baseCommit : null;
    var repoHint = typeof result.repoHint === 'string' ? result.repoHint : null;
    var engine = typeof result.engine === 'string' ? result.engine : null;
    var members = Array.isArray(result.members) ? result.members.filter(function (m) { return typeof m === 'string'; }) : [];
    var sha = (typeof result.releaseSha256 === 'string' ? result.releaseSha256 : null) || cand.hash;
    var quorum = Math.max(1, task.policy.verifyQuorum);
    var votes = (cand.votes || []).filter(function (v) { return !v.targetid || v.targetid === cand.pinId; }).slice().sort(function (a, b) { return a.timestampMs - b.timestampMs; });
    var viewUrl = artifact.metafileViewUrl || metafileViewUrl(cand.attachment || '') || pinViewUrl(cand.pinId);
    var html = '<div class="oac-mt-drawer-veil" data-mt-drawer-close></div>';
    html += '<div class="oac-mt-drawer-panel" role="dialog" aria-modal="true">';
    html += '<button type="button" class="oac-mt-btn oac-mt-btn-xs oac-mt-drawer-close" data-mt-drawer-close>' + esc(uiText('tracking.close', 'Close')) + ' ✕</button>';
    html += '<div class="oac-mt-drawer-head">' + badgeHtml(cand.submitter, task.identities, { md: true }) + '</div>';
    html += '<div class="oac-mt-drawer-sub">' + esc(uiText('tracking.subLine', 'Submitted at {node} · {title} · {when}', { node: node.id, title: node.title, when: relTime(cand.atMs) }));
    if (cand.verified && cand.verifiedHeight !== null && cand.verifiedHeight >= 0) html += '<span class="oac-mt-dim"> · ' + esc(uiText('tracking.verifiedBlock', 'verified @ block {height}', { height: cand.verifiedHeight })) + '</span>';
    html += '</div>';
    html += '<div class="oac-mt-drawer-tags"><span class="oac-mt-statetag oac-mt-statetag-lg oac-tag-cand-' + candState + '">' + esc(uiText('tracking.cand' + candState.charAt(0).toUpperCase() + candState.slice(1), candState)) + '</span>';
    if (rosterSet().has(cand.submitter)) html += '<span class="oac-mt-you">' + esc(uiText('tracking.you', 'local')) + '</span>';
    html += '</div>';
    // What was delivered
    html += '<div><div class="oac-mt-h4">' + esc(uiText('tracking.deliveredTitle', 'What was delivered')) + '</div>';
    html += '<div class="oac-mt-summary">' + esc(summary || uiText('tracking.desc' + (artifact.kind === 'git' ? 'Git' : artifact.kind === 'metafile' ? 'Metafile' : artifact.kind === 'metaapp' ? 'Metaapp' : 'Other'), artifact.kind)) + '</div>';
    html += '<div class="oac-mt-drawer-facts">';
    html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.factType', 'Type')) + '</span><span class="oac-mt-factrow-v">' + esc(artifact.resultType || artifact.kind) + '</span></div>';
    if (artifact.kind === 'git' && commit) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.gitCommit', 'commit')) + '</span><span class="oac-mt-factrow-v"><code title="' + esc(commit) + '">' + esc(shortHash(commit)) + '</code></span></div>';
    if (artifact.kind === 'git' && baseCommit) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">base</span><span class="oac-mt-factrow-v"><code title="' + esc(baseCommit) + '">' + esc(shortHash(baseCommit)) + '</code></span></div>';
    if (artifact.kind === 'git' && repoHint) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">repo</span><span class="oac-mt-factrow-v"><code>' + esc(repoHint) + '</code></span></div>';
    if (artifact.kind === 'git' && engine) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">engine</span><span class="oac-mt-factrow-v"><code>' + esc(engine) + '</code></span></div>';
    if (members.length) {
      html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.factMembers', 'Members')) + '</span><span class="oac-mt-factrow-v">';
      for (var m = 0; m < members.length; m++) html += '<span class="oac-mt-memberchip-mini">' + esc(members[m]) + '</span>';
      html += '</span></div>';
    }
    if (artifact.metafileUri) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.factArtifact', 'Artifact')) + '</span><span class="oac-mt-factrow-v"><code>' + esc(artifact.metafileUri) + '</code> ' + copyMini(artifact.metafileUri) + '</span></div>';
    if (cand.attachment && cand.attachment !== artifact.metafileUri) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.factAttachment', 'Attachment')) + '</span><span class="oac-mt-factrow-v"><code>' + esc(cand.attachment) + '</code> ' + copyMini(cand.attachment) + '</span></div>';
    if (sha) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">sha256</span><span class="oac-mt-factrow-v"><code title="' + esc(sha) + '">' + esc(shortHash(sha)) + '</code> ' + copyMini(sha) + '</span></div>';
    html += '</div>';
    html += '<div class="oac-mt-drawer-actions">';
    if (artifact.metaAppUri) html += '<a class="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" href="' + esc(artifact.metaAppUri) + '">' + esc(uiText('tracking.openApp', 'Open app')) + '</a>';
    html += '<a class="oac-mt-btn oac-mt-btn-sm" href="' + esc(viewUrl) + '" target="_blank" rel="noreferrer">' + esc(uiText('tracking.openInMetaweb', 'View in MetaWeb')) + '</a>';
    html += '</div></div>';
    // Parent refs
    var parentrefs = cand.parentrefs || {};
    var depIds = [];
    for (var dep in parentrefs) if (Object.prototype.hasOwnProperty.call(parentrefs, dep)) depIds.push(dep);
    html += '<div><div class="oac-mt-h4">' + esc(uiText('tracking.parentrefsTitle', 'What it builds on')) + '</div>';
    if (depIds.length) {
      html += '<div class="oac-mt-parentrefs">';
      for (var d = 0; d < depIds.length; d++) {
        var parentPin = parentrefs[depIds[d]];
        var parent = byPin.get(parentPin);
        html += '<button type="button" class="oac-chip-btn" data-mt-cand="' + esc(parentPin) + '" title="' + esc(parentPin) + '"><code>' + esc(depIds[d]) + '</code> · ' + esc(parent ? nameOf(parent.submitter || '') : shortPin(parentPin)) + ' <code>' + esc(shortPin(parentPin)) + '</code> →</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="oac-mt-empty-inline">' + esc(uiText('tracking.parentrefsNone', 'None — entry node, no upstream candidate.')) + '</div>';
    }
    html += '</div>';
    // Review timeline
    html += '<div><div class="oac-mt-h4">' + esc(uiText('tracking.reviewsTitle', 'Review timeline ({count} votes · quorum {quorum})', { count: votes.length, quorum })) + '</div>';
    if (!votes.length) {
      html += '<div class="oac-mt-empty-inline">' + esc(uiText('tracking.noVotes', 'no votes yet')) + '</div>';
    } else {
      html += '<div class="oac-mt-timeline">';
      for (var v = 0; v < votes.length; v++) {
        var vote = votes[v];
        html += '<div class="oac-mt-timeline-item"><div class="oac-mt-timeline-head">';
        html += badgeHtml(vote.voter, task.identities, {});
        html += '<span class="oac-mt-badge oac-mt-badge-verdict-' + esc(vote.verdict) + '">' + esc(vote.verdict === 'pass' ? uiText('tracking.verdictPass', 'Pass') : vote.verdict === 'fail' ? uiText('tracking.verdictFail', 'Fail') : vote.verdict) + '</span>';
        html += '<span class="oac-mt-dim">' + esc(vote.timestampMs ? relTime(vote.timestampMs) : '');
        if (typeof vote.height === 'number') html += ' · ' + esc(vote.height >= 0 ? uiText('tracking.blockHeight', 'block {height}', { height: vote.height }) : uiText('tracking.mempool', 'mempool'));
        html += '</span>';
        if (!vote.counted) html += '<span class="oac-mt-chip">' + esc(uiText('tracking.notCounted', 'not counted: {reason}', { reason: vote.ignoreReason || '—' })) + '</span>';
        html += '</div>';
        if (vote.failreasonText) html += '<div class="oac-mt-evidence oac-mt-evidence-fail"><span class="oac-mt-evidence-label">' + esc(uiText('tracking.failreasonLabel', 'Fail reason')) + '</span>' + esc(vote.failreasonText) + '</div>';
        if (vote.semanticCheckText) html += '<div class="oac-mt-evidence oac-mt-evidence-sem"><span class="oac-mt-evidence-label">' + esc(uiText('tracking.semanticLabel', 'Review evidence')) + '</span>' + esc(vote.semanticCheckText) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    // Receipts
    html += '<div><div class="oac-mt-h4">' + esc(uiText('tracking.receipts', 'On-chain receipts')) + '</div>';
    html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.factPin', 'Submission pin')) + '</span><span class="oac-mt-factrow-v"><code>' + esc(cand.pinId) + '</code> ' + copyMini(cand.pinId) + '</span></div>';
    if (cand.hash) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">hash</span><span class="oac-mt-factrow-v"><code title="' + esc(cand.hash) + '">' + esc(shortHash(cand.hash)) + '</code></span></div>';
    if (cand.supersedeid) html += '<div class="oac-mt-factrow"><span class="oac-mt-factrow-k">' + esc(uiText('tracking.supersede', 'Supersedes')) + '</span><span class="oac-mt-factrow-v"><code title="' + esc(cand.supersedeid) + '">' + esc(shortPin(cand.supersedeid)) + '</code></span></div>';
    html += '</div>';
    html += '<div class="oac-mt-freshness">' + esc(uiText('tracking.freshnessLine', '{events} events @ block {block}', { events: task.freshness.eventCount, block: task.freshness.boundaryBlock })) + '</div>';
    html += '</div>';
    els.drawer.innerHTML = html;
    els.drawer.hidden = false;
    els.drawer.querySelectorAll('[data-mt-drawer-close]').forEach(function (el) {
      el.addEventListener('click', closeDrawer);
    });
    els.drawer.querySelectorAll('[data-mt-cand]').forEach(function (el) {
      el.addEventListener('click', function () { openDrawer(el.getAttribute('data-mt-cand')); });
    });
    els.drawer.querySelectorAll('[data-mt-copy]').forEach(function (el) {
      el.addEventListener('click', function () {
        var value = el.getAttribute('data-mt-copy');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () {
            el.textContent = uiText('tracking.copied', 'Copied');
            window.setTimeout(function () { el.textContent = uiText('tracking.copy', 'Copy'); }, 1200);
          });
        }
      });
    });
  }

  // ── roster + settlement ──────────────────────────────────────────────────
  function rosterSettlementHtml(task) {
    var settlement = task.settlement || null;
    var estimation = task.estimation || null;
    var showEstShare = !settlement && Boolean(estimation);
    var estByMetaId = new Map();
    (estimation && estimation.shares ? estimation.shares : []).forEach(function (share) { estByMetaId.set(share.metaId, share.shareBP); });
    var roster = (task.participants || []).slice().sort(function (a, b) { return b.verifiedContrib - a.verifiedContrib || a.metaId.localeCompare(b.metaId); });
    var html = '<section class="oac-mt-roster-settlement"><div class="oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(uiText('tracking.rosterTitle', 'Roster')) + '</div>';
    html += '<div class="oac-mt-tablewrap"><table class="oac-mt-table"><thead><tr>';
    html += '<th>' + esc(uiText('tracking.rosterIdentity', 'Identity')) + '</th><th>' + esc(uiText('tracking.rosterClaims', 'Claims')) + '</th><th>' + esc(uiText('tracking.rosterVerified', 'Verified contrib')) + '</th><th>' + esc(uiText('tracking.rosterReviews', 'Review votes')) + '</th>';
    if (showEstShare) html += '<th>' + esc(uiText('tracking.rosterEstShare', 'Est. share')) + '</th>';
    html += '</tr></thead><tbody>';
    if (!roster.length) {
      html += '<tr><td colspan="' + (showEstShare ? 5 : 4) + '" class="oac-mt-empty-inline">' + esc(uiText('tracking.mineEmpty', 'Local bots have not joined this task yet')) + '</td></tr>';
    }
    for (var i = 0; i < roster.length; i++) {
      var participant = roster[i];
      var est = estByMetaId.get(participant.metaId);
      html += '<tr><td><span style="display:inline-flex;align-items:center;gap:6px">' + badgeHtml(participant.metaId, task.identities, {}) + (rosterSet().has(participant.metaId) ? '<span class="oac-mt-you">' + esc(uiText('tracking.you', 'local')) + '</span>' : '') + '</span></td>';
      html += '<td class="oac-mt-sharenum">' + participant.effectiveClaims + '</td>';
      html += '<td class="oac-mt-sharenum">' + participant.verifiedContrib + '</td>';
      html += '<td class="oac-mt-sharenum">' + participant.reviewVotes + '</td>';
      if (showEstShare) html += '<td class="oac-mt-sharenum">' + (est === undefined ? '—' : (est / 100).toFixed(2) + '%') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div></div>';
    html += '<div class="oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(uiText('tracking.settlementTitle', 'Settlement')) + '</div>';
    if (settlement) {
      html += '<div class="oac-mt-tablewrap"><table class="oac-mt-table"><thead><tr>';
      html += '<th>' + esc(uiText('tracking.rosterIdentity', 'Identity')) + '</th><th>' + esc(uiText('tracking.settleShare', 'Share')) + '</th><th>%</th>';
      html += '</tr></thead><tbody>';
      for (var s = 0; s < settlement.shares.length; s++) {
        var share = settlement.shares[s];
        html += '<tr><td>' + badgeHtml(share.metaId, task.identities, {}) + '</td>';
        html += '<td class="oac-mt-sharenum">' + share.shareBP + ' bp <small>(' + share.from.submittedBP + '+' + share.from.reviewedBP + ')</small></td>';
        html += '<td class="oac-mt-sharenum">' + (share.shareBP / 100).toFixed(2) + '%</td></tr>';
      }
      html += '</tbody></table></div>';
      if (settlement.unpaidHistory && settlement.unpaidHistory.length) {
        html += '<div class="oac-mt-unpaid">' + esc(uiText('tracking.unpaidCount', 'Plus {count} unpaid-history entries (rework / superseded)', { count: settlement.unpaidHistory.length })) + '</div>';
      }
      if (task.progress.verified < task.progress.total) {
        html += '<div class="oac-mt-unpaid">' + esc(uiText('tracking.legacyNote', 'This task closed before protocol v1.2: under the legacy rule the verified root completed the task and settled shares, so unverified nodes may remain.')) + '</div>';
      }
    } else {
      html += '<div class="oac-mt-pending">' + esc(uiText('tracking.settlementPending', 'The task has not closed yet ({verified}/{total} verified). Once every node verifies, the root aggregates and there are no open challenges, the weighted contribution-share manifest is generated automatically.', { verified: task.progress.verified, total: task.progress.total }));
      html += '<ul class="oac-mt-checklist">';
      html += '<li' + (task.progress.verified === task.progress.total ? ' data-done="true"' : '') + '>' + esc(uiText('tracking.closingAll', 'All nodes verified ({verified}/{total})', { verified: task.progress.verified, total: task.progress.total })) + '</li>';
      html += '<li' + (task.taskComplete ? ' data-done="true"' : '') + '>' + esc(uiText('tracking.closingRoot', 'Root aggregation verified')) + '</li>';
      html += '<li' + (task.progress.disputed === 0 ? ' data-done="true"' : '') + '>' + esc(uiText('tracking.closingNoChallenges', 'No open challenges ({count} pending)', { count: task.progress.disputed })) + '</li>';
      html += '</ul></div>';
    }
    html += '</div></section>';
    return html;
  }

  function ignoredHtml(task) {
    var events = task.ignoredEvents || [];
    if (!events.length) return '';
    var reasonText = function (reason) {
      var key = 'tracking.ignored' + reason.replace(/_/g, ' ').replace(/\\b\\w/g, function (c) { return c.toUpperCase(); }).replace(/ /g, '');
      var fallback = {
        invalid_reference: 'Invalid reference (bad or missing parentRefs)',
        unknown_node: 'Unknown node',
        same_side_roster: 'Same-side roster vote (not independent)',
        supersede_predicate_failed: 'Supersede predicate failed',
        missing_semantic_check: 'Missing semantic_check (ruling #9)',
        below_h_act2: 'Below H_ACT2 (pre-gate event)',
        challenge_gate_failed: 'Challenge gate failed',
        duplicate_open_challenge: 'Duplicate open challenge',
        target_not_active_verified: 'Target not an active verified submission',
        challenge_expired: 'Challenge expired',
      }[reason] || reason;
      return uiText(key, fallback);
    };
    var html = '<div class="oac-mt-ignored oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(uiText('tracking.ignored', 'Ignored chain events')) + '</div>';
    for (var i = 0; i < events.length; i++) {
      html += '<div class="oac-mt-node-row oac-mt-ignored-row"><span class="oac-mt-chip oac-mt-mono">' + esc(shortPin(events[i].pinId)) + '</span><span>' + esc(reasonText(events[i].reason)) + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  // ── tree mode: structure map + branch node table ─────────────────────────
  function treeMapHtml(task) {
    var nodes = Object.values(task.nodeStates || {});
    if (!nodes.length) return '';
    var childrenOf = treeChildrenOf(nodes);
    var rootNode = nodes.filter(function (n) { return !n.parent; })[0];
    if (!rootNode) return '';
    var childIds = new Set();
    childrenOf.forEach(function (list) { list.forEach(function (child) { childIds.add(child.id); }); });
    var baseChildren = (childrenOf.get(rootNode.id) || []).slice();
    if (!baseChildren.length) baseChildren = nodes.filter(function (n) { return !childIds.has(n.id) && n.id !== rootNode.id; });
    var groups = baseChildren.filter(function (n) { return (childrenOf.get(n.id) || []).length > 0; });
    var topLeaves = baseChildren.filter(function (n) { return !(childrenOf.get(n.id) || []).length; });
    var dot = function (node) {
      var tone = node.status === 'verified' ? 'oac-tm-dot-verified' : node.status === 'claimed' ? 'oac-tm-dot-claimed' : 'oac-tm-dot-open';
      if (node.disputed) tone += ' oac-tm-dot-disputed';
      return tone;
    };
    var html = '<div class="oac-mt-treemap"><div class="oac-mt-h3">' + esc(uiText('tracking.treeMap', 'Task structure')) + '<small>' + esc(uiText('tracking.treeMapHint', 'block color = node status, amber ring = disputed; click a block to locate its node below')) + '</small></div>';
    html += '<div class="oac-mt-treemap-card">';
    html += '<div class="oac-mt-treemap-rootrow"><button type="button" class="oac-mt-treemap-root" data-mt-map-node="' + esc(rootNode.id) + '" data-mt-map-group=""><i class="oac-tm-dot ' + dot(rootNode) + '"></i><span class="oac-mt-mono">' + esc(rootNode.id) + '</span><span class="oac-mt-treemap-roottitle">' + esc(rootNode.title) + '</span></button></div>';
    if (groups.length || topLeaves.length) html += '<div class="oac-mt-treemap-stem"></div>';
    html += '<div class="oac-mt-treemap-groups">';
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var stats = treeSubtreeStats(childrenOf, group.id);
      html += '<div class="oac-mt-treemap-group"><button type="button" class="oac-mt-treemap-grouphead" data-mt-map-group-toggle="' + esc(group.id) + '">';
      html += '<span class="oac-mt-treemap-grouprow"><span class="oac-mt-treemap-groupid">' + esc(group.id) + '</span><span class="oac-mt-treemap-groupstats oac-mt-dim">' + stats.verified + '/' + stats.total + '</span></span>';
      html += '<span class="oac-mt-treemap-grouptitle" title="' + esc(group.title) + '">' + esc(group.title) + '</span></button>';
      html += '<div class="oac-mt-treemap-dots">';
      var children = childrenOf.get(group.id) || [];
      for (var c = 0; c < children.length; c++) {
        html += '<button type="button" class="oac-tm-dot oac-tm-dot-sm ' + dot(children[c]) + '" title="' + esc(children[c].id + ' · ' + children[c].title) + '" data-mt-map-node="' + esc(children[c].id) + '" data-mt-map-group="' + esc(group.id) + '"></button>';
      }
      html += '</div></div>';
    }
    if (topLeaves.length) {
      html += '<div class="oac-mt-treemap-group oac-mt-treemap-leaves"><div class="oac-mt-treemap-dots oac-mt-treemap-dots-wide">';
      for (var l = 0; l < topLeaves.length; l++) {
        html += '<button type="button" class="oac-tm-dot oac-tm-dot-sm ' + dot(topLeaves[l]) + '" title="' + esc(topLeaves[l].id + ' · ' + topLeaves[l].title) + '" data-mt-map-node="' + esc(topLeaves[l].id) + '" data-mt-map-group=""></button>';
      }
      html += '</div></div>';
    }
    html += '</div>';
    html += '<div class="oac-mt-treemap-legend">';
    html += '<span><i class="oac-tm-dot oac-tm-dot-open"></i>' + esc(uiText('tracking.statusOpen', 'Open')) + '</span>';
    html += '<span><i class="oac-tm-dot oac-tm-dot-claimed"></i>' + esc(uiText('tracking.statusClaimed', 'Claimed')) + '</span>';
    html += '<span><i class="oac-tm-dot oac-tm-dot-verified"></i>' + esc(uiText('tracking.statusVerifiedNode', 'Verified')) + '</span>';
    html += '<span><i class="oac-tm-dot oac-tm-dot-open oac-tm-dot-disputed"></i>' + esc(uiText('tracking.disputed', 'Disputed')) + '</span>';
    html += '</div></div></div>';
    return html;
  }

  function treeNodeRows(task) {
    var nodes = Object.values(task.nodeStates || {});
    var childrenOf = treeChildrenOf(nodes);
    var byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
    var rootNode = nodes.filter(function (n) { return !n.parent; })[0];
    var childIds = new Set();
    childrenOf.forEach(function (list) { list.forEach(function (child) { childIds.add(child.id); }); });
    var baseChildren = rootNode ? (childrenOf.get(rootNode.id) || []).map(function (c) { return byId.get(c.id); }).filter(Boolean)
      : nodes.filter(function (n) { return !childIds.has(n.id); });
    var groupIdSet = new Set(baseChildren.filter(function (n) { return (childrenOf.get(n.id) || []).length > 0; }).map(function (n) { return n.id; }));
    var statusLabel = function (status) {
      var key = 'tracking.status' + status.charAt(0).toUpperCase() + status.slice(1) + (status === 'verified' ? 'Node' : '');
      var fallback = { open: 'Open', claimed: 'Claimed', verified: 'Verified' }[status] || status;
      return uiText(key, fallback);
    };
    var renderExpanded = function (node) {
      var submission = node.submission;
      var html = '<div class="oac-mt-treeexpanded">';
      html += '<div><div class="oac-mt-treeblock-title">' + esc(uiText('tracking.nodeTaskDef', 'Branch task definition')) + '</div>';
      html += '<div class="oac-mt-treedef"><span class="oac-mt-mono">' + esc(node.kind) + '</span>';
      if (node.specid) html += '<span class="oac-mt-treespec oac-mt-mono">spec: ' + esc(node.specid) + '</span>';
      html += '</div>';
      if (node.params && Object.keys(node.params).length) html += '<pre class="oac-mt-treepre">' + esc(JSON.stringify(node.params, null, 2)) + '</pre>';
      html += '</div>';
      if (submission) {
        html += '<div><div class="oac-mt-treeblock-title">' + esc(uiText('tracking.nodeSubmissionBy', 'Submitted by:')) + ' ' + badgeHtml(submission.submitter, task.identities, {}) + '<span class="oac-mt-mono oac-mt-dim" title="' + esc(submission.pinId) + '">' + esc(submission.pinId.slice(0, 18)) + '…</span></div>';
        if (submission.result) html += '<pre class="oac-mt-treepre">' + esc(JSON.stringify(submission.result, null, 2)) + '</pre>';
        html += '<div class="oac-mt-treemeta">';
        if (submission.hash) html += '<span class="oac-mt-mono" title="' + esc(submission.hash) + '">hash ' + esc(submission.hash.slice(0, 24)) + '…</span>';
        if (submission.attachment) html += '<span class="oac-mt-mono" title="' + esc(submission.attachment) + '">attachment ' + esc(submission.attachment.slice(0, 48)) + '</span>';
        html += '</div></div>';
      } else {
        html += '<div class="oac-mt-dim">' + esc(uiText('tracking.nodeNoSubmissionYet', 'No effective submission yet (open, or claimed but not submitted).')) + '</div>';
      }
      if ((node.votes || []).length) {
        html += '<div><div class="oac-mt-treeblock-title">' + esc(uiText('tracking.nodeVotes', 'Review votes')) + '</div><div class="oac-mt-treevotes">';
        for (var v = 0; v < node.votes.length; v++) {
          var vote = node.votes[v];
          html += '<div class="oac-mt-treevote">' + badgeHtml(vote.voter, task.identities, {}) + '<span class="oac-mt-badge oac-mt-badge-verdict-' + esc(vote.verdict) + '">' + esc(vote.verdict) + '</span>';
          if (!vote.counted) html += '<span class="oac-mt-dim">' + esc(uiText('tracking.notCounted', 'not counted: {reason}', { reason: vote.ignoreReason || '—' })) + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      html += '</div>';
      return html;
    };
    var renderRow = function (node) {
      var children = (childrenOf.get(node.id) || []).map(function (c) { return byId.get(c.id); }).filter(Boolean);
      var isGroup = children.length > 0;
      var collapsed = !state.expandedGroups[node.id];
      var html = '<div id="oac-mt-node-' + esc(node.id) + '"><div class="oac-mt-treerow">';
      if (isGroup) html += '<button type="button" class="oac-mt-treechevron" title="' + esc(uiText('tracking.groupToggleTip', 'Expand/collapse this group')) + '" data-mt-group-toggle="' + esc(node.id) + '">' + (collapsed ? '▸' : '▾') + '</button>';
      html += '<button type="button" class="oac-mt-treerow-main" title="' + esc(uiText('tracking.nodeExpandTip', 'Expand the node spec, submission and review votes')) + '" data-mt-node-toggle="' + esc(node.id) + '">';
      html += '<span class="oac-mt-treerow-lead"><span class="oac-mt-treerow-id">' + esc(node.id) + '</span><span class="oac-mt-treerow-title" title="' + esc(node.title) + '">' + esc(node.title) + '</span>';
      if (node.weight !== null) html += '<span class="oac-mt-treerow-weight">' + (node.weight / 100).toFixed(2) + '%</span>';
      if (isGroup) {
        var stats = treeSubtreeStats(childrenOf, node.id);
        if (stats.total > 0) html += '<span class="oac-mt-treerow-weight">' + stats.verified + '/' + stats.total + '</span>';
      }
      html += '</span>';
      html += '<span class="oac-mt-nodestatus oac-mt-nodestatus-' + esc(node.status) + '">' + esc(statusLabel(node.status)) + (node.disputed ? ' · ' + esc(uiText('tracking.disputed', 'Disputed')) : '') + '</span>';
      if (node.holder) html += '<span class="oac-mt-treerow-holder">' + badgeHtml(node.holder.claimant, task.identities, {}) + '</span>';
      html += '<span class="oac-mt-treerow-votes">' + node.passVotes + '/' + Math.max(1, task.policy.verifyQuorum) + (node.failVotes > 0 ? ' ·' + node.failVotes + '✗' : '') + '</span>';
      html += '<span class="oac-mt-treechevron oac-mt-treechevron-dim">' + (state.expandedNode === node.id ? '▾' : '▸') + '</span>';
      html += '</button></div>';
      if (state.expandedNode === node.id) html += renderExpanded(node);
      if (isGroup && !collapsed) {
        html += '<div class="oac-mt-treechildren">';
        for (var i = 0; i < children.length; i++) html += renderRow(children[i]);
        html += '</div>';
      }
      html += '</div>';
      return html;
    };
    var html = '<div class="oac-mt-treetable">';
    if (rootNode) html += renderRow(rootNode);
    for (var b = 0; b < baseChildren.length; b++) html += renderRow(baseChildren[b]);
    html += '</div>';
    return html;
  }

  // ── detail render + wiring ───────────────────────────────────────────────
  function renderDetailHtml() {
    var task = state.task;
    if (!task) return;
    var competitive = task.policy.mode === 'competitive';
    var html = '<div class="oac-mt-detail">';
    html += headerHtml(task);
    if (competitive) {
      html += '<div class="oac-mt-sectioncard">' + explainerStatusHtml(task) + '</div>';
      html += deliverablesHtml(task);
      html += howtoHtml(task);
      html += mineHtml(task);
      html += '<div class="oac-mt-sectioncard">' + chainHtml(task) + '</div>';
      html += nodeSectionsHtml(task);
    } else {
      html += '<div class="oac-mt-sectioncard"><div class="oac-mt-rules">' + esc(uiText('tracking.rulesTree', 'Claim a node, submit your work, and a review quorum verifies it; the root aggregate closes the task and settles shares by node weight.')) + '</div>' + treeMapHtml(task) + '</div>';
      html += howtoHtml(task);
      html += mineHtml(task);
      html += '<div class="oac-mt-sectioncard"><div class="oac-mt-h3">' + esc(uiText('tracking.nodesTitle', 'Nodes (branch tasks)')) + '<small>' + esc(uiText('tracking.nodesHint', 'Click a row to expand: what the branch asks for, who submitted what, and the review votes')) + '</small></div>' + treeNodeRows(task) + '</div>';
    }
    html += rosterSettlementHtml(task);
    html += ignoredHtml(task);
    html += '</div>';
    els.detail.innerHTML = html;
    wireDetail();
    if (competitive) scheduleChainDraw();
  }

  function rerenderDetail() {
    var y = window.scrollY || 0;
    renderDetailHtml();
    if (window.scrollTo) window.scrollTo(0, y);
  }

  function wireDetail() {
    var back = els.detail.querySelector('[data-mt-back]');
    if (back) back.addEventListener('click', function () { closeDrawer(); void loadBoard(); });
    var brief = els.detail.querySelector('[data-mt-brief]');
    if (brief) brief.addEventListener('click', function () { state.briefOpen = !state.briefOpen; rerenderDetail(); });
    els.detail.querySelectorAll('[data-mt-draft-root]').forEach(function (el) {
      el.addEventListener('click', function () { void loadDraft(state.root); });
    });
    els.detail.querySelectorAll('[data-mt-draft-node]').forEach(function (el) {
      el.addEventListener('click', function () { void loadDraft(state.root); });
    });
    els.detail.querySelectorAll('[data-mt-cand]').forEach(function (el) {
      el.addEventListener('click', function () { openDrawer(el.getAttribute('data-mt-cand')); });
    });
    els.detail.querySelectorAll('[data-mt-nodesec]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-mt-nodesec');
        state.expandedGroups[id] = !state.expandedGroups[id];
        rerenderDetail();
      });
    });
    els.detail.querySelectorAll('[data-mt-group-toggle]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-mt-group-toggle');
        state.expandedGroups[id] = !state.expandedGroups[id];
        rerenderDetail();
      });
    });
    els.detail.querySelectorAll('[data-mt-node-toggle]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-mt-node-toggle');
        state.expandedNode = state.expandedNode === id ? null : id;
        rerenderDetail();
      });
    });
    els.detail.querySelectorAll('[data-mt-map-node]').forEach(function (el) {
      el.addEventListener('click', function () {
        selectTreeNode(el.getAttribute('data-mt-map-node'), el.getAttribute('data-mt-map-group'));
      });
    });
    els.detail.querySelectorAll('[data-mt-map-group-toggle]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-mt-map-group-toggle');
        state.expandedGroups[id] = !state.expandedGroups[id];
        rerenderDetail();
      });
    });
    els.detail.querySelectorAll('[data-mt-mine]').forEach(function (el) {
      el.addEventListener('click', function () {
        var nodeId = el.getAttribute('data-mt-mine');
        if (state.task && state.task.policy.mode === 'tree') {
          var node = state.task.nodeStates[nodeId];
          var groupId = node && node.parent && state.task.nodeStates[node.parent] && (state.task.nodeStates[node.parent].submissions || state.expandedGroups[node.parent] !== undefined) ? node.parent : null;
          if (node && node.parent) {
            var parent = state.task.nodeStates[node.parent];
            var hasChildren = Object.values(state.task.nodeStates).some(function (n) { return n.parent === node.parent && n.id !== node.parent; });
            if (parent && hasChildren) groupId = node.parent;
          }
          selectTreeNode(nodeId, groupId);
        } else {
          var rowNode = state.task && state.task.nodeStates[nodeId];
          var lead = rowNode && rowNode.submission;
          if (lead) openDrawer(lead.pinId);
        }
      });
    });
    els.detail.querySelectorAll('[data-mt-copy]').forEach(function (el) {
      el.addEventListener('click', function () {
        var value = el.getAttribute('data-mt-copy');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () {
            el.textContent = uiText('tracking.copied', 'Copied');
            window.setTimeout(function () { el.textContent = uiText('tracking.copy', 'Copy'); }, 1200);
          });
        }
      });
    });
    // avatar load failures fall back to the colored initial disc
    els.detail.querySelectorAll('[data-mt-avatar-fallback]').forEach(function (img) {
      img.addEventListener('error', function () {
        var parts = String(img.getAttribute('data-mt-avatar-fallback') || '|').split('|');
        var initial = parts[1] || '?';
        var span = document.createElement('span');
        span.className = 'oac-mt-badge-avatar oac-mt-badge-initial';
        span.style.background = colorOfId(parts[0] || '?');
        span.textContent = initial;
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  function selectTreeNode(nodeId, groupId) {
    if (groupId) state.expandedGroups[groupId] = true;
    state.expandedNode = nodeId;
    rerenderDetail();
    window.setTimeout(function () {
      var el = document.getElementById ? document.getElementById('oac-mt-node-' + nodeId) : null;
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  async function loadDetail(root) {
    state.root = root;
    state.view = 'detail';
    state.task = null;
    state.drawerPin = null;
    state.expandedNode = null;
    state.expandedGroups = {};
    state.groupsInitFor = null;
    state.briefOpen = false;
    if (els.drawer) els.drawer.hidden = true;
    els.board.hidden = true;
    els.detail.hidden = false;
    els.detail.innerHTML = '<div class="card"><p class="table-empty">' + esc(uiText('tracking.status.loading', 'Loading…')) + '</p></div>';
    try {
      var task = await fetchJson('/api/metatask/task?root=' + encodeURIComponent(root));
      state.task = task;
      initDetailExpansion(task);
      renderDetailHtml();
    } catch (error) {
      els.detail.innerHTML = '<div class="card"><p class="table-empty">' + esc(uiText('tracking.loadError', 'Could not load tracking data: {message}', { message: error.message })) + '</p></div>';
    }
  }

  // Default expansion, once per task: competitive node sections without
  // candidates start collapsed; tree groups with in-flight/disputed
  // descendants start expanded.
  function initDetailExpansion(task) {
    if (state.groupsInitFor === task.rootPinId) return;
    state.groupsInitFor = task.rootPinId;
    var nodes = Object.values(task.nodeStates || {});
    var childrenOf = treeChildrenOf(nodes);
    var expanded = {};
    if (task.policy.mode === 'competitive') {
      for (var i = 0; i < nodes.length; i++) {
        if (!(nodes[i].submissions || []).length) expanded[nodes[i].id] = false;
        else expanded[nodes[i].id] = true;
      }
    } else {
      var rootNode = nodes.filter(function (n) { return !n.parent; })[0];
      var baseChildren = rootNode ? (childrenOf.get(rootNode.id) || []) : nodes;
      for (var g = 0; g < baseChildren.length; g++) {
        if ((childrenOf.get(baseChildren[g].id) || []).length > 0 && treeSubtreeHasAttention(childrenOf, baseChildren[g].id)) {
          expanded[baseChildren[g].id] = true;
        }
      }
    }
    state.expandedGroups = expanded;
  }

  // ── participation draft overlay ──────────────────────────────────────────
  async function loadDraft(root) {
    var isZh = uiText('tracking.tabLongTerm', 'Long-term') !== 'Long-term';
    els.draftTitle.textContent = uiText('tracking.draftTitle', 'Participation draft');
    els.draftHint.textContent = uiText('tracking.draftHint', 'Copy this draft into a bot session to start the task. This page never writes on-chain.');
    els.draftCopy.textContent = uiText('tracking.copy', 'Copy');
    els.draftText.value = uiText('tracking.status.loading', 'Loading…');
    els.draft.hidden = false;
    try {
      var draft = await fetchJson('/api/metatask/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: root, lang: isZh ? 'zh' : 'en' }),
      });
      if (draft && draft.node) {
        els.draftTitle.textContent = uiText('tracking.draftTitle', 'Participation draft') + ' · ' + draft.node;
      }
      els.draftText.value = (draft && draft.text) || '';
    } catch (error) {
      els.draftText.value = uiText('tracking.loadError', 'Could not load tracking data: {message}', { message: error.message });
    }
  }
  els.draftClose.addEventListener('click', function () { els.draft.hidden = true; });
  els.draftCopy.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(els.draftText.value);
      els.draftCopy.textContent = uiText('tracking.copied', 'Copied');
      window.setTimeout(function () { els.draftCopy.textContent = uiText('tracking.copy', 'Copy'); }, 1500);
    } catch (_) { /* clipboard unavailable */ }
  });

  els.refresh.addEventListener('click', async function () {
    try {
      await fetchJson('/api/metatask/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (els.detail.hidden) await loadBoard();
      else if (state.root) await loadDetail(state.root);
    } catch (error) {
      els.status.textContent = uiText('tracking.refreshFailed', 'Refresh failed: {message}', { message: error.message });
    }
  });

  var timer = window.setInterval(function () {
    if (!document.hidden && els.detail.hidden) void loadBoard();
  }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && els.detail.hidden) void loadBoard(); });
  window.addEventListener('beforeunload', function () { window.clearInterval(timer); });

  bindChainListeners();
  void loadBoard();
})();
`,
    };
}
