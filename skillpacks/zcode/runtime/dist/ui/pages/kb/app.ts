import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';

export function buildKbPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  return {
    page: 'kb',
    title: i18n.t('kb.title'),
    eyebrow: i18n.t('kb.eyebrow'),
    heading: i18n.t('kb.heading'),
    description: i18n.t('kb.description'),
    panels: [],
    contentHtml: `
      <section class="kb-shell" data-kb-shell>
        <div class="kb-toolbar">
          <div>
            <h1 data-i18n-key="kb.heading">${i18n.t('kb.heading')}</h1>
            <p data-kb-status data-i18n-key="kb.loading">${i18n.t('kb.loading')}</p>
          </div>
          <button class="btn btn-sm" type="button" data-kb-refresh data-i18n-key="kb.refresh">${i18n.t('kb.refresh')}</button>
        </div>
        <div class="kb-layout">
          <aside class="card kb-list-card">
            <h2 class="card-title" data-i18n-key="kb.listTitle">${i18n.t('kb.listTitle')}</h2>
            <div class="kb-list" data-kb-list></div>
            <form class="kb-create" data-kb-create-form>
              <h3 class="card-title" data-i18n-key="kb.createTitle">${i18n.t('kb.createTitle')}</h3>
              <label class="field">
                <span data-i18n-key="kb.name">${i18n.t('kb.name')}</span>
                <input type="text" data-kb-create-name placeholder="${i18n.t('kb.namePlaceholder')}" />
              </label>
              <label class="field">
                <span data-i18n-key="kb.descriptionLabel">${i18n.t('kb.descriptionLabel')}</span>
                <input type="text" data-kb-create-description />
              </label>
              <button class="btn btn-sm btn-primary" type="submit" data-kb-create-submit data-i18n-key="kb.create">${i18n.t('kb.create')}</button>
              <p class="status-msg" data-kb-create-status role="status" aria-live="polite"></p>
            </form>
          </aside>
          <div class="kb-main">
            <article class="card" data-kb-detail></article>
            <article class="card">
              <h2 class="card-title" data-i18n-key="kb.queryTitle">${i18n.t('kb.queryTitle')}</h2>
              <p class="card-subtitle" data-i18n-key="kb.queryHint">${i18n.t('kb.queryHint')}</p>
              <form class="kb-query-form" data-kb-query-form>
                <label class="field kb-query-scope">
                  <span data-i18n-key="kb.listTitle">${i18n.t('kb.listTitle')}</span>
                  <select data-kb-query-select></select>
                </label>
                <label class="field kb-query-text">
                  <span data-i18n-key="kb.queryQuestion">${i18n.t('kb.queryQuestion')}</span>
                  <input type="text" data-kb-query-input placeholder="${i18n.t('kb.queryPlaceholder')}" />
                </label>
                <button class="btn btn-sm btn-primary" type="submit" data-kb-query-submit data-i18n-key="kb.queryRun">${i18n.t('kb.queryRun')}</button>
              </form>
              <div class="kb-query-results" data-kb-query-results></div>
              <p class="status-msg" data-kb-query-status role="status" aria-live="polite"></p>
            </article>
            <article class="card">
              <h2 class="card-title" data-i18n-key="kb.studyTitle">${i18n.t('kb.studyTitle')}</h2>
              <p class="card-subtitle" data-i18n-key="kb.studyHint">${i18n.t('kb.studyHint')}</p>
              <form class="kb-study-form" data-kb-study-form>
                <label class="field kb-study-topic">
                  <span data-i18n-key="kb.studyTopic">${i18n.t('kb.studyTopic')}</span>
                  <input type="text" data-kb-study-topic placeholder="${i18n.t('kb.studyTopicPlaceholder')}" />
                </label>
                <label class="field kb-study-budget">
                  <span data-i18n-key="kb.studyBudget">${i18n.t('kb.studyBudget')}</span>
                  <input type="number" min="1" max="50" step="1" data-kb-study-budget />
                </label>
                <button class="btn btn-sm btn-primary" type="submit" data-kb-study-submit data-i18n-key="kb.studyEnqueue">${i18n.t('kb.studyEnqueue')}</button>
              </form>
              <p class="field-hint" data-i18n-key="kb.studyBudgetHint">${i18n.t('kb.studyBudgetHint')}</p>
              <div class="table-wrap" data-kb-study-table></div>
              <p class="status-msg" data-kb-study-status role="status" aria-live="polite"></p>
            </article>
          </div>
        </div>
      </section>
    `,
    script: `(() => {
  const elements = {
    status: document.querySelector('[data-kb-status]'),
    refresh: document.querySelector('[data-kb-refresh]'),
    list: document.querySelector('[data-kb-list]'),
    createForm: document.querySelector('[data-kb-create-form]'),
    createName: document.querySelector('[data-kb-create-name]'),
    createDescription: document.querySelector('[data-kb-create-description]'),
    createSubmit: document.querySelector('[data-kb-create-submit]'),
    createStatus: document.querySelector('[data-kb-create-status]'),
    detail: document.querySelector('[data-kb-detail]'),
    queryForm: document.querySelector('[data-kb-query-form]'),
    querySelect: document.querySelector('[data-kb-query-select]'),
    queryInput: document.querySelector('[data-kb-query-input]'),
    querySubmit: document.querySelector('[data-kb-query-submit]'),
    queryResults: document.querySelector('[data-kb-query-results]'),
    queryStatus: document.querySelector('[data-kb-query-status]'),
    studyForm: document.querySelector('[data-kb-study-form]'),
    studyTopic: document.querySelector('[data-kb-study-topic]'),
    studyBudget: document.querySelector('[data-kb-study-budget]'),
    studySubmit: document.querySelector('[data-kb-study-submit]'),
    studyTable: document.querySelector('[data-kb-study-table]'),
    studyStatus: document.querySelector('[data-kb-study-status]'),
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
    kbs: [],
    selectedId: '',
    editMode: false,
    editName: '',
    editDescription: '',
    editAutoLearn: true,
    confirmRemove: false,
    busyDetail: false,
    busyCreate: false,
    busyQuery: false,
    busyStudy: false,
    queryResults: null,
    studyJobs: [],
    createMessage: { kind: '', text: '' },
    detailMessage: { kind: '', text: '' },
    queryMessage: { kind: '', text: '' },
    studyMessage: { kind: '', text: '' },
  };
  let confirmRemoveTimer = 0;

  const getJson = async (url) => {
    const suffix = fromBot ? (url.indexOf('?') === -1 ? '?from=' : '&from=') + encodeURIComponent(fromBot) : '';
    const response = await fetch(url + suffix, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('kb.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };
  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(withFrom(body)),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('kb.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };

  const setMessage = (target, kind, text) => {
    target.kind = kind;
    target.text = String(text || '');
  };
  const renderMessage = (element, target) => {
    if (!element) return;
    element.textContent = target.text;
    element.className = element.className.replace(/\\s(success|error|busy)/g, '');
    if (target.kind) element.className += ' ' + target.kind;
  };

  const selectedKb = () => state.kbs.find((kb) => kb.id === state.selectedId) || null;
  const learnedLabelFor = (kb) => {
    const learnedMs = parseTime(kb.lastLearnedAt);
    return learnedMs
      ? (formatRelative(learnedMs) || formatDateTime(learnedMs))
      : uiText('kb.lastLearnedNever', 'never learned');
  };

  const renderStatusLine = () => {
    if (!elements.status) return;
    if (state.error) {
      elements.status.textContent = state.error;
      return;
    }
    elements.status.textContent = state.loading
      ? uiText('kb.loading', 'Loading knowledge bases...')
      : uiText('kb.loaded', 'Knowledge bases loaded.');
  };

  const renderList = () => {
    if (!elements.list) return;
    if (!state.kbs.length) {
      elements.list.innerHTML = '<div class="session-empty"><strong>'
        + escapeHtml(uiText('kb.detailEmptyTitle', 'No knowledge base selected'))
        + '</strong><p>' + escapeHtml(uiText('kb.detailEmptyMessage', 'Choose a knowledge base from the list, or create a new one.')) + '</p></div>';
      return;
    }
    elements.list.innerHTML = state.kbs.map((kb) => {
      const badges = kb.isDefault
        ? '<span class="section-badge">' + escapeHtml(uiText('kb.defaultBadge', 'Default')) + '</span>'
        : '';
      return '<button class="kb-row" type="button" data-kb-id="' + escapeHtml(kb.id) + '" data-selected="' + (kb.id === state.selectedId ? 'true' : 'false') + '">'
        + '<span class="kb-row-head"><strong>' + escapeHtml(kb.name) + '</strong>' + badges + '</span>'
        + '<span class="kb-row-meta mono">'
        + escapeHtml(uiText('kb.docCount', '{count} docs', { count: Number(kb.docCount) || 0 }))
        + ' · ' + escapeHtml(uiText('kb.chunkCount', '{count} chunks', { count: Number(kb.chunkCount) || 0 }))
        + ' · ' + escapeHtml(learnedLabelFor(kb))
        + '</span>'
        + '</button>';
    }).join('');
    elements.list.querySelectorAll('[data-kb-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedId = button.getAttribute('data-kb-id') || '';
        state.editMode = false;
        state.confirmRemove = false;
        setMessage(state.detailMessage, '', '');
        render();
      });
    });
  };

  const renderDetail = () => {
    if (!elements.detail) return;
    const kb = selectedKb();
    if (!kb) {
      elements.detail.innerHTML = '<div class="session-empty"><strong>'
        + escapeHtml(uiText('kb.detailEmptyTitle', 'No knowledge base selected'))
        + '</strong><p>' + escapeHtml(uiText('kb.detailEmptyMessage', 'Choose a knowledge base from the list, or create a new one.')) + '</p></div>';
      return;
    }
    if (state.editMode) {
      elements.detail.innerHTML = '<h2 class="card-title">' + escapeHtml(uiText('kb.editTitle', 'Edit knowledge base')) + '</h2>'
        + '<div class="kb-detail-body">'
        + '<label class="field"><span>' + escapeHtml(uiText('kb.name', 'Name')) + '</span>'
        + '<input type="text" data-kb-edit-name value="' + escapeHtml(state.editName) + '" /></label>'
        + '<label class="field"><span>' + escapeHtml(uiText('kb.descriptionLabel', 'Description')) + '</span>'
        + '<input type="text" data-kb-edit-description value="' + escapeHtml(state.editDescription) + '" /></label>'
        + '<label class="kb-check"><input type="checkbox" data-kb-edit-autolearn' + (state.editAutoLearn ? ' checked' : '') + ' />'
        + '<span>' + escapeHtml(uiText('kb.autoLearn', 'Auto-learn')) + '</span></label>'
        + '<p class="field-hint">' + escapeHtml(uiText('kb.autoLearnHint', 'Learn from new documents automatically.')) + '</p>'
        + '</div>'
        + '<div class="kb-detail-actions">'
        + '<button class="btn btn-sm btn-primary" type="button" data-kb-edit-save>' + escapeHtml(uiText('kb.save', 'Save changes')) + '</button>'
        + '<button class="btn btn-sm" type="button" data-kb-edit-cancel>' + escapeHtml(uiText('kb.cancel', 'Cancel')) + '</button>'
        + '</div>'
        + '<p class="status-msg" data-kb-detail-msg role="status" aria-live="polite"></p>';
      const nameInput = elements.detail.querySelector('[data-kb-edit-name]');
      const descriptionInput = elements.detail.querySelector('[data-kb-edit-description]');
      const autoLearnInput = elements.detail.querySelector('[data-kb-edit-autolearn]');
      if (nameInput) nameInput.addEventListener('input', () => { state.editName = nameInput.value; });
      if (descriptionInput) descriptionInput.addEventListener('input', () => { state.editDescription = descriptionInput.value; });
      if (autoLearnInput) autoLearnInput.addEventListener('change', () => { state.editAutoLearn = autoLearnInput.checked; });
      const save = elements.detail.querySelector('[data-kb-edit-save]');
      const cancel = elements.detail.querySelector('[data-kb-edit-cancel]');
      if (save) save.addEventListener('click', saveEdit);
      if (cancel) cancel.addEventListener('click', () => { state.editMode = false; render(); });
      renderMessage(elements.detail.querySelector('[data-kb-detail-msg]'), state.detailMessage);
      return;
    }

    const learnedMs = parseTime(kb.lastLearnedAt);
    const learnedLabel = learnedLabelFor(kb);
    const removeButton = state.confirmRemove
      ? '<button class="btn btn-sm btn-danger" type="button" data-kb-confirm-remove>' + escapeHtml(uiText('kb.confirmRemove', 'Confirm remove')) + '</button>'
      : '<button class="btn btn-sm btn-danger" type="button" data-kb-remove>' + escapeHtml(uiText('kb.remove', 'Remove')) + '</button>';
    elements.detail.innerHTML = '<div class="kb-detail-head">'
      + '<div><h2 class="card-title">' + escapeHtml(kb.name) + '</h2>'
      + (kb.description ? '<p class="card-subtitle">' + escapeHtml(kb.description) + '</p>' : '')
      + '</div>'
      + '<div class="kb-detail-actions">'
      + '<button class="btn btn-sm" type="button" data-kb-edit>' + escapeHtml(uiText('kb.editTitle', 'Edit knowledge base')) + '</button>'
      + removeButton
      + '</div></div>'
      + '<dl class="def-list kb-detail-meta">'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('kb.docsLabel', 'Documents')) + '</dt><dd>' + escapeHtml(String(Number(kb.docCount) || 0)) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('kb.chunksLabel', 'Chunks')) + '</dt><dd>' + escapeHtml(String(Number(kb.chunkCount) || 0)) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('kb.lastLearnedLabel', 'Last learned')) + '</dt><dd title="' + escapeHtml(formatDateTime(learnedMs)) + '">' + escapeHtml(learnedLabel) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('kb.autoLearn', 'Auto-learn')) + '</dt><dd>' + escapeHtml(kb.autoLearn ? uiText('surf.on', 'On') : uiText('surf.off', 'Off')) + '</dd></div>'
      + '</dl>'
      + '<div class="kb-learn-row">'
      + '<button class="btn btn-sm btn-primary" type="button" data-kb-learn>' + escapeHtml(uiText('kb.learnNow', 'Learn now')) + '</button>'
      + '<span class="status-msg" data-kb-detail-msg role="status" aria-live="polite"></span>'
      + '</div>'
      + '<form class="kb-doc-form" data-kb-doc-form>'
      + '<h3 class="card-title">' + escapeHtml(uiText('kb.addDocumentTitle', 'Add a document')) + '</h3>'
      + '<label class="field"><span>' + escapeHtml(uiText('kb.docTitle', 'Title')) + '</span>'
      + '<input type="text" data-kb-doc-title placeholder="' + escapeHtml(uiText('kb.docTitlePlaceholder', 'Document title')) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('kb.docContent', 'Content')) + '</span>'
      + '<textarea rows="5" data-kb-doc-content placeholder="' + escapeHtml(uiText('kb.docContentPlaceholder', 'Paste the text this Bot should remember.')) + '"></textarea></label>'
      + '<button class="btn btn-sm btn-primary" type="submit" data-kb-doc-submit>' + escapeHtml(uiText('kb.docAdd', 'Add document')) + '</button>'
      + '</form>';
    renderMessage(elements.detail.querySelector('[data-kb-detail-msg]'), state.detailMessage);
    const editButton = elements.detail.querySelector('[data-kb-edit]');
    if (editButton) editButton.addEventListener('click', () => {
      state.editMode = true;
      state.editName = kb.name;
      state.editDescription = kb.description || '';
      state.editAutoLearn = kb.autoLearn !== false;
      render();
    });
    const remove = elements.detail.querySelector('[data-kb-remove]');
    if (remove) remove.addEventListener('click', () => {
      state.confirmRemove = true;
      render();
      if (confirmRemoveTimer) clearTimeout(confirmRemoveTimer);
      confirmRemoveTimer = setTimeout(() => {
        state.confirmRemove = false;
        render();
      }, 3000);
    });
    const confirmRemove = elements.detail.querySelector('[data-kb-confirm-remove]');
    if (confirmRemove) confirmRemove.addEventListener('click', removeSelected);
    const learn = elements.detail.querySelector('[data-kb-learn]');
    if (learn) learn.addEventListener('click', learnSelected);
    const docForm = elements.detail.querySelector('[data-kb-doc-form]');
    if (docForm) docForm.addEventListener('submit', addDocument);
  };

  const renderQuery = () => {
    if (!elements.querySelect) return;
    const currentValue = elements.querySelect.value;
    const options = ['<option value="">' + escapeHtml(uiText('kb.queryAll', 'All knowledge bases')) + '</option>']
      .concat(state.kbs.map((kb) => '<option value="' + escapeHtml(kb.id) + '">' + escapeHtml(kb.name) + '</option>'));
    elements.querySelect.innerHTML = options.join('');
    elements.querySelect.value = state.kbs.some((kb) => kb.id === currentValue) ? currentValue : '';
    if (elements.querySubmit) elements.querySubmit.disabled = state.busyQuery;
    if (elements.queryInput) elements.queryInput.disabled = state.busyQuery;
    if (!elements.queryResults) return;
    if (!state.queryResults) {
      elements.queryResults.innerHTML = '';
    } else if (!state.queryResults.length) {
      elements.queryResults.innerHTML = '<div class="table-empty"><strong>' + escapeHtml(uiText('kb.queryEmpty', 'No matching passages found.')) + '</strong></div>';
    } else {
      let hitCount = 0;
      const groups = state.queryResults.map((group) => {
        const hits = Array.isArray(group.hits) ? group.hits : [];
        hitCount += hits.length;
        return '<div class="kb-query-group"><strong>' + escapeHtml(group.knowledgeBaseName || group.knowledgeBaseId || '') + '</strong>'
          + hits.map((hit) => '<div class="kb-hit">'
          + '<span class="kb-hit-title">' + escapeHtml(hit.title || hit.docRelPath || '') + '</span>'
          + '<span class="section-badge">' + escapeHtml(uiText('kb.scoreLabel', 'score {score}', { score: (Number(hit.score) || 0).toFixed(2) })) + '</span>'
          + '<p>' + escapeHtml(hit.snippet || '') + '</p>'
          + '</div>').join('')
          + '</div>';
      }).join('');
      elements.queryResults.innerHTML = '<p class="kb-query-count mono">' + escapeHtml(uiText('kb.queryResults', '{count} results', { count: hitCount })) + '</p>' + groups;
    }
  };

  const jobStatusPill = (status) => {
    const kind = status === 'done' ? 'status-completed' : (status === 'failed' ? 'status-failure' : (status === 'running' ? 'status-active' : 'status-manual'));
    return '<span class="status-pill ' + kind + '"><span class="status-dot"></span>' + escapeHtml(uiText('kb.jobStatus.' + status, status)) + '</span>';
  };

  const renderStudy = () => {
    if (!elements.studyTable) return;
    if (elements.studySubmit) elements.studySubmit.disabled = state.busyStudy;
    if (!state.studyJobs.length) {
      elements.studyTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('kb.studyEmpty', 'No study jobs yet'))
        + '</strong>' + escapeHtml(uiText('kb.studyEmptyHint', 'Enqueue a topic and the Bot studies it overnight.')) + '</div>';
      return;
    }
    const head = '<thead><tr>'
      + '<th>' + escapeHtml(uiText('kb.colTopic', 'Topic')) + '</th>'
      + '<th>' + escapeHtml(uiText('kb.colStatus', 'Status')) + '</th>'
      + '<th>' + escapeHtml(uiText('kb.colProgress', 'Progress')) + '</th>'
      + '<th>' + escapeHtml(uiText('kb.colLastRun', 'Last run')) + '</th>'
      + '<th>' + escapeHtml(uiText('surf.colActions', 'Actions')) + '</th>'
      + '</tr></thead>';
    const rows = state.studyJobs.map((job) => {
      const processed = Array.isArray(job.processedPinIds) ? job.processedPinIds.length : 0;
      const progress = uiText('kb.jobProgress', '{processed} pins · {runs} runs', {
        processed,
        runs: Number(job.runCount) || 0,
      });
      const lastRunMs = parseTime(job.lastRunAt);
      const lastRunLabel = lastRunMs
        ? (formatRelative(lastRunMs) || formatDateTime(lastRunMs))
        : uiText('kb.jobNeverRun', 'Not yet');
      const note = job.error
        ? '<div class="kb-job-error">' + escapeHtml(job.error) + '</div>'
        : (job.summary ? '<div class="kb-job-summary">' + escapeHtml(job.summary) + '</div>' : '');
      const retry = job.status === 'failed'
        ? '<button class="btn btn-sm" type="button" data-kb-job-retry="' + escapeHtml(job.id) + '">' + escapeHtml(uiText('kb.jobRetry', 'Retry')) + '</button>'
        : '';
      return '<tr>'
        + '<td>' + escapeHtml(job.topic || '') + note + '</td>'
        + '<td>' + jobStatusPill(job.status) + '</td>'
        + '<td class="mono">' + escapeHtml(progress) + '</td>'
        + '<td class="mono" title="' + escapeHtml(formatDateTime(lastRunMs)) + '">' + escapeHtml(lastRunLabel) + '</td>'
        + '<td>' + retry + '</td>'
        + '</tr>';
    }).join('');
    elements.studyTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
    elements.studyTable.querySelectorAll('[data-kb-job-retry]').forEach((button) => {
      button.addEventListener('click', () => retryJob(button.getAttribute('data-kb-job-retry') || ''));
    });
  };

  const render = () => {
    renderStatusLine();
    renderList();
    renderDetail();
    renderQuery();
    renderStudy();
    renderMessage(elements.createStatus, state.createMessage);
    renderMessage(elements.queryStatus, state.queryMessage);
    renderMessage(elements.studyStatus, state.studyMessage);
  };

  const load = async () => {
    state.loading = true;
    state.error = '';
    render();
    try {
      const [listData, studyData] = await Promise.all([
        getJson('/api/kb/list'),
        getJson('/api/kb/study/status'),
      ]);
      state.kbs = Array.isArray(listData.knowledgeBases) ? listData.knowledgeBases : [];
      state.studyJobs = Array.isArray(studyData.jobs) ? studyData.jobs : [];
      if (state.selectedId && !state.kbs.some((kb) => kb.id === state.selectedId)) {
        state.selectedId = '';
      }
      if (!state.selectedId && state.kbs.length) {
        state.selectedId = state.kbs[0].id;
      }
      state.loading = false;
    } catch (error) {
      state.loading = false;
      state.error = (error && error.message) || uiText('kb.loadFailed', 'Knowledge bases failed to load.');
    }
    render();
  };

  const createKb = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyCreate) return;
    const name = elements.createName ? String(elements.createName.value || '').trim() : '';
    if (!name) {
      setMessage(state.createMessage, 'error', uiText('kb.createFailed', 'Failed to create the knowledge base.'));
      render();
      return;
    }
    const description = elements.createDescription ? String(elements.createDescription.value || '').trim() : '';
    state.busyCreate = true;
    if (elements.createSubmit) elements.createSubmit.disabled = true;
    setMessage(state.createMessage, '', '');
    render();
    try {
      const data = await postJson('/api/kb/create', { name, ...(description ? { description } : {}) });
      if (data.knowledgeBase && data.knowledgeBase.id) state.selectedId = data.knowledgeBase.id;
      if (elements.createName) elements.createName.value = '';
      if (elements.createDescription) elements.createDescription.value = '';
      setMessage(state.createMessage, 'success', uiText('kb.created', 'Knowledge base created.'));
      await load();
    } catch (error) {
      setMessage(state.createMessage, 'error', (error && error.message) || uiText('kb.createFailed', 'Failed to create the knowledge base.'));
      render();
    } finally {
      state.busyCreate = false;
      if (elements.createSubmit) elements.createSubmit.disabled = false;
      render();
    }
  };

  const saveEdit = async () => {
    if (state.busyDetail) return;
    const kb = selectedKb();
    if (!kb) return;
    const name = String(state.editName || '').trim();
    if (!name) {
      setMessage(state.detailMessage, 'error', uiText('kb.updateFailed', 'Failed to update the knowledge base.'));
      render();
      return;
    }
    state.busyDetail = true;
    render();
    try {
      await postJson('/api/kb/update', {
        id: kb.id,
        name,
        description: String(state.editDescription || '').trim(),
        autoLearn: state.editAutoLearn === true,
      });
      state.editMode = false;
      setMessage(state.detailMessage, 'success', uiText('kb.updated', 'Knowledge base updated.'));
      await load();
    } catch (error) {
      setMessage(state.detailMessage, 'error', (error && error.message) || uiText('kb.updateFailed', 'Failed to update the knowledge base.'));
      render();
    } finally {
      state.busyDetail = false;
      render();
    }
  };

  const removeSelected = async () => {
    if (state.busyDetail) return;
    const kb = selectedKb();
    if (!kb) return;
    state.busyDetail = true;
    render();
    try {
      await postJson('/api/kb/remove', { id: kb.id });
      state.selectedId = '';
      state.confirmRemove = false;
      setMessage(state.detailMessage, 'success', uiText('kb.removed', 'Knowledge base removed.'));
      await load();
    } catch (error) {
      setMessage(state.detailMessage, 'error', (error && error.message) || uiText('kb.removeFailed', 'Failed to remove the knowledge base.'));
      render();
    } finally {
      state.busyDetail = false;
      render();
    }
  };

  const learnSelected = async () => {
    if (state.busyDetail) return;
    const kb = selectedKb();
    if (!kb) return;
    state.busyDetail = true;
    setMessage(state.detailMessage, 'busy', uiText('kb.learning', 'Learning...'));
    render();
    try {
      const data = await postJson('/api/kb/learn', { id: kb.id });
      const summary = data.knowledgeBase && data.knowledgeBase.learnSummary;
      if (summary) {
        setMessage(state.detailMessage, 'success', uiText('kb.learned', 'Learned: {added} added · {updated} updated · {removed} removed', {
          added: Number(summary.added) || 0,
          updated: Number(summary.updated) || 0,
          removed: Number(summary.removed) || 0,
        }));
      } else {
        setMessage(state.detailMessage, 'success', uiText('kb.learned', 'Learned: {added} added · {updated} updated · {removed} removed', { added: 0, updated: 0, removed: 0 }));
      }
      await load();
    } catch (error) {
      setMessage(state.detailMessage, 'error', (error && error.message) || uiText('kb.learnFailed', 'Learn failed.'));
      render();
    } finally {
      state.busyDetail = false;
      render();
    }
  };

  const addDocument = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyDetail) return;
    const kb = selectedKb();
    if (!kb) return;
    const titleInput = elements.detail.querySelector('[data-kb-doc-title]');
    const contentInput = elements.detail.querySelector('[data-kb-doc-content]');
    const title = titleInput ? String(titleInput.value || '').trim() : '';
    const content = contentInput ? String(contentInput.value || '') : '';
    if (!title || !content.trim()) {
      setMessage(state.detailMessage, 'error', uiText('kb.docAddFailed', 'Failed to add the document.'));
      render();
      return;
    }
    state.busyDetail = true;
    setMessage(state.detailMessage, 'busy', uiText('kb.docAdding', 'Adding document...'));
    render();
    try {
      await postJson('/api/kb/add-document', { id: kb.id, title, content });
      setMessage(state.detailMessage, 'success', uiText('kb.docAdded', 'Document added.'));
      await load();
    } catch (error) {
      setMessage(state.detailMessage, 'error', (error && error.message) || uiText('kb.docAddFailed', 'Failed to add the document.'));
      render();
    } finally {
      state.busyDetail = false;
      render();
    }
  };

  const runQuery = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyQuery) return;
    const text = elements.queryInput ? String(elements.queryInput.value || '').trim() : '';
    if (!text) return;
    const scope = elements.querySelect ? elements.querySelect.value : '';
    state.busyQuery = true;
    state.queryResults = null;
    setMessage(state.queryMessage, 'busy', uiText('kb.querying', 'Querying...'));
    render();
    try {
      const data = await postJson('/api/kb/query', { text, ...(scope ? { id: scope } : {}) });
      state.queryResults = Array.isArray(data.results) ? data.results : [];
      setMessage(state.queryMessage, '', '');
    } catch (error) {
      state.queryResults = null;
      setMessage(state.queryMessage, 'error', (error && error.message) || uiText('kb.queryFailed', 'Query failed.'));
    } finally {
      state.busyQuery = false;
      render();
    }
  };

  const enqueueStudy = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyStudy) return;
    const topic = elements.studyTopic ? String(elements.studyTopic.value || '').trim() : '';
    if (!topic) return;
    const budgetRaw = elements.studyBudget ? String(elements.studyBudget.value || '').trim() : '';
    const budget = budgetRaw ? Number(budgetRaw) : undefined;
    state.busyStudy = true;
    setMessage(state.studyMessage, 'busy', uiText('kb.studyEnqueue', 'Enqueue study job'));
    render();
    try {
      await postJson('/api/kb/study/enqueue', {
        topic,
        ...(budget !== undefined && Number.isInteger(budget) && budget >= 1 ? { budgetPins: budget } : {}),
      });
      if (elements.studyTopic) elements.studyTopic.value = '';
      setMessage(state.studyMessage, 'success', uiText('kb.studyEnqueued', 'Study job enqueued.'));
      const studyData = await getJson('/api/kb/study/status');
      state.studyJobs = Array.isArray(studyData.jobs) ? studyData.jobs : [];
    } catch (error) {
      setMessage(state.studyMessage, 'error', (error && error.message) || uiText('kb.studyEnqueueFailed', 'Failed to enqueue the study job.'));
    } finally {
      state.busyStudy = false;
      render();
    }
  };

  const retryJob = async (jobId) => {
    if (state.busyStudy || !jobId) return;
    state.busyStudy = true;
    render();
    try {
      const data = await postJson('/api/kb/study/retry', { jobId });
      setMessage(state.studyMessage, 'success', uiText('kb.studyRetried', 'Retried {count} failed job(s).', { count: Number(data.count) || 0 }));
      const studyData = await getJson('/api/kb/study/status');
      state.studyJobs = Array.isArray(studyData.jobs) ? studyData.jobs : [];
    } catch (error) {
      setMessage(state.studyMessage, 'error', (error && error.message) || uiText('kb.studyRetryFailed', 'Failed to retry the study job.'));
    } finally {
      state.busyStudy = false;
      render();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', load);
  if (elements.createForm) elements.createForm.addEventListener('submit', createKb);
  if (elements.queryForm) elements.queryForm.addEventListener('submit', runQuery);
  if (elements.studyForm) elements.studyForm.addEventListener('submit', enqueueStudy);
  window.addEventListener('oac:i18n-changed', render);

  load();
})();`,
  };
}
