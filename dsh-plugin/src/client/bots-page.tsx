/**
 * Bots main panel (client half): the plugin's dedicated page in the DSH
 * frame, reached from the left-rail `sidebar.panellist` row whose id matches
 * the `main` panel key (`oac-bots`) — the same mechanism the stock 插件 row
 * uses for the plugin manager. The page hosts every OAC configuration
 * surface that used to be a Settings section (Bots, Memory, User, Apps,
 * Traffic) as one `oac.bots.section` list entry each — the first labeled
 * 我的 Bot / My Bots — so DSH Settings stays
 * exactly stock.
 *
 * The chrome mirrors the Plugins settings section's pattern, turned vertical
 * like the Settings left nav it replaces: a nav column projects the
 * section ledger (registration `label`s, locale-reactive through the
 * inject-face snapshot hook), ArrowUp/ArrowDown/Home/End move with a roving
 * tabindex, and visited sections stay mounted behind the `hidden` attribute
 * so a section's loaded state (the Bots grid, the Memory bot select, …)
 * survives a tab switch. The active section id persists in localStorage, so
 * reopening the page returns to the section that was open last.
 *
 * Sections receive `{ close }` as owner props, the same contract
 * `settings.section` gave them: `close` means "leave this surface", which
 * for a main panel is `layout.selectPanel(null)` — back to the conversation
 * column (the Bot Browser reveal flow needs the right Sidebar mounted, and
 * the Sidebar's root gates on `activePanelId === null`).
 *
 * The page also owns a right-side **Bot Page dock**: the kernel hides the
 * right Sidebar while any main panel is active (`RightbarRoot` gates on
 * `activePanelId === null`), so from this page a Bot's page (or the Browser
 * home) opens in an in-page dock iframe instead of the right-Sidebar tab —
 * the page the user is managing never disappears under them. The dock loads
 * the same daemon-resolved `localUiUrl` through the side-effect-free
 * `browser/resolve` host route and renders the shared `BrowserStage`; it is
 * a pure viewer — the iframe bridge and the `<browser_context>` reporting
 * keep tracking only the right-Sidebar tab.
 */
import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import type { CommonKeyOf, InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { BrowserStage } from './browser-stage.tsx'
import {
  IconAgentPresetOutline16,
  IconAlarmClockOutline16,
  IconCloseOutline16,
  IconGaugeOutline16,
  IconGlobeOutline16,
  IconThinkOutline16,
  IconUserOutline16,
  type CompatIconProps,
} from './icons.ts'
import type { BotsLocaleKey } from './locale.ts'

/** Owner share of one Bots-page section entry (the page supplies `close`). */
export interface OacBotsSectionOwnerProps {
  /** Leave the Bots page and return to the conversation column. */
  close: () => void
  /**
   * Open one Bot's page (or the Browser home on null) in the page's own
   * right-side dock — the Bots page stays put (see the file header).
   */
  openBotPage: (uri: string | null, title: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One page inside the Bots main panel. Registrant options carry the nav
     * identity: `id` (section key, drives `only` filtering), `order` (nav
     * position), `label` (registrant-localized display text). Declared at
     * runtime by the panel's own `main` registration.
     */
    'oac.bots.section': {
      kind: 'list'
      scope: 'root'
      owner: OacBotsSectionOwnerProps
    }
  }
}

/** One projected section-ledger row (the page nav's rendering of an entry). */
export interface BotsPageSectionRow {
  id: string
  order: number
  label: string
}

export interface BotsPageInjected {
  hooks: {
    /** The section ledger projection behind the nav (slots version + locale revision memoized). */
    sections: ObservableSnapshot<BotsPageSectionRow[]>
  }
  /** Owner-prop face handed to every rendered section (see the file header). */
  close: () => void
  /** Resolve one Agent Internet URI (null = the Browser home) to its localUiUrl, without opening the right Sidebar. */
  resolveBotPage: (uri: string | null) => Promise<string>
}

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export type BotsPageProps =
  InjectFace<BotsPageInjected>
  & {
    renderSlot: PropsRenderSlots<'oac.bots.section'>['renderSlot']
    t: Translate
  }

/** The active-section preference, remembered per browser. */
const ACTIVE_SECTION_STORAGE_KEY = 'oac-dsh:bots-page-section:v1'

/** Per-section nav icons, keyed by section id (the Settings left nav maps its row icons by id the same way). */
const SECTION_ICONS: Readonly<Record<string, ComponentType<CompatIconProps>>> = {
  'oac-bots': IconAgentPresetOutline16,
  'oac-schedule': IconAlarmClockOutline16,
  'oac-memory': IconThinkOutline16,
  'oac-user': IconUserOutline16,
  'oac-apps': IconGlobeOutline16,
  'oac-traffic': IconGaugeOutline16,
}

function readActiveSection(): string | null {
  try { return window.localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY) } catch { return null }
}

