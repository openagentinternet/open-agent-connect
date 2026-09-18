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
 *
 * The store also carries a one-shot navigation target: the conversation-list
 * tabs (本地对话 / 线上对话 / 群任务) own every list, so the overlay is a pure
 * reading surface and rows navigate by opening it pre-positioned — on one
 * private thread (`private`), one group task (`grouptask`; an empty taskKey
 * opens the create-task modal), or one OpenTeam guest collaboration
 * (`collab`). `openOn` writes the target, the mounted panel applies it and
 * consumes it; `close` drops any unconsumed target so a stale one never
 * re-applies on a later open.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Where the panel should land when it opens (consumed on arrival). */
export type A2APanelTarget =
  | { mode: 'private'; from: string; peer: string }
  | { mode: 'grouptask'; taskKey: string }
  | { mode: 'collab'; slug: string; groupId: string }

export type A2APanelState = {
  /** Whether the A2A Chat overlay covers the center column. */
  open: boolean
  /** One-shot navigation target for the mounted panel; null once consumed. */
  target: A2APanelTarget | null
}

const CLOSED: A2APanelState = { open: false, target: null }

export class A2APanelStore implements SnapshotStore<A2APanelState> {
  private readonly inner = createSnapshotStore<A2APanelState>(CLOSED)

  readonly getSnapshot = (): A2APanelState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: A2APanelState) => void): void => this.inner.update(mutator)

  readonly set = (next: A2APanelState): void => this.inner.set(next)

  /** Flip the overlay (the panellist row's intercepted click). */
  toggle(): void {
    this.set(this.inner.getSnapshot().open ? CLOSED : { open: true, target: null })
  }

  /** Open the overlay positioned on one thread/task/collab (conversation-list tabs). */
  openOn(target: A2APanelTarget): void {
    this.set({ open: true, target })
  }

  /** Acknowledge the target after applying it (the mounted panel). */
  consumeTarget(): void {
    if (this.inner.getSnapshot().target !== null) {
      this.inner.set({ ...this.inner.getSnapshot(), target: null })
    }
  }

  /** Close the overlay (session navigation, or a global panel taking over). */
  close(): void {
    if (this.inner.getSnapshot().open || this.inner.getSnapshot().target !== null) this.set(CLOSED)
  }
}
