"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLoomDashboardIdentityProfile = resolveLoomDashboardIdentityProfile;
exports.projectLoomDashboardBotIdentity = projectLoomDashboardBotIdentity;
function cleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function shortStableLabel(value) {
    if (value.length <= 14) {
        return value;
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
function initialsFromLabel(label) {
    const words = label
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length >= 2) {
        return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    const compact = label.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return compact.slice(0, 2) || '?';
}
function getAuthorAddress(author) {
    const creatorAddress = 'creatorAddress' in author ? author.creatorAddress : undefined;
    const address = 'address' in author ? author.address : undefined;
    return cleanString(creatorAddress) ?? cleanString(address);
}
function resolveLoomDashboardIdentityProfile(author, identityMap) {
    if (!identityMap) {
        return undefined;
    }
    const globalMetaId = cleanString(author.globalMetaId);
    const address = getAuthorAddress(author);
    return (globalMetaId ? identityMap[globalMetaId] : undefined)
        ?? (address ? identityMap[address] : undefined);
}
function projectLoomDashboardBotIdentity(input) {
    const globalMetaId = cleanString(input.author.globalMetaId);
    const authorAddress = cleanString(input.address)
        ?? getAuthorAddress(input.author);
    const profile = input.profile ?? resolveLoomDashboardIdentityProfile(input.author, input.identityMap);
    const profileName = cleanString(profile?.displayName) ?? cleanString(profile?.name);
    const avatarUri = cleanString(profile?.avatarUri) ?? cleanString(profile?.avatarUrl);
    const fallbackSource = globalMetaId ?? authorAddress ?? input.role;
    const fallbackLabel = shortStableLabel(fallbackSource);
    const displayName = profileName ?? fallbackLabel;
    return {
        role: input.role,
        displayName,
        fallbackLabel,
        initials: initialsFromLabel(displayName),
        ...(globalMetaId ? { globalMetaId } : {}),
        ...(authorAddress ? { address: authorAddress } : {}),
        ...(avatarUri ? { avatarUri } : {}),
    };
}
