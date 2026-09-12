/**
 * A2A Chat overlay open state (client half).
 *
 * The A2A Chat surface is a `shell.overlay` entry covering the center column
 * only — the left rail and the official right Sidebar stay mounted and
 * interactive (a kernel global main panel would unmount the right Sidebar).
 * The panellist row cannot drive this state itself: its click is hardwired
 * to `layout.selectPanel`, so it is capture-intercepted and toggles this
 * apply-scope store instead. The overlay entry and the row's glyph read the
 * state through the inject `hooks` compartment.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type A2APanelState = {
  /** Whether the A2A Chat overlay covers the center column. */
  open: boolean
}

const CLOSED: A2APanelState = { open: false }
const OPEN: A2APanelState = { open: true }

export class A2APanelStore implements SnapshotStore<A2APanelState> {
  private readonly inner = createSnapshotStore<A2APanelState>(CLOSED)

  readonly getSnapshot = (): A2APanelState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: A2APanelState) => void): void => this.inner.update(mutator)

  readonly set = (next: A2APanelState): void => this.inner.set(next)

  /** Flip the overlay (the panellist row's intercepted click). */
  toggle(): void {
    this.set(this.inner.getSnapshot().open ? CLOSED : OPEN)
  }

  /** Close the overlay (session navigation, or a global panel taking over). */
  close(): void {
    if (this.inner.getSnapshot().open) this.set(CLOSED)
  }
}
