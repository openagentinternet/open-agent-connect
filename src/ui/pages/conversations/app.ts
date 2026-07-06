import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';
import { buildConversationsPageViewModelRuntimeSource } from './viewModel';

export function buildConversationsPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  const buildConversationsPageViewModelSource = buildConversationsPageViewModelRuntimeSource();
  return {
    page: 'conversations',
    title: i18n.t('conversations.title'),
    eyebrow: i18n.t('conversations.eyebrow'),
    heading: i18n.t('conversations.heading'),
    description: i18n.t('conversations.description'),
    panels: [],
    contentHtml: `
      <section class="conversations-shell" data-conversations-shell>
        <aside class="conversation-sidebar" aria-label="Bot conversations">
          <div class="conversation-local-picker">
            <label id="local-bot-picker-label" data-i18n-key="conversations.localBot">${i18n.t('conversations.localBot')}</label>
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
              <h1 data-i18n-key="conversations.titleShort">${i18n.t('conversations.titleShort')}</h1>
              <p data-conversations-status data-i18n-key="conversations.loading">${i18n.t('conversations.loading')}</p>
            </div>
            <button class="btn btn-sm" type="button" data-conversations-refresh data-i18n-key="conversations.refresh">${i18n.t('conversations.refresh')}</button>
          </div>
          <div class="conversation-list" data-conversation-list></div>
        </aside>
        <section class="conversation-thread" data-conversation-detail aria-label="Conversation thread">
          <header class="conversation-thread-header" data-conversation-detail-header>
            <div>
              <h2 data-i18n-key="conversations.selectConversation">${i18n.t('conversations.selectConversation')}</h2>
              <span data-i18n-key="conversations.chooseRemoteBot">${i18n.t('conversations.chooseRemoteBot')}</span>
            </div>
          </header>
          <div class="conversation-messages" data-conversation-messages></div>
          <footer class="conversation-guidance-footer" data-conversation-guidance>
            <div class="conversation-readonly-status" data-conversation-readonly-status data-i18n-key="conversations.readonlyStatus">${i18n.t('conversations.readonlyStatus')}</div>
            <button class="btn btn-sm" type="button" data-guidance-toggle data-i18n-key="conversations.guidanceToggle">${i18n.t('conversations.guidanceToggle')}</button>
            <form class="conversation-guidance-form" data-guidance-form hidden>
              <input
                class="input"
                type="text"
                data-guidance-input
                placeholder="${i18n.t('conversations.guidancePlaceholder')}"
                aria-label="${i18n.t('conversations.guidancePlaceholder')}"
              />
              <button class="btn btn-sm" type="submit" data-guidance-send data-i18n-key="conversations.guidanceSend">${i18n.t('conversations.guidanceSend')}</button>
              <button class="btn btn-sm btn-ghost" type="button" data-guidance-cancel data-i18n-key="conversations.guidanceCancel">${i18n.t('conversations.guidanceCancel')}</button>
            </form>
            <div class="conversation-guidance-status" data-guidance-status aria-live="polite"></div>
          </footer>
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
    guidance: document.querySelector('[data-conversation-guidance]'),
    guidanceToggle: document.querySelector('[data-guidance-toggle]'),
    guidanceForm: document.querySelector('[data-guidance-form]'),
    guidanceInput: document.querySelector('[data-guidance-input]'),
    guidanceSend: document.querySelector('[data-guidance-send]'),
    guidanceCancel: document.querySelector('[data-guidance-cancel]'),
    guidanceStatus: document.querySelector('[data-guidance-status]'),
    toast: document.querySelector('[data-copy-toast]'),
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
  const localizeKnownText = (value) => {
    const text = String(value == null ? '' : value);
    const keys = {
      Chat: 'conversations.chat',
      Service: 'conversations.service',
      Bot: 'conversations.bot',
      Peer: 'conversations.peer',
      'Local Bot': 'conversations.localBotRole',
      'Remote Bot': 'conversations.remoteBotRole',
      Unknown: 'conversations.unknown',
      'Unknown peer': 'conversations.unknownPeer',
      Active: 'conversations.active',
    };
    const key = keys[text];
    return key ? uiText(key, text) : text;
  };
  const conversationCountLabel = (count) => {
    const numeric = Math.max(0, Math.trunc(Number(count) || 0));
    const noun = numeric === 1
      ? uiText('conversations.conversationOne', 'conversation')
      : uiText('conversations.conversationMany', 'conversations');
    return numeric + ' ' + noun;
  };
  const messageCountLabel = (label) => {
    const match = String(label || '').match(/^(\\d+) messages?$/u);
    if (!match) return localizeKnownText(label);
    const numeric = Number(match[1]);
    const noun = numeric === 1
      ? uiText('conversations.messageOne', 'message')
      : uiText('conversations.messageMany', 'messages');
    return numeric + ' ' + noun;
  };
  const localizeEmptyState = (emptyState) => {
    const title = String(emptyState && emptyState.title || '');
    const message = String(emptyState && emptyState.message || '');
    if (title === 'No conversations yet') {
      return {
        title: uiText('conversations.noConversationsTitle', title),
        message: uiText('conversations.noConversationsMessage', message),
      };
    }
    if (title === 'No messages yet') {
      return {
        title: uiText('conversations.noMessagesTitle', title),
        message: uiText('conversations.noMessagesMessage', message),
      };
    }
    if (title === 'Select a conversation') {
      return {
        title: uiText('conversations.selectConversation', title),
        message: uiText('conversations.detailChooseMessage', message),
      };
    }
    return { title, message };
  };
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
    guidanceOpen: false,
    guidanceDraft: '',
    guidanceSubmitting: false,
    guidanceStatus: '',
    pendingGuidance: null,
  };

  let nextGuidanceSubmissionToken = 0;
  let guidanceRefreshTimer = 0;
  let guidanceRefreshInFlight = false;

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
  const avatarImg = (src, label, cls, attrs) => {
    const fallback = getInitialsAvatar(label, src);
    const resolved = normalizeAvatarUrl(src) || fallback;
    return '<img class="' + escapeHtml(cls) + '" src="' + escapeHtml(resolved) + '" alt="" loading="lazy" data-avatar-fallback="' + escapeHtml(fallback) + '"' + (attrs || '') + ' />';
  };
  const botBrowserPath = (globalMetaId) => {
    const normalized = normalizeText(globalMetaId);
    return normalized ? '/browser/metaid/' + encodeURIComponent(normalized) : '';
  };
  const openBotBrowserWindow = (globalMetaId) => {
    const href = botBrowserPath(globalMetaId);
    if (!href || typeof window === 'undefined' || !window || typeof window.open !== 'function') return false;
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  };
  const botBrowserAvatarLink = (globalMetaId, src, label, cls) => {
    const href = botBrowserPath(globalMetaId);
    const image = avatarImg(src, label, cls);
    return href
      ? '<a class="bot-browser-avatar-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(uiText('action.openInBrowser', 'Open in Browser')) + '">' + image + '</a>'
      : image;
  };
  const handleBotBrowserAvatarClick = (event) => {
    const target = event && event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-bot-browser-open]')
      : null;
    const globalMetaId = target && typeof target.getAttribute === 'function'
      ? normalizeText(target.getAttribute('data-bot-browser-open'))
      : '';
    if (!globalMetaId) return false;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    return openBotBrowserWindow(globalMetaId);
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
      const error = new Error((payload && payload.message) || uiText('conversations.requestFailed', 'Request failed.'));
      if (payload && typeof payload.code === 'string') error.code = payload.code;
      throw error;
    }
    return payload.data || payload;
  };
  const guidanceErrorMessage = (error) => {
    const code = String(error && error.code || '');
    const messages = {
      bad_request: uiText('conversations.guidanceInvalid', 'Guidance is invalid.'),
      missing_local: uiText('conversations.guidanceInvalid', 'Guidance is invalid.'),
      missing_peer: uiText('conversations.guidanceConversationNotFound', 'Select an existing conversation before sending guidance.'),
      missing_guidance: uiText('conversations.guidanceInvalid', 'Guidance is invalid.'),
      conversation_not_found: uiText('conversations.guidanceConversationNotFound', 'Select an existing conversation before sending guidance.'),
      profile_not_found: uiText('conversations.guidanceProfileUnavailable', 'The selected local Bot is no longer available.'),
      identity_missing: uiText('conversations.guidanceIdentityMissing', 'Create a local Bot identity before sending guidance.'),
      not_implemented: uiText('conversations.guidanceUnavailable', 'Guided replies are unavailable right now.'),
      conversation_guidance_failed: uiText('conversations.guidanceFailed', 'Guidance failed.'),
    };
    return messages[code] || uiText('conversations.guidanceFailed', 'Guidance failed.');
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
  const hasGuidanceTarget = () => Boolean(state.selectedLocalGlobalMetaId && state.selectedPeerGlobalMetaId);
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
      : '<span>' + escapeHtml(uiText('conversations.noLocalBot', 'No local Bot')) + '</span>';
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
    const localized = localizeEmptyState(emptyState);
    target.innerHTML = '<div class="conversation-empty"><strong>' + escapeHtml(localized.title) + '</strong><p>' + escapeHtml(localized.message) + '</p></div>';
  };
  const resetGuidanceComposer = (status) => {
    if (guidanceRefreshTimer) {
      clearTimeout(guidanceRefreshTimer);
      guidanceRefreshTimer = 0;
    }
    state.guidanceOpen = false;
    state.guidanceDraft = '';
    state.guidanceSubmitting = false;
    state.guidanceStatus = String(status || '');
    state.pendingGuidance = null;
  };
  const latestThreadMessage = () => Array.isArray(state.messages) && state.messages.length
    ? state.messages[state.messages.length - 1]
    : null;
  const threadHasMessageId = (messageId) => {
    const normalizedMessageId = normalizeText(messageId);
    return Boolean(
      normalizedMessageId
      && Array.isArray(state.messages)
      && state.messages.some((message) => normalizeText(message && message.messageId) === normalizedMessageId)
    );
  };
  const messageFingerprint = (message) => {
    if (!message || typeof message !== 'object') return '';
    return [
      normalizeText(message.messageId),
      normalizeText(message.messagePinId),
      normalizeText(message.txid),
      Number.isFinite(Number(message.timestamp)) ? String(Number(message.timestamp)) : '',
      normalizeText(message.direction),
      normalizeText(message.content),
    ].join('|');
  };
  const isLocalThreadMessage = (message) => {
    const direction = normalizeText(message && message.direction).toLowerCase();
    const directionLabel = normalizeText(message && message.directionLabel);
    return directionLabel === 'Bot' || direction === 'outgoing' || direction === 'outbound';
  };
  const maybeResolvePendingGuidanceFromMessages = () => {
    const pending = state.pendingGuidance;
    if (!pending) return false;
    if (
      state.selectedLocalGlobalMetaId !== pending.localGlobalMetaId
      || state.selectedPeerGlobalMetaId !== pending.peerGlobalMetaId
    ) {
      return false;
    }
    if (threadHasMessageId(pending.expectedMessageId)) {
      resetGuidanceComposer(uiText('conversations.guidanceSent', 'Guidance applied. The local message is now visible.'));
      return true;
    }
    const latest = latestThreadMessage();
    if (!isLocalThreadMessage(latest)) return false;
    const latestFingerprint = messageFingerprint(latest);
    if (!latestFingerprint || latestFingerprint === pending.baselineMessageFingerprint) return false;
    resetGuidanceComposer(uiText('conversations.guidanceSent', 'Guidance applied. The local message is now visible.'));
    return true;
  };
  const scheduleGuidanceMessageRefresh = (submissionToken) => {
    if (guidanceRefreshTimer) {
      clearTimeout(guidanceRefreshTimer);
      guidanceRefreshTimer = 0;
    }
    if (
      !state.pendingGuidance
      || state.pendingGuidance.submissionToken !== submissionToken
      || !state.guidanceSubmitting
    ) {
      return;
    }
    guidanceRefreshTimer = setTimeout(async () => {
      guidanceRefreshTimer = 0;
      const pending = state.pendingGuidance;
      if (
        !pending
        || pending.submissionToken !== submissionToken
        || !state.guidanceSubmitting
        || state.selectedLocalGlobalMetaId !== pending.localGlobalMetaId
        || state.selectedPeerGlobalMetaId !== pending.peerGlobalMetaId
      ) {
        return;
      }
      if (guidanceRefreshInFlight) {
        scheduleGuidanceMessageRefresh(submissionToken);
        return;
      }
      const wasNearBottom = isScrollNearBottom(elements.messages);
      guidanceRefreshInFlight = true;
      try {
        await loadMessages({
          preserveScroll: !wasNearBottom,
          stickToBottom: wasNearBottom,
          silent: true,
        });
      } finally {
        guidanceRefreshInFlight = false;
        if (
          state.pendingGuidance
          && state.pendingGuidance.submissionToken === submissionToken
          && state.guidanceSubmitting
        ) {
          scheduleGuidanceMessageRefresh(submissionToken);
        }
      }
    }, 1000);
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
      button.innerHTML = avatarImg(
        conversation.peerAvatar,
        conversation.peerLabel,
        'conversation-row-avatar',
        ' data-bot-browser-open="' + escapeHtml(conversation.peerGlobalMetaId) + '"',
      ) +
        '<div class="conversation-row-main">' +
          '<div class="conversation-row-identity"><strong>' + escapeHtml(conversation.peerLabel) + '</strong></div>' +
          '<p>' + escapeHtml(conversation.latestText) + '</p>' +
          '<div class="conversation-kind-list">' + conversation.kinds.map((kind) => '<span>' + escapeHtml(localizeKnownText(kind)) + '</span>').join('') + '</div>' +
        '</div>' +
        '<div class="conversation-row-meta"><span>' + escapeHtml(conversation.latestAtLabel) + '</span><span>' + escapeHtml(messageCountLabel(conversation.messageCountLabel)) + '</span></div>';
      button.addEventListener('click', (event) => {
        if (handleBotBrowserAvatarClick(event)) return;
        selectPeer(conversation.peerGlobalMetaId);
      });
      elements.list.appendChild(button);
    });
  };
  const renderGuidanceComposer = (model) => {
    const selected = model.selectedConversation;
    const hasTarget = Boolean(selected && hasGuidanceTarget());
    if (elements.guidance) elements.guidance.hidden = !hasTarget;
    if (!elements.guidanceToggle || !elements.guidanceForm || !elements.guidanceInput || !elements.guidanceSend || !elements.guidanceCancel || !elements.guidanceStatus) {
      return;
    }
    elements.guidanceToggle.hidden = !hasTarget || state.guidanceOpen;
    elements.guidanceToggle.disabled = !hasTarget || state.guidanceSubmitting;
    elements.guidanceForm.hidden = !hasTarget || !state.guidanceOpen;
    elements.guidanceInput.value = state.guidanceDraft;
    elements.guidanceInput.disabled = state.guidanceSubmitting;
    elements.guidanceSend.disabled = state.guidanceSubmitting || !state.guidanceDraft.trim();
    elements.guidanceCancel.disabled = state.guidanceSubmitting;
    elements.guidanceStatus.textContent = state.guidanceStatus;
    elements.guidanceStatus.hidden = !state.guidanceStatus;
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
    return text ? '<p>' + escapeHtml(text).replace(/\\r\\n?|\\n/gu, '<br>') + '</p>' : '<span class="muted">' + escapeHtml(uiText('conversations.empty', '(empty)')) + '</span>';
  };
  const renderMarkdown = (content) => {
    const source = String(content || '').replace(/\\r\\n?/gu, '\\n');
    if (!source.trim()) return '<span class="muted">' + escapeHtml(uiText('conversations.empty', '(empty)')) + '</span>';
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
    ? '<button type="button" class="copy-action ' + escapeHtml(cls || '') + '"' + (extraAttrs || '') + ' data-copy-text="' + escapeHtml(value) + '" data-copy-toast-message="' + escapeHtml(toastMessage || uiText('conversations.copied', 'Copied')) + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + copyIconSvg() + '</button>'
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
      showToast(uiText('conversations.copyUnavailable', 'Copy unavailable'));
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
    showToast(copied ? toastMessage || uiText('conversations.copied', 'Copied') : uiText('conversations.copyUnavailable', 'Copy unavailable'));
  };

  const renderThreadHeader = (model) => {
    const selected = model.selectedConversation;
    if (!elements.detailHeader) return;
    if (!selected) {
      elements.detailHeader.innerHTML = '<div><h2>' + escapeHtml(uiText('conversations.selectConversation', 'Select a conversation')) + '</h2><span>' + escapeHtml(uiText('conversations.chooseRemoteBot', 'Choose a remote Bot')) + '</span></div>';
      return;
    }
    const local = model.localBots.find((bot) => bot.globalMetaId === model.selectedLocalGlobalMetaId) || null;
    const localLabel = selected.localBotLabel || (local && local.label) || uiText('conversations.localBotRole', 'Local Bot');
    const localAvatar = (local && local.avatar) || selected.localAvatar;
    elements.detailHeader.innerHTML = '<div class="conversation-thread-participants">' +
      '<div class="thread-participant">' + botBrowserAvatarLink(selected.peerGlobalMetaId, selected.peerAvatar, selected.peerLabel, 'thread-avatar') + '<div><strong>' + escapeHtml(selected.peerLabel) + '</strong><span>' + escapeHtml(uiText('conversations.remoteBotRole', 'Remote Bot')) + '</span></div></div>' +
      '<span class="conversation-id-chip"><span class="conversation-id-text">id: ' + escapeHtml(selected.conversationIdPreview || selected.conversationId) + '</span>' + copyButton(selected.conversationId, uiText('conversations.copyConversationId', 'Copy conversation id'), 'copy-conversation-id', uiText('conversations.conversationIdCopied', 'Conversation ID copied'), ' data-conversation-id-copy') + '</span>' +
      '<div class="thread-participant thread-participant-local"><div><strong>' + escapeHtml(localLabel) + '</strong><span>' + escapeHtml(uiText('conversations.localBotRole', 'Local Bot')) + '</span></div>' + avatarImg(localAvatar, localLabel, 'thread-avatar') + '</div>' +
    '</div>';
  };
  const renderMessage = (message, selected, model) => {
    const isLocal = message.directionLabel === 'Bot' || message.direction === 'outgoing' || message.direction === 'outbound';
    const local = model.localBots.find((bot) => bot.globalMetaId === model.selectedLocalGlobalMetaId) || null;
    const fallbackName = isLocal
      ? selected.localBotLabel || (local && local.label) || uiText('conversations.localBotRole', 'Local Bot')
      : selected.peerLabel || uiText('conversations.remoteBotRole', 'Remote Bot');
    const fallbackAvatar = isLocal
      ? (local && local.avatar) || selected.localAvatar
      : selected.peerAvatar;
    const senderName = message.senderLabel || fallbackName;
    const senderAvatar = message.senderAvatar || fallbackAvatar;
    const avatarHtml = isLocal
      ? avatarImg(senderAvatar, senderName, 'msg-avatar')
      : botBrowserAvatarLink(selected.peerGlobalMetaId, senderAvatar, senderName, 'msg-avatar');
    const contentHtml = message.isMarkdown ? renderMarkdown(message.content) : renderPlainText(message.content);
    const txidHtml = message.txid
      ? '<span class="msg-txid"><span class="msg-txid-text" data-message-txid-preview>txid: ' + escapeHtml(message.txidPreview) + '</span>' + copyButton(message.txid, uiText('conversations.copyTxid', 'Copy txid'), 'copy-txid', uiText('conversations.txidCopied', 'TxID copied')) + '</span>'
      : '<span class="msg-txid msg-txid-empty">txid: -</span>';
    const timeHtml = '<span class="msg-time">' + escapeHtml(message.timestampLabel) + '</span>';
    const metaHtml = isLocal ? txidHtml + timeHtml : timeHtml + txidHtml;
    return '<article class="msg-row ' + (isLocal ? 'msg-local' : 'msg-peer') + '" data-message-direction="' + (isLocal ? 'local' : 'peer') + '">' +
      avatarHtml +
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
      elements.messages.innerHTML = '<div class="conversation-empty"><strong>' + escapeHtml(uiText('conversations.loadingMessages', 'Loading messages...')) + '</strong></div>';
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
      older.textContent = state.loadingOlder
        ? uiText('conversations.loadingOlder', 'Loading older...')
        : uiText('conversations.loadOlder', 'Load older');
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
      elements.status.textContent = state.error || (state.loading ? uiText('conversations.loading', 'Loading conversations...') : conversationCountLabel(model.conversations.length));
    }
    renderLocalBots(model);
    renderList(model);
    renderDetail(model);
    renderGuidanceComposer(model);
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
    const silent = Boolean(options && options.silent);
    if (appendOlder && !state.beforeCursor) return;
    const scrollAnchor = elements.messages
      ? { height: elements.messages.scrollHeight, top: elements.messages.scrollTop }
      : null;
    if (appendOlder) state.loadingOlder = true; else if (!silent) state.loadingMessages = true;
    if (!silent) {
      state.error = '';
      render();
    }
    try {
      const payload = await fetchJson(messagesUrl(appendOlder ? { before: state.beforeCursor, limit: 50 } : { limit: 50 }));
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const pagination = payload.pagination || {};
      state.messages = appendOlder ? messages.concat(state.messages) : messages;
      state.beforeCursor = pagination.beforeCursor || readBeforeCursor(state.messages);
      state.hasMoreBefore = pagination.hasMoreBefore === true;
      maybeResolvePendingGuidanceFromMessages();
    } catch (error) {
      if (!silent) {
        state.error = error.message || uiText('conversations.messagesLoadFailed', 'Conversation messages failed to load.');
        if (!appendOlder) state.messages = [];
      }
    } finally {
      if (appendOlder) state.loadingOlder = false;
      else if (!silent) state.loadingMessages = false;
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
      const firstPeerGlobalMetaId = state.conversations[0] && state.conversations[0].peerGlobalMetaId;
      if (!state.selectedPeerGlobalMetaId && firstPeerGlobalMetaId) {
        state.selectedPeerGlobalMetaId = firstPeerGlobalMetaId;
      }
      setUrlState();
      state.loading = false;
      render();
      await loadMessages({
        preserveScroll: preserveMessageScroll,
        stickToBottom: stickToBottom || !preserveMessageScroll,
      });
    } catch (error) {
      state.error = error.message || uiText('conversations.conversationsLoadFailed', 'Conversations failed to load.');
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
  const submitGuidance = async () => {
    state.guidanceDraft = String(elements.guidanceInput && elements.guidanceInput.value || state.guidanceDraft || '');
    if (!hasGuidanceTarget() || !state.guidanceDraft.trim() || state.guidanceSubmitting) return;
    const targetLocal = state.selectedLocalGlobalMetaId;
    const targetPeer = state.selectedPeerGlobalMetaId;
    const submissionToken = ++nextGuidanceSubmissionToken;
    state.guidanceSubmitting = true;
    state.guidanceOpen = false;
    state.guidanceStatus = uiText('conversations.guidanceSending', 'Guiding the next local turn...');
    state.pendingGuidance = {
      submissionToken,
      localGlobalMetaId: targetLocal,
      peerGlobalMetaId: targetPeer,
      baselineMessageFingerprint: messageFingerprint(latestThreadMessage()),
    };
    render();
    scheduleGuidanceMessageRefresh(submissionToken);
    try {
      const guidanceResult = await fetchJson('/api/conversations/guidance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          local: targetLocal,
          peer: targetPeer,
          guidance: state.guidanceDraft.trim(),
        }),
      });
      if (
        state.pendingGuidance
        && state.pendingGuidance.submissionToken === submissionToken
      ) {
        state.guidanceDraft = '';
        state.pendingGuidance = {
          ...state.pendingGuidance,
          expectedMessageId: normalizeText(guidanceResult && guidanceResult.messageId),
        };
        if (!maybeResolvePendingGuidanceFromMessages()) {
          state.guidanceStatus = uiText(
            'conversations.guidanceAwaitingMessage',
            'Guidance accepted. Waiting for the local message...',
          );
          render();
        }
      }
      if (state.selectedLocalGlobalMetaId === targetLocal && state.selectedPeerGlobalMetaId === targetPeer) {
        await loadConversations({ stickToBottom: true });
      }
    } catch (error) {
      if (state.selectedLocalGlobalMetaId !== targetLocal || state.selectedPeerGlobalMetaId !== targetPeer) return;
      if (!state.pendingGuidance || state.pendingGuidance.submissionToken !== submissionToken) return;
      if (guidanceRefreshTimer) {
        clearTimeout(guidanceRefreshTimer);
        guidanceRefreshTimer = 0;
      }
      state.pendingGuidance = null;
      state.guidanceSubmitting = false;
      state.guidanceOpen = true;
      state.guidanceStatus = guidanceErrorMessage(error);
      render();
    }
  };
  const selectPeer = async (peerGlobalMetaId) => {
    if (!peerGlobalMetaId || peerGlobalMetaId === state.selectedPeerGlobalMetaId) return;
    state.selectedPeerGlobalMetaId = peerGlobalMetaId;
    state.messages = [];
    state.beforeCursor = null;
    state.hasMoreBefore = false;
    resetGuidanceComposer();
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
    resetGuidanceComposer();
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
  if (elements.guidanceToggle) {
    elements.guidanceToggle.addEventListener('click', () => {
      if (!hasGuidanceTarget()) return;
      state.guidanceOpen = true;
      state.guidanceStatus = '';
      render();
    });
  }
  if (elements.guidanceInput) {
    elements.guidanceInput.addEventListener('input', () => {
      state.guidanceDraft = String(elements.guidanceInput && elements.guidanceInput.value || '');
      render();
    });
  }
  if (elements.guidanceForm) {
    elements.guidanceForm.addEventListener('submit', async (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      await submitGuidance();
    });
  }
  if (elements.guidanceCancel) {
    elements.guidanceCancel.addEventListener('click', () => {
      resetGuidanceComposer();
      render();
    });
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
  window.addEventListener('oac:i18n-changed', () => render());

  loadProfiles()
    .then(() => {
      setUrlState();
      openEvents();
      return loadConversations({ stickToBottom: true });
    })
    .catch((error) => {
      state.error = error.message || uiText('conversations.profilesLoadFailed', 'Profiles failed to load.');
      render();
    });
})();`,
  };
}
