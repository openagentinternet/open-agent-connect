"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServicesPageDefinition = buildServicesPageDefinition;
const i18n_1 = require("../../i18n");
const app_1 = require("../my-services/app");
function buildServicesPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    return (0, app_1.buildMyServicesPageDefinition)({
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
