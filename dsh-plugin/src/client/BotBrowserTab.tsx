/**
 * Right-Sidebar `bot-browser` tab body and chip title (client half).
 *
 * The body renders the local OAC Browser (`/browser/*` localUiUrl) in an
 * iframe inside the official right Sidebar. The URL arrives as navigation
 * params (`useTabInfo().tab.navigation.params`); `navigation.revision`
 * increments on every navigation to the tab, and a navigation carrying the
 * SAME url must not reset the iframe src — the host/daemon already navigated
 * ABC inside the live iframe (see `shouldResetIframeSrc`). Switching tabs
 * unmounts this body (native right-Sidebar semantic), so the iframe reloads
 * on return and ABC reconstructs from the daemon. The iframe stage itself
 * (keyed remount, theme baking, bridge reporting) is `BrowserStage`.
 */
import {
  Component,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { shouldResetIframeSrc, type BotBrowserTabParams } from '../browser-open-flow.ts'
import { BrowserStage } from './browser-stage.tsx'
import type { BotBrowserState } from './browser-store.ts'
import type { BrowserLocaleKey } from './locale-browser.ts'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Navigation params of the bot-browser page kind. */
    'bot-browser': BotBrowserTabParams
  }
}

type Translate = (key: BrowserLocaleKey, vars?: Record<string, string | number>) => string

export interface BotBrowserTabInjected {
  hooks: {
    /** Shared Browser face: live ABC active-tab URI and the last open failure. */
    browser: SnapshotStore<BotBrowserState>
  }
  /** Report the live iframe (and the URL it loaded) to the bridge; (null, url) on detach. */
  onIframe: (iframe: HTMLIFrameElement | null, url: string | null) => void
  /** Open the Browser home in this tab. */
  openHome: () => void
}

export type BotBrowserTabProps =
  InjectFace<BotBrowserTabInjected>
  & { useTabInfo: UseSidebarRightTabInfo; t: Translate }

/** Narrow the framework's navigation-params union to this kind's shape. */
function paramsOf(raw: unknown): BotBrowserTabParams {
  if (raw === null || typeof raw !== 'object') return {}
  const params = raw as BotBrowserTabParams
  return {
    ...(typeof params.url === 'string' ? { url: params.url } : {}),
    ...(typeof params.uri === 'string' ? { uri: params.uri } : {}),
  }
}

type BoundaryState = { error: string | null }

/**
 * Error boundary over the tab tree: a render failure must never blank the
 * right Sidebar silently — it shows a diagnostic line instead and logs the
 * stack.
 */
export class BotBrowserBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown): void {
    console.error('[oac-dsh] bot browser render error:', error)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="oac-browser-landing" data-error>
          <p className="oac-browser-error">Bot Browser failed to render: {this.state.error}</p>
        </div>
      )
    }
    return this.props.children
  }
}

function BotBrowserTabBody({
  useTabInfo,
  useBrowser,
  onIframe,
  openHome,
  t,
}: BotBrowserTabProps): ReactNode {
  const { tab } = useTabInfo()
  const params = paramsOf(tab.navigation.params)
  const paramsUrl = params.url ?? null
  const error = useBrowser((state) => state.error)

  // The URL the iframe currently shows. A navigation carrying a NEW url
  // replaces it (the stage's keyed iframe remounts); a bumped revision with
  // the same url leaves it alone — ABC inside already navigated (daemon/host
  // SSE).
  const [loadedUrl, setLoadedUrl] = useState<string | null>(paramsUrl)
  useEffect(() => {
    if (shouldResetIframeSrc(paramsUrl, loadedUrl)) setLoadedUrl(paramsUrl)
  }, [paramsUrl, tab.navigation.revision, loadedUrl])

  if (loadedUrl === null) {
    return (
      <div className="oac-browser-tab">
        <div className="oac-browser-landing">
          {error !== null ? (
            <p className="oac-browser-error">{error}</p>
          ) : (
            <p className="oac-browser-empty">{t('empty')}</p>
          )}
          <button type="button" className="oac-browser-home" onClick={openHome}>
            {t('emptyAction')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="oac-browser-tab">
      <BrowserStage url={loadedUrl} title={t('title')} onIframe={onIframe} />
    </div>
  )
}

/** The `sidebar.right.pane.tab` body for the bot-browser kind. */
export function BotBrowserTab(props: BotBrowserTabProps): ReactNode {
  return (
    <BotBrowserBoundary>
      <BotBrowserTabBody {...props} />
    </BotBrowserBoundary>
  )
}

export type BotBrowserTabTitleProps =
  Pick<InjectFace<BotBrowserTabInjected>, 'useBrowser'>
  & { useTabInfo: UseSidebarRightTabInfo }

/**
 * The tab chip title: the live ABC active-tab URI once the bridge reports
 * one, falling back to the static `title(address)` captured at open.
 */
export function BotBrowserTabTitle({ useTabInfo, useBrowser }: BotBrowserTabTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const activeUri = useBrowser((state) => state.activeUri)
  return <>{activeUri ?? tab.title}</>
}
