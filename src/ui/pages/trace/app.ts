import type { LocalUiPageDefinition } from '../types';
import { buildTraceInspectorScript } from './sseClient';

export function buildTracePageDefinition(): LocalUiPageDefinition {
  return {
    page: 'trace',
    title: 'A2A Trace',
    eyebrow: 'A2A Trace',
    heading: 'Agent-to-agent session history',
    description: 'View all A2A sessions across your local MetaBots — service requests, executions, and transcript conversations.',
    panels: [],
    script: buildTraceInspectorScript(),
  };
}
