import type { BrowserActor, BrowserRuntimeSnapshot } from './hostTypes';
import type { BrowserContextResult, BrowserUsingIdentity } from './types';

function actorToUsingIdentity(actor: BrowserActor): BrowserUsingIdentity | null {
  if (!actor.globalMetaId && actor.kind !== 'oac-bot') {
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

function actorToDefaultUsingIdentity(actor: BrowserActor): BrowserUsingIdentity | null {
  if (!actor.globalMetaId) {
    return null;
  }

  return actorToUsingIdentity(actor);
}

export function browserRuntimeToContextResult(snapshot: BrowserRuntimeSnapshot): BrowserContextResult {
  const usingIdentities = snapshot.actors
    .map(actorToUsingIdentity)
    .filter((identity): identity is BrowserUsingIdentity => Boolean(identity));
  const defaultUsingIdentity = snapshot.defaultActor
    ? actorToDefaultUsingIdentity(snapshot.defaultActor)
    : null;

  return {
    usingIdentities,
    defaultUsingIdentity,
    defaultUri: snapshot.defaultUri,
  };
}
