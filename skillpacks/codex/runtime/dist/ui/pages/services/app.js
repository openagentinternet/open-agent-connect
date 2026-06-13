"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServicesPageDefinition = buildServicesPageDefinition;
const app_1 = require("../my-services/app");
function buildServicesPageDefinition() {
    return (0, app_1.buildMyServicesPageDefinition)({
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
