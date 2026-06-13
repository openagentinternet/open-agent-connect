"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserRuntimeToContextResult = browserRuntimeToContextResult;
function actorToUsingIdentity(actor) {
    if (actor.kind !== 'oac-bot') {
        return null;
    }
    return {
        slug: actor.id,
        name: actor.label,
        globalMetaId: actor.globalMetaId ?? '',
        ...(actor.avatar ? { avatar: actor.avatar } : {}),
        isDefault: actor.isDefault,
    };
}
function actorToDefaultUsingIdentity(actor) {
    if (actor.kind !== 'oac-bot' || !actor.globalMetaId) {
        return null;
    }
    return actorToUsingIdentity(actor);
}
function browserRuntimeToContextResult(snapshot) {
    const usingIdentities = snapshot.actors
        .map(actorToUsingIdentity)
        .filter((identity) => Boolean(identity));
    const defaultUsingIdentity = snapshot.defaultActor
        ? actorToDefaultUsingIdentity(snapshot.defaultActor)
        : null;
    return {
        usingIdentities,
        defaultUsingIdentity,
        defaultUri: snapshot.defaultUri,
    };
}
