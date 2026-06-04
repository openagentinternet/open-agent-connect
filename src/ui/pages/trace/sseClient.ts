export function buildTraceInspectorScript(): string {
  return `
(function() {
'use strict';

// ─── View model helpers (inlined, no external deps) ─────────────────────────

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function normalizeNullableText(value) {
  var normalized = normalizeText(value);
  return normalized || null;
}
function normalizeByteLength(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function normalizeArtifactFileName(value) {
  var normalized = normalizeText(value).replace(/\\\\/g, '/');
  if (!normalized) return null;
  var fileName = normalized.split('/').filter(Boolean).pop() || '';
  fileName = fileName.split(/[?#]/, 1)[0];
  return fileName || null;
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
function normalizeArtifactContentType(value) {
  var normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized.indexOf('://') !== -1 || normalized.indexOf('\\\\') !== -1 || normalized.charAt(0) === '/') return '';
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\\/[a-z0-9][a-z0-9!#$&^_.+-]*(?: *; *[a-z0-9][a-z0-9!#$&^_.+-]*=[a-z0-9][a-z0-9!#$&^_.+:-]*)*$/i.test(normalized)) return '';
  return normalized;
}
function inferArtifactKind(ext, contentType) {
  if (contentType.indexOf('image/') === 0) return 'image';
  if (contentType.indexOf('video/') === 0) return 'video';
  if (contentType.indexOf('audio/') === 0) return 'audio';
  return ext && IMG_EXT.has(ext) ? 'image' : ext && VID_EXT.has(ext) ? 'video' : ext && AUD_EXT.has(ext) ? 'audio' : 'file';
}
function coerceDeliveryArtifact(value) {
  var record = coerceObject(value);
  if (!record) return null;
  var base = parseMetafileUri(normalizeText(record.uri));
  if (!base) return null;
  var contentType = normalizeArtifactContentType(record.contentType);
  return {
    uri: base.uri,
    pinId: base.pinId,
    kind: inferArtifactKind(base.ext, contentType),
    fileName: normalizeArtifactFileName(record.fileName) || base.fileName,
    extension: base.ext,
    contentType: contentType || null,
    byteLength: normalizeByteLength(record.byteLength),
    sourceUrl: base.sourceUrl,
    fallbackUrl: base.fallbackUrl,
    downloadUrl: base.downloadUrl,
  };
}
function collectDeliveryArtifacts(item, metadata) {
  var deliveryPayload = coerceObject(metadata && metadata.deliveryPayload);
  var sources = [
    item.artifacts,
    metadata && metadata.deliveryArtifacts,
    deliveryPayload && deliveryPayload.artifacts,
  ];
  var seen = new Set();
  var artifacts = [];
  sources.forEach(function(source) {
    (Array.isArray(source) ? source : []).forEach(function(entry) {
      var artifact = coerceDeliveryArtifact(entry);
      if (!artifact || seen.has(artifact.uri)) return;
      seen.add(artifact.uri);
      artifacts.push(artifact);
    });
  });
  return artifacts;
}
const ACTIVE_STATES = new Set(['requesting_remote', 'remote_received', 'remote_executing']);
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

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
function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    var normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}
function isZeroAmount(value) {
  var text = normalizeText(value);
  if (!text) return false;
  var numeric = Number(text);
  return Number.isFinite(numeric) && numeric === 0;
}
function buildRefundHref(orderId) {
  return orderId ? '/ui/refund?orderId=' + encodeURIComponent(orderId) : '/ui/refund';
}
function resolveRefundAction(record, role) {
  record = coerceObject(record) || {};
  var order = coerceObject(record.order);
  var refund = coerceObject(record.refund);
  var source = order || refund || record;
  var orderRole = normalizeText(source.role) || (role === 'provider' ? 'seller' : '');
  var status = normalizeText(source.status) || normalizeText(record.refundStatus) || normalizeText(record.status);
  var blockingReason = normalizeText(source.refundBlockingReason)
    || normalizeText(source.blockingReason)
    || normalizeText(record.refundBlockingReason)
    || normalizeText(record.blockingReason);
  var refundRequestPinId = normalizeText(source.refundRequestPinId)
    || normalizeText(record.refundRequestPinId)
    || null;
  var refundFinalizePinId = normalizeText(source.refundFinalizePinId)
    || normalizeText(record.refundFinalizePinId)
    || null;
  var paymentTxid = normalizeText(source.paymentTxid) || normalizeText(record.paymentTxid);
  var paymentAmount = normalizeText(source.paymentAmount) || normalizeText(record.paymentAmount);
  var orderId = normalizeText(source.id)
    || normalizeText(source.serviceOrderPinId)
    || normalizeText(source.orderReference)
    || normalizeText(record.refundOrderId)
    || normalizeText(record.orderId)
    || normalizeText(record.serviceOrderPinId)
    || null;
  var refundFrom = normalizeText(source.localMetabotSlug)
    || normalizeText(record.localMetabotSlug)
    || normalizeText(record.refundFrom)
    || null;
  var unsupported = blockingReason === 'refund_settlement_unsupported';
  var refunded = status === 'refunded' || Boolean(refundFinalizePinId);
  var explicitRequired = normalizeBoolean(record.refundActionRequired)
    || normalizeBoolean(record.manualActionRequired)
    || normalizeBoolean(source.manualActionRequired);
  var explicitConfirmable = normalizeBoolean(record.refundConfirmable)
    || normalizeBoolean(source.refundConfirmable);
  var pendingRequest = orderRole === 'seller'
    && status === 'refund_pending'
    && Boolean(refundRequestPinId);
  var failedPaidOrder = orderRole === 'seller'
    && status === 'failed'
    && Boolean(paymentTxid)
    && !isZeroAmount(paymentAmount);
  var retryableBlocker = orderRole === 'seller'
    && Boolean(blockingReason)
    && !unsupported;
  var refundActionRequired = !unsupported
    && !refunded
    && (explicitRequired || pendingRequest || failedPaidOrder || retryableBlocker);
  var refundConfirmable = !unsupported
    && !refunded
    && (explicitConfirmable || (refundActionRequired && Boolean(refundRequestPinId)));
  return {
    refundActionRequired: refundActionRequired,
    refundConfirmable: refundConfirmable,
    refundOrderId: orderId,
    refundStatus: status || null,
    refundRequestPinId: refundRequestPinId,
    refundFinalizePinId: refundFinalizePinId,
    refundFrom: refundFrom,
    refundHref: refundActionRequired ? buildRefundHref(orderId) : null,
  };
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
    var isStale = ACTIVE_STATES.has(state) && updatedAt > 0 && (now - updatedAt) > STALE_THRESHOLD_MS;
    var refundAction = resolveRefundAction(record, role);
    return {
      sessionId: sessionId,
      traceId: normalizeText(record.traceId),
      role: role,
      state: state,
      createdAt: normalizeTimestamp(record.createdAt),
      updatedAt: updatedAt,
      localMetabotName: normalizeText(record.localMetabotName),
      localMetabotGlobalMetaId: normalizeText(record.localMetabotGlobalMetaId),
      localMetabotAvatar: normalizeText(record.localMetabotAvatar),
      peerGlobalMetaId: normalizeText(record.peerGlobalMetaId),
      peerName: normalizeText(record.peerName),
      peerAvatar: normalizeText(record.peerAvatar),
      servicePinId: normalizeText(record.servicePinId),
      stateTone: refundAction.refundActionRequired ? 'manual' : isStale ? 'timeout' : getStateTone(state),
      stateLabel: refundAction.refundActionRequired ? 'Refund Required' : isStale ? 'Timeout' : getStateLabel(state),
      timeAgoMs: now - updatedAt,
      refundActionRequired: refundAction.refundActionRequired,
      refundConfirmable: refundAction.refundConfirmable,
      refundOrderId: refundAction.refundOrderId,
      refundStatus: refundAction.refundStatus,
      refundRequestPinId: refundAction.refundRequestPinId,
      refundFinalizePinId: refundAction.refundFinalizePinId,
      refundFrom: refundAction.refundFrom,
      refundHref: refundAction.refundHref,
    };
  }).filter(function(item) { return item !== null; });
}
function buildSessionDetailViewModel(payload) {
  var session = coerceObject(payload.session);
  if (!session) return null;
  var a2a = coerceObject(payload.a2a);
  var sessionId = normalizeText(session.sessionId)
    || normalizeText(payload.sessionId)
    || normalizeText(a2a && a2a.sessionId)
    || normalizeText(session.id);
  var role = normalizeText(session.role) || 'caller';
  var refundActionRecord = Object.assign({}, session);
  if (payload.order) refundActionRecord.order = payload.order;
  var refundAction = resolveRefundAction(refundActionRecord, role);
  var topLevelItems = coerceArray(payload.transcriptItems);
  var inspector = coerceObject(payload.inspector);
  var rawItems = topLevelItems.length ? topLevelItems : coerceArray(inspector && inspector.transcriptItems);
  var messages = rawItems.map(function(item) {
    var id = normalizeText(item.id);
    if (!id) return null;
    var type = normalizeText(item.type) || 'message';
    var sender = normalizeText(item.sender) || 'system';
    var metadata = coerceObject(item.metadata);
    return {
      id: id,
      sessionId: sessionId,
      taskRunId: normalizeText(item.taskRunId) || null,
      timestamp: normalizeTimestamp(item.timestamp),
      type: type,
      sender: sender,
      content: normalizeText(item.content),
      metadata: metadata,
      deliveryArtifacts: collectDeliveryArtifacts(item, metadata),
      tone: getMessageTone(sender, role, type),
    };
  }).filter(function(m) { return m !== null; })
    .sort(function(a, b) { return a.timestamp - b.timestamp; });
  return {
    sessionId: sessionId,
    traceId: normalizeText(session.traceId) || normalizeText(payload.traceId),
    role: role,
    state: normalizeText(session.state) || normalizeText(a2a && a2a.publicStatus),
    createdAt: normalizeTimestamp(session.createdAt),
    updatedAt: normalizeTimestamp(session.updatedAt),
    localMetabotName: normalizeText(payload.localMetabotName),
    localMetabotGlobalMetaId: normalizeText(payload.localMetabotGlobalMetaId),
    localMetabotAvatar: normalizeText(payload.localMetabotAvatar) || normalizeText(session.localMetabotAvatar),
    peerGlobalMetaId: normalizeText(payload.peerGlobalMetaId),
    peerName: normalizeText(payload.peerName) || normalizeText(session.peerName),
    peerAvatar: normalizeText(payload.peerAvatar) || normalizeText(session.peerAvatar),
    servicePinId: normalizeText(session.servicePinId) || normalizeText(a2a && a2a.servicePinId),
    callerGlobalMetaId: normalizeText(session.callerGlobalMetaId) || normalizeText(a2a && a2a.callerGlobalMetaId),
    providerGlobalMetaId: normalizeText(session.providerGlobalMetaId) || normalizeText(a2a && a2a.providerGlobalMetaId),
    messages: messages,
    refundActionRequired: refundAction.refundActionRequired,
    refundConfirmable: refundAction.refundConfirmable,
    refundOrderId: refundAction.refundOrderId,
    refundStatus: refundAction.refundStatus,
    refundRequestPinId: refundAction.refundRequestPinId,
    refundFinalizePinId: refundAction.refundFinalizePinId,
    refundFrom: refundAction.refundFrom,
    refundHref: refundAction.refundHref,
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
  const now = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const time = hh + ':' + mm;
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return time;
  const month = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  if (d.getFullYear() === now.getFullYear()) {
    return month + '-' + day + ' ' + time;
  }
  const yy = String(d.getFullYear()).slice(-2);
  return yy + '-' + month + '-' + day + ' ' + time;
}

function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
}

// ─── Metafile detection ─────────────────────────────────────────────────────

const METAFILE_REGEX = /metafile:\\/\\/[^\\s<>"'\`]+/gi;
const IMG_EXT = new Set(['.jpg','.jpeg','.gif','.png','.webp','.bmp','.svg']);
const VID_EXT = new Set(['.m4v','.mp4','.webm','.mov']);
const AUD_EXT = new Set(['.m4a','.mp3','.ogg','.wav','.flac']);
const MEDIA_HYDRATION_LIMIT = 8;
const MEDIA_FETCH_TIMEOUT_MS = 10000;

function parseMetafileUri(rawUri) {
  const uri = rawUri.trim().replace(/[),.;:!?]+$/, '');
  if (!uri || /[\\s\\x00-\\x1f\\x7f]/.test(uri) || !uri.toLowerCase().startsWith('metafile://')) return null;
  const withoutScheme = uri.slice('metafile://'.length);
  const basePart = withoutScheme.split(/[?#]/)[0] || '';
  if (!basePart || basePart.indexOf('/') !== -1 || basePart.indexOf('\\\\') !== -1) return null;
  const lastDot = basePart.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < basePart.length - 1;
  const pinId = hasExt ? basePart.slice(0, lastDot) : basePart;
  const ext = hasExt ? ('.' + basePart.slice(lastDot + 1).toLowerCase()) : null;
  if (!pinId) return null;
  const kind = ext && IMG_EXT.has(ext) ? 'image' : ext && VID_EXT.has(ext) ? 'video' : ext && AUD_EXT.has(ext) ? 'audio' : 'file';
  const enc = encodeURIComponent(pinId);
  return { uri, pinId, ext, kind,
    sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/' + enc,
    fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/' + enc,
    downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/' + enc,
    fileName: ext ? pinId + ext : pinId };
}

function normalizeMetafileArtifact(rawArtifact) {
  var artifact = coerceObject(rawArtifact);
  if (!artifact) return null;
  var base = parseMetafileUri(normalizeText(artifact.uri));
  if (!base) return null;
  var contentType = normalizeArtifactContentType(artifact.contentType);
  var kind = inferArtifactKind(base.ext, contentType);
  var sourceUrl = base.sourceUrl;
  var fallbackUrl = base.fallbackUrl;
  var downloadUrl = base.downloadUrl;
  return {
    uri: base.uri,
    pinId: normalizeText(artifact.pinId) || base.pinId,
    ext: normalizeText(artifact.extension) || base.ext,
    kind: kind,
    sourceUrl: sourceUrl,
    fallbackUrl: fallbackUrl,
    downloadUrl: downloadUrl,
    fileName: normalizeArtifactFileName(artifact.fileName) || base.fileName || base.pinId,
  };
}

function imgWithFallback(src, fallback, alt, cls) {
  return '<img src="' + escHtml(src) + '" alt="' + escHtml(alt || '') + '"' + (cls ? ' class="' + cls + '"' : '') + ' loading="lazy" data-fallback="' + escHtml(fallback) + '" onerror="if(this.src!==this.dataset.fallback)this.src=this.dataset.fallback" />';
}
function renderMetafileFooter(item) {
  var fileName = item.fileName || item.pinId || 'Artifact';
  var pin = item.pinId && item.pinId !== fileName ? '<span class="metafile-pin">' + escHtml(item.pinId) + '</span>' : '';
  return '<div class="metafile-footer">' +
    '<div class="metafile-labels"><span class="metafile-name">' + escHtml(fileName) + '</span>' + pin + '</div>' +
    '<a href="' + escHtml(item.downloadUrl || item.sourceUrl || item.fallbackUrl) + '" target="_blank" rel="noopener" class="metafile-dl">Download</a>' +
  '</div>';
}
function renderMetafilePreview(item) {
  if (item.kind === 'image') {
    return '<div class="metafile-preview">' + imgWithFallback(item.sourceUrl, item.fallbackUrl, item.fileName, '') + renderMetafileFooter(item) + '</div>';
  }
  if (item.kind === 'video') {
    return '<div class="metafile-preview"><video controls class="metafile-media is-loading" preload="metadata" playsinline data-source-url="' + escHtml(item.sourceUrl) + '" data-fallback-url="' + escHtml(item.fallbackUrl) + '" data-download-url="' + escHtml(item.downloadUrl) + '"></video>' + renderMetafileFooter(item) + '</div>';
  }
  if (item.kind === 'audio') {
    return '<div class="metafile-preview"><audio controls class="metafile-media is-loading" preload="metadata" data-source-url="' + escHtml(item.sourceUrl) + '" data-fallback-url="' + escHtml(item.fallbackUrl) + '" data-download-url="' + escHtml(item.downloadUrl) + '"></audio>' + renderMetafileFooter(item) + '</div>';
  }
  return '<div class="metafile-preview metafile-dl-card"><div class="metafile-labels"><span class="metafile-name">' + escHtml(item.fileName || item.pinId || 'Artifact') + '</span><span class="metafile-pin">' + escHtml(item.pinId || '') + '</span></div><a href="' + escHtml(item.downloadUrl || item.sourceUrl || item.fallbackUrl) + '" target="_blank" rel="noopener" class="metafile-dl">Download</a></div>';
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

function normalizeMessageArtifacts(artifacts) {
  const seen = new Set();
  const result = [];
  (Array.isArray(artifacts) ? artifacts : []).forEach(function(entry) {
    const artifact = normalizeMetafileArtifact(entry);
    if (!artifact || seen.has(artifact.uri)) return;
    seen.add(artifact.uri);
    result.push(artifact);
  });
  return result;
}

// ─── Chain txid helpers ─────────────────────────────────────────────────────

const TXID_RE = /^[0-9a-f]{64}$/i;
const PIN_ID_TXID_RE = /^([0-9a-f]{64})i\\d+$/i;

function normalizeTxidCandidate(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TXID_RE.test(normalized) ? normalized : '';
}

function normalizePinIdTxid(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = normalized.match(PIN_ID_TXID_RE);
  return match ? match[1] : '';
}

function resolveMessageTxid(msg) {
  const metadata = msg && msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
  const txidsCandidate = Array.isArray(metadata.txids)
    ? metadata.txids.map(normalizeTxidCandidate).find(Boolean)
    : '';
  if (txidsCandidate) return txidsCandidate;

  const directKeys = [
    'txid',
    'messageTxid',
    'pinTxid',
    'deliveryTxid',
    'deliveryMessageTxid',
    'orderMessageTxid',
    'orderTxid',
    'ratingTxid',
  ];
  for (const key of directKeys) {
    const normalized = normalizeTxidCandidate(metadata[key]);
    if (normalized) return normalized;
  }

  const pinKeys = [
    'pinId',
    'messagePinId',
    'deliveryPinId',
    'deliveryMessagePinId',
    'orderPinId',
    'orderMessagePinId',
    'ratingPinId',
    'refundRequestPinId',
    'refundFinalizePinId',
  ];
  for (const key of pinKeys) {
    const normalized = normalizePinIdTxid(metadata[key]);
    if (normalized) return normalized;
  }

  return '';
}

function formatTxidPreview(txid) {
  const normalized = normalizeTxidCandidate(txid);
  return normalized ? normalized.slice(0, 8) + '....' : '';
}

// ─── Simple markdown renderer ────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';
  const codeBlocks = [];
  let source = String(text || '').replace(/\\r\\n?/g, '\\n');
  source = source.replace(/\`\`\`([^\\n\`]*)\\n?([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
    const index = codeBlocks.length;
    codeBlocks.push('<pre class="md-code"><code>' + escHtml(code.replace(/\\n$/, '')) + '</code></pre>');
    return '@@CODEBLOCK_' + index + '@@';
  });

  function safeHref(rawHref) {
    const href = String(rawHref || '').trim().replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|file:)/i.test(href)) {
      return escHtml(href);
    }
    return '';
  }
  function inlineMarkdown(raw) {
    let html = escHtml(raw);
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_, label, href) {
      const safe = safeHref(href);
      return safe
        ? '<a href="' + safe + '" target="_blank" rel="noopener">' + label + '</a>'
        : label;
    });
    html = html.replace(/\`([^\`\\n]+)\`/g, '<code class="md-inline-code">$1</code>');
    html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/\\*([^*\\n]+)\\*/g, '<em>$1</em>');
    return html;
  }
  function isTableSeparator(line) {
    return /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(line || '');
  }
  function splitTableRow(line) {
    let trimmed = String(line || '').trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map(cell => cell.trim());
  }
  function startsBlock(line, nextLine) {
    return /^@@CODEBLOCK_\\d+@@$/.test(line)
      || /^#{1,6}\\s+/.test(line)
      || /^\\s*>\\s?/.test(line)
      || /^\\s*[-*]\\s+/.test(line)
      || /^\\s*\\d+\\.\\s+/.test(line)
      || /^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/.test(line)
      || (line.includes('|') && isTableSeparator(nextLine || ''));
  }

  const lines = source.split('\\n');
  const html = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const codeMatch = trimmed.match(/^@@CODEBLOCK_(\\d+)@@$/);
    if (codeMatch) {
      html.push(codeBlocks[Number(codeMatch[1])] || '');
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(
        '<table><thead><tr>'
        + headers.map(cell => '<th>' + inlineMarkdown(cell) + '</th>').join('')
        + '</tr></thead><tbody>'
        + rows.map(row => '<tr>' + row.map(cell => '<td>' + inlineMarkdown(cell) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>'
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>');
      continue;
    }

    if (/^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/.test(line)) {
      html.push('<hr>');
      continue;
    }

    if (/^\\s*>\\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\\s*>\\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\\s*>\\s?/, ''));
        index += 1;
      }
      index -= 1;
      html.push('<blockquote>' + quoteLines.map(inlineMarkdown).join('<br>') + '</blockquote>');
      continue;
    }

    if (/^\\s*[-*]\\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\\s*[-*]\\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\\s*[-*]\\s+/, ''));
        index += 1;
      }
      index -= 1;
      html.push('<ul>' + items.map(item => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</ul>');
      continue;
    }

    if (/^\\s*\\d+\\.\\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\\s*\\d+\\.\\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\\s*\\d+\\.\\s+/, ''));
        index += 1;
      }
      index -= 1;
      html.push('<ol>' + items.map(item => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</ol>');
      continue;
    }

    const paragraph = [line];
    while (
      index + 1 < lines.length
      && lines[index + 1].trim()
      && !startsBlock(lines[index + 1], lines[index + 2])
    ) {
      index += 1;
      paragraph.push(lines[index]);
    }
    html.push('<p>' + paragraph.map(inlineMarkdown).join('<br>') + '</p>');
  }

  return html.join('');
}

// ─── Avatar helpers ─────────────────────────────────────────────────────────

const PROFILE_CACHE_TTL_MS = 60 * 1000;
const AVATAR_CONTENT_PATH_PREFIXES = [
  '/content/',
  '/metafile-indexer/content/',
  '/metafile-indexer/thumbnail/',
  '/metafile-indexer/api/v1/files/content/',
  '/metafile-indexer/api/v1/files/accelerate/content/',
  '/metafile-indexer/api/v1/users/avatar/accelerate/',
];
const profileCache = new Map();

function normalizeAvatarUrl(rawAvatar) {
  const raw = normalizeText(rawAvatar);
  if (!raw) return '';
  if (/^(data:|blob:)/i.test(raw)) {
    return raw;
  }
  const pinRef = extractAvatarPinReference(raw);
  if (pinRef) {
    return '/api/file/avatar?ref=' + encodeURIComponent(pinRef);
  }
  if (isAvatarContentReference(raw)) {
    return '';
  }
  if (isHttpUrl(raw)) {
    return raw;
  }
  return raw;
}

function isAvatarContentReference(rawAvatar) {
  const raw = normalizeText(rawAvatar);
  if (!raw) return false;
  if (raw.toLowerCase().indexOf('metafile://') === 0) {
    return true;
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
  return AVATAR_CONTENT_PATH_PREFIXES.some(prefix => path.toLowerCase().indexOf(prefix.toLowerCase()) === 0);
}

function extractAvatarPinReference(rawAvatar) {
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
  if (/^[0-9a-f]{64}(?:i[0-9]+)?$/i.test(raw)) {
    return raw;
  }
  return '';
}

function isHttpUrl(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized.indexOf('http://') === 0 || normalized.indexOf('https://') === 0;
}

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
  const cached = profileCache.get(gmid);
  if (cached) {
    if (cached.fetching) {
      await cached.fetching;
      const updated = profileCache.get(gmid) || cached;
      return { name: updated.name || gmid, avatar: updated.avatar || '' };
    }
    if (Date.now() - (cached.fetchedAt || 0) < PROFILE_CACHE_TTL_MS) {
      return { name: cached.name || gmid, avatar: cached.avatar || '' };
    }
  }
  let resolveFn;
  const fetchPromise = new Promise(resolve => { resolveFn = resolve; });
  profileCache.set(gmid, {
    name: cached?.name || '',
    avatar: cached?.avatar || '',
    fetchedAt: cached?.fetchedAt || 0,
    fetching: fetchPromise,
  });
  let name = cached?.name || '', avatarUrl = cached?.avatar || '';
  let fetched = false;
  try {
    const resp = await fetch('https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/' + encodeURIComponent(gmid));
    if (resp.ok) {
      const json = await resp.json();
      const data = json?.data || json || {};
      fetched = true;
      name = data.name || data.showName || data.nickname || '';
      const rawAvatar = data.avatar || data.avatarUrl || data.avatarId || data.avatarImage || data.avatarUri || data.avatar_uri || '';
      avatarUrl = normalizeAvatarUrl(rawAvatar);
    }
  } catch { /* ignore */ }
  if (!fetched && cached) {
    name = cached.name || '';
    avatarUrl = cached.avatar || '';
  }
  profileCache.set(gmid, { name, avatar: avatarUrl, fetchedAt: Date.now(), fetching: null });
  resolveFn();
  return { name: name || gmid, avatar: avatarUrl || '' };
}

// ─── Application state ───────────────────────────────────────────────────────

let sessions = [];
let stats = { totalCount: 0, callerCount: 0, providerCount: 0, lastUpdatedAt: null };
let selectedSessionId = null;
let sessionDetail = null;
let refreshTimer = null;
let refreshInFlight = false;
let detailLoadSeq = 0;
let renderedDetailSignature = '';
let renderedMessageCount = 0;
let activeMediaObjectUrls = new Set();
let refundWorkIndex = new Map();

const $ = (sel) => document.querySelector(sel);
const qAll = (sel) => [...document.querySelectorAll(sel)];

function renderStats() {
  const el = $('[data-trace-total]'); if (el) el.textContent = stats.totalCount;
  const el2 = $('[data-trace-caller]'); if (el2) el2.textContent = stats.callerCount;
  const el3 = $('[data-trace-provider]'); if (el3) el3.textContent = stats.providerCount;
  const el4 = $('[data-trace-last]');
  if (el4) el4.textContent = stats.lastUpdatedAt ? fmtDate(stats.lastUpdatedAt) : '—';
}

function getInitialTraceSelection() {
  let params;
  try {
    params = new URLSearchParams((typeof window !== 'undefined' && window.location && window.location.search) || '');
  } catch {
    return { sessionId: '', traceId: '' };
  }
  return {
    sessionId: normalizeText(params.get('sessionId')),
    traceId: normalizeText(params.get('traceId')),
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
}

function buildMessageSignature(msg) {
  return [
    msg.id,
    msg.timestamp,
    msg.type,
    msg.sender,
    msg.content,
    stableStringify(msg.metadata || null),
    stableStringify(msg.deliveryArtifacts || null),
  ].join('\\u001f');
}

function getMessageCount(detail) {
  return detail && Array.isArray(detail.messages) ? detail.messages.length : 0;
}

function buildDetailRenderSignature(detail, profiles) {
  if (!detail) return '';
  return stableStringify({
    sessionId: detail.sessionId,
    traceId: detail.traceId,
    role: detail.role,
    state: detail.state,
    localMetabotName: detail.localMetabotName,
    localMetabotGlobalMetaId: detail.localMetabotGlobalMetaId,
    localMetabotAvatar: detail.localMetabotAvatar,
    peerGlobalMetaId: detail.peerGlobalMetaId,
    peerName: detail.peerName,
    peerAvatar: detail.peerAvatar,
    servicePinId: detail.servicePinId,
    refundActionRequired: detail.refundActionRequired,
    refundConfirmable: detail.refundConfirmable,
    refundOrderId: detail.refundOrderId,
    refundStatus: detail.refundStatus,
    refundRequestPinId: detail.refundRequestPinId,
    refundFinalizePinId: detail.refundFinalizePinId,
    refundFrom: detail.refundFrom,
    refundHref: detail.refundHref,
    localProfile: profiles && profiles.localProfile ? profiles.localProfile : null,
    peerProfile: profiles && profiles.peerProfile ? profiles.peerProfile : null,
    messages: (detail.messages || []).map(buildMessageSignature),
  });
}

function isScrollNearBottom(scroll) {
  if (!scroll) return true;
  const distance = Number(scroll.scrollHeight || 0) - Number(scroll.scrollTop || 0) - Number(scroll.clientHeight || 0);
  return distance <= 48;
}

function resolveInitialSessionId() {
  const selection = getInitialTraceSelection();
  if (selection.sessionId) return selection.sessionId;
  if (!selection.traceId) return '';
  const matched = sessions.find(session => (
    session.traceId === selection.traceId || session.sessionId === selection.traceId
  ));
  return matched ? matched.sessionId : '';
}

async function loadRefundWorkIndex() {
  var index = new Map();
  try {
    var resp = await fetch('/api/services/refunds?all=true', { cache: 'no-store' });
    if (!resp.ok) return index;
    var json = await resp.json();
    var data = json && (json.data || json) || {};
    var sellerRows = Array.isArray(data.receivedByMe) ? data.receivedByMe : [];
    sellerRows.forEach(function(item) {
      var record = Object.assign({}, item, {
        refundActionRequired: item && item.manualActionRequired === true,
        refundOrderId: item && item.orderId,
        refundFrom: item && item.localMetabotSlug,
      });
      var refundAction = resolveRefundAction(record, 'provider');
      if (!refundAction.refundActionRequired) return;
      var patch = {
        refundActionRequired: refundAction.refundActionRequired,
        refundConfirmable: refundAction.refundConfirmable,
        refundOrderId: refundAction.refundOrderId,
        refundStatus: refundAction.refundStatus,
        refundRequestPinId: refundAction.refundRequestPinId,
        refundFinalizePinId: refundAction.refundFinalizePinId,
        refundFrom: refundAction.refundFrom,
        refundHref: refundAction.refundHref,
      };
      var traceId = normalizeText(item && item.traceId);
      var sessionId = normalizeText(item && (item.a2aSessionId || item.sessionId));
      if (traceId) index.set('trace:' + traceId, patch);
      if (sessionId) index.set('session:' + sessionId, patch);
    });
  } catch {
    return index;
  }
  return index;
}

function mergeRefundWorkIntoSessionRecord(record, refundWorkIndex) {
  if (!refundWorkIndex || !refundWorkIndex.size) return record;
  var sessionId = normalizeText(record && record.sessionId);
  var traceId = normalizeText(record && record.traceId);
  var patch = (sessionId && refundWorkIndex.get('session:' + sessionId))
    || (traceId && refundWorkIndex.get('trace:' + traceId));
  return patch ? Object.assign({}, record, patch) : record;
}

function mergeRefundWorkIntoSessionDetail(detail) {
  if (!detail || !refundWorkIndex || !refundWorkIndex.size) return detail;
  var patch = (detail.sessionId && refundWorkIndex.get('session:' + detail.sessionId))
    || (detail.traceId && refundWorkIndex.get('trace:' + detail.traceId));
  return patch ? Object.assign({}, detail, patch) : detail;
}

async function processRefundFromDetail(button) {
  const orderId = button.getAttribute('data-process-refund') || '';
  if (!orderId) return;
  const previousText = button.textContent || 'Process refund';
  button.disabled = true;
  button.textContent = 'Processing...';
  try {
    const from = button.getAttribute('data-refund-from') || '';
    const response = await fetch('/api/services/refunds/settle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, ...(from ? { from } : {}) }),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && (payload.code || payload.message)) || 'Refund settlement is blocked.');
    }
    refundWorkIndex = await loadRefundWorkIndex();
    await loadSessions();
    if (selectedSessionId) {
      await loadSessionDetail(selectedSessionId, { silent: true });
    }
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : String(error);
    return;
  } finally {
    button.disabled = false;
  }
  button.textContent = previousText;
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
    const peerName = session.peerName || session.peerGlobalMetaId || '(unknown remote)';
    const peerMeta = session.peerGlobalMetaId && session.peerGlobalMetaId !== peerName
      ? session.peerGlobalMetaId.slice(0, 16) + '…'
      : '';
    const localName = session.localMetabotName || session.localMetabotGlobalMetaId || '—';
    const timeAgo = session.updatedAt ? fmtTimeAgo(Date.now() - session.updatedAt) : '';
    const isSelected = session.sessionId === selectedSessionId;
    const refundBadge = session.refundActionRequired
      ? '<span class="session-refund-badge">' + (session.refundConfirmable ? 'Refund ready' : 'Refund required') + '</span>'
      : '';
    return '<div class="session-item' + (isSelected ? ' selected' : '') + '" data-session-id="' + escHtml(session.sessionId) + '" role="button" tabindex="0">' +
      '<div class="session-item-header">' +
        '<span class="session-role-badge badge-' + roleBadgeTone + '">' + roleBadge + '</span>' +
        refundBadge +
        '<span class="session-time">' + escHtml(timeAgo) + '</span>' +
      '</div>' +
      '<div class="session-item-peer" data-peer-name="' + escHtml(session.sessionId) + '">' + escHtml(peerName) + '</div>' +
      '<div class="session-item-local">' + escHtml(peerMeta ? peerMeta + ' · local: ' + localName : 'local: ' + localName) + '</div>' +
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
    renderedDetailSignature = '';
    renderedMessageCount = 0;
    revokeMediaObjectUrls();
    panel.innerHTML = '<div class="detail-empty"><p>Select a session from the list to inspect it.</p></div>';
    return;
  }
  const detail = sessionDetail;
  const [localProfile, peerProfile] = await Promise.all([
    resolveProfile(detail.localMetabotGlobalMetaId),
    resolveProfile(detail.peerGlobalMetaId),
  ]);
  const nextDetailSignature = buildDetailRenderSignature(detail, { localProfile, peerProfile });
  const nextMessageCount = getMessageCount(detail);
  if (nextDetailSignature && nextDetailSignature === renderedDetailSignature) {
    return;
  }
  const previousScroll = panel.querySelector('.messages-scroll');
  const shouldStickToBottom = !renderedDetailSignature
    || isScrollNearBottom(previousScroll)
    || nextMessageCount > renderedMessageCount;
  const previousScrollTop = previousScroll ? previousScroll.scrollTop : 0;
  const localName = detail.localMetabotName || localProfile.name || detail.localMetabotGlobalMetaId || 'Local';
  const peerName = detail.peerName
    || (peerProfile.name && peerProfile.name !== detail.peerGlobalMetaId
    ? peerProfile.name
    : (detail.peerGlobalMetaId ? detail.peerGlobalMetaId.slice(0, 20) + '…' : 'Peer'));
  const localAvatar = localProfile.avatar || normalizeAvatarUrl(detail.localMetabotAvatar) || getInitialsAvatar(localName, detail.localMetabotGlobalMetaId);
  const peerAvatar = peerProfile.avatar || normalizeAvatarUrl(detail.peerAvatar) || getInitialsAvatar(peerName, detail.peerGlobalMetaId);
  const traceCopyValue = detail.traceId || detail.sessionId;

  const headerHtml =
    '<div class="detail-header">' +
      '<div class="detail-header-participant">' +
        avatarImg(peerAvatar, getInitialsAvatar(peerName, detail.peerGlobalMetaId), 'participant-avatar') +
        '<div class="participant-info">' +
          '<div class="participant-name">' + escHtml(peerName) + '</div>' +
          '<div class="participant-role">Remote · ' + escHtml(detail.role === 'caller' ? 'Provider' : 'Caller') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-header-meta">' +
        '<span class="status-pill status-' + getStateTone(detail.state) + '"><span class="status-dot"></span><span>' + escHtml(getStateLabel(detail.state)) + '</span></span>' +
        '<div class="detail-trace-row"><span class="detail-trace-id mono">trace: ' + escHtml(traceCopyValue) + '</span>' + copyButton(traceCopyValue, 'Copy trace id', 'copy-trace') + '</div>' +
      '</div>' +
      '<div class="detail-header-participant detail-header-participant-right">' +
        '<div class="participant-info participant-info-right">' +
          '<div class="participant-name">' + escHtml(localName) + '</div>' +
          '<div class="participant-role">' + escHtml(detail.role === 'caller' ? 'Caller' : 'Provider') + ' · Local</div>' +
        '</div>' +
        avatarImg(localAvatar, getInitialsAvatar(localName, detail.localMetabotGlobalMetaId), 'participant-avatar') +
      '</div>' +
    '</div>';

  const messagesHtml = detail.messages.length
    ? '<div class="messages-list">' + detail.messages.map(msg => renderMessage(msg, localName, peerName, localAvatar, peerAvatar)).join('') + '</div>'
    : '<div class="messages-empty"><span class="mono">No transcript messages recorded for this session.</span></div>';
  const refundActionHtml = detail.refundActionRequired
    ? '<div class="detail-refund-alert">'
      + '<div class="detail-refund-copy">'
        + '<strong>' + (detail.refundConfirmable ? 'Provider refund is ready to confirm.' : 'Provider refund needs operator attention.') + '</strong>'
        + '<span>' + escHtml(detail.refundOrderId ? 'Order ' + detail.refundOrderId : 'Open the refund work queue for settlement details.') + '</span>'
      + '</div>'
      + (detail.refundOrderId
        ? '<button type="button" class="detail-refund-action" data-process-refund="' + escHtml(detail.refundOrderId) + '" data-refund-from="' + escHtml(detail.refundFrom || '') + '">Process refund</button>'
        : '<a class="detail-refund-action" href="' + escHtml(detail.refundHref || '/ui/refund') + '">Open refund queue</a>')
    + '</div>'
    : '';

  revokeMediaObjectUrls();
  panel.innerHTML = headerHtml + refundActionHtml + '<div class="messages-scroll">' + messagesHtml + '</div>';
  const scroll = panel.querySelector('.messages-scroll');
  if (scroll) {
    scroll.scrollTop = shouldStickToBottom ? scroll.scrollHeight : previousScrollTop;
  }
  renderedDetailSignature = nextDetailSignature;
  renderedMessageCount = nextMessageCount;
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
  panel.querySelectorAll('[data-copy-text]').forEach(btn => {
    btn.addEventListener('click', () => copyTextToClipboard(btn.dataset.copyText || ''));
  });
  panel.querySelectorAll('[data-process-refund]').forEach(btn => {
    btn.addEventListener('click', () => processRefundFromDetail(btn));
  });
  hydrateMediaPlayback(panel);
}

const TOOL_ID_SEQ = { n: 0 };

function copyIconSvg() {
  return '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M8 7.5V6a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H16" />' +
    '<path d="M4.5 9.5a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9.5Z" />' +
  '</svg>';
}

function copyButton(value, label, cls) {
  if (!value) return '';
  return '<button type="button" class="copy-action ' + escHtml(cls || '') + '" data-copy-text="' + escHtml(value) + '" title="' + escHtml(label) + '" aria-label="' + escHtml(label) + '">' + copyIconSvg() + '</button>';
}

function showToast(message) {
  const toast = $('[data-copy-toast]');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  if (showToast.timer) clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1600);
}

function copyTextFallback(value) {
  if (typeof document === 'undefined' || !document.createElement || !document.body) {
    return false;
  }
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
    ok = document.execCommand && document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

async function copyTextToClipboard(value) {
  if (!value) return;
  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied) {
    copied = copyTextFallback(value);
  }
  showToast(copied ? 'Copied' : 'Copy unavailable');
}

function revokeMediaObjectUrls() {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    activeMediaObjectUrls.clear();
    return;
  }
  activeMediaObjectUrls.forEach(function(objectUrl) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  });
  activeMediaObjectUrls.clear();
}

function setMediaHydrationState(element, state) {
  if (!element || !element.classList) return;
  element.classList.toggle('is-loading', state === 'loading');
  element.classList.toggle('is-ready', state === 'ready');
  element.classList.toggle('is-fallback', state === 'fallback');
}

async function fetchMediaBlob(url) {
  if (!url || typeof fetch !== 'function') return null;
  let controller = null;
  let timeout = null;
  const options = {};
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    options.signal = controller.signal;
  }
  if (controller && typeof setTimeout === 'function') {
    timeout = setTimeout(function() { controller.abort(); }, MEDIA_FETCH_TIMEOUT_MS);
  }
  try {
    const response = await fetch(url, options);
    if (!response || !response.ok || typeof response.blob !== 'function') {
      return null;
    }
    return await response.blob();
  } finally {
    if (timeout && typeof clearTimeout === 'function') {
      clearTimeout(timeout);
    }
  }
}

async function hydrateMediaElement(element) {
  if (!element || !element.dataset || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }
  setMediaHydrationState(element, 'loading');
  const sourceUrl = normalizeText(element.dataset.sourceUrl);
  const fallbackUrl = normalizeText(element.dataset.fallbackUrl);
  const urls = sourceUrl && sourceUrl === fallbackUrl ? [sourceUrl] : [sourceUrl, fallbackUrl].filter(Boolean);

  for (const url of urls) {
    try {
      const blob = await fetchMediaBlob(url);
      if (!blob) continue;
      const oldObjectUrl = element.dataset.objectUrl;
      if (oldObjectUrl && activeMediaObjectUrls.has(oldObjectUrl) && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(oldObjectUrl);
        activeMediaObjectUrls.delete(oldObjectUrl);
      }
      const objectUrl = URL.createObjectURL(blob);
      activeMediaObjectUrls.add(objectUrl);
      element.dataset.objectUrl = objectUrl;
      element.src = objectUrl;
      setMediaHydrationState(element, 'ready');
      return;
    } catch {
      /* try the next URL */
    }
  }
  setMediaHydrationState(element, 'fallback');
}

function hydrateMediaPlayback(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const mediaElements = Array.prototype.slice.call(
    root.querySelectorAll('video[data-source-url], audio[data-source-url]'),
    0,
    MEDIA_HYDRATION_LIMIT,
  );
  mediaElements.forEach(function(element) {
    hydrateMediaElement(element).catch(function() {
      setMediaHydrationState(element, 'fallback');
    });
  });
}

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
  const structuredMetafiles = normalizeMessageArtifacts(msg.deliveryArtifacts);
  const usingTextMetafiles = structuredMetafiles.length === 0;
  const metafiles = usingTextMetafiles ? extractMetafiles(msg.content) : structuredMetafiles;
  const timeStr = fmtTime(msg.timestamp);
  const txid = resolveMessageTxid(msg);
  const txidPreview = formatTxidPreview(txid);
  const timeHtml = '<span class="msg-time">' + escHtml(timeStr) + '</span>';
  const txidHtml = txidPreview
    ? '<span class="msg-txid"><span class="msg-txid-text">txid: ' + escHtml(txidPreview) + '</span>' + copyButton(txid, 'Copy txid', 'copy-txid') + '</span>'
    : '';
  const metaHtml = isLocal
    ? txidHtml + timeHtml
    : timeHtml + txidHtml;
  let contentHtml = renderMarkdown(msg.content);
  if (usingTextMetafiles && metafiles.length) {
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
      '<div class="msg-meta ' + (isLocal ? 'msg-meta-local' : 'msg-meta-peer') + '">' + metaHtml + '</div>' +
    '</div></div>';
}

async function loadSessions() {
  try {
    const [sessionResponse, nextRefundWorkIndex] = await Promise.all([
      fetch('/api/trace/sessions?all=true&limit=500'),
      loadRefundWorkIndex(),
    ]);
    refundWorkIndex = nextRefundWorkIndex;
    const resp = sessionResponse;
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const payload = json.data || json;
    const rawSessions = (payload.sessions || []).map(function(record) {
      return mergeRefundWorkIntoSessionRecord(record, refundWorkIndex);
    });
    sessions = buildSessionListViewModel(rawSessions, Date.now());
    stats = payload.stats || { totalCount: sessions.length, callerCount: 0, providerCount: 0, lastUpdatedAt: null };
    if (!stats.totalCount) stats.totalCount = sessions.length;
    renderStats();
    renderSessionList();
  } catch (err) {
    const list = $('[data-session-list]');
    if (list) list.innerHTML = '<div class="session-empty"><p class="error-text">Failed to load sessions: ' + escHtml(String(err)) + '</p></div>';
  }
}

async function loadSessionDetail(sessionId, options) {
  options = options || {};
  const silent = options.silent === true;
  const sequence = ++detailLoadSeq;
  const panel = $('[data-session-detail]');
  if (panel && !silent) {
    renderedDetailSignature = '';
    renderedMessageCount = 0;
    revokeMediaObjectUrls();
    panel.innerHTML = '<div class="detail-loading"><span class="mono">Loading session…</span></div>';
  }
  try {
    const resp = await fetch('/api/trace/sessions/' + encodeURIComponent(sessionId));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (sequence !== detailLoadSeq) return;
    sessionDetail = mergeRefundWorkIntoSessionDetail(buildSessionDetailViewModel(json.data || json));
    await renderSessionDetail();
  } catch (err) {
    if (sequence !== detailLoadSeq) return;
    sessionDetail = null;
    renderedDetailSignature = '';
    renderedMessageCount = 0;
    revokeMediaObjectUrls();
    if (panel) panel.innerHTML = '<div class="detail-empty error-text"><p>Failed to load session: ' + escHtml(String(err)) + '</p></div>';
  }
}

async function selectSession(sessionId) {
  if (selectedSessionId === sessionId) return;
  selectedSessionId = sessionId;
  qAll('[data-session-id]').forEach(el => el.classList.toggle('selected', el.dataset.sessionId === sessionId));
  await loadSessionDetail(sessionId, { silent: false });
}

function startRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await loadSessions();
      if (selectedSessionId) await loadSessionDetail(selectedSessionId, { silent: true });
    } finally {
      refreshInFlight = false;
    }
  }, 15000);
}

async function init() {
  await loadSessions();
  const initialSessionId = resolveInitialSessionId();
  if (initialSessionId) {
    await selectSession(initialSessionId);
  } else {
    await renderSessionDetail();
  }
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
