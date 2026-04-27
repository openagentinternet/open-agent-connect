"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChatViewerScript = buildChatViewerScript;
function buildChatViewerScript() {
    return `
(() => {
  const POLL_INTERVAL_MS = 4000;
  const SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
  ];

  const state = {
    peer: '',
    self: '',
    messages: [],
    nextPollAfterIndex: undefined,
    pollTimer: null,
    inFlight: false,
    peerName: '',
    peerAvatar: '',
    conversationStopped: false,
    sockets: [],
  };

  const list = document.querySelector('[data-chat-message-list]');
  const peerInput = document.querySelector('[data-chat-peer-input]');
  const selfLabel = document.querySelector('[data-chat-self]');
  const peerLabel = document.querySelector('[data-chat-peer]');
  const peerContainer = document.querySelector('[data-chat-peer-container]');
  const statusLabel = document.querySelector('[data-chat-status]');
  const countLabel = document.querySelector('[data-chat-count]');
  const refreshButton = document.querySelector('[data-chat-refresh]');
  const stopButton = document.querySelector('[data-chat-stop]');

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function setText(node, value) {
    if (node) node.textContent = String(value || '');
  }

  function setStatus(message, tone) {
    setText(statusLabel, message);
    if (statusLabel) {
      statusLabel.dataset.tone = tone || 'neutral';
    }
  }

  function setListState(patch) {
    if (!list) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'loading')) {
      list.loading = !!patch.loading;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
      list.error = String(patch.error || '');
    }
  }

  function messageKey(message) {
    const row = message && typeof message === 'object' ? message : {};
    const pinId = normalizeText(row.pinId);
    if (pinId) return 'pin:' + pinId;
    const txId = normalizeText(row.txId);
    if (txId) return 'tx:' + txId;
    return [
      'fallback',
      normalizeText(row.fromGlobalMetaId),
      normalizeText(row.toGlobalMetaId),
      String(row.index || ''),
      String(row.timestamp || ''),
      normalizeText(row.protocol),
    ].join('|');
  }

  function sortMessages(messages) {
    return messages.slice().sort((a, b) => {
      const ai = Number(a && a.index ? a.index : 0);
      const bi = Number(b && b.index ? b.index : 0);
      if (ai !== bi) return ai - bi;
      return Number(a && a.timestamp ? a.timestamp : 0) - Number(b && b.timestamp ? b.timestamp : 0);
    });
  }

  function mergeMessages(existing, incoming) {
    const byKey = new Map();
    const merged = [];
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].forEach((message) => {
      const key = messageKey(message);
      if (!byKey.has(key)) {
        byKey.set(key, message);
        merged.push(message);
        return;
      }
      const next = { ...byKey.get(key), ...message };
      byKey.set(key, next);
      const index = merged.findIndex((item) => messageKey(item) === key);
      if (index >= 0) merged[index] = next;
    });
    return sortMessages(merged);
  }

  function readPeerFromLocation() {
    const params = new URLSearchParams(window.location.search);
    return normalizeText(params.get('peer'));
  }

  function updateLocationPeer(peer) {
    const url = new URL(window.location.href);
    url.searchParams.set('peer', peer);
    window.history.replaceState(null, '', url.toString());
  }

  function maxMessageIndex(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((max, message) => {
      const index = Number(message && message.index ? message.index : 0);
      return Number.isFinite(index) ? Math.max(max, index) : max;
    }, 0);
  }

  function updatePeerDisplay() {
    if (!peerContainer) return;
    if (state.peerName || state.peerAvatar) {
      let html = '<div class="peer-info">';
      if (state.peerAvatar) {
        html += '<img class="peer-avatar" src="' + state.peerAvatar.replace(/"/g, '&quot;') + '" alt="" onerror="this.style.display=\\'none\\'" />';
      }
      html += '<span class="peer-name">' + (state.peerName || state.peer).replace(/</g, '&lt;') + '</span>';
      html += '</div>';
      peerContainer.innerHTML = html;
    } else {
      peerContainer.innerHTML = '<strong data-chat-peer>' + (state.peer || 'No peer selected').replace(/</g, '&lt;') + '</strong>';
    }
  }

  function extractPeerInfo(messages) {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      if (!msg || !msg.fromUserInfo) continue;
      const fromGm = normalizeText(msg.fromGlobalMetaId);
      if (fromGm && fromGm !== state.self) {
        const info = msg.fromUserInfo;
        const name = normalizeText(info.name) || normalizeText(info.nickname);
        const avatar = normalizeText(info.avatarImage) || normalizeText(info.avatarUrl) || normalizeText(info.avatar) || normalizeText(info.avatarUri);
        if (name && !state.peerName) {
          state.peerName = name;
        }
        if (avatar && !state.peerAvatar) {
          state.peerAvatar = avatar;
        }
        if (state.peerName) break;
      }
    }
  }

  function scrollToBottom() {
    if (!list || !list.shadowRoot) return;
    const container = list.shadowRoot.querySelector('[data-scroll-container]') || list.shadowRoot.querySelector('.messages-container');
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  async function loadConversation(options) {
    const incremental = !!(options && options.incremental);
    if (state.inFlight) return;
    const peer = normalizeText(peerInput && peerInput.value ? peerInput.value : state.peer);
    if (!peer) {
      state.peer = '';
      setText(peerLabel, 'No peer selected');
      setText(selfLabel, 'Waiting for local identity');
      setText(countLabel, '0 messages');
      setStatus('Add a peer globalMetaId to view a private conversation.', 'warning');
      setListState({ loading: false, error: 'peer query parameter is required.' });
      return;
    }

    state.peer = peer;
    updateLocationPeer(peer);
    if (!incremental) {
      state.messages = [];
      state.nextPollAfterIndex = undefined;
      if (list) list.messages = [];
    }

    const query = new URLSearchParams({
      peer,
      limit: incremental ? '200' : '50',
    });
    if (incremental && Number.isFinite(Number(state.nextPollAfterIndex))) {
      query.set('afterIndex', String(state.nextPollAfterIndex));
    }

    state.inFlight = true;
    setListState({ loading: !incremental, error: '' });
    if (!incremental) setStatus('Loading conversation...', 'loading');

    try {
      const response = await fetch('/api/chat/private/conversation?' + query.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.code || 'Failed to load private chat conversation.');
      }

      const incoming = Array.isArray(payload.messages) ? payload.messages : [];
      const prevCount = state.messages.length;
      state.self = normalizeText(payload.selfGlobalMetaId);
      state.peer = normalizeText(payload.peerGlobalMetaId) || peer;
      state.messages = incremental ? mergeMessages(state.messages, incoming) : mergeMessages([], incoming);
      state.nextPollAfterIndex = Number.isFinite(Number(payload.nextPollAfterIndex))
        ? Number(payload.nextPollAfterIndex)
        : maxMessageIndex(state.messages);

      extractPeerInfo(state.messages);

      if (list) {
        list.setAttribute('self-global-metaid', state.self);
        list.setAttribute('peer-global-metaid', state.peer);
        list.messages = state.messages;
        list.loading = false;
        list.error = '';
      }
      setText(selfLabel, state.self || 'Local MetaBot');
      updatePeerDisplay();
      setText(countLabel, state.messages.length === 1 ? '1 message' : state.messages.length + ' messages');
      const statusText = state.conversationStopped ? 'Conversation ended.' : 'Connected (real-time + polling).';
      const statusTone = state.conversationStopped ? 'warning' : 'ready';
      setStatus(statusText, statusTone);

      if (state.messages.length > prevCount) {
        scrollToBottom();
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setListState({ loading: false, error: message });
      setStatus(message, 'error');
    } finally {
      state.inFlight = false;
    }
  }

  function schedulePolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }
    state.pollTimer = setInterval(() => {
      if (!state.peer) return;
      loadConversation({ incremental: true });
    }, POLL_INTERVAL_MS);
  }

  // Socket.io real-time listener
  function connectSocket() {
    if (!state.self) return;
    disconnectSockets();

    for (const endpoint of SOCKET_ENDPOINTS) {
      try {
        const socket = io(endpoint.url, {
          path: endpoint.path,
          query: { metaid: state.self, type: 'pc' },
          reconnection: true,
          reconnectionDelay: 5000,
          reconnectionDelayMax: 30000,
          transports: ['websocket'],
        });

        const handleData = (data) => {
          if (!state.peer) return;
          loadConversation({ incremental: true });
        };

        socket.on('message', handleData);
        socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', handleData);
        state.sockets.push(socket);
      } catch (e) {
        // Socket connection failed, polling will continue.
      }
    }
  }

  function disconnectSockets() {
    for (const socket of state.sockets) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch (e) {
        // Best effort.
      }
    }
    state.sockets = [];
  }

  // Stop conversation handler
  async function stopConversation() {
    if (!state.peer) return;
    if (stopButton) stopButton.disabled = true;
    setStatus('Ending conversation...', 'loading');

    try {
      const response = await fetch('/api/chat/private/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ peer: state.peer }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Failed to end conversation.');
      }
      state.conversationStopped = true;
      setStatus('Conversation ended. Your MetaBot will no longer auto-reply.', 'warning');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'error');
    } finally {
      if (stopButton) stopButton.disabled = false;
    }
  }

  async function start() {
    if (!list) return;
    state.peer = readPeerFromLocation();
    if (peerInput) {
      peerInput.value = state.peer;
      peerInput.addEventListener('change', () => {
        state.conversationStopped = false;
        state.peerName = '';
        state.peerAvatar = '';
        loadConversation({ incremental: false });
      });
      peerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          state.conversationStopped = false;
          state.peerName = '';
          state.peerAvatar = '';
          loadConversation({ incremental: false });
        }
      });
    }
    if (refreshButton) {
      refreshButton.addEventListener('click', () => loadConversation({ incremental: false }));
    }
    if (stopButton) {
      stopButton.addEventListener('click', stopConversation);
    }

    try {
      await import('/ui/chat/idframework/components/id-chat-msg-list.js');
    } catch (error) {
      setStatus('Failed to load the IDFramework chat message list.', 'error');
      setListState({ loading: false, error: error && error.message ? error.message : String(error) });
      return;
    }

    await loadConversation({ incremental: false });
    schedulePolling();

    // Load socket.io client and connect for real-time updates
    try {
      const socketScript = document.createElement('script');
      socketScript.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      socketScript.onload = () => connectSocket();
      document.head.appendChild(socketScript);
    } catch (e) {
      // Socket.io client failed to load, polling will continue.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }
  start();
})();
`.trim();
}
