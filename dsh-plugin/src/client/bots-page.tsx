/**
 * Bots page (client half): the plugin's dedicated surface in the DSH frame,
 * reached from the left-rail `sidebar.panellist` row (id `oac-bots`). The
 * page hosts the OAC surfaces that used to be Settings sections as one
 * `oac.bots.section` list entry each — My Bots, MetaApps, and the merged
 * 插件设置 / Plugin Settings (the former User and Traffic sections as top
 * tabs) — so DSH Settings stays exactly stock.
 *
 * The page is a `shell.overlay` entry (the A2A Chat pattern), NOT a kernel
 * `main` panel: the overlay covers the center column only, so the official
 * right Sidebar stays mounted and opening a Bot page lands in the real
 * right-Sidebar Bot Browser (drag-resize, fullscreen, native tab chrome)
 * while the page stays put. The row's click is capture-intercepted into a
 * toggle of the apply-scope BotsPagePanelStore (a panellist click is
 * hardwired to `layout.selectPanel`, which would need a `main` key and would
 * unmount the right Sidebar); the glyph syncs the kernel's selected look
 * onto the row while the page is open. Session navigation, 新会话, and the
 * A2A overlay opening all close the page.
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
 * Sections receive `{ close, openBotPage }` as owner props. `close` is the
 * settings-era "leave this surface" contract — on the overlay it closes the
 * page. `openBotPage` reveals a resource in the right-Sidebar Bot Browser
 * (the overlay never blocks that Sidebar).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import type { CommonKeyOf, InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot, SnapshotSelectorHook, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { CenterOverlayFrame } from './overlay-frame.tsx'
import { BOTS_PANEL_ROW_MARK } from './a2a-panel-row.ts'
import type { BotsPagePanelState } from './bots-page-store.ts'
import {
  IconAgentPresetOutline16,
  IconBranchOutline16,
  IconGlobeOutline16,
  IconSettingsOutline16,
  type CompatIconProps,
} from './icons.ts'
import type { BotsLocaleKey } from './locale.ts'

/** Owner share of one Bots-page section entry. */
export interface OacBotsSectionOwnerProps {
  /** Close the Bots page (the settings-era "leave this surface" contract). */
  close: () => void
  /**
   * Open one Bot's page (or the Browser home on null) in the official
   * right-Sidebar Bot Browser — the overlay never blocks that Sidebar.
   */
  openBotPage: (uri: string | null) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One page inside the Bots overlay. Registrant options carry the nav
     * identity: `id` (section key, drives `only` filtering), `order` (nav
     * position), `label` (registrant-localized display text). Declared at
     * runtime by the overlay's own registration.
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

export interface BotsPageOverlayInjected {
  hooks: {
    /** The section ledger projection behind the nav (slots version + locale revision memoized). */
    sections: ObservableSnapshot<BotsPageSectionRow[]>
    /** The apply-scope overlay open state. */
    panel: SnapshotStore<BotsPagePanelState>
  }
  /** Close the page (the sections' owner-prop face). */
  close: () => void
  /** Reveal one resource in the right-Sidebar Bot Browser (the sections' owner-prop face). */
  openBotPage: (uri: string | null) => void
}

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export type BotsPageProps = {
  t: Translate
  renderSlot: PropsRenderSlots<'oac.bots.section'>['renderSlot']
  useSections: SnapshotSelectorHook<BotsPageSectionRow[]>
  close: () => void
  openBotPage: (uri: string | null) => void
}

/** The active-section preference, remembered per browser. */
const ACTIVE_SECTION_STORAGE_KEY = 'oac-dsh:bots-page-section:v1'

/** Per-section nav icons, keyed by section id (the Settings left nav maps its row icons by id the same way). */
const SECTION_ICONS: Readonly<Record<string, ComponentType<CompatIconProps>>> = {
  'oac-bots': IconAgentPresetOutline16,
  'oac-apps': IconGlobeOutline16,
  'oac-settings': IconSettingsOutline16,
  'oac-tracking': IconBranchOutline16,
}

function readActiveSection(): string | null {
  try {
    const stored = window.localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY)
    // The User and Traffic sections merged into Plugin Settings; a stored
    // pre-merge id lands on the merged section instead of falling back.
    return stored === 'oac-user' || stored === 'oac-traffic' ? 'oac-settings' : stored
  } catch { return null }
}

function writeActiveSection(id: string): void {
  try { window.localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, id) } catch { /* storage may be disabled */ }
}

export function BotsPage({ t, renderSlot, useSections, close, openBotPage }: BotsPageProps): ReactNode {
  const navId = useId()
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rows = useSections((value) => value)
  const [activeId, setActiveId] = useState<string | null>(readActiveSection)
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id

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
              {renderSlot('oac.bots.section', { close, openBotPage }, { only: row.id })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type BotsPageOverlayProps =
  InjectFace<BotsPageOverlayInjected>
  & {
    renderSlot: PropsRenderSlots<'oac.bots.section'>['renderSlot']
    t: Translate
    usePanelInfo: UsePanelInfo
  }

/** The registered `shell.overlay` entry: the shared frame gating + the page. */
export function BotsPageOverlay(props: BotsPageOverlayProps): ReactNode {
  const { usePanel, usePanelInfo } = props
  const open = usePanel((state) => state.open)
  return (
    <CenterOverlayFrame open={open} usePanelInfo={usePanelInfo}>
      <BotsPage {...props} />
    </CenterOverlayFrame>
  )
}

export interface BotsPageGlyphInjected {
  hooks: {
    /** The apply-scope overlay open state (glyph selected styling). */
    panel: SnapshotStore<BotsPagePanelState>
  }
}

/**
 * The left-rail `sidebar.panellist` glyph for the Bots page. The sidebar owns
 * the row (button, label, tooltip), but the kernel's `active` highlight never
 * fires for an overlay — the glyph syncs the selected look onto the row from
 * the overlay store (`.oac-bots-row-active`, the kernel panelActive
 * vocabulary) plus `aria-current`, and clears both when the page closes.
 */
export function BotsPageGlyph({ size, usePanel }: InjectFace<BotsPageGlyphInjected> & { size: number }): ReactNode {
  const open = usePanel((state) => state.open)
  const markRef = useRef<HTMLSpanElement | null>(null)
  useLayoutEffect(() => {
    const row = markRef.current?.closest('button')
    if (!(row instanceof HTMLElement)) return
    row.classList.toggle('oac-bots-row-active', open)
    if (open) row.setAttribute('aria-current', 'page')
    else row.removeAttribute('aria-current')
    return () => {
      row.classList.remove('oac-bots-row-active')
      row.removeAttribute('aria-current')
    }
  }, [open])
  return (
    <span ref={markRef} {...{ [BOTS_PANEL_ROW_MARK]: '' }} data-open={open || undefined}>
      <IconAgentPresetOutline16 size={size} />
    </span>
  )
}
