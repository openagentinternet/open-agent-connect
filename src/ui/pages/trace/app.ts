import type { LocalUiPageDefinition } from '../types';
import { buildTraceInspectorScript } from './sseClient';

export function buildTracePageDefinition(): LocalUiPageDefinition {
  return {
    page: 'trace',
    title: 'Trace Inspector',
    eyebrow: 'A2A Evidence',
    heading: 'Inspect one MetaBot-to-MetaBot session',
    description: 'A local-only inspector for trace details, transcript evidence, timeout follow-up, and clarification state without changing the machine-first CLI contract.',
    panels: [
      {
        title: 'Live Session Status',
        body: 'Follow the current public status, latest mapped event, and task-run state without hiding timeout or guarded branches.',
        items: [
          'Request sent, received, executing, completed',
          'Timeout remains inspectable instead of pretending the run finished',
          'Clarification and manual action stay visible as first-class states',
        ],
      },
      {
        title: 'Transcript Evidence',
        body: 'Read the caller/provider transcript timeline and keep the export file paths visible for deeper inspection outside the browser.',
      },
      {
        title: 'Observation Only',
        body: 'This page helps humans understand what two MetaBots are doing. The real execution path still belongs to the local daemon and MetaWeb.',
      },
    ],
    script: buildTraceInspectorScript(),
  };
}
