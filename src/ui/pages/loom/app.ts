import type { LocalUiPageDefinition } from '../types';

export function buildLoomPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'loom',
    title: 'Loom Board',
    eyebrow: 'Loom Board',
    heading: 'MetaBot Loom task board',
    description: 'Inspect Loom tasks, claims, deliveries, warnings, and operator handoffs from the local dashboard cache.',
    panels: [],
    contentHtml: `
      <section class="loom-shell" data-loom-shell>
        <section class="loom-board-shell" aria-label="Loom board">
        <section class="loom-toolbar" aria-label="Loom board controls">
          <div class="loom-toolbar-main">
            <div class="loom-title-block">
              <h1>Loom</h1>
              <span class="loom-scope-label" data-loom-scope-label>Global</span>
            </div>
            <div class="loom-toolbar-actions">
              <button type="button" class="loom-action-button" data-loom-new-task title="New task">New task</button>
              <button type="button" class="loom-icon-button loom-refresh" data-loom-refresh title="Refresh dashboard" aria-label="Refresh dashboard">↻</button>
            </div>
          </div>
          <div class="loom-filters" aria-label="Loom board filters" hidden>
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
            <span class="loom-context-warning" data-loom-stale-warning></span>
            <span data-loom-error></span>
          </div>
        </section>

        <section class="loom-metrics" data-loom-metrics aria-label="Loom dashboard metrics"></section>

        <section class="loom-workspace">
          <div class="loom-board" data-loom-board aria-label="Loom task board"></div>
        </section>
        </section>
        <div class="loom-detail-modal" data-loom-detail-modal hidden>
          <section class="loom-detail-dialog" data-loom-detail-dialog role="dialog" aria-modal="true" aria-labelledby="loom-detail-title" tabindex="-1">
            <header class="loom-modal-head">
              <div>
                <span class="loom-kicker">Selected task</span>
                <h2 id="loom-detail-title" data-loom-detail-title>Loom task detail</h2>
              </div>
              <button type="button" class="loom-icon-button loom-detail-close" data-loom-detail-close aria-label="Close task detail">×</button>
            </header>
            <div class="loom-modal-grid">
              <div class="loom-detail-body" data-loom-detail-body></div>
              <aside class="loom-detail-actions" data-loom-detail-actions aria-label="Task actions"></aside>
            </div>
          </section>
        </div>
        <div class="loom-new-task-modal" data-loom-new-task-modal hidden>
          <section class="loom-new-task-dialog" data-loom-new-task-dialog role="dialog" aria-modal="true" aria-labelledby="loom-new-task-title" tabindex="-1">
            <header class="loom-modal-head">
              <div>
                <span class="loom-kicker">Publish task</span>
                <h2 id="loom-new-task-title">New Loom task</h2>
              </div>
              <button type="button" class="loom-icon-button loom-detail-close" data-loom-new-task-close aria-label="Close new task">×</button>
            </header>
            <form class="loom-new-task-form" data-loom-new-task-form>
              <div class="loom-new-task-fields">
                <label><span>From</span><input data-loom-new-task-from name="from" autocomplete="off" /></label>
                <label><span>Title</span><input data-loom-new-task-title name="title" autocomplete="off" /></label>
                <label class="loom-field-wide"><span>Requirement</span><textarea data-loom-new-task-requirement name="requirement" rows="5"></textarea></label>
                <label><span>Requirement type</span><select data-loom-new-task-requirement-content-type name="requirementContentType"><option value="text/markdown">text/markdown</option></select></label>
                <label class="loom-field-wide"><span>Criteria</span><textarea data-loom-new-task-criteria name="criteria" rows="4"></textarea></label>
                <label><span>Criteria type</span><select data-loom-new-task-criteria-content-type name="criteriaContentType"><option value="text/markdown">text/markdown</option></select></label>
                <label class="loom-field-wide"><span>Repo URI</span><input data-loom-new-task-repo-uri name="repoUri" autocomplete="off" /></label>
                <label><span>Project base</span><select data-loom-new-task-project-base name="projectBase"><option value="github">github</option></select></label>
                <label><span>Base branch</span><input data-loom-new-task-base-branch name="baseBranch" value="main" autocomplete="off" /></label>
                <label><span>Bounty amount</span><input data-loom-new-task-bounty-amount name="bountyAmount" inputmode="decimal" autocomplete="off" /></label>
                <label><span>Currency</span><select data-loom-new-task-currency name="currency"><option value="SPACE">SPACE</option><option value="BTC">BTC</option><option value="DOGE">DOGE</option><option value="OPCAT">OPCAT</option></select></label>
                <label><span>Deadline</span><input data-loom-new-task-deadline name="deadline" type="datetime-local" /></label>
                <label class="loom-field-wide"><span>Tags</span><input data-loom-new-task-tags name="tags" autocomplete="off" /></label>
                <label class="loom-field-wide"><span>Attachments</span><textarea data-loom-new-task-attachments name="attachments" rows="3"></textarea></label>
              </div>
              <div class="loom-new-task-summary" data-loom-new-task-summary></div>
              <div class="loom-new-task-error" data-loom-new-task-error role="alert" aria-live="polite"></div>
              <footer class="loom-new-task-actions">
                <button type="submit" class="loom-action-button" data-loom-new-task-preview>Preview</button>
                <button type="button" class="loom-action-button" data-loom-new-task-confirm disabled>Confirm publish</button>
              </footer>
            </form>
          </section>
        </div>
      </section>
    `,
    script: buildLoomPageScript(),
  };
}

