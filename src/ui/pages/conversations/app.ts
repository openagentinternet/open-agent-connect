import type { LocalUiPageDefinition } from '../types';
import { buildConversationsPageViewModelRuntimeSource } from './viewModel';

export function buildConversationsPageDefinition(): LocalUiPageDefinition {
  const buildConversationsPageViewModelSource = buildConversationsPageViewModelRuntimeSource();
  return {
    page: 'conversations',
    title: 'Conversations — Open Agent Connect',
    eyebrow: 'Provider Console',
    heading: 'Conversations',
    description: 'Review private chats and service conversations with your Bot.',
    panels: [],
    contentHtml: `
      <section class="conversations-shell" data-conversations-shell>
        <div class="conversations-toolbar">
          <div>
            <h1>Conversations</h1>
            <p data-conversations-status>Loading conversations...</p>
          </div>
          <button class="btn" type="button" data-conversations-refresh>Refresh</button>
        </div>
        <div class="conversations-workspace">
          <section class="conversation-list-panel" aria-label="Bot conversations">
            <div class="conversation-section-header">
              <h2>Conversations</h2>
              <span data-conversation-count>0</span>
            </div>
            <div class="conversation-list" data-conversation-list></div>
          </section>
          <section class="conversation-detail-panel" data-conversation-detail aria-label="Conversation context">
            <div class="conversation-detail-header" data-conversation-detail-header>
              <h2>Select a conversation</h2>
              <span>Conversation context</span>
            </div>
            <div class="conversation-messages" data-conversation-messages></div>
          </section>
        </div>
      </section>
    `,
    script: `(() => {
  ${buildConversationsPageViewModelSource}

  const elements = {
    status: document.querySelector('[data-conversations-status]'),
    refresh: document.querySelector('[data-conversations-refresh]'),
    list: document.querySelector('[data-conversation-list]'),
    count: document.querySelector('[data-conversation-count]'),
    detail: document.querySelector('[data-conversation-detail]'),
    detailHeader: document.querySelector('[data-conversation-detail-header]'),
    messages: document.querySelector('[data-conversation-messages]'),
  };
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const query = new URLSearchParams(window.location.search);
  const from = query.get('from') || '';
  const initialConversationId = query.get('conversationId') || (query.get('sessionId') ? 'service-' + query.get('sessionId') : '');
  const state = {
    conversations: [],
    traceSessions: [],
    messages: [],
    selectedConversationId: initialConversationId,
    loading: false,
    error: '',
  };

  const withFrom = (base) => from ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'from=' + encodeURIComponent(from) : base;
  const privateConversationsUrl = () => withFrom('/api/chat/private/conversations');
  const privateMessagesUrl = (conversationId) => withFrom('/api/chat/private/messages?conversationId=' + encodeURIComponent(conversationId) + '&limit=50');
  const traceSessionsUrl = () => withFrom('/api/trace/sessions?all=true&limit=50');

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Request failed.');
    }
    return payload.data || payload;
  };
  const fetchOptionalJson = async (url) => {
    try {
      return await fetchJson(url);
    } catch (error) {
      return null;
    }
  };

  const buildModel = () => buildConversationsPageViewModel({
    conversations: state.conversations,
    traceSessions: state.traceSessions,
    messages: state.messages,
    selectedConversationId: state.selectedConversationId,
  });

  const renderEmpty = (target, emptyState) => {
    if (!target) return;
    target.innerHTML = '<div class="conversation-empty"><strong>' + escapeHtml(emptyState.title) + '</strong><p>' + escapeHtml(emptyState.message) + '</p></div>';
  };

  const renderList = (model) => {
    if (elements.count) elements.count.textContent = String(model.conversations.length);
    if (!elements.list) return;
    elements.list.innerHTML = '';
    if (!model.conversations.length) {
      renderEmpty(elements.list, model.emptyState);
      return;
    }
    model.conversations.forEach((conversation) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conversation-row';
      button.dataset.selected = conversation.isSelected ? 'true' : 'false';
      button.dataset.conversationId = conversation.conversationId;
      button.innerHTML = '<div class="conversation-row-main"><strong>' + escapeHtml(conversation.peerLabel) + '</strong><p>' + escapeHtml(conversation.latestText) + '</p><div class="conversation-kind-list">' + conversation.kinds.map((kind) => '<span>' + escapeHtml(kind) + '</span>').join('') + '</div></div>'
        + '<div class="conversation-row-meta"><span>' + escapeHtml(conversation.latestAtLabel) + '</span><span>' + escapeHtml(conversation.stateLabel) + '</span><span>' + escapeHtml(conversation.turnCountLabel) + '</span></div>';
      button.addEventListener('click', () => selectConversation(conversation.conversationId));
      elements.list.appendChild(button);
    });
  };

  const renderActions = (actions) => actions && actions.length
    ? '<div class="conversation-actions">' + actions.map((action) => '<a class="btn btn-sm" href="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + '</a>').join('') + '</div>'
    : '';

  const renderDetail = (model) => {
    if (elements.detailHeader) {
      const selected = model.selectedConversation;
      elements.detailHeader.innerHTML = selected
        ? '<div><h2>' + escapeHtml(selected.peerLabel) + '</h2><span>' + escapeHtml(selected.stateLabel) + ' / ' + escapeHtml(selected.peerGlobalMetaId || '-') + (selected.localBotLabel ? ' / ' + escapeHtml(selected.localBotLabel) : '') + '</span></div>' + renderActions(selected.advancedActions)
        : '<div><h2>Select a conversation</h2><span>Conversation context</span></div>';
    }
    if (!elements.messages) return;
    elements.messages.innerHTML = '';
    if (!model.messages.length) {
      renderEmpty(elements.messages, model.detailEmptyState);
      return;
    }
    model.messages.forEach((message) => {
      const row = document.createElement('article');
      row.className = 'conversation-message';
      row.innerHTML = '<div><strong>' + escapeHtml(message.directionLabel) + '</strong><span>' + escapeHtml(message.timestampLabel) + '</span></div>'
        + '<p>' + escapeHtml(message.content) + '</p>';
      elements.messages.appendChild(row);
    });
  };

  const render = () => {
    const model = buildModel();
    if (!state.selectedConversationId && model.selectedConversation) {
      state.selectedConversationId = model.selectedConversation.conversationId;
      return render();
    }
    if (elements.status) {
      elements.status.textContent = state.error || (state.loading ? 'Loading conversations...' : model.conversations.length + ' conversation' + (model.conversations.length === 1 ? '' : 's'));
    }
    renderList(model);
    renderDetail(model);
  };

  const selectConversation = async (conversationId) => {
    if (!conversationId) return;
    state.selectedConversationId = conversationId;
    const selected = buildModel().selectedConversation;
    render();
    if (!selected || selected.source !== 'private_chat') {
      state.messages = [];
      state.error = '';
      render();
      return;
    }
    try {
      const payload = await fetchJson(privateMessagesUrl(conversationId));
      state.messages = Array.isArray(payload.messages) ? payload.messages : [];
      state.error = '';
    } catch (error) {
      state.error = error.message || 'Conversation messages failed to load.';
      state.messages = [];
    }
    render();
  };

  const load = async () => {
    state.loading = true;
    state.error = '';
    render();
    try {
      const [payload, tracePayload] = await Promise.all([
        fetchJson(privateConversationsUrl()),
        fetchOptionalJson(traceSessionsUrl()),
      ]);
      state.conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
      state.traceSessions = tracePayload && Array.isArray(tracePayload.sessions) ? tracePayload.sessions : [];
      const initialModel = buildConversationsPageViewModel({ conversations: state.conversations, traceSessions: state.traceSessions, selectedConversationId: state.selectedConversationId });
      const nextSelected = initialModel.selectedConversation
        ? initialModel.selectedConversation.conversationId
        : (initialModel.conversations[0] && initialModel.conversations[0].conversationId) || '';
      state.selectedConversationId = nextSelected;
      const selected = initialModel.conversations.find((conversation) => conversation.conversationId === nextSelected);
      if (nextSelected && selected && selected.source === 'private_chat') {
        const messagesPayload = await fetchJson(privateMessagesUrl(nextSelected));
        state.messages = Array.isArray(messagesPayload.messages) ? messagesPayload.messages : [];
      } else {
        state.messages = [];
      }
    } catch (error) {
      state.error = error.message || 'Private chat conversations failed to load.';
      state.conversations = [];
      state.messages = [];
    } finally {
      state.loading = false;
      render();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', load);
  load();
})();`,
  };
}
