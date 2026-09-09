/**
 * Hero Bot identity mount. DSH has no slot above the blank-session hero
 * headline (whale logo + slogan), so this mounts a small React root into the
 * hero stack through the DOM, the same technique the Bot Browser sidebar and
 * the browser-iframe layout push already use.
 *
 * Anchoring lesson (three live rounds): the slot renderer wraps EVERY
 * renderSlot/renderSlotChain output in `display: contents` divs — the outlet
 * anchor `[data-slot="…"]`, and for overlay chains a second
 * `[data-chain-overlay-fallback="…"]` around the fallback — so positional
 * child walks from the composer seat land an unpredictable number of levels
 * short (round 1 dropped the block into the chip row, round 3 into the
 * HeroShell flex-row root beside the stack). The mount therefore anchors on
 * CONTENT, which no wrapper can displace: in the hero phase the whale-logo
 * svg is the first svg under the composer seat, and its nearest div ancestor
 * IS the headline row. The host is inserted directly before that row, so the
 * avatar + name sits centered above the whale and slogan inside the hero
 * stack's flex column. When the first message flips the session active the
 * hero subtree unmounts, the host disconnects, and the mount releases
 * itself until the next blank session. A future DSH layout change that
 * breaks the anchor fails safe: the block stops appearing.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HeroBotIdentity } from './HeroBotIdentity.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'

/**
 * The headline row (whale logo + slogan + preview badge) of the on-screen
 * blank-session hero.
 * @returns the row to insert before, or null when no hero is on screen.
 */
function heroHeadline(): HTMLElement | null {
  const phaseRoot = document.querySelector('[data-phase="hero"]')
  if (!(phaseRoot instanceof HTMLElement)) return null
  const seat = phaseRoot.querySelector('[data-composer-seat]')
  if (!(seat instanceof HTMLElement)) return null
  // Hero phase renders HeroShell first in the composer stack, so the first
  // svg under the seat is the whale mark; the headline grid is its nearest
  // div ancestor (the fish hitbox in between is a span).
  const whale = seat.querySelector('svg')
  if (!(whale instanceof SVGElement)) return null
  const headline = whale.closest('div')
  return headline instanceof HTMLElement ? headline : null
}

/**
 * Watch the DOM and keep the hero Bot identity mounted above the headline of
 * every blank-session hero.
 * @param store the hero chip controller's store (current preset + Bot roster).
 * @returns stop function (disconnect observer, unmount root, drop host).
 */
export function startHeroIdentityMount(store: SnapshotStore<BotPresetSeatState>): () => void {
  let root: Root | null = null
  let host: HTMLElement | null = null

  const release = (): void => {
    root?.unmount()
    root = null
    host?.remove()
    host = null
  }

  const attach = (): void => {
    if (host !== null) {
      if (host.isConnected) return
      // The hero unmounted underneath us (session left the blank phase).
      release()
    }
    const headline = heroHeadline()
    if (headline === null) return
    host = document.createElement('div')
    host.dataset.oacHeroIdentity = ''
    headline.before(host)
    root = createRoot(host)
    root.render(createElement(HeroBotIdentity, { store }))
  }

  const observer = new MutationObserver(() => { attach() })
  observer.observe(document.body, { childList: true, subtree: true })
  attach()
  return release
}