export function buildLoomPageScript(): string {
  return `(() => {
  const elements = {
    status: document.querySelector('[data-loom-status]'),
    refresh: document.querySelector('[data-loom-refresh]'),
    newTask: document.querySelector('[data-loom-new-task]'),
    scopeLabel: document.querySelector('[data-loom-scope-label]'),
    staleWarning: document.querySelector('[data-loom-stale-warning]'),
    stateFilter: document.querySelector('[data-loom-state-filter]'),
    roleFilter: document.querySelector('[data-loom-role-filter]'),
    queryFilter: document.querySelector('[data-loom-query-filter]'),
    metrics: document.querySelector('[data-loom-metrics]'),
    board: document.querySelector('[data-loom-board]'),
    detailModal: document.querySelector('[data-loom-detail-modal]'),
    detailDialog: document.querySelector('[data-loom-detail-dialog]'),
    detailTitle: document.querySelector('[data-loom-detail-title]'),
    detailBody: document.querySelector('[data-loom-detail-body]'),
    detailActions: document.querySelector('[data-loom-detail-actions]'),
    detailClose: document.querySelector('[data-loom-detail-close]'),
    newTaskModal: document.querySelector('[data-loom-new-task-modal]'),
    newTaskDialog: document.querySelector('[data-loom-new-task-dialog]'),
    newTaskForm: document.querySelector('[data-loom-new-task-form]'),
    newTaskClose: document.querySelector('[data-loom-new-task-close]'),
    newTaskFrom: document.querySelector('[data-loom-new-task-from]'),
    newTaskTitle: document.querySelector('[data-loom-new-task-title]'),
    newTaskRequirement: document.querySelector('[data-loom-new-task-requirement]'),
    newTaskRequirementContentType: document.querySelector('[data-loom-new-task-requirement-content-type]'),
    newTaskCriteria: document.querySelector('[data-loom-new-task-criteria]'),
    newTaskCriteriaContentType: document.querySelector('[data-loom-new-task-criteria-content-type]'),
    newTaskRepoUri: document.querySelector('[data-loom-new-task-repo-uri]'),
    newTaskProjectBase: document.querySelector('[data-loom-new-task-project-base]'),
    newTaskBaseBranch: document.querySelector('[data-loom-new-task-base-branch]'),
    newTaskBountyAmount: document.querySelector('[data-loom-new-task-bounty-amount]'),
    newTaskCurrency: document.querySelector('[data-loom-new-task-currency]'),
    newTaskDeadline: document.querySelector('[data-loom-new-task-deadline]'),
    newTaskTags: document.querySelector('[data-loom-new-task-tags]'),
    newTaskAttachments: document.querySelector('[data-loom-new-task-attachments]'),
    newTaskPreview: document.querySelector('[data-loom-new-task-preview]'),
    newTaskConfirm: document.querySelector('[data-loom-new-task-confirm]'),
    newTaskSummary: document.querySelector('[data-loom-new-task-summary]'),
    newTaskError: document.querySelector('[data-loom-new-task-error]'),
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
  let selectedCardElement = null;
  let previewedNewTask = null;

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
  const firstText = (...values) => values.map(text).find(Boolean) || '';
  const nestedTaskPinId = (value, seen) => {
    const stack = seen || [];
    if (!value || typeof value !== 'object' || stack.includes(value)) return '';
    const nextSeen = [...stack, value];
    const direct = firstText(value.taskPinId, value.pinId);
    if (direct) return direct;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = nestedTaskPinId(item, nextSeen);
        if (found) return found;
      }
      return '';
    }
    for (const key of ['task', 'record', 'write', 'chainWrite', 'published', 'result', 'data', 'chain', 'dashboardAfterAction']) {
      const found = nestedTaskPinId(value[key], nextSeen);
      if (found) return found;
    }
    return '';
  };
  const taskPinIdFromActionResult = (result) => {
    const root = obj(result);
    const data = obj(root.data);
    return firstText(data.taskPinId, root.taskPinId, data.pinId, root.pinId)
      || nestedTaskPinId(data)
      || nestedTaskPinId(root);
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
  const fieldValue = (target) => target ? text(target.value) : '';
  const setFieldValue = (target, value) => {
    if (target) target.value = value;
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
  const previewText = (...values) => {
    const normalized = values.map(text).find(Boolean) || '';
    return normalized.length <= 96 ? normalized : normalized.slice(0, 93).trimEnd() + '...';
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
  const cardModel = (value, hasActor) => {
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
      summaryPreview: previewText(card.latestStatusSummary, card.summary, card.description),
      activityLabel: num(card.updatedAt) ? 'updated ' + relativeTime(num(card.updatedAt)) : '',
      latestStatusSummary: text(card.latestStatusSummary),
      prUrl: text(card.prUrl),
      paymentTxId: compact(card.paymentTxId),
      activeClaimCount: num(card.activeClaimCount),
      warningCount,
      warningLabel: countLabel(warningCount, 'warning', 'warnings'),
      actionLabel: hasActor && obj(card.actorContext).needsMyAction === true ? 'Needs my action' : '',
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
    const actor = obj(dashboard.actor);
    const actorModel = {
      profileSlug: text(actor.profileSlug),
      displayLabel: text(actor.profileSlug) || compact(actor.globalMetaId).label || compact(actor.address).label || 'Global Loom',
      globalMetaId: compact(actor.globalMetaId),
      address: compact(actor.address),
    };
    const hasActor = Boolean(actorModel.profileSlug || actorModel.globalMetaId.copyValue || actorModel.address.copyValue);
    const cardsFromTasks = arr(dashboard.tasks).map((card) => cardModel(card, hasActor)).filter(Boolean);
    const cardsFromColumns = rawColumns.flatMap((column) => arr(obj(column).cards)).map((card) => cardModel(card, hasActor)).filter(Boolean);
    const cards = cardsFromTasks.length ? cardsFromTasks : cardsFromColumns;
    const cardsByColumn = new Map();
    rawColumns.forEach((column) => {
      const columnObj = obj(column);
      const columnCards = arr(columnObj.cards).map((card) => cardModel(card, hasActor)).filter(Boolean);
      if (columnCards.length) cardsByColumn.set(text(columnObj.id), columnCards);
    });
    cards.forEach((card) => {
      if (!cardsByColumn.has(card.columnId)) {
        cardsByColumn.set(card.columnId, cards.filter((entry) => entry.columnId === card.columnId));
      }
    });
    const refresh = obj(dashboard.refresh);
    const updatedAt = num(refresh.updatedAt) || num(dashboard.updatedAt);
    const warning = text(refresh.warning) || (updatedAt && Date.now() - updatedAt > 900000 ? 'Dashboard data may be stale.' : '');
    return {
      actor: actorModel,
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
  const participantBlock = (bot, label, payoutAddress) => {
    if (!bot) return '<div class="loom-bot loom-bot-empty">No ' + esc(label.toLowerCase()) + '</div>';
    return '<div class="loom-participant">' +
      botInline(bot, label) +
      '<div class="loom-participant-meta">' +
      (bot.globalMetaId ? '<span>GMID: <code>' + esc(bot.globalMetaId) + '</code></span>' : '') +
      (bot.address ? '<span>Address: <code>' + esc(bot.address) + '</code></span>' : '') +
      (payoutAddress ? '<span>Payout: <code>' + esc(payoutAddress) + '</code></span>' : '') +
      '</div>' +
      '</div>';
  };
  const renderMetrics = () => {
    const visibleMetrics = currentModel.summary.metrics.filter((metric) => (
      ['totalTasks', 'open', 'working', 'review', 'revision', 'invalidRecords'].includes(metric[0])
    ));
    setHtml(elements.metrics, visibleMetrics.map((metric) => (
      '<article class="loom-metric" data-tone="' + (metric[3] ? 'warning' : 'neutral') + '">' +
      '<span>' + esc(metric[1]) + '</span>' +
      '<strong>' + esc(metric[0] === 'totalTasks' ? countLabel(Number(metric[2]), 'task', 'tasks') : Number(metric[2]).toLocaleString('en-US')) + '</strong>' +
      '</article>'
    )).join(''));
  };
  const renderCard = (card) => (
    '<article class="loom-task-card' + (card.taskPinId === selectedTaskPinId ? ' is-selected' : '') + '" data-loom-card="' + esc(card.taskPinId) + '" tabindex="0">' +
    '<div class="loom-card-top"><h3>' + esc(card.title) + '</h3><span class="loom-state" data-tone="' + esc(card.stateTone) + '">' + esc(card.stateLabel) + '</span></div>' +
    (card.summaryPreview ? '<p>' + esc(card.summaryPreview) + '</p>' : '') +
    '<div class="loom-card-bots">' + botInline(card.requester, 'Requester') + (card.developer ? botInline(card.developer, 'Developer') : '<div class="loom-bot loom-bot-empty">No developer claim</div>') + '</div>' +
    '<div class="loom-card-footer">' +
    (card.activityLabel ? '<span class="loom-chip">' + esc(card.activityLabel) + '</span>' : '') +
    (card.actionLabel ? '<span class="loom-chip warning">' + esc(card.actionLabel) + '</span>' : '') +
    (card.warningCount ? '<span class="loom-chip warning">' + esc(card.warningLabel) + '</span>' : '') +
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
      '<header><h2>' + esc(column.title) + '</h2><span>' + esc(countLabel(column.cards.length, 'task', 'tasks')) + '</span></header>' +
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
  const renderRawRecordIndex = (detail) => {
    const groups = [
      ['Status', detail.validRecords.statuses],
      ['Delivery', detail.validRecords.deliveries],
      ['Acceptance', detail.validRecords.acceptances],
      ['Claim reject', detail.validRecords.claimRejects],
    ];
    const rows = groups.flatMap(([label, records]) => records.map((record) => {
      const payload = obj(record.payload);
      const summary = label === 'Claim reject' ? text(payload.reason) : '';
      return '<li><strong>' + esc(label) + '</strong>' +
        (summary ? '<p>' + esc(summary) + '</p>' : '') +
        renderRecordPin(record) +
        renderRecordAuthor(record) +
        '</li>';
    }));
    return rows.length ? '<ul class="loom-raw-index">' + rows.join('') + '</ul>' : '<p>No raw records available.</p>';
  };
  const normalizeList = (value) => {
    const seen = new Set();
    return String(value || '').split(/[,\\n]/u).map((entry) => entry.trim()).filter(Boolean).filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const validateBountyAmount = (value) => /^(?:[1-9]\\d*(?:\\.\\d+)?|0?\\.\\d+)$/u.test(value) && Number(value) > 0;
  const allowedCurrencies = ['SPACE', 'BTC', 'DOGE', 'OPCAT'];
  const validAttachmentUri = (value) => {
    const uri = text(value);
    return uri.startsWith('metafile://') && uri.slice('metafile://'.length).trim().length > 0;
  };
  const newTaskPreviewKey = (entry) => JSON.stringify({ from: entry.from, payload: entry.payload });
  const newTaskPayload = () => {
    const from = fieldValue(elements.newTaskFrom);
    const title = fieldValue(elements.newTaskTitle);
    const requirement = fieldValue(elements.newTaskRequirement);
    const requirementContentType = fieldValue(elements.newTaskRequirementContentType) || 'text/markdown';
    const criteria = fieldValue(elements.newTaskCriteria);
    const criteriaContentType = fieldValue(elements.newTaskCriteriaContentType) || 'text/markdown';
    const repoUri = fieldValue(elements.newTaskRepoUri);
    const projectBase = fieldValue(elements.newTaskProjectBase) || 'github';
    const baseBranch = fieldValue(elements.newTaskBaseBranch) || 'main';
    const amount = fieldValue(elements.newTaskBountyAmount);
    const currency = fieldValue(elements.newTaskCurrency);
    const deadlineValue = fieldValue(elements.newTaskDeadline);
    const tags = normalizeList(elements.newTaskTags ? elements.newTaskTags.value : '');
    const attachments = normalizeList(elements.newTaskAttachments ? elements.newTaskAttachments.value : '');
    const errors = [];
    [
      ['From', from],
      ['Title', title],
      ['Requirement', requirement],
      ['Criteria', criteria],
      ['Repo URI', repoUri],
      ['Base branch', baseBranch],
      ['Bounty amount', amount],
      ['Currency', currency],
    ].forEach(([label, value]) => {
      if (!value) errors.push(label + ' is required.');
    });
    if (amount && !validateBountyAmount(amount)) errors.push('Bounty amount must be a positive decimal.');
    if (currency && !allowedCurrencies.includes(currency)) errors.push('Currency must be SPACE, BTC, DOGE, or OPCAT.');
    if (attachments.some((uri) => !validAttachmentUri(uri))) errors.push('Attachments must use metafile:// URIs with a non-empty suffix.');
    const payload = {
      title,
      requirementContentType,
      requirement,
      criteriaContentType,
      criteria,
      projectBase,
      project: { repoUri, baseBranch },
      bounty: { amount, currency },
    };
    if (deadlineValue) {
      const deadline = Date.parse(deadlineValue);
      if (Number.isFinite(deadline)) payload.deadline = deadline;
      else errors.push('Deadline must be a valid date.');
    }
    if (tags.length) payload.tags = tags;
    if (attachments.length && !attachments.some((uri) => !validAttachmentUri(uri))) payload.attachments = attachments;
    return { from, payload, errors };
  };
  const actionErrorMessage = (payload, fallback) => {
    const root = obj(payload);
    return text(root.message) || text(root.code) || fallback;
  };
  const renderNewTaskSummary = (from, payload, result) => {
    const root = obj(result);
    const data = obj(root.data);
    const preview = obj(data.preview);
    const chain = obj(data.chain || preview.chain);
    const cliFallback = text(data.cliFallback) || text(preview.cliFallback);
    setHtml(elements.newTaskSummary,
      '<section class="loom-new-task-confirmation">' +
      '<h3>Preview</h3>' +
      '<dl>' +
      '<div><dt>Actor</dt><dd>' + esc(from) + '</dd></div>' +
      '<div><dt>Title</dt><dd>' + esc(payload.title) + '</dd></div>' +
      '<div><dt>Repo</dt><dd>' + esc(repoLabel(payload.project)) + '</dd></div>' +
      '<div><dt>Bounty</dt><dd>' + esc(payload.bounty.amount + ' ' + payload.bounty.currency) + '</dd></div>' +
      (chain.path ? '<div><dt>Chain</dt><dd>' + esc(chain.path) + '</dd></div>' : '') +
      (chain.txId ? '<div><dt>Tx</dt><dd>' + esc(chain.txId) + '</dd></div>' : '') +
      (cliFallback ? '<div><dt>CLI</dt><dd><code>' + esc(cliFallback) + '</code></dd></div>' : '') +
      '</dl>' +
      '</section>'
    );
  };
  const resetNewTaskPreview = () => {
    previewedNewTask = null;
    if (elements.newTaskConfirm) elements.newTaskConfirm.disabled = true;
    setHtml(elements.newTaskSummary, '');
  };
  const openNewTaskModal = () => {
    resetNewTaskPreview();
    setText(elements.newTaskError, '');
    setFieldValue(elements.newTaskFrom, fieldValue(elements.newTaskFrom) || fromQuery());
    setFieldValue(elements.newTaskBaseBranch, fieldValue(elements.newTaskBaseBranch) || 'main');
    setFieldValue(elements.newTaskCurrency, fieldValue(elements.newTaskCurrency) || 'SPACE');
    setFieldValue(elements.newTaskRequirementContentType, fieldValue(elements.newTaskRequirementContentType) || 'text/markdown');
    setFieldValue(elements.newTaskCriteriaContentType, fieldValue(elements.newTaskCriteriaContentType) || 'text/markdown');
    setFieldValue(elements.newTaskProjectBase, fieldValue(elements.newTaskProjectBase) || 'github');
    if (elements.newTaskModal) {
      elements.newTaskModal.hidden = false;
      elements.newTaskModal.dataset.state = 'open';
    }
    if (elements.newTaskDialog && elements.newTaskDialog.focus) elements.newTaskDialog.focus();
  };
  const closeNewTaskModal = (returnFocus) => {
    if (elements.newTaskModal) {
      elements.newTaskModal.hidden = true;
      elements.newTaskModal.dataset.state = 'closed';
    }
    if (returnFocus !== false && elements.newTask && elements.newTask.focus) elements.newTask.focus();
  };
  const postNewTaskAction = async (confirm) => {
    const current = newTaskPayload();
    setText(elements.newTaskError, '');
    if (current.errors.length) {
      setText(elements.newTaskError, current.errors.join(' '));
      resetNewTaskPreview();
      return;
    }
    if (confirm && !previewedNewTask) return;
    if (confirm && previewedNewTask.previewKey !== newTaskPreviewKey(current)) {
      resetNewTaskPreview();
      return;
    }
    const next = confirm ? previewedNewTask : current;
    const button = confirm ? elements.newTaskConfirm : elements.newTaskPreview;
    if (button) button.disabled = true;
    try {
      const body = { action: 'postTask', from: next.from, confirm: Boolean(confirm), payload: next.payload };
      const response = await fetch('/api/loom/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(actionErrorMessage(result, confirm ? 'Task publish failed.' : 'Task preview failed.'));
      renderNewTaskSummary(next.from, next.payload, result);
      if (confirm) {
        const taskPinId = taskPinIdFromActionResult(result);
        await refreshDashboard();
        const selectedPublishedTask = taskPinId ? selectDashboardTask(taskPinId) : false;
        closeNewTaskModal(!selectedPublishedTask);
        setStatus('Task published.', 'ready');
        return;
      }
      previewedNewTask = { ...next, previewKey: newTaskPreviewKey(next) };
      if (elements.newTaskConfirm) elements.newTaskConfirm.disabled = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setText(elements.newTaskError, message);
    } finally {
      if (button) button.disabled = false;
      if (!confirm && previewedNewTask && elements.newTaskConfirm) elements.newTaskConfirm.disabled = false;
    }
  };
  const closeDetailModal = (returnFocus) => {
    if (elements.detailModal) {
      elements.detailModal.hidden = true;
      elements.detailModal.dataset.state = 'closed';
    }
    if (returnFocus !== false && selectedCardElement && selectedCardElement.focus) {
      selectedCardElement.focus();
    }
  };
  const renderDetailModal = () => {
    const detail = currentModel.details.find((entry) => entry.taskPinId === selectedTaskPinId) || null;
    const card = currentModel.cards.find((entry) => entry.taskPinId === selectedTaskPinId) || null;
    if (!detail || !card) {
      setHtml(elements.detailBody, '');
      setHtml(elements.detailActions, '');
      closeDetailModal(false);
      return false;
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
    setText(elements.detailTitle, detail.title);
    setHtml(elements.detailBody,
      '<div class="loom-detail-head">' +
      '<div><span class="loom-kicker">State</span><h2>' + esc(detail.title) + '</h2><div class="loom-detail-actors">' + botInline(detail.requester, 'Requester') + (headerDeveloper ? botInline(headerDeveloper, 'Developer') : '<div class="loom-bot loom-bot-empty">No developer claim</div>') + '</div></div>' +
      '<span class="loom-state" data-tone="' + esc(card.stateTone) + '">' + esc(detail.stateLabel) + '</span>' +
      '</div>' +
      '<div class="loom-detail-copy"><code>' + esc(detail.taskPin.label) + '</code>' + copyButton('Copy task pin', detail.taskPin.copyValue) + '</div>' +
      '<section class="loom-detail-section"><h3>State explanation</h3><p>' + esc(card.latestStatusSummary || detail.stateLabel || 'No state summary available.') + '</p></section>' +
      '<section class="loom-detail-section"><h3>Requirement</h3><p>' + esc(detail.requirement || 'No requirement text available.') + '</p><h3>Acceptance criteria</h3><p>' + esc(detail.criteria || 'No acceptance criteria available.') + '</p></section>' +
      renderRepositorySection(card) +
      '<section class="loom-detail-section"><h3>Participants</h3><div class="loom-identity-grid">' + participantBlock(detail.requester, 'Requester', '') + participantBlock(headerDeveloper, 'Developer', activeClaim ? activeClaim.payoutAddress : '') + '</div></section>' +
      '<section class="loom-detail-section"><h3>Claims</h3>' + (detail.claims.length ? detail.claims.map((claim) => '<div class="loom-claim"><strong>' + esc(claim.developer.displayName) + (claim.active ? ' · active' : '') + '</strong><p>' + esc(claim.message || 'No claim message.') + '</p><div class="loom-claim-meta">' + (claim.developer.globalMetaId ? '<span>GMID: <code>' + esc(claim.developer.globalMetaId) + '</code></span>' : '') + (claim.developer.address ? '<span>Address: <code>' + esc(claim.developer.address) + '</code></span>' : '') + (claim.payoutAddress ? '<span>Payout: <code>' + esc(claim.payoutAddress) + '</code></span>' : '') + '</div><div class="loom-inline-copy"><code>' + esc(claim.pin.label) + '</code>' + copyButton('Copy claim pin', claim.pin.copyValue) + '</div></div>').join('') : '<p>No claims yet.</p>') + '</section>' +
      '<section class="loom-detail-section"><h3>Delivery</h3>' + (detail.validRecords.deliveries.length ? renderDeliveryRecords(detail.validRecords.deliveries) : '<p>No delivery record yet.</p>') + '</section>' +
      '<section class="loom-detail-section"><h3>Payment</h3>' + (card.paymentTxId.copyValue ? '<div class="loom-inline-copy"><code>' + esc(card.paymentTxId.label) + '</code>' + copyButton('Copy payment txid', card.paymentTxId.copyValue) + '</div>' : '<p>No payment transaction recorded.</p>') + renderAcceptanceRecords(detail.validRecords.acceptances) + '</section>' +
      '<section class="loom-detail-section"><h3>Process evidence</h3>' + (localEvidence || '<p>No local process evidence recorded.</p>') + renderStatusRecords(detail.validRecords.statuses) + '</section>' +
      '<section class="loom-detail-section"><h3>Timeline</h3><ol class="loom-timeline">' + renderTimeline(detail) + '</ol></section>' +
      '<section class="loom-detail-section"><h3>Warnings</h3>' + (detail.warnings.length ? '<ul class="loom-warning-list">' + detail.warnings.map((warning) => '<li><strong>' + esc(warning.code || warning.protocol || 'warning') + '</strong><p>' + esc(warning.message) + '</p><div class="loom-inline-copy"><code>' + esc(warning.pin.label) + '</code>' + copyButton('Copy warning pin', warning.pin.copyValue) + '</div></li>').join('') + '</ul>' : '<p>No warnings for this task.</p>') + '</section>' +
      '<section class="loom-detail-section"><h3>Raw records</h3>' +
      renderRawRecordIndex(detail) +
      '</section>'
    );
    setHtml(elements.detailActions,
      '<section class="loom-detail-section"><h3>Action panel</h3><p>' + esc(card.actionLabel || detail.stateLabel || 'No operator action selected.') + '</p></section>' +
      '<section class="loom-detail-section"><h3>CLI fallback</h3><div class="loom-handoff">' +
      (card.prUrl ? safeExternalLink(card.prUrl, isHttpUrl(card.prUrl) ? 'Open PR ↗' : card.prUrl, '') : '') +
      handoffCommands.map((command) => '<div class="loom-inline-copy"><code>' + esc(command) + '</code>' + copyButton('Copy CLI', command) + '</div>').join('') +
      '</div></section>'
    );
    bindCopyActions(elements.detailBody);
    bindCopyActions(elements.detailActions);
    return true;
  };
  const openDetailModal = (taskPinId, cardElement) => {
    selectedTaskPinId = taskPinId;
    selectedCardElement = cardElement || selectedCardElement;
    if (!renderDetailModal()) return;
    if (elements.detailModal) {
      elements.detailModal.hidden = false;
      elements.detailModal.dataset.state = 'open';
    }
    if (elements.detailDialog && elements.detailDialog.focus) elements.detailDialog.focus();
  };
  const renderedCardElement = (taskPinId) => {
    if (!elements.board || !elements.board.querySelectorAll) return null;
    return Array.from(elements.board.querySelectorAll('[data-loom-card]'))
      .find((card) => (card.getAttribute('data-loom-card') || '') === taskPinId) || null;
  };
  const selectDashboardTask = (taskPinId) => {
    const id = text(taskPinId);
    if (!id || !currentModel.cards.some((card) => card.taskPinId === id)) return false;
    selectedTaskPinId = id;
    renderBoard();
    const cardElement = renderedCardElement(id);
    if (cardElement) selectedCardElement = cardElement;
    if (currentModel.details.some((detail) => detail.taskPinId === id)) {
      openDetailModal(id, cardElement);
    } else {
      closeDetailModal(false);
      if (cardElement && cardElement.focus) cardElement.focus();
    }
    return true;
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
        openDetailModal(card.getAttribute('data-loom-card') || '', card);
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (event.preventDefault) event.preventDefault();
          select();
        }
      });
    });
  };
  const render = (payload) => {
    currentModel = buildModel(payload);
    if (selectedTaskPinId && !currentModel.cards.some((card) => card.taskPinId === selectedTaskPinId)) closeDetailModal(false);
    setText(elements.scopeLabel, fromQuery() ? 'From ' + fromQuery() : 'Global');
    setText(elements.staleWarning, currentModel.refresh.warningLabel);
    setStatus(currentModel.cards.length ? 'Dashboard loaded.' : 'No Loom tasks found.', 'ready');
    setText(elements.error, '');
    renderMetrics();
    renderBoard();
    if (elements.detailModal && !elements.detailModal.hidden && selectedTaskPinId) renderDetailModal();
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
  if (elements.newTask) elements.newTask.addEventListener('click', openNewTaskModal);
  if (elements.newTaskClose) elements.newTaskClose.addEventListener('click', () => closeNewTaskModal(true));
  if (elements.newTaskForm) {
    elements.newTaskForm.addEventListener('submit', (event) => {
      if (event && event.preventDefault) event.preventDefault();
      return postNewTaskAction(false);
    });
    elements.newTaskForm.addEventListener('keydown', (event) => {
      const tagName = event && event.target && event.target.tagName ? String(event.target.tagName).toUpperCase() : '';
      if (event && event.key === 'Enter' && tagName === 'INPUT') {
        if (event.preventDefault) event.preventDefault();
      }
    });
  }
  if (elements.newTaskConfirm) elements.newTaskConfirm.addEventListener('click', () => postNewTaskAction(true));
  [
    elements.newTaskFrom,
    elements.newTaskTitle,
    elements.newTaskRequirement,
    elements.newTaskRequirementContentType,
    elements.newTaskCriteria,
    elements.newTaskCriteriaContentType,
    elements.newTaskRepoUri,
    elements.newTaskProjectBase,
    elements.newTaskBaseBranch,
    elements.newTaskBountyAmount,
    elements.newTaskCurrency,
    elements.newTaskDeadline,
    elements.newTaskTags,
    elements.newTaskAttachments,
  ].forEach((field) => {
    if (!field) return;
    field.addEventListener('input', resetNewTaskPreview);
    field.addEventListener('change', resetNewTaskPreview);
  });
  if (elements.detailClose) elements.detailClose.addEventListener('click', () => closeDetailModal(true));
  if (elements.newTaskModal) {
    elements.newTaskModal.addEventListener('click', (event) => {
      if (event && event.target === elements.newTaskModal) closeNewTaskModal(true);
    });
    elements.newTaskModal.addEventListener('keydown', (event) => {
      if (event && event.key === 'Escape') {
        if (event.preventDefault) event.preventDefault();
        closeNewTaskModal(true);
      }
    });
  }
  if (elements.detailModal) {
    elements.detailModal.addEventListener('click', (event) => {
      const confirmationActive = elements.detailModal.dataset.confirmationActive === 'true';
      if (!confirmationActive && event && event.target === elements.detailModal) closeDetailModal(true);
    });
    elements.detailModal.addEventListener('keydown', (event) => {
      if (event && event.key === 'Escape') {
        if (event.preventDefault) event.preventDefault();
        closeDetailModal(true);
      }
    });
  }
  if (document && document.addEventListener) {
    document.addEventListener('keydown', (event) => {
      if (event && event.key === 'Escape' && elements.detailModal && !elements.detailModal.hidden) {
        if (event.preventDefault) event.preventDefault();
        closeDetailModal(true);
      }
      if (event && event.key === 'Escape' && elements.newTaskModal && !elements.newTaskModal.hidden) {
        if (event.preventDefault) event.preventDefault();
        closeNewTaskModal(true);
      }
    });
  }
  if (elements.newTask) elements.newTask.disabled = false;
  loadDashboard();
})();`;
}
