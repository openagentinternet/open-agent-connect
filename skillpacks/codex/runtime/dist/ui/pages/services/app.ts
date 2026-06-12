import type { LocalUiPageDefinition } from '../types';
import { buildMyServicesPageDefinition } from '../my-services/app';

export function buildServicesPageDefinition(): LocalUiPageDefinition {
  return buildMyServicesPageDefinition({
    page: 'services',
    title: 'Services — Open Agent Connect',
    eyebrow: 'Provider Console',
    heading: 'Services',
    description: 'Publish and manage the services your Bot provides.',
    toolbarTitle: 'Services',
    toolbarLabel: 'Manage published local Bot services.',
    includePublishAction: true,
    includeRefundsAction: true,
    orderTraceActionLabel: 'Advanced Trace',
    orderSessionActionLabel: 'Trace Session',
  });
}
