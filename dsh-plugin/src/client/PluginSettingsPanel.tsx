/**
 * Plugin Settings (插件设置) section — the merged User + Traffic Bots-page
 * section. Both former sections survive verbatim as top tabs of this one
 * (the MetaApps section's `oac-tablist` strip): the User identity panel and
 * the Traffic billing panel keep their own components, locale namespaces,
 * and styles, so the merge changes only the page nav, not the content.
 *
 * Both tabs stay mounted behind the `hidden` attribute — the same keep-alive
 * contract the page nav applies to its sections — so a loaded identity view
 * or traffic balance survives a tab switch. The last-open tab persists in
 * localStorage like the page's other remembered preferences.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { UserPanel, type UserPanelInjected } from './UserPanel.tsx'
import { TrafficPanel, type TrafficPanelInjected } from './TrafficPanel.tsx'
import type { UserLocaleKey } from './locale-user.ts'
import type { TrafficLocaleKey } from './locale-traffic.ts'
import type { BotsLocaleKey } from './locale.ts'

type BotsTranslate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string
type UserTranslate = (key: UserLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string
type TrafficTranslate = (key: TrafficLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface PluginSettingsPanelInjected extends UserPanelInjected, Omit<TrafficPanelInjected, 'who'> {
  /** The User tab's translator (the former User section's locale face). */
  userT: UserTranslate
  /** The Traffic tab's translator (the former Traffic section's locale face). */
  trafficT: TrafficTranslate
}

/** The settings section's top tabs, keyed by the former section ids' content. */
type SettingsTab = 'user' | 'traffic'

/** The last-open tab preference, remembered per browser. */
const SETTINGS_TAB_STORAGE_KEY = 'oac-dsh:bots-page-settings-tab:v1'

function readSettingsTab(): SettingsTab {
  try { return window.localStorage.getItem(SETTINGS_TAB_STORAGE_KEY) === 'traffic' ? 'traffic' : 'user' } catch { return 'user' }
}

function writeSettingsTab(tab: SettingsTab): void {
  try { window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab) } catch { /* storage may be disabled */ }
}

export function PluginSettingsPanel(
  injected: PluginSettingsPanelInjected & { close: () => void; t: BotsTranslate },
): ReactNode {
  const {
    close,
    t,
    userT,
    trafficT,
    who,
    create,
    importIdentity,
    update,
    reveal,
    deleteIdentity,
    bots,
    status,
    setMode,
    balance,
    ledger,
    usage,
    claim,
    redeem,
    apiBase,
  } = injected
  const [tab, setTab] = useState<SettingsTab>(readSettingsTab)

  useEffect(() => { writeSettingsTab(tab) }, [tab])

  return (
    <div className="oac-panel">
      <div className="oac-tablist" role="tablist" aria-label={t('navSettings')}>
        <button
          type="button"
          role="tab"
          className="oac-tab"
          id="oac-settings-tab-user"
          data-active={tab === 'user' ? 'true' : undefined}
          aria-selected={tab === 'user'}
          aria-controls="oac-settings-panel-user"
          onClick={() => { setTab('user') }}
        >
          {userT('nav')}
        </button>
        <button
          type="button"
          role="tab"
          className="oac-tab"
          id="oac-settings-tab-traffic"
          data-active={tab === 'traffic' ? 'true' : undefined}
          aria-selected={tab === 'traffic'}
          aria-controls="oac-settings-panel-traffic"
          onClick={() => { setTab('traffic') }}
        >
          {trafficT('nav')}
        </button>
      </div>
      <div
        role="tabpanel"
        id="oac-settings-panel-user"
        aria-labelledby="oac-settings-tab-user"
        className="oac-tab-panel"
        hidden={tab !== 'user'}
      >
        <UserPanel
          who={who}
          create={create}
          importIdentity={importIdentity}
          update={update}
          reveal={reveal}
          deleteIdentity={deleteIdentity}
          close={close}
          t={userT}
        />
      </div>
      <div
        role="tabpanel"
        id="oac-settings-panel-traffic"
        aria-labelledby="oac-settings-tab-traffic"
        className="oac-tab-panel"
        hidden={tab !== 'traffic'}
      >
        <TrafficPanel
          who={who}
          bots={bots}
          status={status}
          setMode={setMode}
          balance={balance}
          ledger={ledger}
          usage={usage}
          claim={claim}
          redeem={redeem}
          apiBase={apiBase}
          t={trafficT}
        />
      </div>
    </div>
  )
}
