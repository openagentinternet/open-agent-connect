/**
 * Big Bot identity above the blank-session hero headline: the selected
 * `oac-*` Bot's 100px avatar and name, centered, following the hero chip's
 * staged selection live. Stock DSH presets render nothing (stock hero stays
 * pristine). Rendered above the whale logo + slogan row by hero-identity.ts,
 * not by a slot — DSH offers no slot there.
 */

import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { heroIdentityFor } from '../chip-logic.ts'
import { BotAvatar } from './BotAvatar.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'

export function HeroBotIdentity({ store }: { store: SnapshotStore<BotPresetSeatState> }): ReactNode {
  // Stable identities: useSyncExternalStore resubscribes when the subscribe
  // reference changes, and the store outlives every mount.
  const subscribe = useCallback((onInvalidate: () => void) => store.subscribe(onInvalidate), [store])
  const getSnapshot = useCallback(() => store.getSnapshot(), [store])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const identity = heroIdentityFor(state)
  if (identity === undefined) return null
  return (
    <div className="oac-hero-identity">
      <BotAvatar name={identity.name} src={identity.avatarDataUrl} className="oac-hero-identity-avatar" />
      <div className="oac-hero-identity-name">{identity.name}</div>
    </div>
  )
}
