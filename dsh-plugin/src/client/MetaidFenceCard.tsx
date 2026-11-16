/**
 * The ```metaid fence card (chat code-block rendering by language, DSH rc.2+).
 *
 * DSH routes every Chat-flow fence that carries a language through the
 * session-scoped `conversation.chat.markdown.fence` hoc slot (entryKey =
 * lowercased language); this layer serves the `metaid` key. A fence that
 * names at least one MetaID-network URI renders as a resource card — title,
 * one row per URI with Open (Bot Browser) and Copy — instead of raw code;
 * anything unparseable renders the plain code block it wraps (`children`),
 * so a malformed fence can never hide its content.
 */
import type { ReactNode } from 'react'
import { parseMetaidFence } from '../metaid-fence-logic.js'
import { CopyIconButton } from './CopyIconButton.tsx'
import type { MetaidFenceLocaleKey } from './locale-metaid.ts'

export interface MetaidFenceInjected {
  /** Open one resource URI in the Bot Browser (the shared openFace path). */
  open: (uri: string) => void
  t: (key: MetaidFenceLocaleKey) => string
}

export type MetaidFenceCardProps = {
  readonly lang?: string
  readonly code?: string
  readonly meta?: string
  readonly streaming?: boolean
  /** The wrapped plain code block; rendered verbatim when nothing parses. */
  readonly children?: ReactNode
} & MetaidFenceInjected

export function MetaidFenceCard(props: MetaidFenceCardProps): ReactNode {
  const content = parseMetaidFence(props.code ?? '', props.meta)
  if (content === null) return props.children ?? null
  return (
    <div className="oac-metaid-fence" data-oac-metaid-fence="">
      <div className="oac-metaid-fence-title">{content.title ?? props.t('cardTitle')}</div>
      <div className="oac-metaid-fence-rows">
        {content.uris.map((uri) => (
          <div key={uri} className="oac-metaid-fence-row">
            <span className="oac-metaid-fence-uri">{uri}</span>
            <span className="oac-metaid-fence-actions">
              <button
                type="button"
                className="oac-metaid-fence-open"
                onClick={() => { props.open(uri) }}
              >
                {props.t('open')}
              </button>
              <CopyIconButton value={uri} label={props.t('copy')} copiedLabel={props.t('copied')} />
            </span>
          </div>
        ))}
      </div>
      {content.note !== undefined ? <div className="oac-metaid-fence-note">{content.note}</div> : null}
    </div>
  )
}
