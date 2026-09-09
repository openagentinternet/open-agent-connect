/**
 * Hero Bot identity mount. DSH has no slot above the blank-session hero
 * headline (whale logo + slogan), so this mounts a small React root into the
 * hero stack through the DOM, the same technique the Bot Browser sidebar and
 * the browser-iframe layout push already use.
 *
 * Anchoring lesson (four live rounds): the slot renderer wraps EVERY
 * renderSlot/renderSlotChain output — including the whale mark itself — in
 * `display: contents` divs (`[data-slot="…"]`, and for overlay chains a
 * second `[data-chain-overlay-fallback="…"]` around the fallback). Child
 * walks and bare ancestor matches from any slot output therefore land on a
 * wrapper, not the layout element: rounds 1/3 dropped the block into the
 * chip row and the HeroShell flex-row root, round 4 into the 34px brand-mark
 * wrapper beside the whale. The mount now climbs from the whale svg to the
 * first ancestor div that is provably the headline row: not a slot anchor,
 * and spanning at least half the composer seat's width (the wrappers are
 * content-hugging; only the headline grid spans the hero column). The host
 * inserts directly before that row, making the block a regular child of the
 * hero stack's stretch flex column — horizontally centered, above the whale
 * and slogan. When the first message flips the session active the hero
 * subtree unmounts, the host disconnects, and the mount releases itself
 * until the next blank session. A future DSH layout change that breaks the
 * anchor fails safe: the block stops appearing.
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
  // svg under the seat is the whale mark.
  const whale = seat.querySelector('svg')
  if (!(whale instanceof SVGElement)) return null
  // Climb past every slot wrapper (content-hugging display:contents divs) to
  // the wide, un-wrapped div that can only be the headline grid. Zero-width
  // (hidden) seats never anchor.
  const columnWidth = seat.getBoundingClientRect().width
  if (columnWidth <= 0) return null
  let node: HTMLElement | null = whale.parentElement
  while (node !== null && node !== seat) {
    if (node instanceof HTMLElement
      && node.tagName === 'DIV'
      && node.dataset.slot === undefined
      && node.dataset.chainOverlayFallback === undefined
      && node.getBoundingClientRect().width >= columnWidth / 2) {
      return node
    }
    node = node.parentElement
  }
  return null
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
