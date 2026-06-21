import type { LocalUiPageDefinition } from '../types';
import type { I18nKey, LocalUiI18nContext } from '../../i18n';
export interface MyServicesPageDefinitionOptions {
    page?: LocalUiPageDefinition['page'];
    i18n?: LocalUiI18nContext;
    title?: string;
    eyebrow?: string;
    heading?: string;
    description?: string;
    toolbarTitle?: string;
    toolbarTitleKey?: I18nKey;
    toolbarLabel?: string;
    toolbarLabelKey?: I18nKey;
    includePublishAction?: boolean;
    includeRefundsAction?: boolean;
    publishActionKey?: I18nKey;
    refundsActionKey?: I18nKey;
    orderTraceActionLabel?: string;
    orderTraceActionKey?: I18nKey;
    orderSessionActionLabel?: string;
    orderSessionActionKey?: I18nKey;
}
export declare function buildMyServicesPageDefinition(options?: MyServicesPageDefinitionOptions): LocalUiPageDefinition;
