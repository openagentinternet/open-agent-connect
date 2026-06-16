import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';
import { buildMyServicesPageDefinition } from '../my-services/app';

export function buildServicesPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  return buildMyServicesPageDefinition({
    page: 'services',
    i18n,
    title: i18n.t('services.title'),
    eyebrow: i18n.t('services.eyebrow'),
    heading: i18n.t('services.heading'),
    description: i18n.t('services.description'),
    toolbarTitle: i18n.t('services.toolbarTitle'),
    toolbarTitleKey: 'services.toolbarTitle',
    toolbarLabel: i18n.t('services.toolbarLabel'),
    toolbarLabelKey: 'services.toolbarLabel',
    publishActionKey: 'services.publishService',
    refundsActionKey: 'services.serviceRefunds',
    includePublishAction: true,
    includeRefundsAction: true,
    orderTraceActionLabel: i18n.t('services.advancedTrace'),
    orderTraceActionKey: 'services.advancedTrace',
    orderSessionActionLabel: i18n.t('services.traceSession'),
    orderSessionActionKey: 'services.traceSession',
  });
}