function writeActiveSection(id: string): void {
  try { window.localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, id) } catch { /* storage may be disabled */ }
}

/** One open dock request: the Bot page (or Browser home) being shown. */
interface DockState {
  title: string
  url: string | null
  error: string | null
}

export function BotsPage({ t, renderSlot, useSections, close, resolveBotPage }: BotsPageProps): ReactNode {
  const navId = useId()
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rows = useSections((value) => value)
  const [activeId, setActiveId] = useState<string | null>(readActiveSection)
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id

  const [dock, setDock] = useState<DockState | null>(null)
  const dockRequestRef = useRef(0)
  const openDock = useCallback((uri: string | null, title: string): void => {
    const request = dockRequestRef.current + 1
    dockRequestRef.current = request
    setDock({ title, url: null, error: null })
    resolveBotPage(uri).then((url) => {
      if (dockRequestRef.current === request) setDock({ title, url, error: null })
    }).catch((cause: unknown) => {
      if (dockRequestRef.current === request) {
        setDock({ title, url: null, error: cause instanceof Error ? cause.message : String(cause) })
      }
    })
  }, [resolveBotPage])
  const closeDock = useCallback((): void => {
    dockRequestRef.current += 1
    setDock(null)
  }, [])

  useEffect(() => {
    if (active === undefined) return
    writeActiveSection(active)
    setVisitedIds((previous) => (previous.has(active) ? previous : new Set([...previous, active])))
  }, [active])

  // Roving-tabindex nav in the Plugins settings section's pattern, vertical:
  // Arrow keys cycle the focus, Home/End jump, the selected item owns tabIndex 0.
  const moveItem = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowDown': nextIndex = (index + 1) % rows.length; break
      case 'ArrowUp': nextIndex = (index - 1 + rows.length) % rows.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = rows.length - 1; break
      default: return
    }
    event.preventDefault()
    const next = rows[nextIndex]
    if (next === undefined) return
    setActiveId(next.id)
    itemRefs.current[nextIndex]?.focus()
  }

  const panelId = (id: string): string => `${navId}-panel-${id}`
  const tabId = (id: string): string => `${navId}-tab-${id}`

  return (
    <div className="oac-bots-page">
      <nav className="oac-bots-page-nav">
        <h1 className="oac-bots-page-nav-title">{t('nav')}</h1>
        <div className="oac-bots-page-nav-list" role="tablist" aria-orientation="vertical" aria-label={t('pageSections')}>
          {rows.map((row, index) => {
            const selected = row.id === active
            const Icon = SECTION_ICONS[row.id]
            return (
              <button
                key={row.id}
                ref={(element) => { itemRefs.current[index] = element }}
                id={tabId(row.id)}
                type="button"
                role="tab"
                className="oac-bots-page-nav-item"
                aria-selected={selected}
                aria-current={selected ? 'true' : undefined}
                aria-controls={panelId(row.id)}
                data-active={selected ? 'true' : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => { setActiveId(row.id) }}
                onKeyDown={(event) => { moveItem(event, index) }}
              >
                {Icon === undefined ? null : <Icon size={16} className="oac-bots-page-nav-icon" />}
                <span className="oac-bots-page-nav-label">{row.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
      <div className="oac-bots-page-content">
        {rows.filter((row) => row.id === active || visitedIds.has(row.id)).map((row) => {
          const selected = row.id === active
          return (
            <div
              key={row.id}
              id={panelId(row.id)}
              role="tabpanel"
              aria-labelledby={tabId(row.id)}
              hidden={!selected}
            >
              {renderSlot('oac.bots.section', { close, openBotPage: openDock }, { only: row.id })}
            </div>
          )
        })}
      </div>
      {dock === null ? null : (
        <aside className="oac-bots-page-dock" aria-label={dock.title}>
          <div className="oac-bots-page-dock-head">
            <span className="oac-bots-page-dock-title">{dock.title}</span>
            <button
              type="button"
              className="oac-icon-btn"
              aria-label={t('close')}
              title={t('close')}
              onClick={closeDock}
            >
              <IconCloseOutline16 />
            </button>
          </div>
          {dock.error !== null ? (
            <div className="oac-bots-page-dock-state" role="alert">{dock.error}</div>
          ) : dock.url === null ? (
            <div className="oac-bots-page-dock-state">{t('dockLoading')}</div>
          ) : (
            <BrowserStage url={dock.url} title={dock.title} onIframe={() => undefined} />
          )}
        </aside>
      )}
    </div>
  )
}

/**
 * The left-rail `sidebar.panellist` glyph for the Bots page. The sidebar owns
 * the row (button, label, tooltip, kernel active highlight — this is a real
 * main panel, so `panelActive` fires normally); the registration renders only
 * the glyph inside it.
 */
export function BotsPageGlyph({ size }: { size: number }): ReactNode {
  return <IconAgentPresetOutline16 size={size} />
}
