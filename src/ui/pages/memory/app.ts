import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';

export function buildMemoryPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  return {
    page: 'memory',
    title: i18n.t('memory.title'),
    eyebrow: i18n.t('memory.eyebrow'),
    heading: i18n.t('memory.heading'),
    description: i18n.t('memory.description'),
    panels: [],
    contentHtml: `
      <section class="memory-shell" data-memory-shell>
        <div class="memory-toolbar">
          <div>
            <h1 data-i18n-key="memory.heading">${i18n.t('memory.heading')}</h1>
            <p data-memory-status data-i18n-key="memory.loading">${i18n.t('memory.loading')}</p>
          </div>
          <button class="btn btn-sm" type="button" data-memory-refresh data-i18n-key="memory.refresh">${i18n.t('memory.refresh')}</button>
        </div>
        <div class="memory-tabs" role="tablist" data-memory-tabs></div>
        <div class="memory-panel" data-memory-panel></div>
      </section>
    `,
    script: `(() => {
  const elements = {
    status: document.querySelector('[data-memory-status]'),
    refresh: document.querySelector('[data-memory-refresh]'),
    tabs: document.querySelector('[data-memory-tabs]'),
    panel: document.querySelector('[data-memory-panel]'),
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
  const yesterdayLocal = () => {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const pad = (part) => String(part).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  };
  const untilLabel = (target) => {
    const diff = Number(target) - Date.now();
    if (diff <= 60_000) return uiText('memory.dream.untilSoon', 'soon');
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return uiText('memory.dream.untilMinutes', 'in {n} min', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return uiText('memory.dream.untilHours', 'in {n} hr', { n: hours });
    return uiText('memory.dream.untilDays', 'in {n} d', { n: Math.floor(hours / 24) });
  };

  const TABS = ['knowledge', 'facts', 'contacts', 'dream', 'settings'];
  const TAB_LABEL_KEYS = {
    knowledge: ['memory.tab.knowledge', 'Knowledge'],
    facts: ['memory.tab.facts', 'Facts'],
    contacts: ['memory.tab.contacts', 'Contacts'],
    dream: ['memory.tab.dream', 'Dream'],
    settings: ['memory.tab.settings', 'Settings'],
  };
  const initialTab = (query.get('tab') || '').trim();
  const state = {
    activeTab: TABS.indexOf(initialTab) >= 0 ? initialTab : 'knowledge',
    loaded: {},
    loading: false,
    error: '',
    // Knowledge tab.
    knowledge: [],
    knowledgeQuery: '',
    knowledgeKind: '',
    knowledgeStatus: 'active',
    knowledgeEditId: '',
    knowledgeDraft: { topic: '', summary: '', kind: 'know_how' },
    knowledgeAddDraft: { topic: '', summary: '', kind: 'know_how' },
    knowledgeMessage: { kind: '', text: '' },
    busyKnowledge: false,
    confirmKnowledgeDeleteId: '',
    // Facts tab.
    entries: [],
    factsQuery: '',
    factsScope: '',
    factsStatus: '',
    factsClass: '',
    factsEditId: '',
    factsDraft: { text: '', usageClass: 'profile_fact' },
    factsAddDraft: { text: '', usageClass: 'profile_fact' },
    factsMessage: { kind: '', text: '' },
    busyFacts: false,
    confirmFactsDeleteId: '',
    // Contacts tab.
    snapshots: [],
    contactDetail: null,
    contactsMessage: { kind: '', text: '' },
    busyContacts: false,
    // Dream tab.
    dreamStatus: null,
    dreamDue: null,
    dreamPolicyEnabled: null,
    summaries: [],
    expandedSummary: '',
    selfIdentity: null,
    capabilities: [],
    dreamDate: yesterdayLocal(),
    busyDreamRun: false,
    dreamMessage: { kind: '', text: '' },
    retryingDate: '',
    // Settings tab.
    policy: null,
    policyHasOverride: false,
    policyDraft: null,
    policyMessage: { kind: '', text: '' },
    busyPolicy: false,
    hygiene: null,
    hygieneDraft: null,
    hygieneMessage: { kind: '', text: '' },
    busyHygiene: false,
  };
  let confirmTimer = 0;
  let pollTimer = 0;

  const apiUrl = (path, params) => {
    const search = new URLSearchParams();
    if (fromBot) search.set('from', fromBot);
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    });
    const suffix = search.toString();
    return suffix ? path + '?' + suffix : path;
  };
  const getJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('memory.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };
  const sendJson = async (method, url, body) => {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(withFrom(body)),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('memory.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };
  const postJson = (url, body) => sendJson('POST', url, body);

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
  const messageHtml = (target) => target.text
    ? '<p class="status-msg' + (target.kind ? ' ' + target.kind : '') + '" role="status" aria-live="polite"></p>'
    : '';

  const renderStatusLine = () => {
    if (!elements.status) return;
    if (state.error) {
      elements.status.textContent = state.error;
      return;
    }
    elements.status.textContent = state.loading
      ? uiText('memory.loading', 'Loading memory...')
      : uiText('memory.loaded', 'Memory loaded.');
  };

  const pill = (kind, label, pulse) => {
    const pulseAttr = pulse ? ' data-memory-pulse="true"' : '';
    return '<span class="status-pill ' + kind + '"' + pulseAttr + '><span class="status-dot"></span>' + escapeHtml(label) + '</span>';
  };

  const statusPillFor = (value) => value
    ? pill('status-online', uiText('surf.on', 'On'), false)
    : pill('status-offline', uiText('surf.off', 'Off'), false);

  const renderTabs = () => {
    if (!elements.tabs) return;
    elements.tabs.innerHTML = TABS.map((tab) => {
      const labelKey = TAB_LABEL_KEYS[tab];
      return '<button class="memory-tab" type="button" role="tab" data-memory-tab="' + tab + '" data-active="'
        + (state.activeTab === tab ? 'true' : 'false') + '" aria-selected="'
        + (state.activeTab === tab ? 'true' : 'false') + '">'
        + escapeHtml(uiText(labelKey[0], labelKey[1])) + '</button>';
    }).join('');
    elements.tabs.querySelectorAll('[data-memory-tab]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.getAttribute('data-memory-tab') || ''));
    });
  };

  const syncTabQuery = () => {
    try {
      if (typeof history === 'undefined' || !history.replaceState) return;
      const url = new URL(window.location.href);
      url.searchParams.set('tab', state.activeTab);
      history.replaceState(null, '', url.pathname + url.search);
    } catch {}
  };

  const setTab = (tab) => {
    if (TABS.indexOf(tab) < 0 || tab === state.activeTab) return;
    state.activeTab = tab;
    syncTabQuery();
    render();
    ensureTabLoaded(tab);
  };

  const ensureTabLoaded = (tab) => {
    if (state.loaded[tab] || state.loading) return;
    const loaders = {
      knowledge: loadKnowledge,
      facts: loadFacts,
      contacts: loadContacts,
      dream: loadDream,
      settings: loadSettings,
    };
    const loader = loaders[tab];
    if (loader) loader();
  };

  // ----- Knowledge tab -----

  const loadKnowledge = async () => {
    state.loading = true;
    state.error = '';
    renderStatusLine();
    try {
      const data = await getJson(apiUrl('/api/memory/knowledge/list', {
        status: state.knowledgeStatus,
        kind: state.knowledgeKind,
        query: state.knowledgeQuery,
        limit: 200,
      }));
      state.knowledge = Array.isArray(data.entries) ? data.entries : [];
      state.loaded.knowledge = true;
    } catch (error) {
      state.error = (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.');
    }
    state.loading = false;
    render();
  };

  const renderKnowledge = () => {
    const rows = state.knowledge.map((entry) => {
      if (state.knowledgeEditId === entry.id) {
        return '<div class="memory-edit-form" data-memory-knowledge-edit-form>'
          + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.topic', 'Topic')) + '</span>'
          + '<input type="text" data-memory-knowledge-edit-topic value="' + escapeHtml(state.knowledgeDraft.topic) + '" /></label>'
          + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.summary', 'Summary')) + '</span>'
          + '<textarea rows="3" data-memory-knowledge-edit-summary>' + escapeHtml(state.knowledgeDraft.summary) + '</textarea></label>'
          + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.kindLabel', 'Kind')) + '</span>'
          + '<select data-memory-knowledge-edit-kind>'
          + ['know_how', 'pitfall', 'principle'].map((kind) => '<option value="' + kind + '"' + (state.knowledgeDraft.kind === kind ? ' selected' : '') + '>'
          + escapeHtml(uiText('memory.knowledge.kind.' + kind, kind)) + '</option>').join('')
          + '</select></label>'
          + '<div class="memory-form-actions">'
          + '<button class="btn btn-sm btn-primary" type="button" data-memory-knowledge-save>' + escapeHtml(uiText('memory.knowledge.save', 'Save')) + '</button>'
          + '<button class="btn btn-sm" type="button" data-memory-knowledge-cancel>' + escapeHtml(uiText('memory.knowledge.cancel', 'Cancel')) + '</button>'
          + '</div></div>';
      }
      const kindLabel = uiText('memory.knowledge.kind.' + entry.kind, entry.kind);
      const badges = '<span class="section-badge">' + escapeHtml(kindLabel) + '</span>'
        + (Number(entry.version) > 1
          ? '<span class="section-badge">' + escapeHtml(uiText('memory.knowledge.versionBadge', 'v{version}', { version: Number(entry.version) })) + '</span>'
          : '')
        + (entry.status !== 'active'
          ? '<span class="section-badge amber">' + escapeHtml(uiText('memory.knowledge.status.' + entry.status, entry.status)) + '</span>'
          : '');
      const actions = entry.status === 'active'
        ? '<button class="btn btn-sm" type="button" data-memory-knowledge-edit="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.knowledge.edit', 'Edit')) + '</button>'
        + '<button class="btn btn-sm" type="button" data-memory-knowledge-archive="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.knowledge.archive', 'Archive')) + '</button>'
        : '';
      const deleteButton = state.confirmKnowledgeDeleteId === entry.id
        ? '<button class="btn btn-sm btn-danger" type="button" data-memory-knowledge-confirm-delete="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.knowledge.confirmDelete', 'Confirm delete')) + '</button>'
        : '<button class="btn btn-sm btn-danger" type="button" data-memory-knowledge-delete="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.knowledge.delete', 'Delete')) + '</button>';
      const updatedMs = parseTime(entry.updatedAt);
      return '<div class="memory-row" data-memory-knowledge-row data-active="' + (entry.status === 'active' ? 'true' : 'false') + '">'
        + '<div class="memory-row-head"><strong>' + escapeHtml(entry.topic) + '</strong>' + badges + '</div>'
        + '<p class="memory-row-text">' + escapeHtml(entry.summary) + '</p>'
        + '<div class="memory-row-meta">' + escapeHtml(uiText('memory.knowledge.updatedLabel', 'Updated')) + ' '
        + escapeHtml(formatRelative(updatedMs) || formatDateTime(updatedMs) || String(entry.updatedAt || '')) + '</div>'
        + '<div class="memory-row-actions">' + actions + deleteButton + '</div>'
        + '</div>';
    }).join('');

    return '<div class="memory-filters" data-memory-knowledge-filters>'
      + '<label class="field memory-filter-grow"><span>' + escapeHtml(uiText('memory.knowledge.searchLabel', 'Search')) + '</span>'
      + '<input type="text" data-memory-knowledge-query value="' + escapeHtml(state.knowledgeQuery) + '" placeholder="' + escapeHtml(uiText('memory.knowledge.searchPlaceholder', 'Search knowledge points')) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.kindLabel', 'Kind')) + '</span>'
      + '<select data-memory-knowledge-kind>'
      + '<option value="">' + escapeHtml(uiText('memory.knowledge.kindAll', 'All kinds')) + '</option>'
      + ['know_how', 'pitfall', 'principle'].map((kind) => '<option value="' + kind + '"' + (state.knowledgeKind === kind ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.knowledge.kind.' + kind, kind)) + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.statusLabel', 'Status')) + '</span>'
      + '<select data-memory-knowledge-status>'
      + [['active', 'memory.knowledge.status.active', 'Active'], ['archived', 'memory.knowledge.status.archived', 'Archived'], ['all', 'memory.knowledge.status.all', 'All']]
        .map((option) => '<option value="' + option[0] + '"' + (state.knowledgeStatus === option[0] ? ' selected' : '') + '>' + escapeHtml(uiText(option[1], option[2])) + '</option>').join('')
      + '</select></label>'
      + '</div>'
      + '<form class="memory-add-form" data-memory-knowledge-add>'
      + '<h3 class="card-title">' + escapeHtml(uiText('memory.knowledge.addTitle', 'Add knowledge point')) + '</h3>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.topic', 'Topic')) + '</span>'
      + '<input type="text" data-memory-knowledge-topic value="' + escapeHtml(state.knowledgeAddDraft.topic) + '" placeholder="' + escapeHtml(uiText('memory.knowledge.topicPlaceholder', 'e.g. How to publish a MetaApp')) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.summary', 'Summary')) + '</span>'
      + '<textarea rows="3" data-memory-knowledge-summary placeholder="' + escapeHtml(uiText('memory.knowledge.summaryPlaceholder', 'What should the Bot remember?')) + '">' + escapeHtml(state.knowledgeAddDraft.summary) + '</textarea></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.knowledge.kindLabel', 'Kind')) + '</span>'
      + '<select data-memory-knowledge-add-kind>'
      + ['know_how', 'pitfall', 'principle'].map((kind) => '<option value="' + kind + '"' + (state.knowledgeAddDraft.kind === kind ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.knowledge.kind.' + kind, kind)) + '</option>').join('')
      + '</select></label>'
      + '<div class="memory-form-actions">'
      + '<button class="btn btn-sm btn-primary" type="submit" data-memory-knowledge-add-submit>' + escapeHtml(uiText('memory.knowledge.add', 'Add')) + '</button>'
      + messageHtml(state.knowledgeMessage)
      + '</div></form>'
      + (state.knowledge.length
        ? '<div class="memory-list" data-memory-knowledge-list>' + rows + '</div>'
        : '<div class="table-empty" data-memory-knowledge-empty><strong>' + escapeHtml(uiText('memory.knowledge.empty', 'No knowledge points yet'))
        + '</strong>' + escapeHtml(uiText('memory.knowledge.emptyHint', 'Add the first thing this Bot should know.')) + '</div>');
  };

  const bindKnowledge = () => {
    if (!elements.panel) return;
    const queryInput = elements.panel.querySelector('[data-memory-knowledge-query]');
    if (queryInput) {
      queryInput.addEventListener('input', () => {
        state.knowledgeQuery = String(queryInput.value || '').trim();
      });
      queryInput.addEventListener('change', () => {
        state.knowledgeQuery = String(queryInput.value || '').trim();
        state.loaded.knowledge = false;
        loadKnowledge();
      });
    }
    const kindSelect = elements.panel.querySelector('[data-memory-knowledge-kind]');
    if (kindSelect) kindSelect.addEventListener('change', () => {
      state.knowledgeKind = kindSelect.value;
      state.loaded.knowledge = false;
      loadKnowledge();
    });
    const statusSelect = elements.panel.querySelector('[data-memory-knowledge-status]');
    if (statusSelect) statusSelect.addEventListener('change', () => {
      state.knowledgeStatus = statusSelect.value;
      state.loaded.knowledge = false;
      loadKnowledge();
    });
    const addForm = elements.panel.querySelector('[data-memory-knowledge-add]');
    if (addForm) addForm.addEventListener('submit', addKnowledge);
    const addTopic = elements.panel.querySelector('[data-memory-knowledge-topic]');
    if (addTopic) addTopic.addEventListener('input', () => {
      state.knowledgeAddDraft.topic = String(addTopic.value || '');
    });
    const addSummary = elements.panel.querySelector('[data-memory-knowledge-summary]');
    if (addSummary) addSummary.addEventListener('input', () => {
      state.knowledgeAddDraft.summary = String(addSummary.value || '');
    });
    const addKind = elements.panel.querySelector('[data-memory-knowledge-add-kind]');
    if (addKind) addKind.addEventListener('change', () => {
      state.knowledgeAddDraft.kind = addKind.value;
    });
    renderMessage(elements.panel.querySelector('[data-memory-knowledge-add] .status-msg'), state.knowledgeMessage);
    elements.panel.querySelectorAll('[data-memory-knowledge-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = state.knowledge.find((candidate) => candidate.id === button.getAttribute('data-memory-knowledge-edit'));
        if (!entry) return;
        state.knowledgeEditId = entry.id;
        state.knowledgeDraft = { topic: entry.topic || '', summary: entry.summary || '', kind: entry.kind || 'know_how' };
        render();
      });
    });
    elements.panel.querySelectorAll('[data-memory-knowledge-save]').forEach((button) => {
      button.addEventListener('click', saveKnowledgeEdit);
    });
    const editTopic = elements.panel.querySelector('[data-memory-knowledge-edit-topic]');
    if (editTopic) editTopic.addEventListener('input', () => {
      state.knowledgeDraft.topic = String(editTopic.value || '');
    });
    const editSummary = elements.panel.querySelector('[data-memory-knowledge-edit-summary]');
    if (editSummary) editSummary.addEventListener('input', () => {
      state.knowledgeDraft.summary = String(editSummary.value || '');
    });
    const editKind = elements.panel.querySelector('[data-memory-knowledge-edit-kind]');
    if (editKind) editKind.addEventListener('change', () => {
      state.knowledgeDraft.kind = editKind.value;
    });
    elements.panel.querySelectorAll('[data-memory-knowledge-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        state.knowledgeEditId = '';
        render();
      });
    });
    elements.panel.querySelectorAll('[data-memory-knowledge-archive]').forEach((button) => {
      button.addEventListener('click', () => archiveKnowledge(button.getAttribute('data-memory-knowledge-archive') || ''));
    });
    elements.panel.querySelectorAll('[data-memory-knowledge-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        state.confirmKnowledgeDeleteId = button.getAttribute('data-memory-knowledge-delete') || '';
        render();
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          state.confirmKnowledgeDeleteId = '';
          render();
        }, 3000);
      });
    });
    elements.panel.querySelectorAll('[data-memory-knowledge-confirm-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteKnowledge(button.getAttribute('data-memory-knowledge-confirm-delete') || ''));
    });
  };

  const addKnowledge = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyKnowledge) return;
    const topic = String(state.knowledgeAddDraft.topic || '').trim();
    const summary = String(state.knowledgeAddDraft.summary || '').trim();
    if (!topic || !summary) {
      setMessage(state.knowledgeMessage, 'error', uiText('memory.knowledge.addFailed', 'Failed to save the knowledge point.'));
      render();
      return;
    }
    state.busyKnowledge = true;
    setMessage(state.knowledgeMessage, '', '');
    render();
    try {
      await postJson('/api/memory/knowledge/upsert', { topic, summary, kind: state.knowledgeAddDraft.kind || 'know_how' });
      state.knowledgeAddDraft = { topic: '', summary: '', kind: state.knowledgeAddDraft.kind || 'know_how' };
      setMessage(state.knowledgeMessage, 'success', uiText('memory.knowledge.added', 'Knowledge point saved.'));
      await loadKnowledge();
    } catch (error) {
      setMessage(state.knowledgeMessage, 'error', (error && error.message) || uiText('memory.knowledge.addFailed', 'Failed to save the knowledge point.'));
      render();
    } finally {
      state.busyKnowledge = false;
      render();
    }
  };

  const saveKnowledgeEdit = async () => {
    if (state.busyKnowledge || !state.knowledgeEditId) return;
    const topic = String(state.knowledgeDraft.topic || '').trim();
    const summary = String(state.knowledgeDraft.summary || '').trim();
    if (!topic || !summary) {
      setMessage(state.knowledgeMessage, 'error', uiText('memory.knowledge.saveFailed', 'Failed to update the knowledge point.'));
      render();
      return;
    }
    state.busyKnowledge = true;
    render();
    try {
      await postJson('/api/memory/knowledge/update', {
        id: state.knowledgeEditId,
        topic,
        summary,
        kind: state.knowledgeDraft.kind || 'know_how',
      });
      state.knowledgeEditId = '';
      setMessage(state.knowledgeMessage, 'success', uiText('memory.knowledge.saved', 'Knowledge point updated.'));
      await loadKnowledge();
    } catch (error) {
      setMessage(state.knowledgeMessage, 'error', (error && error.message) || uiText('memory.knowledge.saveFailed', 'Failed to update the knowledge point.'));
      render();
    } finally {
      state.busyKnowledge = false;
      render();
    }
  };

  const archiveKnowledge = async (id) => {
    if (state.busyKnowledge || !id) return;
    state.busyKnowledge = true;
    render();
    try {
      await postJson('/api/memory/knowledge/archive', { id });
      setMessage(state.knowledgeMessage, 'success', uiText('memory.knowledge.archived', 'Knowledge point archived.'));
      await loadKnowledge();
    } catch (error) {
      setMessage(state.knowledgeMessage, 'error', (error && error.message) || uiText('memory.knowledge.saveFailed', 'Failed to update the knowledge point.'));
      render();
    } finally {
      state.busyKnowledge = false;
      render();
    }
  };

  const deleteKnowledge = async (id) => {
    if (state.busyKnowledge || !id) return;
    state.busyKnowledge = true;
    state.confirmKnowledgeDeleteId = '';
    render();
    try {
      await postJson('/api/memory/knowledge/delete', { id });
      setMessage(state.knowledgeMessage, 'success', uiText('memory.knowledge.deleted', 'Knowledge point deleted.'));
      await loadKnowledge();
    } catch (error) {
      setMessage(state.knowledgeMessage, 'error', (error && error.message) || uiText('memory.knowledge.deleteFailed', 'Failed to delete the knowledge point.'));
      render();
    } finally {
      state.busyKnowledge = false;
      render();
    }
  };

  // ----- Facts tab -----

  const loadFacts = async () => {
    state.loading = true;
    state.error = '';
    renderStatusLine();
    try {
      const data = await getJson(apiUrl('/api/memory/list', {
        limit: 200,
        includeArchived: true,
        scopeKind: state.factsScope,
        status: state.factsStatus,
        usageClass: state.factsClass,
        query: state.factsQuery,
      }));
      state.entries = Array.isArray(data.entries) ? data.entries : [];
      state.loaded.facts = true;
    } catch (error) {
      state.error = (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.');
    }
    state.loading = false;
    render();
  };

  const renderFacts = () => {
    const activeEntries = state.entries.filter((entry) => !entry.archivedAt);
    const archivedEntries = state.entries.filter((entry) => Boolean(entry.archivedAt));
    const rows = activeEntries.map((entry) => {
      if (state.factsEditId === entry.id) {
        return '<div class="memory-edit-form" data-memory-facts-edit-form>'
          + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.text', 'Fact')) + '</span>'
          + '<textarea rows="3" data-memory-facts-edit-text>' + escapeHtml(state.factsDraft.text) + '</textarea></label>'
          + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.classLabel', 'Category')) + '</span>'
          + '<select data-memory-facts-edit-class>'
          + ['profile_fact', 'preference', 'operational_preference', 'work_review', 'value_boundary'].map((cls) => '<option value="' + cls + '"' + (state.factsDraft.usageClass === cls ? ' selected' : '') + '>'
          + escapeHtml(uiText('memory.facts.class.' + cls, cls)) + '</option>').join('')
          + '</select></label>'
          + '<div class="memory-form-actions">'
          + '<button class="btn btn-sm btn-primary" type="button" data-memory-facts-save>' + escapeHtml(uiText('memory.facts.save', 'Save')) + '</button>'
          + '<button class="btn btn-sm" type="button" data-memory-facts-cancel>' + escapeHtml(uiText('memory.facts.cancel', 'Cancel')) + '</button>'
          + '</div></div>';
      }
      const isIdentity = entry.usageClass === 'self_identity';
      const badges = '<span class="section-badge">' + escapeHtml(uiText('memory.facts.class.' + entry.usageClass, entry.usageClass)) + '</span>'
        + '<span class="section-badge">' + escapeHtml(uiText('memory.facts.origin.' + entry.origin, entry.origin)) + '</span>'
        + (entry.status !== 'created'
          ? '<span class="section-badge amber">' + escapeHtml(uiText('memory.facts.status.' + entry.status, entry.status)) + '</span>'
          : '');
      const actions = isIdentity
        ? '<span class="field-hint">' + escapeHtml(uiText('memory.facts.protected', 'Self-identity entries are protected.')) + '</span>'
        : '<button class="btn btn-sm" type="button" data-memory-facts-edit="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.facts.edit', 'Edit')) + '</button>';
      const deleteButton = isIdentity ? '' : (state.confirmFactsDeleteId === entry.id
        ? '<button class="btn btn-sm btn-danger" type="button" data-memory-facts-confirm-delete="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.facts.confirmDelete', 'Confirm delete')) + '</button>'
        : '<button class="btn btn-sm btn-danger" type="button" data-memory-facts-delete="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.facts.delete', 'Delete')) + '</button>');
      const updatedMs = parseTime(entry.updatedAt);
      return '<div class="memory-row" data-memory-facts-row data-active="' + (entry.status === 'created' ? 'true' : 'false') + '">'
        + '<p class="memory-row-text">' + escapeHtml(entry.text) + '</p>'
        + '<div class="memory-row-head">' + badges + '</div>'
        + '<div class="memory-row-meta">' + escapeHtml(uiText('memory.facts.updatedLabel', 'Updated')) + ' '
        + escapeHtml(formatRelative(updatedMs) || formatDateTime(updatedMs) || String(entry.updatedAt || '')) + '</div>'
        + '<div class="memory-row-actions">' + actions + deleteButton + '</div>'
        + '</div>';
    }).join('');
    const archivedRows = archivedEntries.map((entry) => '<div class="memory-archived-row">'
      + '<span>' + escapeHtml(entry.text) + '</span>'
      + '<button class="btn btn-sm" type="button" data-memory-facts-restore="' + escapeHtml(entry.id) + '">' + escapeHtml(uiText('memory.facts.restore', 'Restore')) + '</button>'
      + '</div>').join('');

    return '<div class="memory-filters" data-memory-facts-filters>'
      + '<label class="field memory-filter-grow"><span>' + escapeHtml(uiText('memory.facts.searchLabel', 'Search')) + '</span>'
      + '<input type="text" data-memory-facts-query value="' + escapeHtml(state.factsQuery) + '" placeholder="' + escapeHtml(uiText('memory.facts.searchPlaceholder', 'Search facts')) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.scopeLabel', 'Scope')) + '</span>'
      + '<select data-memory-facts-scope>'
      + '<option value="">' + escapeHtml(uiText('memory.facts.scopeAll', 'All scopes')) + '</option>'
      + ['owner', 'contact', 'conversation'].map((scope) => '<option value="' + scope + '"' + (state.factsScope === scope ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.facts.scope.' + scope, scope)) + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.statusLabel', 'Status')) + '</span>'
      + '<select data-memory-facts-status>'
      + '<option value="">' + escapeHtml(uiText('memory.facts.statusAll', 'Any status')) + '</option>'
      + ['created', 'stale'].map((status) => '<option value="' + status + '"' + (state.factsStatus === status ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.facts.status.' + status, status)) + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.classLabel', 'Category')) + '</span>'
      + '<select data-memory-facts-class>'
      + '<option value="">' + escapeHtml(uiText('memory.facts.classAll', 'All categories')) + '</option>'
      + ['profile_fact', 'preference', 'operational_preference', 'self_identity', 'work_review', 'value_boundary'].map((cls) => '<option value="' + cls + '"' + (state.factsClass === cls ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.facts.class.' + cls, cls)) + '</option>').join('')
      + '</select></label>'
      + '</div>'
      + '<form class="memory-add-form" data-memory-facts-add>'
      + '<h3 class="card-title">' + escapeHtml(uiText('memory.facts.addTitle', 'Add a fact')) + '</h3>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.text', 'Fact')) + '</span>'
      + '<textarea rows="3" data-memory-facts-text placeholder="' + escapeHtml(uiText('memory.facts.textPlaceholder', 'e.g. The user prefers short answers.')) + '">' + escapeHtml(state.factsAddDraft.text) + '</textarea></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.facts.classLabel', 'Category')) + '</span>'
      + '<select data-memory-facts-add-class>'
      + ['profile_fact', 'preference', 'operational_preference', 'work_review', 'value_boundary'].map((cls) => '<option value="' + cls + '"' + (state.factsAddDraft.usageClass === cls ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.facts.class.' + cls, cls)) + '</option>').join('')
      + '</select></label>'
      + '<div class="memory-form-actions">'
      + '<button class="btn btn-sm btn-primary" type="submit" data-memory-facts-add-submit>' + escapeHtml(uiText('memory.facts.add', 'Add fact')) + '</button>'
      + messageHtml(state.factsMessage)
      + '</div></form>'
      + (activeEntries.length
        ? '<div class="memory-list" data-memory-facts-list>' + rows + '</div>'
        : '<div class="table-empty" data-memory-facts-empty><strong>' + escapeHtml(uiText('memory.facts.empty', 'No facts yet'))
        + '</strong>' + escapeHtml(uiText('memory.facts.emptyHint', 'Add a fact manually, or let the Bot learn from chats and dreams.')) + '</div>')
      + (archivedEntries.length
        ? '<div class="memory-archived" data-memory-facts-archived>'
        + '<p class="memory-archived-title">' + escapeHtml(uiText('memory.facts.archivedTitle', 'Archived facts')) + '</p>'
        + '<p class="field-hint">' + escapeHtml(uiText('memory.facts.archivedHint', 'Hygiene soft-archives stale facts. Restore the ones that still matter.')) + '</p>'
        + archivedRows + '</div>'
        : '');
  };

  const bindFacts = () => {
    if (!elements.panel) return;
    const queryInput = elements.panel.querySelector('[data-memory-facts-query]');
    if (queryInput) {
      queryInput.addEventListener('input', () => {
        state.factsQuery = String(queryInput.value || '').trim();
      });
      queryInput.addEventListener('change', () => {
        state.factsQuery = String(queryInput.value || '').trim();
        state.loaded.facts = false;
        loadFacts();
      });
    }
    const scopeSelect = elements.panel.querySelector('[data-memory-facts-scope]');
    if (scopeSelect) scopeSelect.addEventListener('change', () => {
      state.factsScope = scopeSelect.value;
      state.loaded.facts = false;
      loadFacts();
    });
    const statusSelect = elements.panel.querySelector('[data-memory-facts-status]');
    if (statusSelect) statusSelect.addEventListener('change', () => {
      state.factsStatus = statusSelect.value;
      state.loaded.facts = false;
      loadFacts();
    });
    const classSelect = elements.panel.querySelector('[data-memory-facts-class]');
    if (classSelect) classSelect.addEventListener('change', () => {
      state.factsClass = classSelect.value;
      state.loaded.facts = false;
      loadFacts();
    });
    const addForm = elements.panel.querySelector('[data-memory-facts-add]');
    if (addForm) addForm.addEventListener('submit', addFact);
    const addText = elements.panel.querySelector('[data-memory-facts-text]');
    if (addText) addText.addEventListener('input', () => {
      state.factsAddDraft.text = String(addText.value || '');
    });
    const addClass = elements.panel.querySelector('[data-memory-facts-add-class]');
    if (addClass) addClass.addEventListener('change', () => {
      state.factsAddDraft.usageClass = addClass.value;
    });
    renderMessage(elements.panel.querySelector('[data-memory-facts-add] .status-msg'), state.factsMessage);
    elements.panel.querySelectorAll('[data-memory-facts-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = state.entries.find((candidate) => candidate.id === button.getAttribute('data-memory-facts-edit'));
        if (!entry) return;
        state.factsEditId = entry.id;
        state.factsDraft = { text: entry.text || '', usageClass: entry.usageClass || 'profile_fact' };
        render();
      });
    });
    elements.panel.querySelectorAll('[data-memory-facts-save]').forEach((button) => {
      button.addEventListener('click', saveFactEdit);
    });
    const editText = elements.panel.querySelector('[data-memory-facts-edit-text]');
    if (editText) editText.addEventListener('input', () => {
      state.factsDraft.text = String(editText.value || '');
    });
    const editClass = elements.panel.querySelector('[data-memory-facts-edit-class]');
    if (editClass) editClass.addEventListener('change', () => {
      state.factsDraft.usageClass = editClass.value;
    });
    elements.panel.querySelectorAll('[data-memory-facts-cancel]').forEach((button) => {
      button.addEventListener('click', () => {
        state.factsEditId = '';
        render();
      });
    });
    elements.panel.querySelectorAll('[data-memory-facts-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        state.confirmFactsDeleteId = button.getAttribute('data-memory-facts-delete') || '';
        render();
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          state.confirmFactsDeleteId = '';
          render();
        }, 3000);
      });
    });
    elements.panel.querySelectorAll('[data-memory-facts-confirm-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteFact(button.getAttribute('data-memory-facts-confirm-delete') || ''));
    });
    elements.panel.querySelectorAll('[data-memory-facts-restore]').forEach((button) => {
      button.addEventListener('click', () => restoreFact(button.getAttribute('data-memory-facts-restore') || ''));
    });
  };

  const addFact = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.busyFacts) return;
    const text = String(state.factsAddDraft.text || '').trim();
    if (!text) {
      setMessage(state.factsMessage, 'error', uiText('memory.facts.addFailed', 'Failed to save the fact.'));
      render();
      return;
    }
    state.busyFacts = true;
    setMessage(state.factsMessage, '', '');
    render();
    try {
      await postJson('/api/memory/add', {
        text,
        usageClass: state.factsAddDraft.usageClass || 'profile_fact',
        isExplicit: true,
      });
      state.factsAddDraft = { text: '', usageClass: state.factsAddDraft.usageClass || 'profile_fact' };
      setMessage(state.factsMessage, 'success', uiText('memory.facts.added', 'Fact saved.'));
      await loadFacts();
    } catch (error) {
      setMessage(state.factsMessage, 'error', (error && error.message) || uiText('memory.facts.addFailed', 'Failed to save the fact.'));
      render();
    } finally {
      state.busyFacts = false;
      render();
    }
  };

  const saveFactEdit = async () => {
    if (state.busyFacts || !state.factsEditId) return;
    const text = String(state.factsDraft.text || '').trim();
    if (!text) {
      setMessage(state.factsMessage, 'error', uiText('memory.facts.saveFailed', 'Failed to update the fact.'));
      render();
      return;
    }
    state.busyFacts = true;
    render();
    try {
      await postJson('/api/memory/update', {
        id: state.factsEditId,
        text,
        usageClass: state.factsDraft.usageClass || 'profile_fact',
      });
      state.factsEditId = '';
      setMessage(state.factsMessage, 'success', uiText('memory.facts.saved', 'Fact updated.'));
      await loadFacts();
    } catch (error) {
      setMessage(state.factsMessage, 'error', (error && error.message) || uiText('memory.facts.saveFailed', 'Failed to update the fact.'));
      render();
    } finally {
      state.busyFacts = false;
      render();
    }
  };

  const deleteFact = async (id) => {
    if (state.busyFacts || !id) return;
    state.busyFacts = true;
    state.confirmFactsDeleteId = '';
    render();
    try {
      await postJson('/api/memory/delete', { id });
      setMessage(state.factsMessage, 'success', uiText('memory.facts.deleted', 'Fact deleted.'));
      await loadFacts();
    } catch (error) {
      setMessage(state.factsMessage, 'error', (error && error.message) || uiText('memory.facts.deleteFailed', 'Failed to delete the fact.'));
      render();
    } finally {
      state.busyFacts = false;
      render();
    }
  };

  const restoreFact = async (id) => {
    if (state.busyFacts || !id) return;
    state.busyFacts = true;
    render();
    try {
      await postJson('/api/memory/unarchive', { id });
      setMessage(state.factsMessage, 'success', uiText('memory.facts.restored', 'Fact restored.'));
      await loadFacts();
    } catch (error) {
      setMessage(state.factsMessage, 'error', (error && error.message) || uiText('memory.facts.restoreFailed', 'Failed to restore the fact.'));
      render();
    } finally {
      state.busyFacts = false;
      render();
    }
  };

  // ----- Contacts tab -----

  const loadContacts = async () => {
    state.loading = true;
    state.error = '';
    setMessage(state.contactsMessage, '', '');
    renderStatusLine();
    try {
      const data = await getJson(apiUrl('/api/memory/impressions/list', {}));
      state.snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
      state.loaded.contacts = true;
    } catch (error) {
      state.snapshots = [];
      state.loaded.contacts = true;
      setMessage(state.contactsMessage, 'error', (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.'));
    }
    state.loading = false;
    render();
  };

  const abbreviateId = (id) => {
    const trimmed = String(id || '').trim();
    if (trimmed.length <= 16) return trimmed;
    return trimmed.slice(0, 8) + '…' + trimmed.slice(-6);
  };
  const subjectLabel = (snapshot) => {
    const name = String(snapshot.subjectName || '').trim();
    return name || abbreviateId(snapshot.subjectGlobalMetaId);
  };

  const renderContacts = () => {
    if (state.contactsMessage.kind === 'error') {
      return '<div class="table-empty" data-memory-contacts-error><strong>'
        + escapeHtml(state.contactsMessage.text) + '</strong>'
        + escapeHtml(uiText('memory.contacts.errorHint', 'Create the Bot identity first, then let it chat or dream to gather impressions.'))
        + '</div>';
    }
    if (state.contactDetail) {
      const detail = state.contactDetail;
      const snapshot = detail.snapshot || null;
      const observations = Array.isArray(detail.observations) ? detail.observations : [];
      const snapshotHtml = snapshot
        ? '<div class="memory-row"><div class="memory-row-head"><strong>' + escapeHtml(subjectLabel(snapshot)) + '</strong>'
        + '<span class="memory-contact-id" title="' + escapeHtml(snapshot.subjectGlobalMetaId || '') + '">' + escapeHtml(abbreviateId(snapshot.subjectGlobalMetaId)) + '</span></div>'
        + (snapshot.summaryText ? '<p class="memory-row-text">' + escapeHtml(snapshot.summaryText) + '</p>' : '')
        + (snapshot.styleDescriptors && snapshot.styleDescriptors.length
          ? '<p class="field-hint">' + escapeHtml(uiText('memory.contacts.style', 'Style')) + ': ' + escapeHtml(snapshot.styleDescriptors.join(', ')) + '</p>' : '')
        + (snapshot.relationshipTemperature
          ? '<p class="field-hint">' + escapeHtml(uiText('memory.contacts.temperature', 'Relationship temperature')) + ': ' + escapeHtml(snapshot.relationshipTemperature) + '</p>' : '')
        + (snapshot.communicationGuidance
          ? '<p class="field-hint">' + escapeHtml(uiText('memory.contacts.guidance', 'Communication guidance')) + ': ' + escapeHtml(snapshot.communicationGuidance) + '</p>' : '')
        + (snapshot.uncertaintyText
          ? '<p class="field-hint">' + escapeHtml(uiText('memory.contacts.uncertainty', 'Uncertainty')) + ': ' + escapeHtml(snapshot.uncertaintyText) + '</p>' : '')
        + '</div>'
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('memory.contacts.noSubject', 'No impression found for this contact.')) + '</strong></div>';
      const observationsHtml = observations.length
        ? observations.map((observation) => '<div class="memory-row" data-active="' + (observation.status === 'active' ? 'true' : 'false') + '">'
          + '<p class="memory-row-text">' + escapeHtml(observation.observationText || '') + '</p>'
          + (observation.interpretationText ? '<p class="field-hint">' + escapeHtml(observation.interpretationText) + '</p>' : '')
          + '<div class="memory-row-head"><span class="section-badge">'
          + escapeHtml(String(observation.dreamDate || ''))
          + (observation.status ? ' · ' + escapeHtml(uiText('memory.contacts.observationStatus.' + observation.status, observation.status)) : '')
          + '</span></div></div>').join('')
        : '';
      return '<div class="memory-contact-detail" data-memory-contacts-detail>'
        + '<div><button class="btn btn-sm" type="button" data-memory-contacts-back>' + escapeHtml(uiText('memory.contacts.back', 'Back to contacts')) + '</button></div>'
        + snapshotHtml
        + (observations.length
          ? '<h3 class="card-title">' + escapeHtml(uiText('memory.contacts.observations', 'Dream observations')) + '</h3>' + observationsHtml
          : '')
        + '</div>';
    }
    const rows = state.snapshots.map((snapshot) => '<button class="memory-contact" type="button" data-memory-contact="'
      + escapeHtml(snapshot.subjectGlobalMetaId) + '">'
      + '<span class="memory-contact-name">' + escapeHtml(subjectLabel(snapshot)) + '</span>'
      + (String(snapshot.subjectName || '').trim()
        ? '<span class="memory-contact-id" title="' + escapeHtml(snapshot.subjectGlobalMetaId) + '">' + escapeHtml(abbreviateId(snapshot.subjectGlobalMetaId)) + '</span>'
        : '')
      + '<span class="memory-row-meta">' + escapeHtml(uiText('memory.contacts.interactions', '{count} interactions', { count: Number(snapshot.interactionCount) || 0 })) + '</span>'
      + (snapshot.summaryText ? '<span class="memory-contact-summary">' + escapeHtml(snapshot.summaryText) + '</span>' : '')
      + '</button>').join('');
    return state.snapshots.length
      ? '<div class="memory-contact-list" data-memory-contacts-list>' + rows + '</div>'
      : '<div class="table-empty" data-memory-contacts-empty><strong>' + escapeHtml(uiText('memory.contacts.empty', 'No contacts yet'))
      + '</strong>' + escapeHtml(uiText('memory.contacts.emptyHint', 'Impressions appear after the Bot chats with someone or dreams about them.')) + '</div>';
  };

  const bindContacts = () => {
    if (!elements.panel) return;
    const back = elements.panel.querySelector('[data-memory-contacts-back]');
    if (back) back.addEventListener('click', () => {
      state.contactDetail = null;
      render();
    });
    elements.panel.querySelectorAll('[data-memory-contact]').forEach((button) => {
      button.addEventListener('click', () => showContact(button.getAttribute('data-memory-contact') || ''));
    });
  };

  const showContact = async (subject) => {
    if (state.busyContacts || !subject) return;
    state.busyContacts = true;
    render();
    try {
      const data = await getJson(apiUrl('/api/memory/impressions/show', { subject }));
      state.contactDetail = {
        subject,
        snapshot: data.snapshot || null,
        observations: Array.isArray(data.observations) ? data.observations : [],
      };
    } catch (error) {
      setMessage(state.contactsMessage, 'error', (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.'));
    } finally {
      state.busyContacts = false;
      render();
    }
  };

  // ----- Dream tab -----

  const loadDream = async (options) => {
    const silent = Boolean(options && options.silent);
    if (!silent) {
      state.loading = true;
      state.error = '';
      renderStatusLine();
    }
    try {
      const [status, due, summaries, identity, capabilities, policy] = await Promise.all([
        getJson(apiUrl('/api/dream/status', {})),
        getJson(apiUrl('/api/dream/due', {})),
        getJson(apiUrl('/api/dream/summaries', { limit: 30 })),
        getJson(apiUrl('/api/dream/self-identity', {})),
        getJson(apiUrl('/api/dream/capabilities', { limit: 50 })),
        getJson(apiUrl('/api/memory/policy', {})),
      ]);
      state.dreamStatus = status;
      state.dreamDue = due;
      state.dreamPolicyEnabled = policy && policy.effective ? policy.effective.dreamEnabled === true : null;
      state.summaries = Array.isArray(summaries.summaries) ? summaries.summaries : [];
      state.selfIdentity = identity;
      state.capabilities = Array.isArray(capabilities.drafts) ? capabilities.drafts : [];
      state.loaded.dream = true;
      if (!silent) state.error = '';
    } catch (error) {
      if (!silent) {
        state.error = (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.');
      }
    }
    state.loading = false;
    render();
    if (state.loaded.dream && dreamRunningNow()) scheduleDreamPoll();
  };

  const dreamRunningNow = () => {
    const runs = state.dreamStatus && Array.isArray(state.dreamStatus.runs) ? state.dreamStatus.runs : [];
    return runs.some((run) => run.status === 'running');
  };

  const scheduleDreamPoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = 0;
      loadDream({ silent: true }).catch(() => undefined);
    }, 3000);
  };

  const renderDream = () => {
    const status = state.dreamStatus || {};
    const runs = Array.isArray(status.runs) ? status.runs : [];
    const due = state.dreamDue || {};
    const dueDates = Array.isArray(due.dueDates) ? due.dueDates : [];
    const repairDates = Array.isArray(due.repairDates) ? due.repairDates : [];
    const summaryDates = {};
    state.summaries.forEach((summary) => { summaryDates[summary.summaryDate] = true; });

    const enabledRow = state.dreamPolicyEnabled === null
      ? '<span class="muted">' + escapeHtml(uiText('memory.loading', 'Loading memory...')) + '</span>'
      : statusPillFor(state.dreamPolicyEnabled);
    const identityRow = status.hasSelfIdentity
      ? pill('status-online', uiText('memory.dream.identityYes', 'Established'), false)
      : pill('', uiText('memory.dream.identityNo', 'Not yet'), false);
    const statusRows = [
      ['memory.dream.enabledLabel', 'Dream', enabledRow],
      ['memory.dream.diariesLabel', 'Diaries', escapeHtml(uiText('memory.dream.summaryCount', '{count} diaries', { count: Number(status.summaryCount) || 0 }))],
      ['memory.dream.latestLabel', 'Latest diary', escapeHtml(status.latestSummaryDate || uiText('surf.never', 'Never'))],
      ['memory.dream.identityLabel', 'Self-identity', identityRow],
      ['memory.dream.nextDueLabel', 'Next due', escapeHtml(dueDates[0] || uiText('memory.dream.dueNone', 'Up to date'))],
    ];

    const runRows = runs.slice(0, 10).map((run) => {
      const kind = run.status === 'running' ? 'status-active' : (run.status === 'completed' ? 'status-completed' : 'status-failure');
      const pulse = run.status === 'running' ? ' data-memory-pulse="true"' : '';
      const parts = [run.dreamDate, uiText('memory.dream.runStatus.' + run.status, run.status),
        uiText('memory.dream.attempts', '{count} attempt(s)', { count: Number(run.attemptCount) || 0 })];
      if (run.status === 'completed' && !summaryDates[run.dreamDate]) parts.push(uiText('memory.dream.quietDay', 'quiet day'));
      let retry = '';
      if (run.status === 'failed') {
        if (typeof run.nextRetryAt === 'number' && run.nextRetryAt > Date.now()) {
          parts.push(uiText('memory.dream.nextRetry', 'next retry {when}', { when: untilLabel(run.nextRetryAt) }));
        }
        if (run.error) parts.push(run.error);
        retry = '<button class="btn btn-sm" type="button" data-memory-dream-retry="' + escapeHtml(run.dreamDate) + '"'
          + (state.busyDreamRun || state.retryingDate ? ' disabled' : '') + '>'
          + escapeHtml(state.retryingDate === run.dreamDate
            ? uiText('memory.dream.running', 'Dreaming...')
            : uiText('memory.dream.retry', 'Retry'))
          + '</button>';
      }
      const errorLine = run.status === 'failed' && run.error
        ? '<div class="memory-run-error">' + escapeHtml(uiText('surf.runError', 'Error: {message}', { message: run.error })) + '</div>'
        : '';
      return '<div class="memory-due-row"><span><span class="status-pill ' + kind + '"' + pulse + '><span class="status-dot"></span>'
        + escapeHtml(uiText('memory.dream.runStatus.' + run.status, run.status)) + '</span> '
        + escapeHtml(parts.filter((part, index) => index !== 1).join(' · ')) + '</span>' + retry + '</div>' + errorLine;
    }).join('');

    const diaries = state.summaries.map((summary) => {
      const expanded = state.expandedSummary === summary.summaryDate;
      const stats = summary.stats || {};
      const sections = summary.sections && typeof summary.sections === 'object' ? summary.sections : {};
      const sectionKeys = Object.keys(sections);
      const sessionRefs = Array.isArray(summary.sessionRefs) ? summary.sessionRefs : [];
      return '<div class="memory-diary" data-memory-diary="' + escapeHtml(summary.summaryDate) + '">'
        + '<button class="memory-diary-head" type="button" data-memory-diary-toggle="' + escapeHtml(summary.summaryDate) + '">'
        + '<strong>' + escapeHtml(summary.summaryDate) + '</strong>'
        + '<span class="memory-row-meta">' + escapeHtml(uiText('memory.dream.stats', '{sessions} sessions · {messages} messages', {
          sessions: Number(stats.sessionCount) || 0,
          messages: Number(stats.messageCount) || 0,
        })) + '</span>'
        + '</button>'
        + (expanded
          ? '<p class="memory-diary-text">' + escapeHtml(summary.summaryText || '') + '</p>'
          + (sectionKeys.length
            ? '<div class="memory-diary-sections"><h3 class="card-title">' + escapeHtml(uiText('memory.dream.sections', 'Sections')) + '</h3>'
            + sectionKeys.map((key) => '<p><strong>' + escapeHtml(key) + '</strong>: ' + escapeHtml(sections[key]) + '</p>').join('') + '</div>'
            : '')
          + (sessionRefs.length
            ? '<p class="field-hint">' + escapeHtml(uiText('memory.dream.sessions', 'Source sessions')) + ': '
            + escapeHtml(sessionRefs.map((ref) => ref.sessionId || ref).join(', ')) + '</p>'
            : '')
          : '')
        + '</div>';
    }).join('');

    const identityText = state.selfIdentity ? String(state.selfIdentity.text || '').trim() : '';
    const identityUpdatedMs = parseTime(state.selfIdentity ? state.selfIdentity.updatedAt : 0);
    const capabilities = state.capabilities.map((draft) => '<div class="memory-row" data-memory-capability>'
      + '<div class="memory-row-head"><strong>' + escapeHtml(draft.title || '') + '</strong>'
      + '<span class="section-badge">' + escapeHtml(uiText('memory.dream.capability.' + draft.capabilityType, draft.capabilityType)) + '</span>'
      + '<span class="section-badge">' + escapeHtml(draft.dreamDate || '') + '</span></div>'
      + (draft.description ? '<p class="memory-row-text">' + escapeHtml(draft.description) + '</p>' : '')
      + '</div>').join('');

    const surfHref = '/ui/surf' + (fromBot ? '?from=' + encodeURIComponent(fromBot) : '');

    return '<div class="memory-grid" data-memory-dream-status-card>'
      + '<article class="card"><h2 class="card-title">' + escapeHtml(uiText('memory.dream.statusTitle', 'Dream status')) + '</h2>'
      + '<dl class="def-list">' + statusRows.map((row) => '<div class="def-row"><dt>' + escapeHtml(uiText(row[0], row[1])) + '</dt><dd>' + row[2] + '</dd></div>').join('') + '</dl>'
      + '<p class="field-hint"><a href="' + escapeHtml(surfHref) + '">' + escapeHtml(uiText('memory.dream.surfLink', 'Set up surf before dream')) + '</a></p>'
      + '</article>'
      + '<article class="card" data-memory-dream-run-card><h2 class="card-title">' + escapeHtml(uiText('memory.dream.runTitle', 'Run a dream')) + '</h2>'
      + '<form class="memory-add-form" data-memory-dream-run-form>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.dream.runDate', 'Dream date')) + '</span>'
      + '<input type="date" data-memory-dream-date value="' + escapeHtml(state.dreamDate) + '" /></label>'
      + '<div class="memory-form-actions">'
      + '<button class="btn btn-sm btn-primary" type="submit" data-memory-dream-run' + (state.busyDreamRun ? ' disabled' : '') + '>'
      + escapeHtml(state.busyDreamRun ? uiText('memory.dream.running', 'Dreaming...') : uiText('memory.dream.runNow', 'Run dream now'))
      + '</button>'
      + messageHtml(state.dreamMessage)
      + '</div></form>'
      + (dueDates.length || repairDates.length
        ? '<p class="field-hint">' + escapeHtml(uiText('memory.dream.dueLabel', 'Due dates'))
        + ': ' + escapeHtml(dueDates.concat(repairDates).join(', ')) + '</p>'
        : '<p class="field-hint">' + escapeHtml(uiText('memory.dream.dueNone', 'Up to date')) + '</p>')
      + '</article>'
      + '</div>'
      + (runs.length
        ? '<article class="card" data-memory-dream-runs><h2 class="card-title">' + escapeHtml(uiText('memory.dream.runsTitle', 'Recent runs')) + '</h2>'
        + '<div class="memory-list">' + runRows + '</div></article>'
        : '')
      + '<article class="card" data-memory-dream-diaries><h2 class="card-title">' + escapeHtml(uiText('memory.dream.diariesTitle', 'Dream diaries')) + '</h2>'
      + (state.summaries.length
        ? '<div class="memory-list">' + diaries + '</div>'
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('memory.dream.diariesEmpty', 'No dream diaries yet'))
        + '</strong>' + escapeHtml(uiText('memory.dream.diariesEmptyHint', 'Run a dream to distill the day into a diary.')) + '</div>')
      + '</article>'
      + '<div class="memory-grid">'
      + '<article class="card" data-memory-dream-identity><h2 class="card-title">' + escapeHtml(uiText('memory.dream.identityTitle', 'Self-identity')) + '</h2>'
      + (identityText
        ? '<p class="memory-identity">' + escapeHtml(identityText) + '</p>'
        + (identityUpdatedMs ? '<p class="field-hint">' + escapeHtml(uiText('memory.dream.identityUpdated', 'Updated {when}', { when: formatRelative(identityUpdatedMs) || formatDateTime(identityUpdatedMs) })) + '</p>' : '')
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('memory.dream.identityEmpty', 'The Bot has not written its self-identity yet.'))
        + '</strong>' + escapeHtml(uiText('memory.dream.identityEmptyHint', 'It appears after the first dream.')) + '</div>')
      + '</article>'
      + '<article class="card" data-memory-dream-capabilities><h2 class="card-title">' + escapeHtml(uiText('memory.dream.capabilitiesTitle', 'Capability drafts')) + '</h2>'
      + (state.capabilities.length
        ? '<div class="memory-list">' + capabilities + '</div>'
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('memory.dream.capabilitiesEmpty', 'No capability drafts yet'))
        + '</strong>' + escapeHtml(uiText('memory.dream.capabilitiesHint', 'Dreams propose new skills, workflows, and tool patterns here.')) + '</div>')
      + '</article>'
      + '</div>';
  };

  const bindDream = () => {
    if (!elements.panel) return;
    const dateInput = elements.panel.querySelector('[data-memory-dream-date]');
    if (dateInput) dateInput.addEventListener('change', () => {
      state.dreamDate = String(dateInput.value || '').trim() || yesterdayLocal();
    });
    const runForm = elements.panel.querySelector('[data-memory-dream-run-form]');
    if (runForm) runForm.addEventListener('submit', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      runDream(state.dreamDate);
    });
    renderMessage(elements.panel.querySelector('[data-memory-dream-run-form] .status-msg'), state.dreamMessage);
    elements.panel.querySelectorAll('[data-memory-diary-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const date = button.getAttribute('data-memory-diary-toggle') || '';
        state.expandedSummary = state.expandedSummary === date ? '' : date;
        render();
      });
    });
    elements.panel.querySelectorAll('[data-memory-dream-retry]').forEach((button) => {
      button.addEventListener('click', () => runDream(button.getAttribute('data-memory-dream-retry') || '', true));
    });
  };

  const runDream = async (date, isRetry) => {
    if (state.busyDreamRun || !date) return;
    state.busyDreamRun = true;
    if (isRetry) state.retryingDate = date;
    setMessage(state.dreamMessage, '', '');
    render();
    try {
      await postJson('/api/dream/run', { date });
      setMessage(state.dreamMessage, 'success', uiText('memory.dream.runStarted', 'Dream run started. The diary appears when the run finishes.'));
      await loadDream({ silent: true });
    } catch (error) {
      setMessage(state.dreamMessage, 'error', (error && error.message) || uiText('memory.dream.runStartFailed', 'Failed to start the dream run.'));
      render();
    } finally {
      state.busyDreamRun = false;
      state.retryingDate = '';
      render();
    }
  };

  // ----- Settings tab (policy + hygiene) -----

  const loadSettings = async () => {
    state.loading = true;
    state.error = '';
    renderStatusLine();
    try {
      const [policy, hygiene] = await Promise.all([
        getJson(apiUrl('/api/memory/policy', {})),
        getJson(apiUrl('/api/memory/hygiene/status', {})),
      ]);
      state.policy = policy;
      state.policyHasOverride = Boolean(policy.override && Object.keys(policy.override).length > 0);
      state.hygiene = hygiene;
      if (!state.policyDraft) state.policyDraft = policyDraftFrom(policy.effective || {});
      if (!state.hygieneDraft) state.hygieneDraft = hygieneDraftFrom(hygiene.config || {});
      state.loaded.settings = true;
    } catch (error) {
      state.error = (error && error.message) || uiText('memory.loadFailed', 'Memory failed to load.');
    }
    state.loading = false;
    render();
  };

  const policyDraftFrom = (effective) => ({
    memoryEnabled: effective.memoryEnabled === true,
    memoryImplicitUpdateEnabled: effective.memoryImplicitUpdateEnabled === true,
    memoryLlmJudgeEnabled: effective.memoryLlmJudgeEnabled === true,
    dreamEnabled: effective.dreamEnabled === true,
    memoryGuardLevel: String(effective.memoryGuardLevel || 'strict'),
    memoryUserMemoriesMaxItems: Number(effective.memoryUserMemoriesMaxItems) || 20,
    memoryPromptMaxChars: Number(effective.memoryPromptMaxChars) || 12000,
  });
  const hygieneDraftFrom = (config) => ({
    enabled: config.enabled !== false,
    memoryDecayDays: Number(config.memoryDecayDays) || 180,
    knowledgeRevisionKeep: Number(config.knowledgeRevisionKeep) || 5,
    dreamRunRetentionDays: Number(config.dreamRunRetentionDays) || 90,
    deepConsolidationEnabled: config.deepConsolidationEnabled !== false,
    deepConsolidationIntervalDays: Number(config.deepConsolidationIntervalDays) || 7,
  });

  const renderSettings = () => {
    if (!state.policy || !state.hygiene) {
      return '<div class="table-empty"><strong>' + escapeHtml(uiText('memory.loading', 'Loading memory...')) + '</strong></div>';
    }
    const policy = state.policy.effective || {};
    const draft = state.policyDraft || policyDraftFrom(policy);
    const override = state.policyHasOverride;
    const hygiene = state.hygiene;
    const hygieneConfig = hygiene.config || {};
    const hygieneDraft = state.hygieneDraft || hygieneDraftFrom(hygieneConfig);
    const lastRun = hygiene.lastRun || null;
    const deepLastMs = parseTime(hygiene.deepConsolidationLastRunAt);

    const toggleRow = (field, labelKey, labelFallback, hintKey, hintFallback) => '<label class="kb-check">'
      + '<input type="checkbox" data-memory-policy-field="' + field + '"' + (draft[field] ? ' checked' : '') + (override ? '' : ' disabled') + ' />'
      + '<span>' + escapeHtml(uiText(labelKey, labelFallback)) + '</span></label>'
      + '<p class="field-hint">' + escapeHtml(uiText(hintKey, hintFallback)) + '</p>';

    const policyForm = override
      ? toggleRow('memoryEnabled', 'memory.settings.enabled', 'Memory enabled', 'memory.settings.enabledHint', 'Let the Bot keep memories at all.')
      + toggleRow('memoryImplicitUpdateEnabled', 'memory.settings.implicit', 'Learn from conversations', 'memory.settings.implicitHint', 'Capture and update memories while chatting.')
      + toggleRow('memoryLlmJudgeEnabled', 'memory.settings.judge', 'LLM judge', 'memory.settings.judgeHint', 'Let an LLM judge candidate memories before storing them.')
      + toggleRow('dreamEnabled', 'memory.settings.dream', 'Dream', 'memory.settings.dreamHint', 'Let the Bot dream nightly and distill the day.')
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.guard', 'Guard level')) + '</span>'
      + '<select data-memory-policy-field="memoryGuardLevel">'
      + ['strict', 'standard', 'relaxed'].map((level) => '<option value="' + level + '"' + (draft.memoryGuardLevel === level ? ' selected' : '') + '>'
      + escapeHtml(uiText('memory.settings.guard.' + level, level)) + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.maxItems', 'User memory slots')) + '</span>'
      + '<input type="number" min="1" max="60" step="1" data-memory-policy-field="memoryUserMemoriesMaxItems" value="' + escapeHtml(String(draft.memoryUserMemoriesMaxItems)) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.maxChars', 'Prompt budget (chars)')) + '</span>'
      + '<input type="number" min="2000" max="65536" step="500" data-memory-policy-field="memoryPromptMaxChars" value="' + escapeHtml(String(draft.memoryPromptMaxChars)) + '" /></label>'
      : '<dl class="def-list">'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.enabled', 'Memory enabled')) + '</dt><dd>' + statusPillFor(policy.memoryEnabled === true) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.implicit', 'Learn from conversations')) + '</dt><dd>' + statusPillFor(policy.memoryImplicitUpdateEnabled === true) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.judge', 'LLM judge')) + '</dt><dd>' + statusPillFor(policy.memoryLlmJudgeEnabled === true) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.dream', 'Dream')) + '</dt><dd>' + statusPillFor(policy.dreamEnabled === true) + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.guard', 'Guard level')) + '</dt><dd>' + escapeHtml(uiText('memory.settings.guard.' + String(policy.memoryGuardLevel || 'strict'), String(policy.memoryGuardLevel || 'strict'))) + '</dd></div>'
      + '</dl>';

    const counts = lastRun && lastRun.counts && typeof lastRun.counts === 'object'
      ? '<div class="memory-counts">' + Object.keys(lastRun.counts).map((step) => '<span>' + escapeHtml(step) + ': ' + escapeHtml(String(lastRun.counts[step])) + '</span>').join('') + '</div>'
      : '';
    const runErrors = lastRun && Array.isArray(lastRun.errors) && lastRun.errors.length
      ? '<p class="status-msg error">' + escapeHtml(lastRun.errors.join('; ')) + '</p>'
      : '';

    return '<div class="memory-grid">'
      + '<article class="card" data-memory-policy-card>'
      + '<h2 class="card-title">' + escapeHtml(uiText('memory.settings.policyTitle', 'Memory policy')) + '</h2>'
      + '<p class="card-subtitle">' + escapeHtml(uiText('memory.settings.policyHint', 'Defaults come from the host. Turn on the override to customize this Bot.')) + '</p>'
      + '<label class="kb-check"><input type="checkbox" data-memory-policy-override' + (override ? ' checked' : '') + ' />'
      + '<span>' + escapeHtml(uiText('memory.settings.override', 'Customize policy for this Bot')) + '</span></label>'
      + '<div data-memory-policy-form>' + policyForm + '</div>'
      + '<div class="memory-form-actions">'
      + (override
        ? '<button class="btn btn-sm btn-primary" type="button" data-memory-policy-save' + (state.busyPolicy ? ' disabled' : '') + '>'
        + escapeHtml(state.busyPolicy ? uiText('memory.settings.saving', 'Saving policy...') : uiText('memory.settings.save', 'Save policy')) + '</button>'
        : '<button class="btn btn-sm" type="button" data-memory-policy-reset' + (state.busyPolicy ? ' disabled' : '') + '>'
        + escapeHtml(uiText('memory.settings.reset', 'Use host defaults')) + '</button>')
      + messageHtml(state.policyMessage)
      + '</div></article>'
      + '<article class="card" data-memory-hygiene-card>'
      + '<h2 class="card-title">' + escapeHtml(uiText('memory.settings.hygieneTitle', 'Memory hygiene')) + '</h2>'
      + '<p class="card-subtitle">' + escapeHtml(uiText('memory.settings.hygieneHint', 'The nightly compression pass that retires what nothing reads again.')) + '</p>'
      + '<dl class="def-list">'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.hygieneLastRunLabel', 'Last run')) + '</dt><dd>'
      + escapeHtml(lastRun && lastRun.dateKey
        ? uiText('memory.settings.hygieneLastRun', 'Last run {date}', { date: lastRun.dateKey })
        : uiText('memory.settings.hygieneNever', 'Hygiene has not run yet.'))
      + (lastRun && lastRun.trigger === 'manual' ? ' · ' + escapeHtml(uiText('memory.settings.hygieneTrigger.manual', 'Manual')) : '')
      + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.hygieneDueLabel', 'Due')) + '</dt><dd>'
      + (hygiene.due === true
        ? pill('status-active', uiText('memory.settings.hygieneDue', 'Due now'), true)
        : escapeHtml(uiText('memory.settings.hygieneNotDue', 'Not due')))
      + '</dd></div>'
      + (deepLastMs
        ? '<div class="def-row"><dt>' + escapeHtml(uiText('memory.settings.hygieneDeepLabel', 'Last deep consolidation')) + '</dt><dd>'
        + escapeHtml(formatRelative(deepLastMs) || formatDateTime(deepLastMs)) + '</dd></div>'
        : '')
      + '</dl>'
      + counts + runErrors
      + '<div data-memory-hygiene-form>'
      + '<label class="kb-check"><input type="checkbox" data-memory-hygiene-field="enabled"' + (hygieneDraft.enabled ? ' checked' : '') + ' />'
      + '<span>' + escapeHtml(uiText('memory.settings.hygieneEnabled', 'Hygiene enabled')) + '</span></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.decayDays', 'Memory decay (days)')) + '</span>'
      + '<input type="number" min="14" max="3650" step="1" data-memory-hygiene-field="memoryDecayDays" value="' + escapeHtml(String(hygieneDraft.memoryDecayDays)) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.revisionKeep', 'Knowledge revisions kept')) + '</span>'
      + '<input type="number" min="1" max="50" step="1" data-memory-hygiene-field="knowledgeRevisionKeep" value="' + escapeHtml(String(hygieneDraft.knowledgeRevisionKeep)) + '" /></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.runRetention', 'Dream run retention (days)')) + '</span>'
      + '<input type="number" min="30" max="3650" step="1" data-memory-hygiene-field="dreamRunRetentionDays" value="' + escapeHtml(String(hygieneDraft.dreamRunRetentionDays)) + '" /></label>'
      + '<label class="kb-check"><input type="checkbox" data-memory-hygiene-field="deepConsolidationEnabled"' + (hygieneDraft.deepConsolidationEnabled ? ' checked' : '') + ' />'
      + '<span>' + escapeHtml(uiText('memory.settings.deepEnabled', 'Deep consolidation')) + '</span></label>'
      + '<label class="field"><span>' + escapeHtml(uiText('memory.settings.deepInterval', 'Deep consolidation interval (days)')) + '</span>'
      + '<input type="number" min="7" max="365" step="1" data-memory-hygiene-field="deepConsolidationIntervalDays" value="' + escapeHtml(String(hygieneDraft.deepConsolidationIntervalDays)) + '" /></label>'
      + '</div>'
      + '<div class="memory-form-actions">'
      + '<button class="btn btn-sm" type="button" data-memory-hygiene-save' + (state.busyHygiene ? ' disabled' : '') + '>'
      + escapeHtml(uiText('memory.settings.hygieneSave', 'Save hygiene config')) + '</button>'
      + '<button class="btn btn-sm btn-primary" type="button" data-memory-hygiene-run' + (state.busyHygiene ? ' disabled' : '') + '>'
      + escapeHtml(state.busyHygiene ? uiText('memory.settings.hygieneRunning', 'Running hygiene...') : uiText('memory.settings.hygieneRunNow', 'Run hygiene now'))
      + '</button>'
      + messageHtml(state.hygieneMessage)
      + '</div></article>'
      + '</div>';
  };

  const bindSettings = () => {
    if (!elements.panel) return;
    const overrideToggle = elements.panel.querySelector('[data-memory-policy-override]');
    if (overrideToggle) overrideToggle.addEventListener('change', () => {
      state.policyHasOverride = overrideToggle.checked === true;
      state.policyDraft = policyDraftFrom((state.policy && state.policy.effective) || {});
      render();
    });
    elements.panel.querySelectorAll('[data-memory-policy-field]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!state.policyDraft) return;
        const field = input.getAttribute('data-memory-policy-field');
        if (input.tagName === 'INPUT' && input.type === 'checkbox') state.policyDraft[field] = input.checked === true;
        else if (input.type === 'number') state.policyDraft[field] = Number(input.value) || 0;
        else state.policyDraft[field] = input.value;
      });
    });
    elements.panel.querySelectorAll('[data-memory-policy-save]').forEach((button) => {
      button.addEventListener('click', savePolicy);
    });
    elements.panel.querySelectorAll('[data-memory-policy-reset]').forEach((button) => {
      button.addEventListener('click', resetPolicy);
    });
    renderMessage(elements.panel.querySelector('[data-memory-policy-card] .status-msg'), state.policyMessage);
    elements.panel.querySelectorAll('[data-memory-hygiene-field]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!state.hygieneDraft) return;
        const field = input.getAttribute('data-memory-hygiene-field');
        if (input.tagName === 'INPUT' && input.type === 'checkbox') state.hygieneDraft[field] = input.checked === true;
        else state.hygieneDraft[field] = Number(input.value) || 0;
      });
    });
    elements.panel.querySelectorAll('[data-memory-hygiene-save]').forEach((button) => {
      button.addEventListener('click', saveHygieneConfig);
    });
    elements.panel.querySelectorAll('[data-memory-hygiene-run]').forEach((button) => {
      button.addEventListener('click', runHygiene);
    });
    renderMessage(elements.panel.querySelector('[data-memory-hygiene-card] .status-msg'), state.hygieneMessage);
  };

  const savePolicy = async () => {
    if (state.busyPolicy || !state.policyDraft) return;
    state.busyPolicy = true;
    setMessage(state.policyMessage, '', '');
    render();
    try {
      await postJson('/api/memory/policy', {
        memoryEnabled: state.policyDraft.memoryEnabled,
        memoryImplicitUpdateEnabled: state.policyDraft.memoryImplicitUpdateEnabled,
        memoryLlmJudgeEnabled: state.policyDraft.memoryLlmJudgeEnabled,
        dreamEnabled: state.policyDraft.dreamEnabled,
        memoryGuardLevel: state.policyDraft.memoryGuardLevel,
        memoryUserMemoriesMaxItems: Number(state.policyDraft.memoryUserMemoriesMaxItems) || 20,
        memoryPromptMaxChars: Number(state.policyDraft.memoryPromptMaxChars) || 12000,
      });
      setMessage(state.policyMessage, 'success', uiText('memory.settings.policySaved', 'Policy saved.'));
      await loadSettings();
    } catch (error) {
      setMessage(state.policyMessage, 'error', (error && error.message) || uiText('memory.settings.policySaveFailed', 'Failed to save the policy.'));
      render();
    } finally {
      state.busyPolicy = false;
      render();
    }
  };

  const resetPolicy = async () => {
    if (state.busyPolicy) return;
    state.busyPolicy = true;
    setMessage(state.policyMessage, '', '');
    render();
    try {
      await sendJson('DELETE', '/api/memory/policy', undefined);
      setMessage(state.policyMessage, 'success', uiText('memory.settings.policyReset', 'Policy override removed.'));
      state.policy = null;
      state.policyDraft = null;
      await loadSettings();
    } catch (error) {
      setMessage(state.policyMessage, 'error', (error && error.message) || uiText('memory.settings.policySaveFailed', 'Failed to save the policy.'));
      render();
    } finally {
      state.busyPolicy = false;
      render();
    }
  };

  const saveHygieneConfig = async () => {
    if (state.busyHygiene || !state.hygieneDraft) return;
    state.busyHygiene = true;
    setMessage(state.hygieneMessage, '', '');
    render();
    try {
      await postJson('/api/memory/hygiene/config', {
        enabled: state.hygieneDraft.enabled,
        memoryDecayDays: Number(state.hygieneDraft.memoryDecayDays) || 180,
        knowledgeRevisionKeep: Number(state.hygieneDraft.knowledgeRevisionKeep) || 5,
        dreamRunRetentionDays: Number(state.hygieneDraft.dreamRunRetentionDays) || 90,
        deepConsolidationEnabled: state.hygieneDraft.deepConsolidationEnabled,
        deepConsolidationIntervalDays: Number(state.hygieneDraft.deepConsolidationIntervalDays) || 7,
      });
      setMessage(state.hygieneMessage, 'success', uiText('memory.settings.hygieneSaved', 'Hygiene config saved.'));
      state.hygiene = null;
      state.hygieneDraft = null;
      await loadSettings();
    } catch (error) {
      setMessage(state.hygieneMessage, 'error', (error && error.message) || uiText('memory.settings.hygieneSaveFailed', 'Failed to save the hygiene config.'));
      render();
    } finally {
      state.busyHygiene = false;
      render();
    }
  };

  const runHygiene = async () => {
    if (state.busyHygiene) return;
    state.busyHygiene = true;
    setMessage(state.hygieneMessage, '', '');
    render();
    try {
      await postJson('/api/memory/hygiene/run', {});
      setMessage(state.hygieneMessage, 'success', uiText('memory.settings.hygieneRunDone', 'Hygiene run finished.'));
      state.hygiene = null;
      await loadSettings();
    } catch (error) {
      setMessage(state.hygieneMessage, 'error', (error && error.message) || uiText('memory.settings.hygieneRunFailed', 'Hygiene run failed.'));
      render();
    } finally {
      state.busyHygiene = false;
      render();
    }
  };

  // ----- Root render -----

  const renderPanel = () => {
    if (!elements.panel) return;
    const renderers = {
      knowledge: renderKnowledge,
      facts: renderFacts,
      contacts: renderContacts,
      dream: renderDream,
      settings: renderSettings,
    };
    elements.panel.innerHTML = (renderers[state.activeTab] || renderKnowledge)();
    const binders = {
      knowledge: bindKnowledge,
      facts: bindFacts,
      contacts: bindContacts,
      dream: bindDream,
      settings: bindSettings,
    };
    const binder = binders[state.activeTab];
    if (binder) binder();
  };

  const render = () => {
    renderStatusLine();
    renderTabs();
    renderPanel();
  };

  const refreshActiveTab = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = 0;
    }
    state.loaded[state.activeTab] = false;
    ensureTabLoaded(state.activeTab);
  };

  if (elements.refresh) elements.refresh.addEventListener('click', refreshActiveTab);
  window.addEventListener('oac:i18n-changed', render);
  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearTimeout(pollTimer);
    if (confirmTimer) clearTimeout(confirmTimer);
  });

  render();
  ensureTabLoaded(state.activeTab);
})();`,
  };
}
