import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';

export function buildSchedulePageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  return {
    page: 'schedule',
    title: i18n.t('schedule.title'),
    titleKey: 'schedule.title',
    eyebrow: i18n.t('schedule.eyebrow'),
    heading: i18n.t('schedule.heading'),
    description: i18n.t('schedule.description'),
    panels: [],
    contentHtml: `
      <section class="schedule-shell" data-schedule-shell>
        <div class="schedule-toolbar">
          <div>
            <h1 data-i18n-key="schedule.heading">${i18n.t('schedule.heading')}</h1>
            <p data-schedule-status data-i18n-key="schedule.status.loading">${i18n.t('schedule.status.loading')}</p>
          </div>
          <div class="schedule-toolbar-actions">
            <button class="btn btn-sm" type="button" data-schedule-refresh data-i18n-key="schedule.refresh">${i18n.t('schedule.refresh')}</button>
            <button class="btn btn-primary btn-sm" type="button" data-schedule-new data-i18n-key="schedule.newTask">${i18n.t('schedule.newTask')}</button>
          </div>
        </div>
        <article class="card schedule-context" data-schedule-context>
          <label class="field">
            <span data-i18n-key="schedule.botLabel">${i18n.t('schedule.botLabel')}</span>
            <select data-schedule-bot-select></select>
          </label>
          <p class="field-hint" data-schedule-bot-hint data-i18n-key="schedule.botHint">${i18n.t('schedule.botHint')}</p>
          <p class="table-empty" data-schedule-no-bots hidden>
            <strong data-i18n-key="schedule.noBots">${i18n.t('schedule.noBots')}</strong>
            <span data-i18n-key="schedule.noBotsHint">${i18n.t('schedule.noBotsHint')}</span>
            <a href="/ui/bot" data-i18n-key="action.openBotPage">${i18n.t('action.openBotPage')}</a>
          </p>
        </article>
        <article class="card schedule-editor" data-schedule-editor hidden>
          <h2 class="card-title" data-schedule-editor-title></h2>
          <form class="schedule-editor" data-schedule-form>
            <label class="field">
              <span data-i18n-key="schedule.fieldName">${i18n.t('schedule.fieldName')}</span>
              <input type="text" data-schedule-name />
            </label>
            <label class="field">
              <span data-i18n-key="schedule.fieldPrompt">${i18n.t('schedule.fieldPrompt')}</span>
              <textarea rows="4" data-schedule-prompt></textarea>
            </label>
            <div class="field">
              <span data-i18n-key="schedule.fieldSchedule">${i18n.t('schedule.fieldSchedule')}</span>
              <div class="schedule-kind-row">
                <select data-schedule-kind>
                  <option value="interval" data-i18n-key="schedule.kind.interval">${i18n.t('schedule.kind.interval')}</option>
                  <option value="cron" data-i18n-key="schedule.kind.cron">${i18n.t('schedule.kind.cron')}</option>
                  <option value="at" data-i18n-key="schedule.kind.at">${i18n.t('schedule.kind.at')}</option>
                </select>
                <input type="datetime-local" data-schedule-at hidden />
                <div class="schedule-interval-row" data-schedule-interval-row>
                  <input type="number" min="1" step="1" data-schedule-interval-value value="1" />
                  <select data-schedule-interval-unit>
                    <option value="minute" data-i18n-key="schedule.unit.minute">${i18n.t('schedule.unit.minute')}</option>
                    <option value="hour" data-i18n-key="schedule.unit.hour">${i18n.t('schedule.unit.hour')}</option>
                    <option value="day" data-i18n-key="schedule.unit.day">${i18n.t('schedule.unit.day')}</option>
                  </select>
                </div>
                <input type="text" placeholder="0 9 * * *" data-schedule-cron hidden />
              </div>
            </div>
            <label class="field">
              <span data-i18n-key="schedule.fieldChannel">${i18n.t('schedule.fieldChannel')}</span>
              <select data-schedule-channel>
                <option value="auto" data-i18n-key="schedule.channel.auto">${i18n.t('schedule.channel.auto')}</option>
                <option value="host" data-i18n-key="schedule.channel.host">${i18n.t('schedule.channel.host')}</option>
                <option value="daemon" data-i18n-key="schedule.channel.daemon">${i18n.t('schedule.channel.daemon')}</option>
              </select>
            </label>
            <p class="field-hint" data-i18n-key="schedule.channelHint">${i18n.t('schedule.channelHint')}</p>
            <p class="status-msg" data-schedule-editor-status role="status" aria-live="polite"></p>
            <div class="schedule-editor-actions">
              <button class="btn btn-primary btn-sm" type="submit" data-schedule-submit></button>
              <button class="btn btn-sm" type="button" data-schedule-cancel data-i18n-key="schedule.cancel">${i18n.t('schedule.cancel')}</button>
            </div>
          </form>
        </article>
        <div class="schedule-tasks">
          <div class="section-header">
            <h2 class="section-title" data-i18n-key="schedule.tasksTitle">${i18n.t('schedule.tasksTitle')}</h2>
          </div>
          <div class="table-wrap" data-schedule-task-table></div>
        </div>
        <article class="card schedule-runs" data-schedule-runs-card>
          <h2 class="card-title" data-schedule-runs-title></h2>
          <div class="table-wrap" data-schedule-runs-table></div>
        </article>
      </section>
    `,
    script: `(() => {
  const elements = {
    status: document.querySelector('[data-schedule-status]'),
    refresh: document.querySelector('[data-schedule-refresh]'),
    newTask: document.querySelector('[data-schedule-new]'),
    context: document.querySelector('[data-schedule-context]'),
    botSelect: document.querySelector('[data-schedule-bot-select]'),
    botHint: document.querySelector('[data-schedule-bot-hint]'),
    noBots: document.querySelector('[data-schedule-no-bots]'),
    editor: document.querySelector('[data-schedule-editor]'),
    editorTitle: document.querySelector('[data-schedule-editor-title]'),
    form: document.querySelector('[data-schedule-form]'),
    nameInput: document.querySelector('[data-schedule-name]'),
    promptInput: document.querySelector('[data-schedule-prompt]'),
    kindSelect: document.querySelector('[data-schedule-kind]'),
    atInput: document.querySelector('[data-schedule-at]'),
    intervalRow: document.querySelector('[data-schedule-interval-row]'),
    intervalValue: document.querySelector('[data-schedule-interval-value]'),
    intervalUnit: document.querySelector('[data-schedule-interval-unit]'),
    cronInput: document.querySelector('[data-schedule-cron]'),
    channelSelect: document.querySelector('[data-schedule-channel]'),
    editorStatus: document.querySelector('[data-schedule-editor-status]'),
    submit: document.querySelector('[data-schedule-submit]'),
    cancel: document.querySelector('[data-schedule-cancel]'),
    taskTable: document.querySelector('[data-schedule-task-table]'),
    runsCard: document.querySelector('[data-schedule-runs-card]'),
    runsTitle: document.querySelector('[data-schedule-runs-title]'),
    runsTable: document.querySelector('[data-schedule-runs-table]'),
  };
  const query = new URLSearchParams(window.location.search);
  const fromParam = (query.get('from') || '').trim();

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
  const formatIn = (value) => {
    const ms = parseTime(value);
    if (!ms) return '';
    const minutes = Math.ceil((ms - Date.now()) / 60000);
    if (minutes <= 1) return uiText('schedule.nextDueNow', 'due now');
    if (minutes < 60) return uiText('time.inMinutes', 'in {n} min', { n: minutes });
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return uiText('time.inHours', 'in {n} hr', { n: hours });
    return uiText('time.inDays', 'in {n} d', { n: Math.ceil(hours / 24) });
  };
  const formatDuration = (ms) => {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return '';
    if (value < 60000) return Math.max(1, Math.round(value / 1000)) + 's';
    if (value < 3600000) return Math.round(value / 60000) + 'm';
    return Math.round(value / 3600000) + 'h';
  };

  const state = {
    loading: false,
    profiles: [],
    fromBot: '',
    tasks: [],
    selectedTaskId: '',
    runs: [],
    runsLoading: false,
    editorOpen: false,
    editingId: '',
    confirmDeleteId: '',
    busyIds: {},
    formBusy: false,
    runPollingId: '',
  };
  let runPollTimer = 0;
  const editorMessage = { kind: '', text: '' };
  const statusState = { key: 'schedule.status.loading', replacements: null, text: '' };

  const getJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('schedule.requestFailed', 'Request failed.'));
    }
    return payload.data || {};
  };
  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('schedule.requestFailed', 'Request failed.'));
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

  const profileLabel = (profile) => {
    const name = String(profile && profile.name || '').trim();
    const slug = String(profile && profile.slug || '').trim();
    return name && name !== slug ? name + ' (' + slug + ')' : (slug || name);
  };

  const cadenceParts = (task) => {
    const spec = (task && task.schedule) || {};
    if (spec.type === 'interval') {
      const ms = Number(spec.intervalMs) || 0;
      const minutes = Math.round(ms / 60000);
      if (minutes < 60) {
        return { kind: 'interval', text: uiText('schedule.cadence.everyMinutes', 'Every {n} minutes', { n: Math.max(1, minutes) }) };
      }
      const hours = Math.round(minutes / 60);
      if (hours < 24) {
        return { kind: 'interval', text: uiText('schedule.cadence.everyHours', 'Every {n} hours', { n: Math.max(1, hours) }) };
      }
      return { kind: 'interval', text: uiText('schedule.cadence.everyDays', 'Every {n} days', { n: Math.max(1, Math.round(hours / 24)) }) };
    }
    if (spec.type === 'cron') {
      return { kind: 'cron', text: String(spec.expression || '') };
    }
    if (spec.type === 'at') {
      return { kind: 'at', text: uiText('schedule.cadence.at', 'Once at {time}', { time: formatDateTime(spec.datetime) || String(spec.datetime || '') }) };
    }
    return { kind: '', text: '' };
  };

  const statusPill = (task) => {
    const lastStatus = task && task.enabled === false ? 'disabled' : (task && task.state && task.state.lastStatus) || 'none';
    if (lastStatus === 'running') {
      return '<span class="status-pill status-active"><span class="status-dot"></span>' + escapeHtml(uiText('schedule.taskStatus.running', 'Running')) + '</span>';
    }
    if (lastStatus === 'success') {
      return '<span class="status-pill status-completed"><span class="status-dot"></span>' + escapeHtml(uiText('schedule.taskStatus.success', 'Succeeded')) + '</span>';
    }
    if (lastStatus === 'error') {
      return '<span class="status-pill status-failure"><span class="status-dot"></span>' + escapeHtml(uiText('schedule.taskStatus.error', 'Failed')) + '</span>';
    }
    if (lastStatus === 'disabled') {
      return '<span class="status-pill status-offline"><span class="status-dot"></span>' + escapeHtml(uiText('schedule.taskStatus.disabled', 'Disabled')) + '</span>';
    }
    return '<span class="status-pill"><span class="status-dot"></span>' + escapeHtml(uiText('schedule.taskStatus.none', 'No runs yet')) + '</span>';
  };

  const renderBotSelect = () => {
    if (!elements.botSelect) return;
    if (!state.profiles.length) {
      elements.botSelect.innerHTML = '';
      if (elements.botSelect) elements.botSelect.disabled = true;
      if (elements.botHint) elements.botHint.hidden = true;
      if (elements.noBots) elements.noBots.hidden = false;
      return;
    }
    if (elements.botHint) elements.botHint.hidden = false;
    if (elements.noBots) elements.noBots.hidden = true;
    elements.botSelect.disabled = state.loading || state.formBusy;
    elements.botSelect.innerHTML = state.profiles.map((profile) => {
      const slug = String(profile.slug || '');
      return '<option value="' + escapeHtml(slug) + '"' + (slug === state.fromBot ? ' selected' : '') + '>'
        + escapeHtml(profileLabel(profile)) + '</option>';
    }).join('');
  };

  const renderTasks = () => {
    if (!elements.taskTable) return;
    if (!state.fromBot) {
      elements.taskTable.innerHTML = '';
      return;
    }
    if (!state.tasks.length) {
      elements.taskTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('schedule.tasksEmpty', 'No scheduled tasks yet.'))
        + '</strong>' + escapeHtml(uiText('schedule.tasksEmptyHint', 'Create a task to run a prompt on a one-time, repeating, or cron schedule.'))
        + '</div>';
      return;
    }
    const head = '<thead><tr>'
      + '<th>' + escapeHtml(uiText('schedule.colTask', 'Task')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colCadence', 'Cadence')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colChannel', 'Channel')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colStatus', 'Status')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colNextRun', 'Next run')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colLastRun', 'Last run')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colActions', 'Actions')) + '</th>'
      + '</tr></thead>';
    const rows = state.tasks.map((task) => {
      const busy = state.busyIds[task.id] === true;
      const cadence = cadenceParts(task);
      const channelKey = 'schedule.channel.' + (task.channel || 'auto');
      const channelFallback = task.channel === 'host' ? 'Host' : task.channel === 'daemon' ? 'Daemon' : 'Auto';
      const nextRun = task.enabled ? (formatIn(task.state && task.state.nextRunAtMs) || formatDateTime(task.state && task.state.nextRunAtMs) || uiText('schedule.nextNone', '—')) : uiText('schedule.nextDisabled', 'Off');
      const lastRun = formatRelative(task.state && task.state.lastRunAtMs) || formatDateTime(task.state && task.state.lastRunAtMs) || uiText('schedule.never', 'Never');
      const errors = (task.state && Number(task.state.consecutiveErrors) > 0)
        ? '<div class="schedule-error-line">' + escapeHtml(uiText('schedule.consecutiveErrors', '{n} consecutive failures', { n: Number(task.state.consecutiveErrors) })) + '</div>'
        : '';
      const lastError = task.state && task.state.lastError
        ? '<div class="schedule-error-line">' + escapeHtml(uiText('schedule.lastError', 'Last error: {message}', { message: task.state.lastError })) + '</div>'
        : '';
      const toggleLabel = task.enabled
        ? uiText('schedule.disable', 'Disable')
        : uiText('schedule.enable', 'Enable');
      const runNowButton = '<button class="btn btn-sm" type="button" data-run-task="' + escapeHtml(task.id) + '"'
        + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('schedule.runNow', 'Run now')) + '</button>';
      const deleteButton = state.confirmDeleteId === task.id
        ? '<button class="btn btn-danger btn-sm" type="button" data-confirm-delete="' + escapeHtml(task.id) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('schedule.deleteConfirm', 'Confirm delete')) + '</button>'
        : '<button class="btn btn-sm" type="button" data-delete-task="' + escapeHtml(task.id) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('schedule.delete', 'Delete')) + '</button>';
      return '<tr data-task-id="' + escapeHtml(task.id) + '" data-selected="' + (task.id === state.selectedTaskId ? 'true' : 'false') + '">'
        + '<td><div class="schedule-task-name"><strong>' + escapeHtml(task.name || task.id) + '</strong><span>' + escapeHtml(task.prompt || '') + '</span></div>' + lastError + '</td>'
        + '<td><span class="schedule-cadence"><span class="schedule-cadence-kind">' + escapeHtml(uiText('schedule.kindLabel.' + (cadence.kind || 'none'), cadence.kind || '—')) + '</span>' + escapeHtml(cadence.text) + '</span>' + errors + '</td>'
        + '<td>' + escapeHtml(uiText(channelKey, channelFallback)) + '</td>'
        + '<td>' + statusPill(task) + '</td>'
        + '<td class="mono">' + escapeHtml(nextRun) + '</td>'
        + '<td class="mono" title="' + escapeHtml(formatDateTime(task.state && task.state.lastRunAtMs)) + '">' + escapeHtml(lastRun) + '</td>'
        + '<td><div class="schedule-row-actions">'
        + runNowButton
        + '<button class="btn btn-sm" type="button" data-toggle-task="' + escapeHtml(task.id) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(toggleLabel) + '</button>'
        + '<button class="btn btn-sm" type="button" data-edit-task="' + escapeHtml(task.id) + '"' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('schedule.edit', 'Edit')) + '</button>'
        + deleteButton
        + '<button class="btn btn-sm" type="button" data-view-runs="' + escapeHtml(task.id) + '">' + escapeHtml(uiText('schedule.viewRuns', 'Runs')) + '</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
    elements.taskTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
    elements.taskTable.querySelectorAll('[data-toggle-task]').forEach((button) => {
      button.addEventListener('click', () => { toggleTask(button.getAttribute('data-toggle-task')); });
    });
    elements.taskTable.querySelectorAll('[data-run-task]').forEach((button) => {
      button.addEventListener('click', () => { runTaskNow(button.getAttribute('data-run-task')); });
    });
    elements.taskTable.querySelectorAll('[data-edit-task]').forEach((button) => {
      button.addEventListener('click', () => { openEditor(button.getAttribute('data-edit-task')); });
    });
    elements.taskTable.querySelectorAll('[data-delete-task]').forEach((button) => {
      button.addEventListener('click', () => {
        state.confirmDeleteId = button.getAttribute('data-delete-task') || '';
        renderTasks();
      });
    });
    elements.taskTable.querySelectorAll('[data-confirm-delete]').forEach((button) => {
      button.addEventListener('click', () => { deleteTask(button.getAttribute('data-confirm-delete')); });
    });
    elements.taskTable.querySelectorAll('[data-view-runs]').forEach((button) => {
      button.addEventListener('click', () => { selectTask(button.getAttribute('data-view-runs')); });
    });
  };

  const renderEditor = () => {
    if (!elements.editor) return;
    elements.editor.hidden = !state.editorOpen;
    if (!state.editorOpen) return;
    if (elements.editorTitle) {
      elements.editorTitle.textContent = state.editingId
        ? uiText('schedule.editTask', 'Edit task')
        : uiText('schedule.newTaskTitle', 'New scheduled task');
    }
    if (elements.submit) {
      elements.submit.textContent = state.editingId
        ? uiText('schedule.save', 'Save task')
        : uiText('schedule.create', 'Create task');
      elements.submit.disabled = state.formBusy;
    }
    if (elements.cancel) elements.cancel.disabled = state.formBusy;
    if (elements.nameInput) elements.nameInput.disabled = state.formBusy;
    if (elements.promptInput) elements.promptInput.disabled = state.formBusy;
    if (elements.kindSelect) elements.kindSelect.disabled = state.formBusy;
    if (elements.channelSelect) elements.channelSelect.disabled = state.formBusy;
    const kind = elements.kindSelect ? String(elements.kindSelect.value || 'interval') : 'interval';
    if (elements.atInput) elements.atInput.hidden = kind !== 'at';
    if (elements.intervalRow) elements.intervalRow.hidden = kind !== 'interval';
    if (elements.cronInput) elements.cronInput.hidden = kind !== 'cron';
    if (elements.editorStatus) {
      elements.editorStatus.textContent = editorMessage.text;
      elements.editorStatus.className = 'status-msg' + (editorMessage.kind ? ' ' + editorMessage.kind : '');
    }
  };

  const renderRuns = () => {
    if (!elements.runsCard) return;
    const task = state.tasks.find((candidate) => candidate.id === state.selectedTaskId) || null;
    if (!task) {
      elements.runsCard.hidden = true;
      return;
    }
    elements.runsCard.hidden = false;
    if (elements.runsTitle) {
      elements.runsTitle.textContent = uiText('schedule.runsTitle', 'Run history — {name}', { name: task.name || task.id });
    }
    if (!elements.runsTable) return;
    if (state.runsLoading) {
      elements.runsTable.innerHTML = '<div class="table-empty"><strong>' + escapeHtml(uiText('schedule.runsLoading', 'Loading runs...')) + '</strong></div>';
      return;
    }
    if (!state.runs.length) {
      elements.runsTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('schedule.runsEmpty', 'No runs recorded yet.'))
        + '</strong>' + escapeHtml(uiText('schedule.runsEmptyHint', 'Runs appear after the task fires on its schedule.'))
        + '</div>';
      return;
    }
    const head = '<thead><tr>'
      + '<th>' + escapeHtml(uiText('schedule.colRunStatus', 'Status')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colRunTrigger', 'Trigger')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colRunStarted', 'Started')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colRunDuration', 'Duration')) + '</th>'
      + '<th>' + escapeHtml(uiText('schedule.colRunError', 'Error')) + '</th>'
      + '</tr></thead>';
    const rows = state.runs.map((run) => {
      const pillKind = run.status === 'running' ? 'status-active' : run.status === 'success' ? 'status-completed' : 'status-failure';
      const trigger = run.trigger === 'manual'
        ? uiText('schedule.trigger.manual', 'Manual')
        : uiText('schedule.trigger.scheduled', 'Scheduled');
      const executor = run.executor ? ' · ' + escapeHtml(String(run.executor)) : '';
      return '<tr>'
        + '<td><span class="status-pill ' + pillKind + '"><span class="status-dot"></span>' + escapeHtml(runStatusLabel(run.status)) + '</span></td>'
        + '<td>' + escapeHtml(trigger) + executor + '</td>'
        + '<td class="mono" title="' + escapeHtml(formatDateTime(run.startedAt)) + '">' + escapeHtml(formatRelative(run.startedAt) || formatDateTime(run.startedAt)) + '</td>'
        + '<td class="mono">' + escapeHtml(formatDuration(run.durationMs) || '—') + '</td>'
        + '<td>' + (run.error ? '<span class="schedule-error-line">' + escapeHtml(String(run.error)) + '</span>' : '<span class="muted">—</span>') + '</td>'
        + '</tr>';
    }).join('');
    elements.runsTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
  };
  const runStatusLabel = (status) => uiText('schedule.runStatus.' + status, String(status || '—'));

  const render = () => {
    renderBotSelect();
    renderTasks();
    renderEditor();
    renderRuns();
    if (elements.newTask) elements.newTask.disabled = !state.fromBot || state.formBusy;
    if (elements.refresh) elements.refresh.disabled = state.loading;
  };

  const loadProfiles = async () => {
    const data = await getJson('/api/bot/profiles');
    state.profiles = (Array.isArray(data.profiles) ? data.profiles : []).filter((profile) => profile && profile.slug);
    if (!state.profiles.length) {
      state.fromBot = '';
      return;
    }
    const bySelector = fromParam
      ? state.profiles.find((profile) => profile.slug === fromParam || profile.globalMetaId === fromParam)
      : null;
    const twin = state.profiles.find((profile) => profile.isActive === true);
    state.fromBot = (bySelector && bySelector.slug) || (twin && twin.slug) || state.profiles[0].slug;
  };

  const loadTasks = async () => {
    if (!state.fromBot) {
      state.tasks = [];
      state.selectedTaskId = '';
      state.runs = [];
      return;
    }
    const data = await getJson('/api/schedule/list?from=' + encodeURIComponent(state.fromBot));
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (state.selectedTaskId && !state.tasks.some((task) => task.id === state.selectedTaskId)) {
      state.selectedTaskId = '';
      state.runs = [];
    }
  };

  const loadRuns = async () => {
    if (!state.fromBot || !state.selectedTaskId) {
      state.runs = [];
      state.runsLoading = false;
      return;
    }
    state.runsLoading = true;
    renderRuns();
    try {
      const data = await getJson('/api/schedule/runs?from=' + encodeURIComponent(state.fromBot)
        + '&id=' + encodeURIComponent(state.selectedTaskId) + '&limit=20');
      state.runs = Array.isArray(data.runs) ? data.runs : [];
    } catch (error) {
      state.runs = [];
      setStatusText((error && error.message) || uiText('schedule.runsFailed', 'Run history failed to load.'));
    } finally {
      state.runsLoading = false;
      renderRuns();
    }
  };

  const selectTask = (id) => {
    state.selectedTaskId = String(id || '');
    state.runs = [];
    render();
    loadRuns().catch(() => undefined);
  };

  const setBusy = (id, busy) => {
    if (busy) state.busyIds[id] = true;
    else delete state.busyIds[id];
  };

  const toggleTask = async (id) => {
    if (!id || state.busyIds[id]) return;
    const task = state.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    setBusy(id, true);
    render();
    try {
      await postJson(task.enabled ? '/api/schedule/disable' : '/api/schedule/enable', { from: state.fromBot, id });
      await loadTasks();
      setStatusKey('schedule.status.saved', { name: task.name || id });
    } catch (error) {
      setStatusText((error && error.message) || uiText('schedule.saveFailed', 'Failed to update the task.'));
    } finally {
      setBusy(id, false);
      render();
    }
  };

  // Fire-and-poll, surf runSurf parity: /api/schedule/run starts the run
  // inside the daemon and returns immediately; we poll the task's run history
  // every few seconds until no run is running, then report the finish.
  const scheduleRunPoll = () => {
    if (!state.runPollingId || runPollTimer) return;
    runPollTimer = setTimeout(() => {
      runPollTimer = 0;
      pollRunOnce().catch(() => undefined);
    }, 3000);
  };

  const pollRunOnce = async () => {
    const id = state.runPollingId;
    if (!id) return;
    try {
      await loadTasks();
      if (state.selectedTaskId === id) await loadRuns();
      const running = (state.selectedTaskId === id ? state.runs : []).some((run) => run.status === 'running')
        || state.tasks.some((task) => task.id === id
          && task.state && task.state.lastStatus === 'running');
      if (running) {
        scheduleRunPoll();
        return;
      }
      const task = state.tasks.find((candidate) => candidate.id === id);
      state.runPollingId = '';
      setStatusKey('schedule.status.runFinished', { name: (task && task.name) || id });
      render();
    } catch (error) {
      state.runPollingId = '';
      setStatusText((error && error.message) || uiText('schedule.runStatusFailed', 'Failed to refresh the run status.'));
    }
  };

  const runTaskNow = async (id) => {
    if (!id || state.busyIds[id]) return;
    const task = state.tasks.find((candidate) => candidate.id === id);
    setBusy(id, true);
    render();
    try {
      await postJson('/api/schedule/run', { from: state.fromBot, id });
      setStatusKey('schedule.status.runStarted', { name: (task && task.name) || id });
      if (state.selectedTaskId !== id) selectTask(id);
      else await loadRuns();
      state.runPollingId = id;
      scheduleRunPoll();
    } catch (error) {
      setStatusText((error && error.message) || uiText('schedule.runStartFailed', 'Failed to start the task run.'));
    } finally {
      setBusy(id, false);
      render();
    }
  };

  const deleteTask = async (id) => {
    if (!id || state.busyIds[id]) return;
    const task = state.tasks.find((candidate) => candidate.id === id);
    setBusy(id, true);
    state.confirmDeleteId = '';
    render();
    try {
      await postJson('/api/schedule/delete', { from: state.fromBot, id });
      if (state.selectedTaskId === id) {
        state.selectedTaskId = '';
        state.runs = [];
      }
      await loadTasks();
      setStatusKey('schedule.status.deleted', { name: (task && task.name) || id });
    } catch (error) {
      setStatusText((error && error.message) || uiText('schedule.deleteFailed', 'Failed to delete the task.'));
    } finally {
      setBusy(id, false);
      render();
    }
  };

  const scheduleSpecFromForm = () => {
    const kind = elements.kindSelect ? String(elements.kindSelect.value || 'interval') : 'interval';
    if (kind === 'at') {
      const value = elements.atInput ? String(elements.atInput.value || '').trim() : '';
      if (!value) return { error: uiText('schedule.atRequired', 'Choose a date and time for the one-time run.') };
      if (/z$/i.test(value)) return { error: uiText('schedule.atTimezone', 'Use a local date-time without a timezone suffix.') };
      if (!Number.isFinite(Date.parse(value))) return { error: uiText('schedule.atInvalid', 'The date-time is not parseable.') };
      return { spec: { type: 'at', datetime: value } };
    }
    if (kind === 'interval') {
      const raw = elements.intervalValue ? String(elements.intervalValue.value || '').trim() : '';
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value < 1) {
        return { error: uiText('schedule.intervalInvalid', 'Enter a whole number of 1 or more.') };
      }
      const unitMs = { minute: 60000, hour: 3600000, day: 86400000 }[elements.intervalUnit ? String(elements.intervalUnit.value) : 'hour'] || 3600000;
      if (value * unitMs < 60000) {
        return { error: uiText('schedule.intervalTooSmall', 'The interval must be at least 1 minute.') };
      }
      return { spec: { type: 'interval', intervalMs: value * unitMs } };
    }
    const expression = elements.cronInput ? String(elements.cronInput.value || '').trim() : '';
    if (!expression) return { error: uiText('schedule.cronRequired', 'Enter a cron expression.') };
    if (expression.split(/\\s+/).length !== 5) {
      return { error: uiText('schedule.cronInvalid', 'The cron expression must have 5 fields.') };
    }
    return { spec: { type: 'cron', expression } };
  };

  const openEditor = (id) => {
    const task = id ? state.tasks.find((candidate) => candidate.id === id) : null;
    state.editorOpen = true;
    state.editingId = task ? task.id : '';
    editorMessage.kind = '';
    editorMessage.text = '';
    if (elements.nameInput) elements.nameInput.value = task ? String(task.name || '') : '';
    if (elements.promptInput) elements.promptInput.value = task ? String(task.prompt || '') : '';
    if (elements.channelSelect) elements.channelSelect.value = task ? String(task.channel || 'auto') : 'auto';
    const spec = (task && task.schedule) || null;
    const kind = spec ? spec.type : 'interval';
    if (elements.kindSelect) elements.kindSelect.value = kind;
    if (elements.atInput) elements.atInput.value = spec && spec.type === 'at' ? String(spec.datetime || '').slice(0, 16) : '';
    if (spec && spec.type === 'interval') {
      const minutes = Math.round((Number(spec.intervalMs) || 0) / 60000);
      if (minutes > 0 && minutes % 1440 === 0) {
        if (elements.intervalValue) elements.intervalValue.value = String(minutes / 1440);
        if (elements.intervalUnit) elements.intervalUnit.value = 'day';
      } else if (minutes > 0 && minutes % 60 === 0) {
        if (elements.intervalValue) elements.intervalValue.value = String(minutes / 60);
        if (elements.intervalUnit) elements.intervalUnit.value = 'hour';
      } else {
        if (elements.intervalValue) elements.intervalValue.value = String(Math.max(1, minutes || 1));
        if (elements.intervalUnit) elements.intervalUnit.value = 'minute';
      }
    } else {
      if (elements.intervalValue) elements.intervalValue.value = '1';
      if (elements.intervalUnit) elements.intervalUnit.value = 'hour';
    }
    if (elements.cronInput) elements.cronInput.value = spec && spec.type === 'cron' ? String(spec.expression || '') : '';
    render();
  };

  const closeEditor = () => {
    state.editorOpen = false;
    state.editingId = '';
    editorMessage.kind = '';
    editorMessage.text = '';
    render();
  };

  const submitForm = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.formBusy) return;
    const name = elements.nameInput ? String(elements.nameInput.value || '').trim() : '';
    const prompt = elements.promptInput ? String(elements.promptInput.value || '').trim() : '';
    if (!name || !prompt) {
      editorMessage.kind = 'error';
      editorMessage.text = uiText('schedule.namePromptRequired', 'A task name and prompt are required.');
      renderEditor();
      return;
    }
    const parsed = scheduleSpecFromForm();
    if (parsed.error) {
      editorMessage.kind = 'error';
      editorMessage.text = parsed.error;
      renderEditor();
      return;
    }
    state.formBusy = true;
    editorMessage.kind = '';
    editorMessage.text = '';
    render();
    try {
      const channel = elements.channelSelect ? String(elements.channelSelect.value || 'auto') : 'auto';
      if (state.editingId) {
        await postJson('/api/schedule/update', {
          from: state.fromBot,
          id: state.editingId,
          payload: { name, prompt, channel, schedule: parsed.spec },
        });
        setStatusKey('schedule.status.saved', { name });
      } else {
        await postJson('/api/schedule/create', {
          from: state.fromBot,
          name,
          prompt,
          channel,
          schedule: parsed.spec,
        });
        setStatusKey('schedule.status.created', { name });
      }
      state.editorOpen = false;
      state.editingId = '';
      await loadTasks();
    } catch (error) {
      editorMessage.kind = 'error';
      editorMessage.text = (error && error.message) || uiText('schedule.saveFailed', 'Failed to update the task.');
    } finally {
      state.formBusy = false;
      render();
    }
  };

  const load = async () => {
    state.loading = true;
    setStatusKey('schedule.status.loading');
    render();
    try {
      if (!state.profiles.length) {
        await loadProfiles();
      }
      await loadTasks();
      state.loading = false;
      setStatusKey('schedule.status.loaded');
      render();
      if (state.selectedTaskId) loadRuns().catch(() => undefined);
    } catch (error) {
      state.loading = false;
      setStatusText((error && error.message) || uiText('schedule.status.failed', 'Scheduled tasks failed to load.'));
      render();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', () => {
    state.confirmDeleteId = '';
    load().catch(() => undefined);
  });
  if (elements.newTask) elements.newTask.addEventListener('click', () => { openEditor(''); });
  if (elements.cancel) elements.cancel.addEventListener('click', closeEditor);
  if (elements.form) elements.form.addEventListener('submit', submitForm);
  if (elements.kindSelect) elements.kindSelect.addEventListener('change', renderEditor);
  if (elements.botSelect) elements.botSelect.addEventListener('change', () => {
    const next = elements.botSelect ? String(elements.botSelect.value || '') : '';
    if (!next || next === state.fromBot) return;
    state.fromBot = next;
    state.tasks = [];
    state.selectedTaskId = '';
    state.runs = [];
    state.confirmDeleteId = '';
    state.editorOpen = false;
    state.editingId = '';
    state.runPollingId = '';
    if (runPollTimer) {
      clearTimeout(runPollTimer);
      runPollTimer = 0;
    }
    load().catch(() => undefined);
  });
  window.addEventListener('oac:i18n-changed', () => {
    renderStatusLine();
    render();
  });
  window.addEventListener('beforeunload', () => { if (runPollTimer) clearTimeout(runPollTimer); });

  load();
})();`,
  };
}
