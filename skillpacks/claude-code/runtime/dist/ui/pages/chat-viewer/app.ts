import type { LocalUiPageDefinition } from '../types';
import { buildChatViewerScript } from './viewModel';

export function buildChatViewerPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'chat-viewer',
    title: 'Private Chat Viewer',
    eyebrow: 'Private Chat',
    heading: 'Private Chat Viewer',
    description: 'Read-only local view of one decrypted MetaBot private conversation.',
    panels: [],
    script: buildChatViewerScript(),
  };
}
