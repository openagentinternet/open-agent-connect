"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomPageDefinition = buildLoomPageDefinition;
exports.buildLoomPageScript = buildLoomPageScript;
function buildLoomPageDefinition() {
    return {
        page: 'loom',
        title: 'Loom Board',
        eyebrow: 'Loom Board',
        heading: 'MetaBot Loom task board',
        description: 'Inspect Loom tasks, claims, deliveries, warnings, and operator handoffs from the local dashboard cache.',
        panels: [],
        contentHtml: `
      <section class="loom-shell" data-loom-shell>
        <section class="loom-toolbar" aria-label="Loom board controls">
          <div class="loom-toolbar-main">
            <div>
              <div class="loom-kicker">Loom Board</div>
              <h1>Task operations</h1>
            </div>
            <button type="button" class="loom-icon-button loom-refresh" data-loom-refresh title="Refresh dashboard" aria-label="Refresh dashboard">↻</button>
          </div>
          <div class="loom-toolbar-context">
            <div class="loom-context-item">
              <span>Actor</span>
              <strong data-loom-actor>Loading...</strong>
            </div>
            <div class="loom-context-item">
              <span>Last refresh</span>
              <strong data-loom-updated>Loading...</strong>
            </div>
            <div class="loom-context-warning" data-loom-stale-warning></div>
          </div>
          <div class="loom-filters" aria-label="Loom board filters">
            <label>
              <span>State</span>
              <select data-loom-state-filter>
                <option value="">All states</option>
                <option value="open">Open</option>
                <option value="claimed">Claimed</option>
                <option value="in_progress">Working</option>
                <option value="delivered">Review</option>
                <option value="revision_needed">Revision</option>
                <option value="accepted_paid">Accepted paid</option>
                <option value="rejected">Rejected</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label>
              <span>Role</span>
              <select data-loom-role-filter>
                <option value="">Any role</option>
                <option value="requester">Requester</option>
                <option value="developer">Developer</option>
                <option value="needs_action">Needs action</option>
              </select>
            </label>
            <label class="loom-filter-query">
              <span>Query</span>
              <input type="search" data-loom-query-filter placeholder="Task, Bot, repo, pin" />
            </label>
          </div>
          <div class="loom-status-line">
            <span data-loom-status>Loading dashboard...</span>
            <span data-loom-error></span>
          </div>
        </section>

        <section class="loom-metrics" data-loom-metrics aria-label="Loom dashboard metrics"></section>

        <section class="loom-workspace">
          <div class="loom-board" data-loom-board aria-label="Loom task board"></div>
          <aside class="loom-detail" data-loom-detail aria-label="Selected Loom task detail">
            <div class="loom-empty-detail">
              <h2>Select a task</h2>
              <p>Task requirements, Bot identities, timeline, warnings, and handoff commands will appear here.</p>
            </div>
          </aside>
        </section>
      </section>
    `,
        script: buildLoomPageScript(),
    };
}
function buildLoomPageScript() {
    return `(() => {
  const elements = {
    status: document.querySelector('[data-loom-status]'),
    refresh: document.querySelector('[data-loom-refresh]'),
    actor: document.querySelector('[data-loom-actor]'),
    updated: document.querySelector('[data-loom-updated]'),
    staleWarning: document.querySelector('[data-loom-stale-warning]'),
    stateFilter: document.querySelector('[data-loom-state-filter]'),
    roleFilter: document.querySelector('[data-loom-role-filter]'),
    queryFilter: document.querySelector('[data-loom-query-filter]'),
    metrics: document.querySelector('[data-loom-metrics]'),
    board: document.querySelector('[data-loom-board]'),
    detail: document.querySelector('[data-loom-detail]'),
    error: document.querySelector('[data-loom-error]'),
  };
  const boardColumns = [
    { id: 'open', title: 'Open' },
    { id: 'claimed', title: 'Claimed' },
    { id: 'working', title: 'Working' },
    { id: 'review', title: 'Review' },
    { id: 'revision', title: 'Revision' },
    { id: 'closed', title: 'Closed' },
  ];
  let currentModel = null;
  let selectedTaskPinId = '';

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const obj = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const arr = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const countLabel = (count, singular, plural) => String(count) + ' ' + (count === 1 ? singular : plural);
  const compact = (value) => {
    const normalized = text(value);
    if (!normalized) return { label: '', copyValue: '' };
    return {
      label: normalized.length <= 18 ? normalized : normalized.slice(0, 8) + '...' + normalized.slice(-4),
      copyValue: normalized,
    };
  };
  const setText = (target, value) => {
    if (target) target.textContent = value;
  };
  const setHtml = (target, value) => {
    if (target) target.innerHTML = value;
  };
  const setStatus = (value, tone) => {
    setText(elements.status, value);
    if (elements.status) elements.status.dataset.tone = tone || 'neutral';
  };
  const fromQuery = () => new URLSearchParams(window.location.search || '').get('from') || '';
  const relativeTime = (timestamp) => {
    const parsed = num(timestamp);
    if (!parsed) return 'Never';
    const age = Math.max(0, Date.now() - parsed);
    if (age < 60000) return 'just now';
    if (age < 3600000) return String(Math.floor(age / 60000)) + 'm ago';
    if (age < 86400000) return String(Math.floor(age / 3600000)) + 'h ago';
    return String(Math.floor(age / 86400000)) + 'd ago';
  };
  const stateLabel = (state) => ({
    open: 'Open',
    claimed: 'Claimed',
    in_progress: 'Working',
    delivered: 'In review',
    revision_needed: 'Needs revision',
    accepted_paid: 'Accepted paid',
    rejected: 'Rejected',
    failed: 'Failed',
  }[state] || state || 'Unknown');
  const columnForState = (state) => ({
    open: 'open',
    claimed: 'claimed',
    in_progress: 'working',
    delivered: 'review',
    revision_needed: 'revision',
    accepted_paid: 'closed',
    rejected: 'closed',
    failed: 'closed',
  }[state] || 'open');

  const dashboardFrom = (payload) => {
    const root = obj(payload);
    if (root.ok === false) throw new Error(text(root.message) || text(root.code) || 'Loom dashboard request failed.');
    const data = obj(root.data);
    return obj(root.dashboard || data.dashboard || data || root);
  };
  const botModel = (value, role) => {
    const bot = obj(value);
    const fallbackLabel = text(bot.fallbackLabel) || role + ':unknown';
    const displayName = text(bot.displayName) || text(bot.name) || fallbackLabel;
    const initials = text(bot.initials) || displayName.split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || role.slice(0, 2).toUpperCase();
    return {
      role: text(bot.role) || role,
      displayName,
      initials,
      fallbackLabel,
      globalMetaId: text(bot.globalMetaId),
      address: text(bot.address),
      avatarUri: text(bot.avatarUri || bot.avatarUrl),
    };
  };
  const bountyLabel = (value) => {
    const bounty = obj(value);
    return [text(bounty.amount), text(bounty.currency)].filter(Boolean).join(' ') || 'Bounty not set';
  };
  const repoLabel = (value) => {
    const repo = obj(value);
    const repoUri = text(repo.repoUri);
    const baseBranch = text(repo.baseBranch);
    let label = repoUri || 'Repository not set';
    const githubMatch = repoUri.match(/^https?:\\/\\/github\\.com\\/([^/]+)\\/([^/?#]+)(?:[/?#].*)?$/i);
    if (githubMatch) label = githubMatch[1] + '/' + githubMatch[2].replace(/\\.git$/i, '');
    return [label, baseBranch].filter(Boolean).join(' @ ');
  };
  const repoModel = (value) => {
    const repo = obj(value);
    return {
      repoUri: text(repo.repoUri),
      baseBranch: text(repo.baseBranch),
      label: repoLabel(repo),
    };
  };
  const cardModel = (value) => {
    const card = obj(value);
    const taskPinId = text(card.taskPinId);
    if (!taskPinId) return null;
    const warningCount = num(card.warningCount);
    return {
      taskPinId,
      taskPin: compact(taskPinId),
      title: text(card.title) || 'Untitled Loom task',
      state: text(card.state),
      stateLabel: stateLabel(text(card.state)),
      stateTone: text(card.stateTone) || 'neutral',
      columnId: text(card.columnId) || columnForState(text(card.state)),
      requester: botModel(card.requester, 'requester'),
      developer: card.developer ? botModel(card.developer, 'developer') : null,
      bountyLabel: bountyLabel(card.bounty),
      repo: repoModel(card.repo),
      repoLabel: repoLabel(card.repo),
      tags: arr(card.tags).filter((item) => typeof item === 'string'),
      latestStatusSummary: text(card.latestStatusSummary),
      prUrl: text(card.prUrl),
      paymentTxId: compact(card.paymentTxId),
      activeClaimCount: num(card.activeClaimCount),
      warningCount,
      warningLabel: countLabel(warningCount, 'warning', 'warnings'),
      needsAction: obj(card.actorContext).needsMyAction === true,
      updatedAt: num(card.updatedAt),
      createdAt: num(card.createdAt),
    };
  };
  const stringList = (value) => arr(value).filter((entry) => typeof entry === 'string');
  const commitModels = (value) => arr(value).map((commit) => {
    const commitObj = obj(commit);
    return {
      sha: text(commitObj.sha),
      message: text(commitObj.message),
      files: stringList(commitObj.files),
    };
  }).filter((commit) => commit.sha || commit.message);
  const recordModels = (value) => arr(value).map((record) => {
    const item = obj(record);
    return {
      pin: compact(item.pinId),
      timestamp: num(item.timestamp),
      globalMetaId: text(item.globalMetaId),
      address: text(item.creatorAddress) || text(item.address),
      payload: obj(item.payload),
    };
  }).filter((record) => record.pin.copyValue);
  const detailModel = (value) => {
    const detail = obj(value);
    const taskPinId = text(detail.taskPinId);
    if (!taskPinId) return null;
    const validRecords = obj(detail.validRecords);
    return {
      taskPinId,
      taskPin: compact(taskPinId),
      title: text(detail.title) || 'Untitled Loom task',
      state: text(detail.state),
      stateLabel: stateLabel(text(detail.state)),
      requirement: text(detail.requirement),
      criteria: text(detail.criteria),
      requester: botModel(detail.requester, 'requester'),
      claims: arr(detail.claims).map((claim) => {
        const item = obj(claim);
        return {
          pin: compact(item.pinId),
          active: item.active === true,
          message: text(item.message),
          timestamp: num(item.timestamp),
          payoutAddress: text(item.payoutAddress),
          developer: botModel(item.developer, 'developer'),
        };
      }).filter((claim) => claim.pin.copyValue),
      warnings: arr(detail.warnings).map((warning) => {
        const item = obj(warning);
        return {
          pin: compact(item.recordPinId),
          protocol: text(item.protocol),
          code: text(item.code),
          message: text(item.message),
          timestamp: num(item.timestamp),
        };
      }).filter((warning) => warning.pin.copyValue),
      localWorkflow: arr(detail.localWorkflow).map((workflow) => {
        const item = obj(workflow);
        return {
          developerMetaBotSlug: text(item.developerMetaBotSlug),
          branchName: text(item.branchName),
          workspacePath: text(item.workspacePath),
          llmSessionIds: stringList(item.llmSessionIds),
          processLogPaths: stringList(item.processLogPaths),
          processLogUris: stringList(item.processLogUris),
          commits: commitModels(item.commits),
        };
      }),
      validRecords: {
        statuses: recordModels(validRecords.statuses),
        deliveries: recordModels(validRecords.deliveries),
        acceptances: recordModels(validRecords.acceptances),
        claimRejects: recordModels(validRecords.claimRejects),
      },
      timeline: arr(detail.timeline).map((event) => {
        const item = obj(event);
        return {
          id: text(item.id) || text(item.kind) + ':' + text(item.pinId),
          kind: text(item.kind),
          title: text(item.title) || text(item.kind),
          summary: text(item.summary),
          timestamp: num(item.timestamp),
          pin: compact(item.pinId),
        };
      }).filter((event) => event.id).sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id)),
    };
  };
  const buildModel = (payload) => {
    const dashboard = dashboardFrom(payload);
    const summary = obj(dashboard.summary);
    const rawColumns = arr(dashboard.columns);
    const cardsFromTasks = arr(dashboard.tasks).map(cardModel).filter(Boolean);
    const cardsFromColumns = rawColumns.flatMap((column) => arr(obj(column).cards)).map(cardModel).filter(Boolean);
    const cards = cardsFromTasks.length ? cardsFromTasks : cardsFromColumns;
    const cardsByColumn = new Map();
    rawColumns.forEach((column) => {
      const columnObj = obj(column);
      const columnCards = arr(columnObj.cards).map(cardModel).filter(Boolean);
      if (columnCards.length) cardsByColumn.set(text(columnObj.id), columnCards);
    });
    cards.forEach((card) => {
      if (!cardsByColumn.has(card.columnId)) {
        cardsByColumn.set(card.columnId, cards.filter((entry) => entry.columnId === card.columnId));
      }
    });
    const actor = obj(dashboard.actor);
    const refresh = obj(dashboard.refresh);
    const updatedAt = num(refresh.updatedAt) || num(dashboard.updatedAt);
    const warning = text(refresh.warning) || (updatedAt && Date.now() - updatedAt > 900000 ? 'Dashboard data may be stale.' : '');
    return {
      actor: {
        profileSlug: text(actor.profileSlug),
        displayLabel: text(actor.profileSlug) || compact(actor.globalMetaId).label || compact(actor.address).label || 'No active Bot',
        globalMetaId: compact(actor.globalMetaId),
        address: compact(actor.address),
      },
      summary: {
        metrics: [
          ['totalTasks', 'Total tasks', num(summary.totalTasks), false],
          ['needsMyAction', 'Needs my action', num(summary.needsMyAction), num(summary.needsMyAction) > 0],
          ['open', 'Open', num(summary.open), false],
          ['working', 'Working', num(summary.inProgress), false],
          ['review', 'In review', num(summary.delivered), false],
          ['revision', 'Needs revision', num(summary.revisionNeeded), num(summary.revisionNeeded) > 0],
          ['closed', 'Closed', num(summary.acceptedPaid) + num(summary.rejected) + num(summary.failed), false],
          ['invalidRecords', 'Invalid records', num(summary.invalidRecords), num(summary.invalidRecords) > 0],
        ],
        newestActivityLabel: relativeTime(summary.newestActivityAt),
      },
      columns: boardColumns.map((column) => ({
        id: column.id,
        title: column.title,
        cards: cardsByColumn.get(column.id) || [],
      })),
      cards,
      details: arr(dashboard.details).map(detailModel).filter(Boolean),
      refresh: {
        updatedLabel: updatedAt ? relativeTime(updatedAt) : 'Not refreshed yet',
        warningLabel: warning,
      },
    };
  };

  const copyButton = (label, value) => value ? '<button type="button" class="loom-copy" data-loom-copy="' + esc(value) + '" title="Copy ' + esc(label) + '">' + esc(label) + '</button>' : '';
  const safeExternalLink = (href, label, className) => {
    const value = text(href);
    if (!value) return '';
    const classes = className ? ' class="' + esc(className) + '"' : '';
    if (isHttpUrl(value)) {
      return '<a' + classes + ' href="' + esc(value) + '" target="_blank" rel="noreferrer">' + esc(label || value) + '</a>';
    }
    return '<span' + classes + '>' + esc(value) + '</span>';
  };
  const shellArg = (value) => "'" + String(value == null ? '' : value).split("'").join("'\\\\''") + "'";
  const avatar = (bot) => {
    if (bot.avatarUri) return '<img class="loom-avatar" src="' + esc(bot.avatarUri) + '" alt="" loading="lazy" />';
    return '<span class="loom-avatar loom-avatar-fallback">' + esc(bot.initials) + '</span>';
  };
  const botInline = (bot, label) => '<div class="loom-bot"><div>' + avatar(bot) + '</div><div class="loom-bot-text"><span>' + esc(label) + '</span><strong>' + esc(bot.displayName) + '</strong><small>' + esc(bot.globalMetaId || bot.fallbackLabel) + '</small></div></div>';
  const renderMetrics = () => {
    setHtml(elements.metrics, currentModel.summary.metrics.map((metric) => (
      '<article class="loom-metric" data-tone="' + (metric[3] ? 'warning' : 'neutral') + '">' +
      '<span>' + esc(metric[1]) + '</span>' +
      '<strong>' + esc(Number(metric[2]).toLocaleString('en-US')) + '</strong>' +
      '</article>'
    )).join(''));
  };
  const renderCard = (card) => (
    '<article class="loom-task-card' + (card.taskPinId === selectedTaskPinId ? ' is-selected' : '') + '" data-loom-card="' + esc(card.taskPinId) + '" tabindex="0">' +
    '<div class="loom-card-top"><h3>' + esc(card.title) + '</h3><span class="loom-state" data-tone="' + esc(card.stateTone) + '">' + esc(card.stateLabel) + '</span></div>' +
    '<div class="loom-card-pin"><span>' + esc(card.taskPin.label) + '</span>' + copyButton('Copy', card.taskPin.copyValue) + '</div>' +
    '<div class="loom-card-bots">' + botInline(card.requester, 'Requester') + (card.developer ? botInline(card.developer, 'Developer') : '<div class="loom-bot loom-bot-empty">No developer claim</div>') + '</div>' +
    '<div class="loom-card-meta"><span>' + esc(card.bountyLabel) + '</span><span>' + esc(card.repoLabel) + '</span></div>' +
    (card.tags.length ? '<div class="loom-tag-row">' + card.tags.slice(0, 4).map((tag) => '<span class="loom-chip">' + esc(tag) + '</span>').join('') + '</div>' : '') +
    (card.latestStatusSummary ? '<p>' + esc(card.latestStatusSummary) + '</p>' : '') +
    '<div class="loom-card-footer">' +
    (card.updatedAt ? '<span class="loom-chip">Updated ' + esc(relativeTime(card.updatedAt)) + '</span>' : '') +
    (card.activeClaimCount ? '<span class="loom-chip">' + esc(countLabel(card.activeClaimCount, 'claim', 'claims')) + '</span>' : '') +
    (card.paymentTxId.copyValue ? '<span class="loom-chip">Paid ' + esc(card.paymentTxId.label) + '</span>' + copyButton('Copy tx', card.paymentTxId.copyValue) : '') +
    (card.needsAction ? '<span class="loom-chip warning">Needs my action</span>' : '') +
    (card.warningCount ? '<span class="loom-chip warning">' + esc(card.warningLabel) + '</span>' : '') +
    (card.prUrl ? safeExternalLink(card.prUrl, isHttpUrl(card.prUrl) ? 'PR ↗' : card.prUrl, 'loom-chip') : '') +
    '</div>' +
    '</article>'
  );
  const renderBoard = () => {
    if (!currentModel.cards.length) {
      setHtml(elements.board, '<div class="loom-empty-board"><h2>No Loom tasks yet</h2><p>No published task records are visible in the local dashboard cache yet.</p></div>');
      return;
    }
    setHtml(elements.board, currentModel.columns.map((column) => (
      '<section class="loom-column" data-column="' + esc(column.id) + '">' +
      '<header><h2>' + esc(column.title) + '</h2><span>' + String(column.cards.length) + '</span></header>' +
      '<div class="loom-column-list">' + (column.cards.length ? column.cards.map(renderCard).join('') : '<p class="loom-empty-column">No tasks</p>') + '</div>' +
      '</section>'
    )).join(''));
    bindBoardActions();
  };
  const renderTimeline = (detail) => detail.timeline.length ? detail.timeline.map((event) => (
    '<li><div><strong>' + esc(event.title) + '</strong><span>' + esc(relativeTime(event.timestamp)) + '</span></div>' +
    (event.summary ? '<p>' + esc(event.summary) + '</p>' : '') +
    (event.pin.copyValue ? '<div class="loom-inline-copy"><code>' + esc(event.pin.label) + '</code>' + copyButton('Copy pin', event.pin.copyValue) + '</div>' : '') +
    '</li>'
  )).join('') : '<li><p>No timeline events.</p></li>';
  const renderCommitEvidence = (commits) => commits.length ? (
    '<div class="loom-commit-list">' + commits.map((commit) => {
      const shortSha = commit.sha ? commit.sha.slice(0, 7) : 'commit';
      const files = commit.files.length
        ? '<small>' + esc(countLabel(commit.files.length, 'file', 'files')) + ': ' + esc(commit.files.slice(0, 3).join(', ')) + (commit.files.length > 3 ? '...' : '') + '</small>'
        : '';
      return '<div class="loom-commit"><div class="loom-inline-copy"><code>' + esc(shortSha) + '</code>' + copyButton('Copy SHA', commit.sha) + '</div>' + (commit.message ? '<p>' + esc(commit.message) + '</p>' : '') + files + '</div>';
    }).join('') + '</div>'
  ) : '';
  const renderTextList = (items) => items.length ? '<ul class="loom-mini-list">' + items.map((item) => '<li>' + esc(item) + '</li>').join('') + '</ul>' : '';
  const renderRecordPin = (record) => '<div class="loom-inline-copy"><code>' + esc(record.pin.label) + '</code>' + copyButton('Copy pin', record.pin.copyValue) + '</div>';
  const renderRecordAuthor = (record) => (record.globalMetaId || record.address) ? (
    '<div class="loom-author-row">' +
    (record.globalMetaId ? '<span>Author GMID: <code>' + esc(record.globalMetaId) + '</code></span>' : '') +
    (record.address ? '<span>Author address: <code>' + esc(record.address) + '</code></span>' : '') +
    '</div>'
  ) : '';
  const checklistModels = (value) => arr(value).map((entry) => {
    if (typeof entry === 'string') return { item: text(entry), status: '' };
    const item = obj(entry);
    return {
      item: text(item.item) || text(item.label) || text(item.name),
      status: text(item.status) || text(item.state),
    };
  }).filter((entry) => entry.item || entry.status);
  const renderChecklist = (items) => items.length ? '<ul class="loom-mini-list">' + items.map((item) => '<li>' + esc(item.item || 'Checklist item') + (item.status ? ' · ' + esc(item.status) : '') + '</li>').join('') + '</ul>' : '';
  const isHttpUrl = (value) => {
    return /^https?:\\/\\//i.test(text(value));
  };
  const renderRepositorySection = (card) => {
    const repo = card.repo || {};
    if (!repo.repoUri && !repo.label && !repo.baseBranch) return '';
    const repoLink = repo.repoUri
      ? safeExternalLink(repo.repoUri, isHttpUrl(repo.repoUri) ? (repo.label || repo.repoUri) : (repo.label || repo.repoUri), '')
      : '<span>' + esc(repo.label || 'Repository not set') + '</span>';
    return '<section class="loom-detail-section"><h3>Repository</h3><div class="loom-repo-detail">' + repoLink + (repo.baseBranch ? '<p>Base branch: <code>' + esc(repo.baseBranch) + '</code></p>' : '') + '</div></section>';
  };
  const renderStatusRecords = (records) => records.length ? (
    '<section class="loom-detail-section"><h3>Status records</h3>' + records.map((record) => {
      const payload = record.payload;
      return '<div class="loom-raw-record">' +
        '<strong>' + esc(text(payload.status) || 'status') + '</strong>' +
        renderRecordAuthor(record) +
        (text(payload.progressSummary) ? '<p>' + esc(text(payload.progressSummary)) + '</p>' : '') +
        (text(payload.branchName) ? '<p>Branch: <code>' + esc(text(payload.branchName)) + '</code></p>' : '') +
        renderCommitEvidence(commitModels(payload.commits)) +
        (stringList(payload.processLogs).length ? '<p>Process logs:</p>' + renderTextList(stringList(payload.processLogs)) : '') +
        (stringList(payload.artifactUris).length ? '<p>Artifacts:</p>' + renderTextList(stringList(payload.artifactUris)) : '') +
        renderRecordPin(record) +
        '</div>';
    }).join('') + '</section>'
  ) : '';
  const renderDeliveryRecords = (records) => records.length ? (
    '<section class="loom-detail-section"><h3>Delivery records</h3>' + records.map((record) => {
      const payload = record.payload;
      const delivery = obj(payload.delivery);
      const prUrl = text(delivery.prUrl) || text(payload.prUrl);
      const prTitle = text(delivery.prTitle) || text(payload.prTitle);
      const deliverySummary = text(payload.deliverySummary) || text(delivery.deliverySummary);
      const headBranch = text(delivery.prBranch) || text(delivery.headBranch) || text(payload.prBranch) || text(payload.headBranch);
      const baseBranch = text(delivery.prBaseBranch) || text(delivery.baseBranch) || text(payload.prBaseBranch) || text(payload.baseBranch);
      const checklist = checklistModels(payload.reviewChecklist);
      return '<div class="loom-raw-record">' +
        (prTitle ? '<strong>' + esc(prTitle) + '</strong>' : '<strong>Delivery</strong>') +
        renderRecordAuthor(record) +
        (deliverySummary ? '<p>' + esc(deliverySummary) + '</p>' : '') +
        (prUrl ? safeExternalLink(prUrl, prUrl, '') : '') +
        ([headBranch, baseBranch].filter(Boolean).length ? '<p>Branches: <code>' + esc([headBranch, baseBranch].filter(Boolean).join(' -> ')) + '</code></p>' : '') +
        (checklist.length ? '<p>Checklist:</p>' + renderChecklist(checklist) : '') +
        (stringList(payload.attachments).length ? '<p>Attachments:</p>' + renderTextList(stringList(payload.attachments)) : '') +
        renderRecordPin(record) +
        '</div>';
    }).join('') + '</section>'
  ) : '';
  const renderAcceptanceRecords = (records) => records.length ? (
    '<section class="loom-detail-section"><h3>Acceptance records</h3>' + records.map((record) => {
      const payload = record.payload;
      const paymentTxId = compact(payload.paymentTxId);
      return '<div class="loom-raw-record">' +
        '<strong>' + esc(text(payload.verdict) || 'acceptance') + '</strong>' +
        renderRecordAuthor(record) +
        (num(payload.score) ? '<p>Score: ' + esc(String(num(payload.score))) + '</p>' : '') +
        (text(payload.comment) ? '<p>' + esc(text(payload.comment)) + '</p>' : '') +
        (payload.releasePayment === true ? '<p>Release payment: true</p>' : '') +
        (paymentTxId.copyValue ? '<div class="loom-inline-copy"><code>' + esc(paymentTxId.label) + '</code>' + copyButton('Copy payment txid', paymentTxId.copyValue) + '</div>' : '') +
        (stringList(payload.attachments).length ? '<p>Attachments:</p>' + renderTextList(stringList(payload.attachments)) : '') +
        renderRecordPin(record) +
        '</div>';
    }).join('') + '</section>'
  ) : '';
  const renderClaimRejectRecords = (records) => records.length ? (
    '<section class="loom-detail-section"><h3>Claim rejects</h3>' + records.map((record) => {
      const payload = record.payload;
      return '<div class="loom-raw-record">' +
        '<strong>' + esc(text(payload.reason) || 'Claim rejected') + '</strong>' +
        renderRecordAuthor(record) +
        (text(payload.claimPinId) ? '<div class="loom-inline-copy"><code>' + esc(compact(payload.claimPinId).label) + '</code>' + copyButton('Copy claim pin', text(payload.claimPinId)) + '</div>' : '') +
        renderRecordPin(record) +
        '</div>';
    }).join('') + '</section>'
  ) : '';
  const renderDetail = () => {
    const detail = currentModel.details.find((entry) => entry.taskPinId === selectedTaskPinId) || null;
    const card = currentModel.cards.find((entry) => entry.taskPinId === selectedTaskPinId) || currentModel.cards[0] || null;
    if (!detail || !card) {
      setHtml(elements.detail, '<div class="loom-empty-detail"><h2>Select a task</h2><p>Task requirements, Bot identities, timeline, warnings, and handoff commands will appear here.</p></div>');
      return;
    }
    const firstClaim = detail.claims[0] || null;
    const activeClaim = detail.claims.find((claim) => claim.active) || null;
    const headerDeveloper = activeClaim ? activeClaim.developer : (card.developer || (firstClaim ? firstClaim.developer : null));
    const from = fromQuery();
    const fromArg = from ? ' --from ' + shellArg(from) : '';
    const deliveryEvent = detail.timeline.find((event) => event.kind === 'delivery' && event.pin.copyValue);
    const deliveryPinId = deliveryEvent ? deliveryEvent.pin.copyValue : '';
    const handoffCommands = ['metabot loom state ' + shellArg(detail.taskPinId) + ' --refresh' + fromArg];
    if (deliveryPinId) {
      handoffCommands.push('metabot loom accept-and-pay --task-pin-id ' + shellArg(detail.taskPinId) + ' --delivery-pin-id ' + shellArg(deliveryPinId) + ' --score 5 --comment "accepted" --confirm-payment' + fromArg);
      handoffCommands.push('metabot loom review-delivery --task-pin-id ' + shellArg(detail.taskPinId) + ' --delivery-pin-id ' + shellArg(deliveryPinId) + ' --verdict revision_needed --score 3 --comment "needs revision"' + fromArg);
    }
    const localEvidence = detail.localWorkflow.length ? detail.localWorkflow.map((workflow) => (
      '<div class="loom-local-evidence">' +
      '<div><strong>' + esc(workflow.developerMetaBotSlug || 'Local workflow') + '</strong></div>' +
      (workflow.branchName ? '<p>Branch: <code>' + esc(workflow.branchName) + '</code></p>' : '') +
      (workflow.workspacePath ? '<p>Workspace: <code>' + esc(workflow.workspacePath) + '</code></p>' : '') +
      (workflow.llmSessionIds.length ? '<p>LLM sessions: ' + workflow.llmSessionIds.map((sessionId) => '<code>' + esc(sessionId) + '</code>').join(' ') + '</p>' : '') +
      (workflow.processLogPaths.length ? '<p>Process logs: ' + workflow.processLogPaths.map((logPath) => '<code>' + esc(logPath) + '</code>').join(' ') + '</p>' : '') +
      (workflow.processLogUris.length ? '<p>Uploaded logs: ' + workflow.processLogUris.map((uri) => safeExternalLink(uri, uri, '')).join(' ') + '</p>' : '') +
      renderCommitEvidence(workflow.commits) +
      '</div>'
    )).join('') : '';
    setHtml(elements.detail,
      '<div class="loom-detail-head">' +
      '<div><span class="loom-kicker">Selected task</span><h2>' + esc(detail.title) + '</h2><div class="loom-detail-actors">' + botInline(detail.requester, 'Requester') + (headerDeveloper ? botInline(headerDeveloper, 'Developer') : '<div class="loom-bot loom-bot-empty">No developer claim</div>') + '</div></div>' +
      '<span class="loom-state" data-tone="' + esc(card.stateTone) + '">' + esc(detail.stateLabel) + '</span>' +
      '</div>' +
      '<div class="loom-detail-copy"><code>' + esc(detail.taskPin.label) + '</code>' + copyButton('Copy task pin', detail.taskPin.copyValue) + '</div>' +
      '<section class="loom-detail-section"><h3>Requirement</h3><p>' + esc(detail.requirement || 'No requirement text available.') + '</p><h3>Acceptance criteria</h3><p>' + esc(detail.criteria || 'No acceptance criteria available.') + '</p></section>' +
      renderRepositorySection(card) +
      '<section class="loom-detail-section"><h3>Bot identities</h3><div class="loom-identity-grid">' + botInline(detail.requester, 'Requester') + (headerDeveloper ? botInline(headerDeveloper, 'Developer') : '<div class="loom-bot loom-bot-empty">No developer claim</div>') + '</div></section>' +
      '<section class="loom-detail-section"><h3>Claims</h3>' + (detail.claims.length ? detail.claims.map((claim) => '<div class="loom-claim"><strong>' + esc(claim.developer.displayName) + (claim.active ? ' · active' : '') + '</strong><p>' + esc(claim.message || 'No claim message.') + '</p><div class="loom-claim-meta">' + (claim.developer.globalMetaId ? '<span>GMID: <code>' + esc(claim.developer.globalMetaId) + '</code></span>' : '') + (claim.developer.address ? '<span>Address: <code>' + esc(claim.developer.address) + '</code></span>' : '') + (claim.payoutAddress ? '<span>Payout: <code>' + esc(claim.payoutAddress) + '</code></span>' : '') + '</div><div class="loom-inline-copy"><code>' + esc(claim.pin.label) + '</code>' + copyButton('Copy claim pin', claim.pin.copyValue) + '</div></div>').join('') : '<p>No claims yet.</p>') + '</section>' +
      '<section class="loom-detail-section"><h3>Warnings</h3>' + (detail.warnings.length ? '<ul class="loom-warning-list">' + detail.warnings.map((warning) => '<li><strong>' + esc(warning.code || warning.protocol || 'warning') + '</strong><p>' + esc(warning.message) + '</p><div class="loom-inline-copy"><code>' + esc(warning.pin.label) + '</code>' + copyButton('Copy warning pin', warning.pin.copyValue) + '</div></li>').join('') + '</ul>' : '<p>No warnings for this task.</p>') + '</section>' +
      (localEvidence ? '<section class="loom-detail-section"><h3>Local evidence</h3>' + localEvidence + '</section>' : '') +
      renderStatusRecords(detail.validRecords.statuses) +
      renderDeliveryRecords(detail.validRecords.deliveries) +
      renderAcceptanceRecords(detail.validRecords.acceptances) +
      renderClaimRejectRecords(detail.validRecords.claimRejects) +
      '<section class="loom-detail-section"><h3>Handoffs</h3><div class="loom-handoff">' +
      (card.prUrl ? safeExternalLink(card.prUrl, isHttpUrl(card.prUrl) ? 'Open PR ↗' : card.prUrl, '') : '') +
      (card.paymentTxId.copyValue ? '<div class="loom-inline-copy"><code>' + esc(card.paymentTxId.label) + '</code>' + copyButton('Copy payment txid', card.paymentTxId.copyValue) + '</div>' : '') +
      handoffCommands.map((command) => '<div class="loom-inline-copy"><code>' + esc(command) + '</code>' + copyButton('Copy CLI', command) + '</div>').join('') +
      '</div></section>' +
      '<section class="loom-detail-section"><h3>Timeline</h3><ol class="loom-timeline">' + renderTimeline(detail) + '</ol></section>'
    );
    bindCopyActions(elements.detail);
  };
  const bindCopyActions = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-loom-copy]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        const value = button.getAttribute('data-loom-copy') || '';
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(value);
          }
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Copy failed';
        }
      });
    });
  };
  const bindBoardActions = () => {
    bindCopyActions(elements.board);
    if (!elements.board || !elements.board.querySelectorAll) return;
    elements.board.querySelectorAll('[data-loom-card]').forEach((card) => {
      const select = () => {
        selectedTaskPinId = card.getAttribute('data-loom-card') || '';
        renderBoard();
        renderDetail();
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') select();
      });
    });
  };
  const render = (payload) => {
    currentModel = buildModel(payload);
    if (!selectedTaskPinId || !currentModel.cards.some((card) => card.taskPinId === selectedTaskPinId)) {
      selectedTaskPinId = currentModel.cards[0] ? currentModel.cards[0].taskPinId : '';
    }
    setText(elements.actor, currentModel.actor.displayLabel);
    setText(elements.updated, currentModel.refresh.updatedLabel);
    setText(elements.staleWarning, currentModel.refresh.warningLabel);
    setStatus(currentModel.cards.length ? 'Dashboard loaded.' : 'No Loom tasks found.', 'ready');
    setText(elements.error, '');
    renderMetrics();
    renderBoard();
    renderDetail();
  };
  const dashboardRequestParams = () => {
    const params = new URLSearchParams();
    const from = fromQuery();
    const state = elements.stateFilter ? text(elements.stateFilter.value) : '';
    const role = elements.roleFilter ? text(elements.roleFilter.value) : '';
    const query = elements.queryFilter ? text(elements.queryFilter.value) : '';
    if (from) params.set('from', from);
    if (state) params.set('state', state);
    if (role) params.set('role', role);
    if (query) params.set('query', query);
    return params;
  };
  const dashboardUrl = () => {
    const params = dashboardRequestParams();
    return '/api/loom/dashboard' + (params.toString() ? '?' + params.toString() : '');
  };
  const loadDashboard = async () => {
    setStatus('Loading dashboard...', 'busy');
    try {
      const response = await fetch(dashboardUrl(), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(text(payload.message) || 'Loom dashboard load failed.');
      render(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setText(elements.error, message);
      setStatus(message, 'error');
    }
  };
  const refreshDashboard = async () => {
    if (elements.refresh) elements.refresh.disabled = true;
    setStatus('Refreshing dashboard...', 'busy');
    try {
      const body = Object.fromEntries(dashboardRequestParams().entries());
      const response = await fetch('/api/loom/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(text(payload.message) || 'Loom dashboard refresh failed.');
      render(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setText(elements.error, message);
      setStatus(message, 'error');
    } finally {
      if (elements.refresh) elements.refresh.disabled = false;
    }
  };

  [elements.stateFilter, elements.roleFilter].forEach((filter) => {
    if (filter) filter.addEventListener('change', loadDashboard);
  });
  if (elements.queryFilter) elements.queryFilter.addEventListener('input', loadDashboard);
  if (elements.refresh) elements.refresh.addEventListener('click', refreshDashboard);
  loadDashboard();
})();`;
}
