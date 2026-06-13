"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConversationsPageDefinition = buildConversationsPageDefinition;
const viewModel_1 = require("./viewModel");
function buildConversationsPageDefinition() {
    const buildConversationsPageViewModelSource = (0, viewModel_1.buildConversationsPageViewModelRuntimeSource)();
    return {
        page: 'conversations',
        title: 'Conversations — Open Agent Connect',
        eyebrow: 'Provider Console',
        heading: 'Conversations',
        description: 'Review peer conversations from one local Bot perspective.',
        panels: [],
        contentHtml: `
      <section class="conversations-shell" data-conversations-shell>
        <aside class="conversation-sidebar" aria-label="Bot conversations">
          <div class="conversation-local-picker">
            <label id="local-bot-picker-label">Local Bot</label>
            <div class="local-bot-picker" data-local-bot-picker>
              <button class="local-bot-trigger" type="button" data-local-bot-trigger aria-labelledby="local-bot-picker-label" aria-haspopup="listbox" aria-expanded="false">
                <span class="local-bot-current" data-local-bot-current></span>
                <span class="local-bot-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="local-bot-menu" data-local-bot-menu role="listbox" hidden></div>
            </div>
          </div>
          <div class="conversation-section-header">
            <div>
              <h1>Conversations</h1>
              <p data-conversations-status>Loading conversations...</p>
            </div>
            <button class="btn btn-sm" type="button" data-conversations-refresh>Refresh</button>
          </div>
          <div class="conversation-list" data-conversation-list></div>
        </aside>
        <section class="conversation-thread" data-conversation-detail aria-label="Conversation thread">
          <header class="conversation-thread-header" data-conversation-detail-header>
            <div>
              <h2>Select a conversation</h2>
              <span>Choose a remote Bot</span>
            </div>
          </header>
          <div class="conversation-messages" data-conversation-messages></div>
          <div class="conversation-readonly-status" data-conversation-readonly-status>Agent-to-agent conversation · Human replies are disabled</div>
        </section>
      </section>
    `,
        script: `(() => {
  ${buildConversationsPageViewModelSource}

  const elements = {
    status: document.querySelector('[data-conversations-status]'),
    refresh: document.querySelector('[data-conversations-refresh]'),
    localBotPicker: document.querySelector('[data-local-bot-picker]'),
    localBotTrigger: document.querySelector('[data-local-bot-trigger]'),
    localBotCurrent: document.querySelector('[data-local-bot-current]'),
    localBotMenu: document.querySelector('[data-local-bot-menu]'),
    list: document.querySelector('[data-conversation-list]'),
    detailHeader: document.querySelector('[data-conversation-detail-header]'),
    messages: document.querySelector('[data-conversation-messages]'),
    toast: document.querySelector('[data-copy-toast]'),
  };
  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const query = new URLSearchParams(window.location.search);
  const state = {
    localBots: [],
    conversations: [],
    messages: [],
    selectedLocalGlobalMetaId: query.get('local') || '',
    selectedPeerGlobalMetaId: query.get('peer') || '',
    loading: false,
    loadingMessages: false,
    loadingOlder: false,
    error: '',
    eventSource: null,
    beforeCursor: null,
    hasMoreBefore: false,
    botPickerOpen: false,
  };

  const AVATAR_CONTENT_PATH_PREFIXES = [
    '/content/',
    '/metafile-indexer/content/',
    '/metafile-indexer/thumbnail/',
    '/metafile-indexer/api/v1/files/content/',
    '/metafile-indexer/api/v1/files/accelerate/content/',
    '/metafile-indexer/api/v1/users/avatar/accelerate/',
  ];

  const isHttpUrl = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return normalized.indexOf('http://') === 0 || normalized.indexOf('https://') === 0;
  };
  const isAvatarContentReference = (rawAvatar) => {
    const raw = normalizeText(rawAvatar);
    if (!raw) return false;
    if (raw.toLowerCase().indexOf('metafile://') === 0) return true;
    const path = (() => {
      if (isHttpUrl(raw)) {
        try {
          return new URL(raw).pathname;
        } catch {
          return '';
        }
      }
      return raw;
    })();
    return AVATAR_CONTENT_PATH_PREFIXES.some((prefix) => path.toLowerCase().indexOf(prefix.toLowerCase()) === 0);
  };
  const extractAvatarPinReference = (rawAvatar) => {
    const raw = normalizeText(rawAvatar);
    if (!raw) return '';
    if (raw.toLowerCase().indexOf('metafile://') === 0) {
      const pinId = raw.slice('metafile://'.length).trim().split(/[?#]/)[0] || '';
      return pinId ? 'metafile://' + pinId : '';
    }
    const path = (() => {
      if (isHttpUrl(raw)) {
        try {
          return new URL(raw).pathname;
        } catch {
          return '';
        }
      }
      return raw;
    })();
    for (const prefix of AVATAR_CONTENT_PATH_PREFIXES) {
      if (path.toLowerCase().indexOf(prefix.toLowerCase()) === 0) {
        return decodeURIComponent((path.slice(prefix.length).split(/[?#]/)[0] || '').trim());
      }
    }
    if (/^[0-9a-f]{64}(?:i[0-9]+)?$/iu.test(raw)) return raw;
    return '';
  };
  const normalizeAvatarUrl = (rawAvatar) => {
    const raw = normalizeText(rawAvatar);
    if (!raw) return '';
    if (/^(data:|blob:)/iu.test(raw)) return raw;
    const pinRef = extractAvatarPinReference(raw);
    if (pinRef) return '/api/file/avatar?ref=' + encodeURIComponent(pinRef);
    if (isAvatarContentReference(raw)) return '';
    if (isHttpUrl(raw) || raw.indexOf('/') === 0) return raw;
    return '';
  };
  const getInitialsAvatar = (name, seed) => {
    const text = normalizeText(name) || normalizeText(seed) || '?';
    const chars = Array.from(text).filter((char) => char.trim()).slice(0, 2);
    const label = (chars.join('') || '?').toUpperCase();
    const palette = [
      ['#2f6f7e', '#ffffff'],
      ['#7a4f9a', '#ffffff'],
      ['#2f7d4f', '#ffffff'],
      ['#9a5d2f', '#ffffff'],
      ['#4b6f9f', '#ffffff'],
      ['#8b3f5f', '#ffffff'],
    ];
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pair = palette[Math.abs(hash) % palette.length];
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="20" fill="' + pair[0] + '"/>' +
      '<text x="20" y="25" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="14" font-weight="600" fill="' + pair[1] + '">' + escapeHtml(label) + '</text>' +
      '</svg>'
    );
  };
  const avatarImg = (src, label, cls) => {
    const fallback = getInitialsAvatar(label, src);
    const resolved = normalizeAvatarUrl(src) || fallback;
    return '<img class="' + escapeHtml(cls) + '" src="' + escapeHtml(resolved) + '" alt="" loading="lazy" data-avatar-fallback="' + escapeHtml(fallback) + '" />';
  };
  const hydrateAvatarFallbacks = (root) => {
    (root || document).querySelectorAll('img[data-avatar-fallback]:not([data-avatar-bound])').forEach((img) => {
      img.setAttribute('data-avatar-bound', 'true');
      img.addEventListener('error', () => {
        const fallback = img.getAttribute('data-avatar-fallback') || '';
        if (fallback && img.getAttribute('src') !== fallback) img.setAttribute('src', fallback);
      });
    });
  };

  const fetchJson = async (url, options) => {
    const response = await fetch(url, { cache: 'no-store', ...(options || {}) });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Request failed.');
    }
    return payload.data || payload;
  };
  const buildModel = () => buildConversationsPageViewModel({
    localBots: state.localBots,
    conversations: state.conversations,
    messages: state.messages,
    selectedLocalGlobalMetaId: state.selectedLocalGlobalMetaId,
    selectedPeerGlobalMetaId: state.selectedPeerGlobalMetaId,
  });
  const setUrlState = () => {
    const next = new URLSearchParams(window.location.search);
    if (state.selectedLocalGlobalMetaId) next.set('local', state.selectedLocalGlobalMetaId); else next.delete('local');
    if (state.selectedPeerGlobalMetaId) next.set('peer', state.selectedPeerGlobalMetaId); else next.delete('peer');
    const suffix = next.toString();
    window.history.replaceState(null, '', window.location.pathname + (suffix ? '?' + suffix : ''));
  };
  const conversationUrl = () => '/api/conversations?local=' + encodeURIComponent(state.selectedLocalGlobalMetaId) + '&limit=100';
  const messagesUrl = (options) => {
    let url = '/api/conversations/messages?local=' + encodeURIComponent(state.selectedLocalGlobalMetaId)
      + '&peer=' + encodeURIComponent(state.selectedPeerGlobalMetaId)
      + '&limit=' + encodeURIComponent(String((options && options.limit) || 50));
    if (options && options.before) url += '&before=' + encodeURIComponent(String(options.before));
    if (options && options.after) url += '&after=' + encodeURIComponent(String(options.after));
    return url;
  };
  const eventsUrl = () => '/api/conversations/events?local=' + encodeURIComponent(state.selectedLocalGlobalMetaId);
  const scrollToBottom = () => {
    if (!elements.messages) return;
    elements.messages.scrollTop = elements.messages.scrollHeight;
  };
  const isScrollNearBottom = (node) => {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const setBotPickerOpen = (open) => {
    state.botPickerOpen = Boolean(open);
    if (elements.localBotTrigger) elements.localBotTrigger.setAttribute('aria-expanded', state.botPickerOpen ? 'true' : 'false');
    if (elements.localBotMenu) elements.localBotMenu.hidden = !state.botPickerOpen;
  };
  const renderLocalBots = (model) => {
    if (!elements.localBotCurrent || !elements.localBotMenu || !elements.localBotTrigger) return;
    const selected = model.localBots.find((bot) => bot.isSelected) || model.localBots[0] || null;
    elements.localBotCurrent.innerHTML = selected
      ? avatarImg(selected.avatar, selected.label, 'avatar') + '<span>' + escapeHtml(selected.label) + '</span>'
      : '<span>No local Bot</span>';
    elements.localBotTrigger.disabled = model.localBots.length === 0;
    elements.localBotMenu.innerHTML = model.localBots.map((bot) => (
      '<button type="button" class="local-bot-option" role="option" data-local-bot-option="' + escapeHtml(bot.globalMetaId) + '" data-selected="' + (bot.isSelected ? 'true' : 'false') + '" aria-selected="' + (bot.isSelected ? 'true' : 'false') + '">' +
        '<span class="local-bot-option-main">' + avatarImg(bot.avatar, bot.label, 'avatar') + '<span>' + escapeHtml(bot.label) + '</span></span>' +
      '</button>'
    )).join('');
    elements.localBotMenu.hidden = !state.botPickerOpen;
    elements.localBotMenu.querySelectorAll('[data-local-bot-option]').forEach((button) => {
      button.addEventListener('click', () => {
        setBotPickerOpen(false);
        selectLocalBot(button.getAttribute('data-local-bot-option') || '');
      });
    });
  };
  const renderEmpty = (target, emptyState) => {
    if (!target) return;
    target.innerHTML = '<div class="conversation-empty"><strong>' + escapeHtml(emptyState.title) + '</strong><p>' + escapeHtml(emptyState.message) + '</p></div>';
  };
  const renderList = (model) => {
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
      button.dataset.peerGlobalMetaId = conversation.peerGlobalMetaId;
      button.innerHTML = avatarImg(conversation.peerAvatar, conversation.peerLabel, 'conversation-row-avatar') +
        '<div class="conversation-row-main">' +
          '<div class="conversation-row-identity"><strong>' + escapeHtml(conversation.peerLabel) + '</strong></div>' +
          '<p>' + escapeHtml(conversation.latestText) + '</p>' +
          '<div class="conversation-kind-list">' + conversation.kinds.map((kind) => '<span>' + escapeHtml(kind) + '</span>').join('') + '</div>' +
        '</div>' +
        '<div class="conversation-row-meta"><span>' + escapeHtml(conversation.latestAtLabel) + '</span><span>' + escapeHtml(conversation.messageCountLabel) + '</span></div>';
      button.addEventListener('click', () => selectPeer(conversation.peerGlobalMetaId));
      elements.list.appendChild(button);
    });
  };

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
  const renderPlainText = (content) => {
    const text = String(content || '');
    return text ? '<p>' + escapeHtml(text).replace(/\\r\\n?|\\n/gu, '<br>') + '</p>' : '<span class="muted">(empty)</span>';
  };
  const renderMarkdown = (content) => {
    const source = String(content || '').replace(/\\r\\n?/gu, '\\n');
    if (!source.trim()) return '<span class="muted">(empty)</span>';
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
  const copyIconSvg = () => '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M8 7.5V6a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H16" />' +
    '<path d="M4.5 9.5a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9.5Z" />' +
  '</svg>';
  const copyButton = (value, label, cls, toastMessage, extraAttrs) => value
    ? '<button type="button" class="copy-action ' + escapeHtml(cls || '') + '"' + (extraAttrs || '') + ' data-copy-text="' + escapeHtml(value) + '" data-copy-toast-message="' + escapeHtml(toastMessage || '已复制') + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + copyIconSvg() + '</button>'
    : '';
  const showToast = (message) => {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    if (showToast.timer) clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 1600);
  };
  const copyTextFallback = (value) => {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    let ok = false;
    try {
      ok = Boolean(document.execCommand && document.execCommand('copy'));
    } catch {
      ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
  };
  const copyTextToClipboard = async (value, toastMessage) => {
    if (!value) {
      showToast('复制不可用');
      return;
    }
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) copied = copyTextFallback(value);
    showToast(copied ? toastMessage || '已复制' : '复制不可用');
  };

  const renderThreadHeader = (model) => {
    const selected = model.selectedConversation;
    if (!elements.detailHeader) return;
    if (!selected) {
      elements.detailHeader.innerHTML = '<div><h2>Select a conversation</h2><span>Choose a remote Bot</span></div>';
      return;
    }
    const local = model.localBots.find((bot) => bot.globalMetaId === model.selectedLocalGlobalMetaId) || null;
    const localLabel = selected.localBotLabel || (local && local.label) || 'Local Bot';
    const localAvatar = (local && local.avatar) || selected.localAvatar;
    elements.detailHeader.innerHTML = '<div class="conversation-thread-participants">' +
      '<div class="thread-participant">' + avatarImg(selected.peerAvatar, selected.peerLabel, 'thread-avatar') + '<div><strong>' + escapeHtml(selected.peerLabel) + '</strong><span>Remote Bot</span></div></div>' +
      '<span class="conversation-id-chip"><span class="conversation-id-text">id: ' + escapeHtml(selected.conversationIdPreview || selected.conversationId) + '</span>' + copyButton(selected.conversationId, 'Copy conversation id', 'copy-conversation-id', '会话 ID 已复制', ' data-conversation-id-copy') + '</span>' +
      '<div class="thread-participant thread-participant-local"><div><strong>' + escapeHtml(localLabel) + '</strong><span>Local Bot</span></div>' + avatarImg(localAvatar, localLabel, 'thread-avatar') + '</div>' +
    '</div>';
  };
  const renderMessage = (message, selected, model) => {
    const isLocal = message.directionLabel === 'Bot' || message.direction === 'outgoing' || message.direction === 'outbound';
    const local = model.localBots.find((bot) => bot.globalMetaId === model.selectedLocalGlobalMetaId) || null;
    const fallbackName = isLocal
      ? selected.localBotLabel || (local && local.label) || 'Local Bot'
      : selected.peerLabel || 'Remote Bot';
    const fallbackAvatar = isLocal
      ? (local && local.avatar) || selected.localAvatar
      : selected.peerAvatar;
    const senderName = message.senderLabel || fallbackName;
    const senderAvatar = message.senderAvatar || fallbackAvatar;
    const contentHtml = message.isMarkdown ? renderMarkdown(message.content) : renderPlainText(message.content);
    const txidHtml = message.txid
      ? '<span class="msg-txid"><span class="msg-txid-text" data-message-txid-preview>txid: ' + escapeHtml(message.txidPreview) + '</span>' + copyButton(message.txid, 'Copy txid', 'copy-txid', 'TxID 已复制') + '</span>'
      : '<span class="msg-txid msg-txid-empty">txid: -</span>';
    const timeHtml = '<span class="msg-time">' + escapeHtml(message.timestampLabel) + '</span>';
    const metaHtml = isLocal ? txidHtml + timeHtml : timeHtml + txidHtml;
    return '<article class="msg-row ' + (isLocal ? 'msg-local' : 'msg-peer') + '" data-message-direction="' + (isLocal ? 'local' : 'peer') + '">' +
      avatarImg(senderAvatar, senderName, 'msg-avatar') +
      '<div class="msg-body">' +
        '<div class="msg-name">' + escapeHtml(senderName) + '</div>' +
        '<div class="msg-bubble ' + (isLocal ? 'bubble-local' : 'bubble-peer') + '">' + contentHtml + '</div>' +
        '<div class="msg-meta ' + (isLocal ? 'msg-meta-local' : 'msg-meta-peer') + '">' + metaHtml + '</div>' +
      '</div>' +
    '</article>';
  };
  const renderDetail = (model) => {
    const selected = model.selectedConversation;
    renderThreadHeader(model);
    if (!elements.messages) return;
    elements.messages.innerHTML = '';
    if (state.loadingMessages && !state.messages.length) {
      elements.messages.innerHTML = '<div class="conversation-empty"><strong>Loading messages...</strong></div>';
      return;
    }
    if (!selected || !model.messages.length) {
      renderEmpty(elements.messages, model.detailEmptyState);
      return;
    }
    if (state.hasMoreBefore || state.loadingOlder) {
      const older = document.createElement('button');
      older.type = 'button';
      older.className = 'btn btn-sm conversation-load-older';
      older.textContent = state.loadingOlder ? 'Loading older...' : 'Load older';
      older.disabled = state.loadingOlder;
      older.addEventListener('click', () => loadMessages({ appendOlder: true }));
      elements.messages.appendChild(older);
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = model.messages.map((message) => renderMessage(message, selected, model)).join('');
    while (wrapper.firstChild) elements.messages.appendChild(wrapper.firstChild);
  };
  const render = () => {
    const model = buildModel();
    if (elements.status) {
      elements.status.textContent = state.error || (state.loading ? 'Loading conversations...' : model.conversations.length + ' conversation' + (model.conversations.length === 1 ? '' : 's'));
    }
    renderLocalBots(model);
    renderList(model);
    renderDetail(model);
    hydrateAvatarFallbacks(document);
  };

  const loadProfiles = async () => {
    const payload = await fetchJson('/api/bot/profiles');
    state.localBots = Array.isArray(payload.profiles) ? payload.profiles.filter((profile) => profile && profile.globalMetaId) : [];
    if (!state.selectedLocalGlobalMetaId && state.localBots[0]) {
      state.selectedLocalGlobalMetaId = state.localBots[0].globalMetaId;
    }
  };
  const readBeforeCursor = (messages) => {
    const first = Array.isArray(messages) && messages.length ? messages[0] : null;
    return first && Number.isFinite(Number(first.timestamp)) ? Number(first.timestamp) : state.beforeCursor;
  };
  const loadMessages = async (options) => {
    if (!state.selectedLocalGlobalMetaId || !state.selectedPeerGlobalMetaId) return;
    const appendOlder = Boolean(options && options.appendOlder);
    const preserveScroll = Boolean(options && options.preserveScroll);
    const stickToBottom = Boolean(options && options.stickToBottom);
    if (appendOlder && !state.beforeCursor) return;
    const scrollAnchor = elements.messages
      ? { height: elements.messages.scrollHeight, top: elements.messages.scrollTop }
      : null;
    if (appendOlder) state.loadingOlder = true; else state.loadingMessages = true;
    state.error = '';
    render();
    try {
      const payload = await fetchJson(messagesUrl(appendOlder ? { before: state.beforeCursor, limit: 50 } : { limit: 50 }));
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const pagination = payload.pagination || {};
      state.messages = appendOlder ? messages.concat(state.messages) : messages;
      state.beforeCursor = pagination.beforeCursor || readBeforeCursor(state.messages);
      state.hasMoreBefore = pagination.hasMoreBefore === true;
    } catch (error) {
      state.error = error.message || 'Conversation messages failed to load.';
      if (!appendOlder) state.messages = [];
    } finally {
      state.loadingMessages = false;
      state.loadingOlder = false;
      render();
      requestAnimationFrame(() => {
        if (!elements.messages) return;
        if (appendOlder && scrollAnchor) {
          elements.messages.scrollTop = elements.messages.scrollHeight - scrollAnchor.height + scrollAnchor.top;
          return;
        }
        if (preserveScroll && scrollAnchor) {
          elements.messages.scrollTop = scrollAnchor.top;
          return;
        }
        if (stickToBottom || !appendOlder) scrollToBottom();
      });
    }
  };
  const loadConversations = async (options) => {
    if (!state.selectedLocalGlobalMetaId) return;
    const preserveMessageScroll = Boolean(options && options.preserveMessageScroll);
    const stickToBottom = Boolean(options && options.stickToBottom);
    state.loading = true;
    state.error = '';
    render();
    try {
      const payload = await fetchJson(conversationUrl());
      state.conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
      const selectedStillExists = state.conversations.some((conversation) => conversation.peerGlobalMetaId === state.selectedPeerGlobalMetaId);
      if ((!state.selectedPeerGlobalMetaId || !selectedStillExists) && state.conversations[0]) {
        state.selectedPeerGlobalMetaId = state.conversations[0].peerGlobalMetaId;
      }
      if (state.selectedPeerGlobalMetaId && !state.conversations.length) {
        state.selectedPeerGlobalMetaId = '';
      }
      setUrlState();
      state.loading = false;
      render();
      await loadMessages({
        preserveScroll: preserveMessageScroll,
        stickToBottom: stickToBottom || !preserveMessageScroll,
      });
    } catch (error) {
      state.error = error.message || 'Conversations failed to load.';
      state.conversations = [];
      state.messages = [];
      state.loading = false;
      render();
    }
  };
  const openEvents = () => {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    if (!state.selectedLocalGlobalMetaId || typeof EventSource === 'undefined') return;
    const source = new EventSource(eventsUrl());
    const refresh = () => {
      const wasNearBottom = isScrollNearBottom(elements.messages);
      loadConversations({
        preserveMessageScroll: !wasNearBottom,
        stickToBottom: wasNearBottom,
      });
    };
    source.addEventListener('conversation-message', refresh);
    source.addEventListener('conversation-update', refresh);
    source.onerror = () => {
      if (state.eventSource !== source) source.close();
    };
    state.eventSource = source;
  };
  const selectPeer = async (peerGlobalMetaId) => {
    if (!peerGlobalMetaId || peerGlobalMetaId === state.selectedPeerGlobalMetaId) return;
    state.selectedPeerGlobalMetaId = peerGlobalMetaId;
    state.messages = [];
    state.beforeCursor = null;
    state.hasMoreBefore = false;
    setUrlState();
    render();
    await loadMessages({ stickToBottom: true });
  };
  const selectLocalBot = async (globalMetaId) => {
    if (!globalMetaId || globalMetaId === state.selectedLocalGlobalMetaId) return;
    state.selectedLocalGlobalMetaId = globalMetaId;
    state.selectedPeerGlobalMetaId = '';
    state.messages = [];
    state.beforeCursor = null;
    state.hasMoreBefore = false;
    setUrlState();
    openEvents();
    await loadConversations({ stickToBottom: true });
  };

  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      const wasNearBottom = isScrollNearBottom(elements.messages);
      loadConversations({
        preserveMessageScroll: !wasNearBottom,
        stickToBottom: wasNearBottom,
      });
    });
  }
  if (elements.localBotTrigger) {
    elements.localBotTrigger.addEventListener('click', () => setBotPickerOpen(!state.botPickerOpen));
  }
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('[data-copy-text]')) {
      const button = target.closest('[data-copy-text]');
      copyTextToClipboard(button.getAttribute('data-copy-text') || '', button.getAttribute('data-copy-toast-message') || '');
      return;
    }
    if (state.botPickerOpen && target && elements.localBotPicker && !elements.localBotPicker.contains(target)) {
      setBotPickerOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setBotPickerOpen(false);
  });
  if (elements.messages) {
    elements.messages.addEventListener('scroll', () => {
      if (elements.messages.scrollTop <= 0 && state.hasMoreBefore && !state.loadingMessages && !state.loadingOlder) {
        loadMessages({ appendOlder: true });
      }
    });
  }
  window.addEventListener('beforeunload', () => {
    if (state.eventSource) state.eventSource.close();
  });

  loadProfiles()
    .then(() => {
      setUrlState();
      openEvents();
      return loadConversations({ stickToBottom: true });
    })
    .catch((error) => {
      state.error = error.message || 'Profiles failed to load.';
      render();
    });
})();`,
    };
}
