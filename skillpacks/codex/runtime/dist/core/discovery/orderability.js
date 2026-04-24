"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDelegationOrderability = void 0;
const serviceDirectory_1 = require("./serviceDirectory");
const serviceMatches = (service, servicePinId, providerGlobalMetaId) => {
    return ((service?.pinId === servicePinId || service?.sourceServicePinId === servicePinId) &&
        (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(service?.providerGlobalMetaId || service?.globalMetaId)
            === (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(providerGlobalMetaId));
};
const resolveDelegationOrderability = (params) => {
    const availableService = params.availableServices.find((service) => (serviceMatches(service, params.servicePinId, params.providerGlobalMetaId)));
    if (availableService) {
        return { status: 'available', service: availableService };
    }
    const dbService = params.allServices.find((service) => (serviceMatches(service, params.servicePinId, params.providerGlobalMetaId)));
    if (dbService) {
        return { status: 'offline', service: null };
    }
    return { status: 'missing', service: null };
};
exports.resolveDelegationOrderability = resolveDelegationOrderability;
