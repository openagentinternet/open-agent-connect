export function buildTraceInspectorScript(): string {
  return `(() => {
  const traceId = new URL(window.location.href).searchParams.get('traceId') || 'unknown-trace';
  const traceApiUrl = '/api/trace/' + encodeURIComponent(traceId);
  const traceEventsUrl = traceApiUrl + '/events';
  const transcriptEventKeys = new Set();
  const statusEventKeys = new Set();
  let currentTrace = null;
  let currentInspector = null;

  const elements = {
    traceId: document.querySelector('[data-trace-id]'),
    orderId: document.querySelector('[data-order-id]'),
    connection: document.querySelector('[data-connection-state]'),
    streamUrl: document.querySelector('[data-stream-url]'),
    statusPill: document.querySelector('[data-status-pill]'),
    statusTitle: document.querySelector('[data-status-title]'),
    statusCopy: document.querySelector('[data-status-copy]'),
    snapshot: document.querySelector('[data-trace-snapshot]'),
    participants: document.querySelector('[data-trace-participants]'),
    artifacts: document.querySelector('[data-trace-artifacts]'),
    transcript: document.querySelector('[data-trace-transcript]'),
    events: document.querySelector('[data-trace-events]'),
    transcriptHint: document.querySelector('[data-transcript-hint]'),
  };

  const setText = (element, value) => {
    if (!element) return;
    element.textContent = value;
  };

  const clearChildren = (element) => {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  };

  const appendDefinitionRow = (target, label, value) => {
    if (!target || !value) return;
    const row = document.createElement('div');
    row.className = 'definition-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    row.appendChild(term);
    row.appendChild(description);
    target.appendChild(row);
  };

  const appendListItem = (target, title, body, tone) => {
    if (!target) return;
    const item = document.createElement('li');
    item.className = tone ? 'timeline-item tone-' + tone : 'timeline-item';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = body;
    item.appendChild(strong);
    item.appendChild(paragraph);
    target.appendChild(item);
  };

  const formatTime = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 'pending';
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const coerceArray = (value) => Array.isArray(value) ? value.slice() : [];
  const coerceObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;

  const getCurrentPublicStatus = (trace, inspector) => {
    const traceStatus = trace && trace.a2a && typeof trace.a2a.publicStatus === 'string'
      ? trace.a2a.publicStatus
      : '';
    if (traceStatus) return traceStatus;
    const inspectorSession = inspector && inspector.session && typeof inspector.session.state === 'string'
      ? inspector.session.state
      : '';
    if (inspectorSession) return inspectorSession;
    return trace && typeof trace.status === 'string' ? trace.status : 'awaiting_trace';
  };

  const getCurrentClarificationState = (trace, inspector) => {
    const latestEvent = trace && trace.a2a && typeof trace.a2a.latestEvent === 'string'
      ? trace.a2a.latestEvent
      : '';
    const taskRunState = trace && trace.a2a && typeof trace.a2a.taskRunState === 'string'
      ? trace.a2a.taskRunState
      : '';
    const taskRuns = coerceArray(inspector && inspector.taskRuns);
    const latestTaskRun = taskRuns.length ? taskRuns[taskRuns.length - 1] : null;
    const latestTaskRunState = latestTaskRun && typeof latestTaskRun.state === 'string'
      ? latestTaskRun.state
      : '';
    return latestEvent === 'clarification_needed'
      || taskRunState === 'needs_clarification'
      || latestTaskRunState === 'needs_clarification';
  };

  const renderStatusBanner = (trace, inspector) => {
    const status = getCurrentPublicStatus(trace, inspector);
    const clarificationNeeded = getCurrentClarificationState(trace, inspector);
    let title = 'Watching Remote MetaBot';
    let copy = 'This local inspector is following one MetaBot-to-MetaBot session through the local daemon.';
    let tone = 'active';

    if (clarificationNeeded) {
      title = 'Clarification';
      copy = 'The remote MetaBot asked one follow-up question. Answer it in the host session, then keep this inspector open for the returned result.';
      tone = 'clarification';
    } else if (status === 'timeout') {
      title = 'Timeout';
      copy = 'Foreground waiting ended, but the remote MetaBot may still continue processing. Keep inspecting this trace for late completion.';
      tone = 'timeout';
    } else if (status === 'manual_action_required') {
      title = 'Manual Action';
      copy = 'The session reached a guarded branch that should be completed by a human instead of hiding it behind automation.';
      tone = 'manual';
    } else if (status === 'remote_failed') {
      title = 'Remote Failed';
      copy = 'The remote MetaBot explicitly failed this run. Inspect the timeline and transcript before retrying.';
      tone = 'failure';
    } else if (status === 'completed') {
      title = 'Completed';
      copy = 'The remote MetaBot returned a result and the local daemon captured the full trace.';
      tone = 'completed';
    } else if (status === 'remote_received' || status === 'remote_executing' || status === 'requesting_remote') {
      title = 'Live Remote Delegation';
      copy = 'The caller MetaBot has an active remote task session. Progress updates here mirror the daemon state, not a browser-only simulation.';
      tone = 'active';
    }

    if (elements.statusPill) {
      elements.statusPill.textContent = status || 'awaiting_trace';
      elements.statusPill.setAttribute('data-tone', tone);
    }
    setText(elements.statusTitle, title);
    setText(elements.statusCopy, copy);
  };

  const renderSnapshot = (trace, inspector) => {
    clearChildren(elements.snapshot);
    if (!elements.snapshot || !trace) return;
    appendDefinitionRow(elements.snapshot, 'Trace ID', trace.traceId || traceId);
    appendDefinitionRow(elements.snapshot, 'Channel', trace.channel || 'unknown');
    appendDefinitionRow(elements.snapshot, 'A2A Session ID', trace.a2a && trace.a2a.sessionId ? trace.a2a.sessionId : '');
    appendDefinitionRow(elements.snapshot, 'Task Run ID', trace.a2a && trace.a2a.taskRunId ? trace.a2a.taskRunId : '');
    appendDefinitionRow(elements.snapshot, 'Public Status', getCurrentPublicStatus(trace, inspector));
    appendDefinitionRow(elements.snapshot, 'Latest Event', trace.a2a && trace.a2a.latestEvent ? trace.a2a.latestEvent : '');
    appendDefinitionRow(elements.snapshot, 'Task Run State', trace.a2a && trace.a2a.taskRunState ? trace.a2a.taskRunState : '');
    appendDefinitionRow(elements.snapshot, 'External Conversation', trace.session && trace.session.externalConversationId ? trace.session.externalConversationId : '');
    appendDefinitionRow(elements.snapshot, 'Observed At', formatTime(trace.createdAt));
  };

  const renderParticipants = (trace, inspector) => {
    clearChildren(elements.participants);
    if (!elements.participants || !trace) return;

    const callerName = trace.a2a && (trace.a2a.callerName || trace.a2a.callerGlobalMetaId)
      ? [trace.a2a.callerName, trace.a2a.callerGlobalMetaId].filter(Boolean).join(' ')
      : (trace.order && trace.order.role === 'seller'
        ? [trace.session.peerName, trace.session.peerGlobalMetaId].filter(Boolean).join(' ')
        : (trace.session && trace.session.metabotId != null ? 'Local MetaBot #' + trace.session.metabotId : 'Local MetaBot'));
    const remoteName = trace.a2a && trace.a2a.role === 'provider'
      ? [trace.a2a.callerName, trace.a2a.callerGlobalMetaId].filter(Boolean).join(' ')
      : [trace.a2a && trace.a2a.providerName, trace.a2a && trace.a2a.providerGlobalMetaId, trace.session && trace.session.peerName, trace.session && trace.session.peerGlobalMetaId]
        .filter(Boolean)[0] || [trace.session && trace.session.peerName, trace.session && trace.session.peerGlobalMetaId].filter(Boolean).join(' ');
    appendListItem(elements.participants, 'Caller MetaBot', callerName || 'Unknown caller MetaBot', 'active');
    appendListItem(elements.participants, 'Remote MetaBot', remoteName || 'Unknown remote MetaBot', 'active');
    if (trace.order && (trace.order.serviceName || trace.order.serviceId)) {
      appendListItem(
        elements.participants,
        'Requested Capability',
        [trace.order.serviceName, trace.order.serviceId].filter(Boolean).join(' / '),
        'neutral'
      );
    }
  };

  const renderArtifacts = (trace, inspector) => {
    clearChildren(elements.artifacts);
    if (!elements.artifacts || !trace) return;
    const artifactEntries = [
      ['Transcript Markdown', trace.artifacts && trace.artifacts.transcriptMarkdownPath],
      ['Trace Markdown', trace.artifacts && trace.artifacts.traceMarkdownPath],
      ['Trace JSON', trace.artifacts && trace.artifacts.traceJsonPath],
    ];
    artifactEntries.forEach(([label, value]) => appendDefinitionRow(elements.artifacts, label, value || ''));
    if (inspector && inspector.traceMarkdown) {
      appendDefinitionRow(elements.artifacts, 'Trace Preview', String(inspector.traceMarkdown).split('\\n').slice(0, 3).join(' '));
    }
  };

  const renderTranscript = (trace, inspector) => {
    clearChildren(elements.transcript);
    if (!elements.transcript) return;
    const items = coerceArray(inspector && inspector.transcriptItems).sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
    if (!items.length) {
      const fallback = inspector && typeof inspector.transcriptMarkdown === 'string' && inspector.transcriptMarkdown.trim()
        ? inspector.transcriptMarkdown.trim().split('\\n').slice(0, 8).join('\\n')
        : 'Transcript entries will appear here when the daemon has session-level conversation records for this trace.';
      const pre = document.createElement('pre');
      pre.textContent = fallback;
      elements.transcript.appendChild(pre);
      if (elements.transcriptHint && trace && trace.artifacts && trace.artifacts.transcriptMarkdownPath) {
        elements.transcriptHint.textContent = 'Export path: ' + trace.artifacts.transcriptMarkdownPath;
      }
      return;
    }

    const list = document.createElement('ol');
    list.className = 'timeline-list';
    items.forEach((item) => {
      const key = [item.id || '', item.timestamp || '', item.content || ''].join('|');
      if (transcriptEventKeys.has(key)) {
        return;
      }
      transcriptEventKeys.add(key);
      const entry = document.createElement('li');
      entry.className = 'timeline-item tone-' + (item.type === 'clarification_request'
        ? 'clarification'
        : item.type === 'failure'
          ? 'failure'
          : item.sender === 'system'
            ? 'manual'
            : 'active');
      const strong = document.createElement('strong');
      strong.textContent = '[' + (item.sender || 'system') + '] ' + (item.type || 'message') + ' · ' + formatTime(item.timestamp);
      const paragraph = document.createElement('p');
      paragraph.textContent = item.content || '';
      entry.appendChild(strong);
      entry.appendChild(paragraph);
      list.appendChild(entry);
    });
    elements.transcript.appendChild(list);
    if (elements.transcriptHint && trace && trace.artifacts && trace.artifacts.transcriptMarkdownPath) {
      elements.transcriptHint.textContent = 'Export path: ' + trace.artifacts.transcriptMarkdownPath;
    }
  };

  const renderStatusEvents = (trace, inspector) => {
    clearChildren(elements.events);
    if (!elements.events) return;
    const snapshots = coerceArray(inspector && inspector.publicStatusSnapshots)
      .sort((left, right) => (left.resolvedAt || 0) - (right.resolvedAt || 0));
    if (!snapshots.length) {
      appendListItem(
        elements.events,
        'Awaiting Session Events',
        'No public status snapshots are stored yet for this trace. Keep the page open while the daemon processes remote updates.',
        'neutral'
      );
      return;
    }
    snapshots.forEach((snapshot) => {
      const key = [snapshot.sessionId || '', snapshot.taskRunId || '', snapshot.status || '', snapshot.resolvedAt || ''].join('|');
      if (statusEventKeys.has(key)) {
        return;
      }
      statusEventKeys.add(key);
      appendListItem(
        elements.events,
        (snapshot.status || 'pending') + ' · ' + formatTime(snapshot.resolvedAt),
        snapshot.rawEvent ? 'Mapped from ' + snapshot.rawEvent : 'Derived from daemon session state.',
        snapshot.status === 'timeout'
          ? 'timeout'
          : snapshot.status === 'manual_action_required'
            ? 'manual'
            : snapshot.status === 'remote_failed'
              ? 'failure'
              : snapshot.status === 'completed'
                ? 'completed'
                : snapshot.status === 'remote_received' || snapshot.status === 'remote_executing' || snapshot.status === 'requesting_remote'
                  ? 'active'
                  : 'neutral'
      );
    });
  };

  const normalizePayload = (payload) => {
    const data = coerceObject(payload && payload.data) || {};
    const trace = coerceObject(data.traceId ? data : data.trace) || {};
    const inspector = coerceObject(data.inspector) || {};
    return { trace, inspector };
  };

  const renderAll = () => {
    renderStatusBanner(currentTrace, currentInspector);
    renderSnapshot(currentTrace, currentInspector);
    renderParticipants(currentTrace, currentInspector);
    renderArtifacts(currentTrace, currentInspector);
    renderTranscript(currentTrace, currentInspector);
    renderStatusEvents(currentTrace, currentInspector);
  };

  const connectEventStream = () => {
    setText(elements.streamUrl, traceEventsUrl);
    if (!window.EventSource) {
      setText(elements.connection, 'eventsource-unavailable');
      return;
    }
    setText(elements.connection, 'connecting');
    const source = new EventSource(traceEventsUrl);
    source.addEventListener('open', () => {
      setText(elements.connection, 'connected');
    });
    source.addEventListener('trace-status', (event) => {
      try {
        const snapshot = JSON.parse(event.data);
        if (!currentInspector || !Array.isArray(currentInspector.publicStatusSnapshots)) {
          currentInspector = Object.assign({}, currentInspector || {}, { publicStatusSnapshots: [] });
        }
        currentInspector.publicStatusSnapshots = currentInspector.publicStatusSnapshots.concat([
          {
            sessionId: snapshot.sessionId || (currentTrace && currentTrace.a2a && currentTrace.a2a.sessionId) || '',
            taskRunId: snapshot.taskRunId || null,
            status: snapshot.status || null,
            mapped: true,
            rawEvent: snapshot.status || null,
            resolvedAt: snapshot.observedAt || Date.now(),
          },
        ]);
        if (currentTrace && currentTrace.a2a) {
          currentTrace.a2a.publicStatus = snapshot.status || currentTrace.a2a.publicStatus;
        }
        renderAll();
        if (snapshot.terminal) {
          setText(elements.connection, 'completed');
          source.close();
        }
      } catch {
        setText(elements.connection, 'stream-parse-error');
      }
    });
    source.addEventListener('error', () => {
      setText(elements.connection, 'reconnecting');
    });
  };

  const loadTrace = async () => {
    setText(elements.traceId, traceId);
    setText(elements.streamUrl, traceEventsUrl);
    const response = await fetch(traceApiUrl, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Trace inspector failed to load trace details.');
    }
    const normalized = normalizePayload(payload);
    currentTrace = normalized.trace;
    currentInspector = normalized.inspector;
    setText(elements.orderId, currentTrace && currentTrace.order && currentTrace.order.id ? currentTrace.order.id : 'no-order');
    renderAll();
    connectEventStream();
  };

  loadTrace().catch((error) => {
    setText(elements.connection, 'load-failed');
    if (elements.statusPill) {
      elements.statusPill.textContent = 'load_failed';
      elements.statusPill.setAttribute('data-tone', 'failure');
    }
    setText(elements.statusTitle, 'Inspector Load Failed');
    setText(elements.statusCopy, error instanceof Error ? error.message : String(error));
  });
})();`;
}
