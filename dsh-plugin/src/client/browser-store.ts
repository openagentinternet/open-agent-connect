/**
 * Right-sidebar Bot Browser store.
 *
 * The DSH web shell exposes no right-sidebar seat, so the plugin owns one as
 * a body portal (the same approach dsh-better-sidebar uses). This tiny store
 * is the single source of truth for open state, the iframe URL, and the
 * panel width; it is shared by the mounted panel, the Settings > Bots entry
 * buttons, and the daemon-event listener.
 */

export const BROWSER_WIDTH_MIN = 560
export const BROWSER_WIDTH_MAX = Math.round((typeof window === 'undefined' ? 1440 : window.innerWidth) * 0.9)
export const BROWSER_WIDTH_DEFAULT = Math.min(
  Math.round((typeof window === 'undefined' ? 1440 : window.innerWidth) * 0.72),
  1280,
)

export type BotBrowserState = {
  open: boolean
  /** The daemon `localUiUrl` currently loaded (null = landing/empty state). */
  url: string | null
  /** Panel width in CSS px (drives `--oac-browser-width`). */
  width: number
  /** Last open failure message (landing state shows it when set). */
  error: string | null
}

export class BotBrowserStore {
  private state: BotBrowserState = {
    open: false,
    url: null,
    width: BROWSER_WIDTH_DEFAULT,
    error: null,
  }

  private readonly listeners = new Set<() => void>()

  getSnapshot = (): BotBrowserState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private set(patch: Partial<BotBrowserState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Open the sidebar, loading the given page (null keeps the landing state). */
  open(url: string | null): void {
    this.set({ open: true, url, error: null })
  }

  /** Open the sidebar to the landing state carrying an open failure message. */
  fail(message: string): void {
    this.set({ open: true, url: null, error: message })
  }

  close(): void {
    this.set({ open: false })
  }

  toggle(): void {
    this.set({ open: !this.state.open })
  }

  setWidth(width: number): void {
    const clamped = Math.min(BROWSER_WIDTH_MAX, Math.max(BROWSER_WIDTH_MIN, Math.round(width)))
    if (clamped === this.state.width) return
    this.set({ width: clamped })
  }
}
