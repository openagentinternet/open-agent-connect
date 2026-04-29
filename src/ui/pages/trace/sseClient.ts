export function buildTraceInspectorScript(): string {
  return `
(function() {
'use strict';

// ─── View model helpers (inlined, no external deps) ─────────────────────────

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function coerceObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}
function coerceArray(value) {
  return Array.isArray(value)
    ? value.filter(e => e && typeof e === 'object' && !Array.isArray(e))
    : [];
}
function normalizeTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value >= 1e9 && value < 1e12) return value * 1000;
  return value;
}
function getStateTone(state) {
  switch (state) {
    case 'completed': return 'completed';
    case 'remote_failed': return 'failure';
    case 'timeout': return 'timeout';
    case 'manual_action_required': return 'manual';
    case 'requesting_remote': case 'remote_received': case 'remote_executing': return 'active';
    default: return 'neutral';
  }
}
function getStateLabel(state) {
  const map = { discovered:'Discovered', awaiting_confirmation:'Awaiting', requesting_remote:'Requesting', remote_received:'Received', remote_executing:'Executing', completed:'Completed', manual_action_required:'Manual Action', remote_failed:'Failed', timeout:'Timeout' };
  return map[state] || state;
}
function getMessageTone(sender, role, type) {
  if (sender === 'system') return 'system';
  if (type === 'tool_use' || type === 'tool_result') return 'tool';
  if (sender === role) return 'local';
  return 'peer';
}
function buildSessionListViewModel(rawSessions, now) {
  now = now || Date.now();
  return rawSessions.map(function(entry) {
    var record = coerceObject(entry);
    if (!record) return null;
    var sessionId = normalizeText(record.sessionId);
    if (!sessionId) return null;
    var role = normalizeText(record.role) || 'caller';
    var state = normalizeText(record.state);
    var updatedAt = normalizeTimestamp(record.updatedAt);
    return {
      sessionId: sessionId,
      traceId: normalizeText(record.traceId),
      role: role,
      state: state,
      createdAt: normalizeTimestamp(record.createdAt),
      updatedAt: updatedAt,
      localMetabotName: normalizeText(record.localMetabotName),
      localMetabotGlobalMetaId: normalizeText(record.localMetabotGlobalMetaId),
      peerGlobalMetaId: normalizeText(record.peerGlobalMetaId),
      servicePinId: normalizeText(record.servicePinId),
      stateTone: getStateTone(state),
      stateLabel: getStateLabel(state),
      timeAgoMs: now - updatedAt,
    };
  }).filter(function(item) { return item !== null; });
}
function buildSessionDetailViewModel(payload) {
  var session = coerceObject(payload.session);
  if (!session) return null;
  var sessionId = normalizeText(session.sessionId);
  var role = normalizeText(session.role) || 'caller';
  var rawItems = coerceArray(payload.transcriptItems);
  var messages = rawItems.map(function(item) {
    var id = normalizeText(item.id);
    if (!id) return null;
    var type = normalizeText(item.type) || 'message';
    var sender = normalizeText(item.sender) || 'system';
    return {
      id: id,
      sessionId: sessionId,
      taskRunId: normalizeText(item.taskRunId) || null,
      timestamp: normalizeTimestamp(item.timestamp),
      type: type,
      sender: sender,
      content: normalizeText(item.content),
      metadata: coerceObject(item.metadata),
      tone: getMessageTone(sender, role, type),
    };
  }).filter(function(m) { return m !== null; })
    .sort(function(a, b) { return a.timestamp - b.timestamp; });
  return {
    sessionId: sessionId,
    traceId: normalizeText(session.traceId),
    role: role,
    state: normalizeText(session.state),
    createdAt: normalizeTimestamp(session.createdAt),
    updatedAt: normalizeTimestamp(session.updatedAt),
    localMetabotName: normalizeText(payload.localMetabotName),
    localMetabotGlobalMetaId: normalizeText(payload.localMetabotGlobalMetaId),
    peerGlobalMetaId: normalizeText(payload.peerGlobalMetaId),
    servicePinId: normalizeText(session.servicePinId),
    callerGlobalMetaId: normalizeText(session.callerGlobalMetaId),
    providerGlobalMetaId: normalizeText(session.providerGlobalMetaId),
    messages: messages,
  };
}

// ─── Helper utilities ───────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTimeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return hh + ':' + mm;
}

function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
}

// ─── Metafile detection ─────────────────────────────────────────────────────

const METAFILE_REGEX = /metafile:\\/\\/[^\\s<>"'\`]+/gi;
const IMG_EXT = new Set(['.jpg','.jpeg','.gif','.png','.webp','.bmp','.svg']);
const VID_EXT = new Set(['.mp4','.webm','.mov']);
const AUD_EXT = new Set(['.mp3','.wav','.flac']);

function parseMetafileUri(rawUri) {
  const uri = rawUri.trim().replace(/[),.;:!?]+$/, '');
  if (!uri.toLowerCase().startsWith('metafile://')) return null;
  const withoutScheme = uri.slice('metafile://'.length);
  if (!withoutScheme) return null;
  const basePart = withoutScheme.split(/[?#]/)[0] || '';
  const lastDot = basePart.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < basePart.length - 1;
  const pinId = hasExt ? basePart.slice(0, lastDot) : basePart;
  const ext = hasExt ? ('.' + basePart.slice(lastDot + 1).toLowerCase()) : null;
  if (!pinId) return null;
  const kind = ext && IMG_EXT.has(ext) ? 'image' : ext && VID_EXT.has(ext) ? 'video' : ext && AUD_EXT.has(ext) ? 'audio' : 'download';
  const enc = encodeURIComponent(pinId);
  return { uri, pinId, ext, kind,
    sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/' + enc,
    fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/' + enc,
    fileName: ext ? pinId + ext : pinId };
}

function imgWithFallback(src, fallback, alt, cls) {
  return '<img src="' + escHtml(src) + '" alt="' + escHtml(alt || '') + '"' + (cls ? ' class="' + cls + '"' : '') + ' loading="lazy" data-fallback="' + escHtml(fallback) + '" onerror="if(this.src!==this.dataset.fallback)this.src=this.dataset.fallback" />';
}
function renderMetafilePreview(item) {
  if (item.kind === 'image') {
    return '<div class="metafile-preview">' + imgWithFallback(item.sourceUrl, item.fallbackUrl, item.fileName, '') + '<div class="metafile-footer"><span class="metafile-pin">' + escHtml(item.pinId) + '</span><a href="' + escHtml(item.sourceUrl) + '" target="_blank" rel="noopener" class="metafile-dl">↓</a></div></div>';
  }
  if (item.kind === 'video') {
    return '<div class="metafile-preview"><video controls preload="auto" playsinline><source src="' + escHtml(item.sourceUrl) + '" /></video><div class="metafile-footer"><span class="metafile-pin">' + escHtml(item.pinId) + '</span><a href="' + escHtml(item.sourceUrl) + '" target="_blank" rel="noopener" class="metafile-dl">↓</a></div></div>';
  }
  if (item.kind === 'audio') {
    return '<div class="metafile-preview"><audio controls preload="auto"><source src="' + escHtml(item.sourceUrl) + '" /></audio><div class="metafile-footer"><span class="metafile-pin">' + escHtml(item.pinId) + '</span><a href="' + escHtml(item.sourceUrl) + '" target="_blank" rel="noopener" class="metafile-dl">↓</a></div></div>';
  }
  return '<div class="metafile-preview metafile-dl-card"><span class="metafile-pin">' + escHtml(item.fileName) + '</span><a href="' + escHtml(item.sourceUrl) + '" target="_blank" rel="noopener" class="metafile-dl">↓ Download</a></div>';
}

function extractMetafiles(content) {
  const matches = content.match(METAFILE_REGEX) || [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    const parsed = parseMetafileUri(m);
    if (parsed && !seen.has(parsed.uri)) { seen.add(parsed.uri); result.push(parsed); }
  }
  return result;
}

// ─── Simple markdown renderer ────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';
  let html = escHtml(text);
  html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
    return '<pre class="md-code"><code>' + code + '</code></pre>';
  });
  html = html.replace(/\`([^\`]+)\`/g, '<code class="md-inline-code">$1</code>');
  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^(- .+)(\\n- .+)*/gm, function(block) {
    const items = block.split('\\n').map(l => '<li>' + l.replace(/^- /, '') + '</li>').join('');
    return '<ul>' + items + '</ul>';
  });
  html = html.replace(/\\n\\n/g, '</p><p>');
  html = html.replace(/\\n/g, '<br>');
  return '<p>' + html + '</p>';
}

// ─── Avatar helpers ─────────────────────────────────────────────────────────

const profileCache = new Map();

function getInitialsAvatar(name, gmid) {
  const text = name || gmid || '?';
  const char = text.charAt(0).toUpperCase();
  const hue = Math.abs(text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 360;
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="16" fill="hsl(' + hue + ',55%,45%)"/>' +
    '<text x="16" y="21" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="14" font-weight="500" fill="#fff">' + char + '</text>' +
    '</svg>'
  );
}

function avatarImg(src, fallback, cls) {
  return '<img class="' + cls + '" src="' + escHtml(src) + '" alt="" loading="lazy" data-fallback="' + escHtml(fallback) + '" onerror="if(this.src!==this.dataset.fallback)this.src=this.dataset.fallback" />';
}

async function resolveProfile(gmid) {
  if (!gmid) return { name: '', avatar: '' };
  if (profileCache.has(gmid)) {
    const cached = profileCache.get(gmid);
    if (cached.fetching) await cached.fetching;
    return { name: cached.name || gmid, avatar: cached.avatar || getInitialsAvatar(cached.name, gmid) };
  }
  let resolveFn;
  const fetchPromise = new Promise(resolve => { resolveFn = resolve; });
  profileCache.set(gmid, { name: '', avatar: '', fetching: fetchPromise });
  let name = '', avatarUrl = '';
  try {
    const resp = await fetch('https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/' + encodeURIComponent(gmid));
    if (resp.ok) {
      const json = await resp.json();
      const data = json?.data || json || {};
      name = data.name || data.showName || data.nickname || '';
      const rawAvatar = data.avatar || data.avatarUrl || '';
      if (rawAvatar && (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:'))) {
        avatarUrl = rawAvatar;
      } else if (rawAvatar && rawAvatar.match(/^[0-9a-f]{64}$/i)) {
        avatarUrl = 'https://file.metaid.io/metafile-indexer/api/v1/files/content/' + rawAvatar;
      }
    }
  } catch { /* ignore */ }
  profileCache.set(gmid, { name, avatar: avatarUrl, fetching: null });
  resolveFn();
  return { name: name || gmid, avatar: avatarUrl || getInitialsAvatar(name, gmid) };
}

// ─── Application state ───────────────────────────────────────────────────────

let sessions = [];
let stats = { totalCount: 0, callerCount: 0, providerCount: 0, lastUpdatedAt: null };
let selectedSessionId = null;
let sessionDetail = null;
let refreshTimer = null;

const $ = (sel) => document.querySelector(sel);
const qAll = (sel) => [...document.querySelectorAll(sel)];

function renderStats() {
  const el = $('[data-trace-total]'); if (el) el.textContent = stats.totalCount;
  const el2 = $('[data-trace-caller]'); if (el2) el2.textContent = stats.callerCount;
  const el3 = $('[data-trace-provider]'); if (el3) el3.textContent = stats.providerCount;
  const el4 = $('[data-trace-last]');
  if (el4) el4.textContent = stats.lastUpdatedAt ? fmtDate(stats.lastUpdatedAt) : '—';
}

function renderSessionList() {
  const list = $('[data-session-list]');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = '<div class="session-empty"><p>No A2A sessions found.</p><p class="session-empty-hint">Sessions appear when your MetaBots interact with remote services.</p></div>';
    return;
  }
  list.innerHTML = sessions.map(session => {
    const roleBadgeTone = session.role === 'caller' ? 'caller' : 'provider';
    const roleBadge = session.role === 'caller' ? 'CALLER' : 'PROVIDER';
    const peer = session.peerGlobalMetaId ? session.peerGlobalMetaId.slice(0, 16) + '…' : '(unknown peer)';
    const timeAgo = session.updatedAt ? fmtTimeAgo(Date.now() - session.updatedAt) : '';
    const isSelected = session.sessionId === selectedSessionId;
    return '<div class="session-item' + (isSelected ? ' selected' : '') + '" data-session-id="' + escHtml(session.sessionId) + '" role="button" tabindex="0">' +
      '<div class="session-item-header">' +
        '<span class="session-role-badge badge-' + roleBadgeTone + '">' + roleBadge + '</span>' +
        '<span class="session-time">' + escHtml(timeAgo) + '</span>' +
      '</div>' +
      '<div class="session-item-peer" data-peer-name="' + escHtml(session.sessionId) + '">' + escHtml(peer) + '</div>' +
      '<div class="session-item-local">' + escHtml(session.localMetabotName || session.localMetabotGlobalMetaId || '—') + '</div>' +
      '<div class="session-item-footer">' +
        '<span class="status-pill status-' + session.stateTone + '">' +
          '<span class="status-dot"></span>' +
          '<span>' + escHtml(session.stateLabel) + '</span>' +
        '</span>' +
      '</div>' +
    '</div>';
  }).join('');
  qAll('[data-session-id]').forEach(el => {
    el.addEventListener('click', () => selectSession(el.dataset.sessionId));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectSession(el.dataset.sessionId); });
  });
  sessions.forEach(session => {
    if (!session.peerGlobalMetaId) return;
    resolveProfile(session.peerGlobalMetaId).then(profile => {
      const nameEl = $('[data-peer-name="' + session.sessionId + '"]');
      if (nameEl && profile.name && profile.name !== session.peerGlobalMetaId) nameEl.textContent = profile.name;
    });
  });
}

async function renderSessionDetail() {
  const panel = $('[data-session-detail]');
  if (!panel) return;
  if (!sessionDetail) {
    panel.innerHTML = '<div class="detail-empty"><p>Select a session from the list to inspect it.</p></div>';
    return;
  }
  const detail = sessionDetail;
  const [localProfile, peerProfile] = await Promise.all([
    resolveProfile(detail.localMetabotGlobalMetaId),
    resolveProfile(detail.peerGlobalMetaId),
  ]);
  const localName = detail.localMetabotName || localProfile.name || detail.localMetabotGlobalMetaId || 'Local';
  const peerName = peerProfile.name && peerProfile.name !== detail.peerGlobalMetaId
    ? peerProfile.name
    : (detail.peerGlobalMetaId ? detail.peerGlobalMetaId.slice(0, 20) + '…' : 'Peer');
  const localAvatar = localProfile.avatar || getInitialsAvatar(localName, detail.localMetabotGlobalMetaId);
  const peerAvatar = peerProfile.avatar || getInitialsAvatar(peerName, detail.peerGlobalMetaId);

  const headerHtml =
    '<div class="detail-header">' +
      '<div class="detail-header-participant">' +
        avatarImg(localAvatar, getInitialsAvatar(localName, detail.localMetabotGlobalMetaId), 'participant-avatar') +
        '<div class="participant-info">' +
          '<div class="participant-name">' + escHtml(localName) + '</div>' +
          '<div class="participant-role">Local · ' + escHtml(detail.role === 'caller' ? 'Caller' : 'Provider') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-header-meta">' +
        '<span class="status-pill status-' + getStateTone(detail.state) + '"><span class="status-dot"></span><span>' + escHtml(getStateLabel(detail.state)) + '</span></span>' +
        '<div class="detail-trace-id mono">trace: ' + escHtml(detail.traceId || detail.sessionId) + '</div>' +
      '</div>' +
      '<div class="detail-header-participant detail-header-participant-right">' +
        '<div class="participant-info participant-info-right">' +
          '<div class="participant-name">' + escHtml(peerName) + '</div>' +
          '<div class="participant-role">' + escHtml(detail.role === 'caller' ? 'Provider' : 'Caller') + ' · Remote</div>' +
        '</div>' +
        avatarImg(peerAvatar, getInitialsAvatar(peerName, detail.peerGlobalMetaId), 'participant-avatar') +
      '</div>' +
    '</div>';

  const messagesHtml = detail.messages.length
    ? '<div class="messages-list">' + detail.messages.map(msg => renderMessage(msg, localName, peerName, localAvatar, peerAvatar)).join('') + '</div>'
    : '<div class="messages-empty"><span class="mono">No transcript messages recorded for this session.</span></div>';

  panel.innerHTML = headerHtml + '<div class="messages-scroll">' + messagesHtml + '</div>';
  const scroll = panel.querySelector('.messages-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  panel.querySelectorAll('[data-tool-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = panel.querySelector('[data-tool-body="' + btn.dataset.toolToggle + '"]');
      if (body) {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        btn.querySelector('.tool-chevron').textContent = open ? '▶' : '▼';
      }
    });
  });
}

const TOOL_ID_SEQ = { n: 0 };

function renderMessage(msg, localName, peerName, localAvatar, peerAvatar) {
  if (msg.tone === 'system') {
    return '<div class="msg-system"><span>' + escHtml(msg.content) + '</span></div>';
  }
  if (msg.tone === 'tool') {
    const toolId = 't' + (++TOOL_ID_SEQ.n);
    const toolName = (msg.metadata && msg.metadata.toolName) ? msg.metadata.toolName : (msg.content || msg.type || 'tool');
    const toolInput = msg.metadata && msg.metadata.toolInput ? JSON.stringify(msg.metadata.toolInput, null, 2) : null;
    const toolResult = msg.metadata && msg.metadata.toolResult ? msg.metadata.toolResult : null;
    return '<div class="msg-tool">' +
      '<button class="tool-toggle" data-tool-toggle="' + toolId + '"><span class="tool-chevron">▶</span><span class="mono">' + escHtml(toolName) + '</span></button>' +
      '<div class="tool-body" data-tool-body="' + toolId + '" style="display:none">' +
        (toolInput ? '<pre class="tool-input">' + escHtml(toolInput) + '</pre>' : '') +
        (toolResult ? '<pre class="tool-result">' + escHtml(toolResult) + '</pre>' : '') +
        (!toolInput && !toolResult ? '<pre class="tool-input">' + escHtml(msg.content || '') + '</pre>' : '') +
      '</div></div>';
  }
  const isLocal = msg.tone === 'local';
  const name = isLocal ? localName : peerName;
  const avatar = isLocal ? localAvatar : peerAvatar;
  const metafiles = extractMetafiles(msg.content);
  const timeStr = fmtTime(msg.timestamp);
  let contentHtml = renderMarkdown(msg.content);
  if (metafiles.length) {
    const cleanContent = msg.content.replace(METAFILE_REGEX, '').trim();
    contentHtml = cleanContent ? renderMarkdown(cleanContent) : '';
  }
  const metafileHtml = metafiles.map(renderMetafilePreview).join('');
  return '<div class="msg-row ' + (isLocal ? 'msg-local' : 'msg-peer') + '">' +
    avatarImg(avatar, isLocal ? getInitialsAvatar(localName, '') : getInitialsAvatar(peerName, ''), 'msg-avatar') +
    '<div class="msg-body">' +
      '<div class="msg-name">' + escHtml(name) + '</div>' +
      '<div class="msg-bubble ' + (isLocal ? 'bubble-local' : 'bubble-peer') + '">' + (contentHtml || '<span class="muted">(empty)</span>') + '</div>' +
      (metafileHtml ? '<div class="msg-metafiles">' + metafileHtml + '</div>' : '') +
      '<div class="msg-time">' + escHtml(timeStr) + '</div>' +
    '</div></div>';
}

async function loadSessions() {
  try {
    const resp = await fetch('/api/trace/sessions');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const payload = json.data || json;
    sessions = buildSessionListViewModel(payload.sessions || [], Date.now());
    stats = payload.stats || { totalCount: sessions.length, callerCount: 0, providerCount: 0, lastUpdatedAt: null };
    if (!stats.totalCount) stats.totalCount = sessions.length;
    renderStats();
    renderSessionList();
  } catch (err) {
    const list = $('[data-session-list]');
    if (list) list.innerHTML = '<div class="session-empty"><p class="error-text">Failed to load sessions: ' + escHtml(String(err)) + '</p></div>';
  }
}

async function loadSessionDetail(sessionId) {
  const panel = $('[data-session-detail]');
  if (panel) panel.innerHTML = '<div class="detail-loading"><span class="mono">Loading session…</span></div>';
  try {
    const resp = await fetch('/api/trace/sessions/' + encodeURIComponent(sessionId));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    sessionDetail = buildSessionDetailViewModel(json.data || json);
    await renderSessionDetail();
  } catch (err) {
    sessionDetail = null;
    if (panel) panel.innerHTML = '<div class="detail-empty error-text"><p>Failed to load session: ' + escHtml(String(err)) + '</p></div>';
  }
}

async function selectSession(sessionId) {
  if (selectedSessionId === sessionId) return;
  selectedSessionId = sessionId;
  qAll('[data-session-id]').forEach(el => el.classList.toggle('selected', el.dataset.sessionId === sessionId));
  await loadSessionDetail(sessionId);
}

function startRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    await loadSessions();
    if (selectedSessionId) await loadSessionDetail(selectedSessionId);
  }, 15000);
}

async function init() {
  await loadSessions();
  startRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
`;
}
