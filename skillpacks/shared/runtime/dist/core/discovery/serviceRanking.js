"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankServicesForDirectory = void 0;
const serviceDirectory_1 = require("./serviceDirectory");
const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const toSafeString = (value) => {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
};
const isOnline = (onlineBots, service) => {
    const globalMetaId = (0, serviceDirectory_1.normalizeComparableGlobalMetaId)(service?.providerGlobalMetaId || service?.globalMetaId);
    return Boolean(globalMetaId && onlineBots[globalMetaId]);
};
const rankServicesForDirectory = (services, onlineBots) => {
    return [...services].sort((left, right) => {
        const leftOnline = isOnline(onlineBots, left);
        const rightOnline = isOnline(onlineBots, right);
        if (leftOnline !== rightOnline) {
            return rightOnline ? 1 : -1;
        }
        const updatedDiff = toNumber(right?.updatedAt) - toNumber(left?.updatedAt);
        if (updatedDiff !== 0)
            return updatedDiff;
        const ratingDiff = toNumber(right?.ratingCount) - toNumber(left?.ratingCount);
        if (ratingDiff !== 0)
            return ratingDiff;
        return toSafeString(left?.serviceName || left?.displayName).localeCompare(toSafeString(right?.serviceName || right?.displayName));
    });
};
exports.rankServicesForDirectory = rankServicesForDirectory;
