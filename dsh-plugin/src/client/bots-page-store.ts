/**
 * Bots page overlay open state (client half).
 *
 * The Bots page is a `shell.overlay` entry covering the center column only —
 * the official right Sidebar stays mounted, so opening a Bot page lands in
 * the real right-Sidebar Bot Browser (drag-resize, fullscreen, native tabs)
 * while the page stays put. The panellist row's click is hardwired to
 * `layout.selectPanel`, so it is capture-intercepted and toggles this
 * apply-scope store instead (the A2A overlay pattern). Session navigation and
 * 新会话 close the page, and opening the A2A overlay closes it too (one
 * center-column overlay at a time).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type BotsPagePanelState = {
  /** Whether the Bots page covers the center column. */
  open: boolean
}

const CLOSED: BotsPagePanelState = { open: false }

export class BotsPagePanelStore implements SnapshotStore<BotsPagePanelState> {
  private readonly inner = createSnapshotStore<BotsPagePanelState>(CLOSED)

  readonly getSnapshot = (): BotsPagePanelState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: BotsPagePanelState) => void): void => this.inner.update(mutator)

  readonly set = (next: BotsPagePanelState): void => this.inner.set(next)

  /** Flip the page (the panellist row's intercepted click). */
  toggle(): void {
    this.set(this.inner.getSnapshot().open ? CLOSED : { open: true })
  }

  /** Close the page (session navigation, 新会话, or the A2A overlay opening). */
  close(): void {
    if (this.inner.getSnapshot().open) this.set(CLOSED)
  }
}
