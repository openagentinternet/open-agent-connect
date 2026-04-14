import { buildTraceInspectorViewModel } from './viewModel';

export function buildTraceInspectorScript(): string {
  const buildTraceInspectorViewModelSource = buildTraceInspectorViewModel.toString();
  return `(() => {
  const buildTraceInspectorViewModel = ${buildTraceInspectorViewModelSource};
  const traceId = new URL(window.location.href).searchParams.get('traceId') || 'unknown-trace';
  const traceApiUrl = '/api/trace/' + encodeURIComponent(traceId);
  const traceEventsUrl = traceApiUrl + '/events';
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
    resultSummary: document.querySelector('[data-trace-result-summary]'),
    result: document.querySelector('[data-trace-result]'),
    resultMeta: document.querySelector('[data-trace-result-meta]'),
    ratingSummary: document.querySelector('[data-trace-rating-summary]'),
    ratingRequest: document.querySelector('[data-trace-rating-request]'),
    ratingComment: document.querySelector('[data-trace-rating-comment]'),
    ratingMeta: document.querySelector('[data-trace-rating-meta]'),
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

  const setPreText = (element, value) => {
    if (!element) return;
    element.textContent = value;
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

  const appendListItem = (target, title, body, tone, extraClass) => {
    if (!target) return;
    const item = document.createElement('li');
    item.className = tone ? 'timeline-item tone-' + tone : 'timeline-item';
    if (extraClass) {
      item.className += ' ' + extraClass;
    }
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
  const formatDefinitionValue = (label, value) => {
    if (/(^| )At$/.test(label) && /^\\d+$/.test(String(value || ''))) {
      return formatTime(Number(value));
    }
    return String(value || '');
  };

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
    let title = 'Watching Remote agent';
    let copy = 'This local inspector is following one agent-to-agent session through the local daemon.';
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

  const buildParticipantBody = (values, fallback) => {
    const unique = [];
    values.forEach((value) => {
      if (typeof value !== 'string') return;
      const normalized = value.trim();
      if (!normalized || unique.includes(normalized)) return;
      unique.push(normalized);
    });
    return unique.length ? unique.join('\\n') : fallback;
  };

  const renderParticipants = (trace, inspector) => {
    clearChildren(elements.participants);
    if (!elements.participants || !trace) return;

    const callerName = trace.a2a && (trace.a2a.callerName || trace.a2a.callerGlobalMetaId)
      ? buildParticipantBody([trace.a2a.callerName, trace.a2a.callerGlobalMetaId], 'Unknown caller agent')
      : (trace.order && trace.order.role === 'seller'
        ? buildParticipantBody([trace.session && trace.session.peerName, trace.session && trace.session.peerGlobalMetaId], 'Unknown caller agent')
        : (trace.session && trace.session.metabotId != null ? 'Local MetaBot #' + trace.session.metabotId : 'Local MetaBot'));
    const remoteName = trace.a2a && trace.a2a.role === 'provider'
      ? buildParticipantBody([trace.a2a.callerName, trace.a2a.callerGlobalMetaId], 'Unknown remote MetaBot')
      : buildParticipantBody(
        [
          trace.a2a && trace.a2a.providerName,
          trace.a2a && trace.a2a.providerGlobalMetaId,
          trace.session && trace.session.peerName,
          trace.session && trace.session.peerGlobalMetaId,
        ],
        'Unknown remote MetaBot'
      );
    appendListItem(elements.participants, 'Caller agent', callerName || 'Unknown caller agent', 'active', 'participant-item');
    appendListItem(elements.participants, 'Remote agent', remoteName || 'Unknown remote MetaBot', 'active', 'participant-item');
    if (trace.order && (trace.order.serviceName || trace.order.serviceId)) {
      appendListItem(
        elements.participants,
        'Requested Capability',
        buildParticipantBody([trace.order.serviceName, trace.order.serviceId], 'Unspecified capability'),
        'neutral',
        'participant-item'
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

  const renderResultPanels = (trace, inspector) => {
    const viewModel = buildTraceInspectorViewModel({ trace, inspector });

    setText(elements.resultSummary, viewModel.resultPanel.summary);
    setPreText(elements.result, viewModel.resultPanel.text);
    clearChildren(elements.resultMeta);
    viewModel.resultPanel.metaRows.forEach((row) => {
      appendDefinitionRow(elements.resultMeta, row.label, formatDefinitionValue(row.label, row.value));
    });

    setText(elements.ratingSummary, viewModel.ratingPanel.summary);
    setPreText(
      elements.ratingRequest,
      viewModel.ratingPanel.requestText || 'No provider-side rating request is stored for this trace.'
    );
    setPreText(
      elements.ratingComment,
      viewModel.ratingPanel.commentText || 'No buyer-side rating follow-up is stored for this trace yet.'
    );
    clearChildren(elements.ratingMeta);
    viewModel.ratingPanel.metaRows.forEach((row) => {
      appendDefinitionRow(elements.ratingMeta, row.label, formatDefinitionValue(row.label, row.value));
    });
  };

  const renderTranscript = (trace, inspector) => {
    clearChildren(elements.transcript);
    if (!elements.transcript) return;
    const viewModel = buildTraceInspectorViewModel({ trace, inspector });
    const items = coerceArray(viewModel.transcriptItems);
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
      const entry = document.createElement('li');
      entry.className = 'timeline-item tone-' + (item.tone || 'neutral');
      const strong = document.createElement('strong');
      strong.textContent = (item.title || 'Transcript Event') + ' · ' + formatTime(item.timestamp);
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
    const viewModel = buildTraceInspectorViewModel({ trace, inspector });
    const snapshots = coerceArray(viewModel.statusItems);
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
      appendListItem(
        elements.events,
        (snapshot.title || 'pending') + ' · ' + formatTime(snapshot.timestamp),
        snapshot.content || 'Derived from daemon session state.',
        snapshot.tone || 'neutral'
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
    renderResultPanels(currentTrace, currentInspector);
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
