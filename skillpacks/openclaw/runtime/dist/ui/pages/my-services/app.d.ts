import type { LocalUiPageDefinition } from '../types';
export interface MyServicesPageDefinitionOptions {
    page?: LocalUiPageDefinition['page'];
    title?: string;
    eyebrow?: string;
    heading?: string;
    description?: string;
    toolbarTitle?: string;
    toolbarLabel?: string;
    includePublishAction?: boolean;
    includeRefundsAction?: boolean;
    orderTraceActionLabel?: string;
    orderSessionActionLabel?: string;
}
export declare function buildMyServicesPageDefinition(options?: MyServicesPageDefinitionOptions): LocalUiPageDefinition;
