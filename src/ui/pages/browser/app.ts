import type { LocalUiPageDefinition } from '../types';
import { buildBrowserPageDefinition as buildBrowserModulePageDefinition } from '../../../browser/app';

export function buildBrowserPageDefinition(): LocalUiPageDefinition {
  return buildBrowserModulePageDefinition();
}
