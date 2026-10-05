/**
 * Tracking Tasks (追踪任务) section — the Bots page's wide task-tracking
 * panel. First tab: MetaTask (chain task square); the second tab slot is
 * reserved for 长期任务 (Long-term) later. Tab mechanics copied from
 * PluginSettingsPanel (top tabs, keep-alive panels, localStorage preference).
 *
 * The panel root uses `.oac-track-shell` (NOT `.oac-panel`) — the Bots page
 * caps tab panels at 720px and a `:has()` rule in styles.ts lifts the cap
 * ONLY for this shell, because the chain view needs width.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { MetataskBoard, type MetataskBoardLocale, type MetataskApi } from './metatask/MetataskBoard.tsx'
import { MetataskDetail } from './metatask/MetataskDetail.tsx'
import type { BotsLocaleKey } from './locale.ts'

type BotsTranslate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface TrackingTasksPanelInjected extends MetataskBoardLocale, MetataskApi {
  t: BotsTranslate
}

type TrackingTab = 'metatask'

const TRACKING_TAB_STORAGE_KEY = 'oac-dsh:bots-page-tracking-tab:v1'

function readTrackingTab(): TrackingTab {
  try { return window.localStorage.getItem(TRACKING_TAB_STORAGE_KEY) === 'longterm' ? 'longterm' as TrackingTab : 'metatask' } catch { return 'metatask' }
}

function writeTrackingTab(tab: TrackingTab): void {
  try { window.localStorage.setItem(TRACKING_TAB_STORAGE_KEY, tab) } catch { /* storage may be disabled */ }
}

export function TrackingTasksPanel(injected: TrackingTasksPanelInjected): ReactNode {
  const { t } = injected
  const [tab, setTab] = useState<TrackingTab>(readTrackingTab)
  const [root, setRoot] = useState<string | null>(null)

  useEffect(() => { writeTrackingTab(tab) }, [tab])

  return (
    <div className="oac-track-shell">
      <div className="oac-tablist" role="tablist" aria-label={t('navTracking')}>
        <button
          type="button"
          role="tab"
          className="oac-tab"
          id="oac-tracking-tab-metatask"
          data-active={tab === 'metatask' ? 'true' : undefined}
          aria-selected={tab === 'metatask'}
          aria-controls="oac-tracking-panel-metatask"
          onClick={() => { setTab('metatask') }}
        >
          {t('trackingTabMetatask')}
        </button>
        <button
          type="button"
          role="tab"
          className="oac-tab"
          id="oac-tracking-tab-longterm"
          disabled
          title={t('trackingTabLongTermHint')}
        >
          {t('trackingTabLongTerm')}
        </button>
      </div>
      <div
        role="tabpanel"
        id="oac-tracking-panel-metatask"
        aria-labelledby="oac-tracking-tab-metatask"
        className="oac-tab-panel"
      >
        {root
          ? <MetataskDetail {...injected} root={root} onBack={() => { setRoot(null) }} />
          : <MetataskBoard {...injected} onOpen={(taskRoot) => { setRoot(taskRoot) }} />}
      </div>
    </div>
  )
}
