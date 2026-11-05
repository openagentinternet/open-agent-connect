/**
 * OAC actions for the DSH 0.2.2+ unified session context menu (client half).
 *
 * The host's ui-context-menu plugin owns the right-click/keyboard overlay on
 * session rows; this contribution adds the one action that is ours: editing
 * the Bot behind an `oac-*` session. The session's committed `agentPreset`
 * projection (`oac-<slug>`) maps the row back to its Bot — every other row
 * resolves to no actions. The Bots page overlay opens on top of the center
 * column and the editor focuses the profile through the editor-request bus.
 *
 * Registration is feature-detected by the caller: `ctx.inject(['contextMenus'])`
 * never resolves on kernels without the service, so this module only runs on
 * 0.2.2+ clients.
 */
import type { BotsPagePanelStore } from './bots-page-store.ts'
import { requestBotEditor } from './bot-editor-requests.ts'

/** The sessions-list snapshot slice the resolver reads (structural). */
export interface SessionMenuSessionsState {
  byId: Record<string, { projectionValues?: { agentPreset?: unknown } } | undefined>
}

/** Structural face of the unified context-menu registry this module needs. */
export interface SessionMenuRegistry {
  register(contribution: {
    readonly id: string
    readonly target: 'session'
    readonly order: number
    readonly resolve: (target: { readonly sessionId: string; readonly displayTitle: string }) => readonly {
      readonly id: string
      readonly label: string
      readonly run?: () => void | Promise<void>
    }[]
  }): () => void
}

/** The Bot slug behind an `oac-*` session, or undefined for every other row. */
export function oacBotSlugOf(state: SessionMenuSessionsState, sessionId: string): string | undefined {
  const summary = (state.byId as SessionMenuSessionsState['byId'])[sessionId]
  const preset = summary?.projectionValues?.agentPreset
  if (typeof preset !== 'string' || !preset.startsWith('oac-')) return undefined
  const slug = preset.slice('oac-'.length)
  return slug === '' ? undefined : slug
}

/**
 * Register the `oac.editBot` session contribution. `label` is read per
 * resolve so a locale switch shows fresh text. Returns the unregister.
 */
export function registerSessionMenu(
  registry: SessionMenuRegistry,
  sessions: { list: { getSnapshot(): SessionMenuSessionsState } },
  botsPage: Pick<BotsPagePanelStore, 'set'>,
  label: () => string,
): () => void {
  return registry.register({
    id: 'oac.editBot',
    target: 'session',
    order: 700,
    resolve: (target) => {
      const slug = oacBotSlugOf(sessions.list.getSnapshot(), target.sessionId)
      if (slug === undefined) return []
      return [{
        id: 'edit-bot',
        label: label(),
        run: () => {
          botsPage.set({ open: true })
          requestBotEditor(slug)
        },
      }]
    },
  })
}
