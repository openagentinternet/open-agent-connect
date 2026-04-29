import { buildSessionListViewModel, buildSessionDetailViewModel } from './viewModel';

// Embed view model functions as source strings to be included in the client-side script
const buildSessionListViewModelSrc = buildSessionListViewModel.toString();
const buildSessionDetailViewModelSrc = buildSessionDetailViewModel.toString();

export function buildTraceInspectorScript(): string {
  return `
(function() {
'use strict';

// ─── Embedded view model helpers ───────────────────────────────────────────

${buildSessionListViewModelSrc}
${buildSessionDetailViewModelSrc}

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

function renderMetafilePreview(item) {
  if (item.kind === 'image') {
    return '<div class="metafile-preview"><img src="' + escHtml(item.sourceUrl) + '" alt="' + escHtml(item.fileName) + '" loading="lazy" onerror="this.src=\'' + escHtml(item.fallbackUrl) + '\'" /><div class="metafile-footer"><span class="metafile-pin">' + escHtml(item.pinId) + '</span><a href="' + escHtml(item.sourceUrl) + '" target="_blank" rel="noopener" class="metafile-dl">↓</a></div></div>';
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
  // Code blocks
  html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
    return '<pre class="md-code"><code>' + code + '</code></pre>';
  });
  // Inline code
  html = html.replace(/\`([^\`]+)\`/g, '<code class="md-inline-code">$1</code>');
  // Bold
  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Lists
  html = html.replace(/^(- .+)(\\n- .+)*/gm, function(block) {
    const items = block.split('\\n').map(l => '<li>' + l.replace(/^- /, '') + '</li>').join('');
    return '<ul>' + items + '</ul>';
  });
  // Paragraphs (double newlines)
  html = html.replace(/\\n\\n/g, '</p><p>');
  // Single newlines
  html = html.replace(/\\n/g, '<br>');
  return '<p>' + html + '</p>';
}

// ─── Avatar helpers ─────────────────────────────────────────────────────────

const profileCache = new Map(); // gmid → { name, avatar, fetching }

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

// ─── DOM references ───────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ─── Stats rendering ──────────────────────────────────────────────────────────

function renderStats() {
  const el = $('[data-trace-total]'); if (el) el.textContent = stats.totalCount;
  const el2 = $('[data-trace-caller]'); if (el2) el2.textContent = stats.callerCount;
  const el3 = $('[data-trace-provider]'); if (el3) el3.textContent = stats.providerCount;
  const el4 = $('[data-trace-last]');
  if (el4) {
    el4.textContent = stats.lastUpdatedAt
      ? fmtDate(stats.lastUpdatedAt)
      : '—';
  }
}

// ─── Session list rendering ───────────────────────────────────────────────────

function renderSessionList() {
  const list = $('[data-session-list]');
  if (!list) return;

  if (!sessions.length) {
    list.innerHTML = '<div class="session-empty"><p>No A2A sessions found.</p><p class="session-empty-hint">Sessions appear when your MetaBots interact with remote services.</p></div>';
    return;
  }

  list.innerHTML = sessions.map(session => {
    const toneClass = 'tone-' + session.stateTone;
    const roleBadge = session.role === 'caller' ? 'CALLER' : 'PROVIDER';
    const roleBadgeTone = session.role === 'caller' ? 'caller' : 'provider';
    const peer = session.peerGlobalMetaId
      ? session.peerGlobalMetaId.slice(0, 16) + '…'
      : '(unknown peer)';
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
        '<span class="status-pill status-' + session.stateTone + ' ' + toneClass + '">' +
          '<span class="status-dot"></span>' +
          '<span>' + escHtml(session.stateLabel) + '</span>' +
        '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  // Wire up click handlers
  $$('[data-session-id]').forEach(el => {
    el.addEventListener('click', () => selectSession(el.dataset.sessionId));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectSession(el.dataset.sessionId); });
  });

  // After rendering, asynchronously resolve peer names
  sessions.forEach(session => {
    if (!session.peerGlobalMetaId) return;
    resolveProfile(session.peerGlobalMetaId).then(profile => {
      const nameEl = $('[data-peer-name="' + session.sessionId + '"]');
      if (nameEl && profile.name && profile.name !== session.peerGlobalMetaId) {
        nameEl.textContent = profile.name;
      }
    });
  });
}

// ─── Session detail rendering ─────────────────────────────────────────────────

async function renderSessionDetail() {
  const panel = $('[data-session-detail]');
  if (!panel) return;

  if (!sessionDetail) {
    panel.innerHTML = '<div class="detail-empty"><p>Select a session from the list to inspect it.</p></div>';
    return;
  }

  const detail = sessionDetail;
  const isCallerLocal = detail.role === 'caller';
  const localGmid = detail.localMetabotGlobalMetaId;
  const peerGmid = detail.peerGlobalMetaId;

  // Resolve identities in parallel
  const [localProfile, peerProfile] = await Promise.all([
    resolveProfile(localGmid),
    resolveProfile(peerGmid),
  ]);

  const localName = detail.localMetabotName || localProfile.name || localGmid || 'Local';
  const peerName = peerProfile.name && peerProfile.name !== peerGmid ? peerProfile.name : (peerGmid ? peerGmid.slice(0, 20) + '…' : 'Peer');
  const localAvatar = localProfile.avatar || getInitialsAvatar(localName, localGmid);
  const peerAvatar = peerProfile.avatar || getInitialsAvatar(peerName, peerGmid);

  const headerHtml =
    '<div class="detail-header">' +
      '<div class="detail-header-participant">' +
        '<img class="participant-avatar" src="' + escHtml(localAvatar) + '" alt="" onerror="this.src=\'' + escHtml(getInitialsAvatar(localName, localGmid)) + '\'" />' +
        '<div class="participant-info">' +
          '<div class="participant-name">' + escHtml(localName) + '</div>' +
          '<div class="participant-role">Local · ' + escHtml(detail.role === 'caller' ? 'Caller' : 'Provider') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-header-meta">' +
        '<div class="detail-session-state">' +
          '<span class="status-pill status-' + getStateToneStr(detail.state) + '">' +
            '<span class="status-dot"></span>' +
            '<span>' + escHtml(getStateLabelStr(detail.state)) + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="detail-trace-id mono">trace: ' + escHtml(detail.traceId || detail.sessionId) + '</div>' +
      '</div>' +
      '<div class="detail-header-participant detail-header-participant-right">' +
        '<div class="participant-info participant-info-right">' +
          '<div class="participant-name">' + escHtml(peerName) + '</div>' +
          '<div class="participant-role">' + escHtml(detail.role === 'caller' ? 'Provider' : 'Caller') + ' · Remote</div>' +
        '</div>' +
        '<img class="participant-avatar" src="' + escHtml(peerAvatar) + '" alt="" onerror="this.src=\'' + escHtml(getInitialsAvatar(peerName, peerGmid)) + '\'" />' +
      '</div>' +
    '</div>';

  let messagesHtml = '';
  if (!detail.messages.length) {
    messagesHtml = '<div class="messages-empty"><span class="mono">No transcript messages recorded for this session.</span></div>';
  } else {
    messagesHtml = '<div class="messages-list">' +
      detail.messages.map(msg => renderMessage(msg, localName, peerName, localAvatar, peerAvatar)).join('') +
    '</div>';
  }

  panel.innerHTML = headerHtml + '<div class="messages-scroll">' + messagesHtml + '</div>';

  // Scroll to bottom
  const scroll = panel.querySelector('.messages-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;

  // Wire up tool call toggles
  panel.querySelectorAll('[data-tool-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toolToggle;
      const body = panel.querySelector('[data-tool-body="' + id + '"]');
      if (body) {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        btn.querySelector('.tool-chevron').textContent = open ? '▶' : '▼';
      }
    });
  });
}

function getStateToneStr(state) {
  switch (state) {
    case 'completed': return 'completed';
    case 'remote_failed': return 'failure';
    case 'timeout': return 'timeout';
    case 'manual_action_required': return 'manual';
    case 'requesting_remote': case 'remote_received': case 'remote_executing': return 'active';
    default: return 'neutral';
  }
}

function getStateLabelStr(state) {
  const map = { discovered:'Discovered', awaiting_confirmation:'Awaiting', requesting_remote:'Requesting', remote_received:'Received', remote_executing:'Executing', completed:'Completed', manual_action_required:'Manual Action', remote_failed:'Failed', timeout:'Timeout' };
  return map[state] || state;
}

const TOOL_ID_SEQ = { n: 0 };

function renderMessage(msg, localName, peerName, localAvatar, peerAvatar) {
  // System messages: centered label
  if (msg.tone === 'system') {
    return '<div class="msg-system"><span>' + escHtml(msg.content) + '</span></div>';
  }

  // Tool blocks: collapsible
  if (msg.tone === 'tool') {
    const toolId = 't' + (++TOOL_ID_SEQ.n);
    const toolName = (msg.metadata && msg.metadata.toolName) ? msg.metadata.toolName : (msg.content || msg.type || 'tool');
    const toolInput = msg.metadata && msg.metadata.toolInput ? JSON.stringify(msg.metadata.toolInput, null, 2) : null;
    const toolResult = msg.metadata && msg.metadata.toolResult ? msg.metadata.toolResult : null;
    return '<div class="msg-tool">' +
      '<button class="tool-toggle" data-tool-toggle="' + toolId + '">' +
        '<span class="tool-chevron">▶</span>' +
        '<span class="mono">' + escHtml(toolName) + '</span>' +
      '</button>' +
      '<div class="tool-body" data-tool-body="' + toolId + '" style="display:none">' +
        (toolInput ? '<pre class="tool-input">' + escHtml(toolInput) + '</pre>' : '') +
        (toolResult ? '<pre class="tool-result">' + escHtml(toolResult) + '</pre>' : '') +
        (!toolInput && !toolResult ? '<pre class="tool-input">' + escHtml(msg.content || '') + '</pre>' : '') +
      '</div>' +
    '</div>';
  }

  // Chat bubbles: local (right, blue) or peer (left, gray)
  const isLocal = msg.tone === 'local';
  const name = isLocal ? localName : peerName;
  const avatar = isLocal ? localAvatar : peerAvatar;
  const metafiles = extractMetafiles(msg.content);
  const timeStr = fmtTime(msg.timestamp);

  let contentHtml = renderMarkdown(msg.content);
  // Remove metafile URIs from displayed text (we render them separately as previews)
  if (metafiles.length) {
    const cleanContent = msg.content.replace(METAFILE_REGEX, '').trim();
    contentHtml = cleanContent ? renderMarkdown(cleanContent) : '';
  }

  const metafileHtml = metafiles.map(renderMetafilePreview).join('');

  return '<div class="msg-row ' + (isLocal ? 'msg-local' : 'msg-peer') + '">' +
    '<img class="msg-avatar" src="' + escHtml(avatar) + '" alt="" onerror="this.src=\'' + escHtml(isLocal ? getInitialsAvatar(localName, '') : getInitialsAvatar(peerName, '')) + '\'" />' +
    '<div class="msg-body">' +
      '<div class="msg-name">' + escHtml(name) + '</div>' +
      '<div class="msg-bubble ' + (isLocal ? 'bubble-local' : 'bubble-peer') + '">' +
        (contentHtml || '<span class="muted">(empty)</span>') +
      '</div>' +
      (metafileHtml ? '<div class="msg-metafiles">' + metafileHtml + '</div>' : '') +
      '<div class="msg-time">' + escHtml(timeStr) + '</div>' +
    '</div>' +
  '</div>';
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const resp = await fetch('/api/trace/sessions');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const rawSessions = (json.sessions || []);
    sessions = buildSessionListViewModel(rawSessions, Date.now());
    stats = json.stats || { totalCount: sessions.length, callerCount: 0, providerCount: 0, lastUpdatedAt: null };
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
    sessionDetail = buildSessionDetailViewModel(json);
    await renderSessionDetail();
  } catch (err) {
    sessionDetail = null;
    if (panel) panel.innerHTML = '<div class="detail-empty error-text"><p>Failed to load session: ' + escHtml(String(err)) + '</p></div>';
  }
}

async function selectSession(sessionId) {
  if (selectedSessionId === sessionId) return;
  selectedSessionId = sessionId;

  // Update selected state in list
  $$('[data-session-id]').forEach(el => {
    el.classList.toggle('selected', el.dataset.sessionId === sessionId);
  });

  await loadSessionDetail(sessionId);
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

function startRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    await loadSessions();
    // If a session is selected, also refresh its detail
    if (selectedSessionId) {
      await loadSessionDetail(selectedSessionId);
    }
  }, 15000); // refresh every 15s
}

// ─── Boot ────────────────────────────────────────────────────────────────────

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
