/**
 * Candidate drawer (F8): right slide-over inside the panel overlay — what the
 * submitter delivered (summary + type-aware facts + attachment actions), the
 * parentrefs chips (navigate to the parent candidate), the per-candidate
 * review timeline with failreason/semantic_check evidence boxes, and the
 * on-chain credentials (pinId + hash, copyable).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  candidateArtifactOf,
  candidateState,
  metafileViewUrl,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import type { TaskNodeState, TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export interface DrawerCandidate {
  pinId: string
  submitter: string
  atMs: number
  result: Record<string, unknown> | null
  hash: string | null
  contentType: string | null
  attachment: string | null
  parentrefs: Record<string, string> | null
  verified: boolean
  chainValid: boolean
  superseded: boolean
  failed: boolean
  passVotes: number
  failVotes: number
  verifiedHeight: number | null
  votes?: TaskNodeState['votes']
}

const CopyMini = ({ mt, value }: { mt: Mt; value: string }): ReactNode => {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="oac-btn oac-btn-sm oac-copy-mini"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, 1500)
        })
      }}
    >
      {copied ? mt('mtCopied') : mt('mtCopy')}
    </button>
  )
}

const MetaWebLink = ({ mt, uri }: { mt: Mt; uri: string }): ReactNode => {
  const url = metafileViewUrl(uri)
  return url
    ? <a className="oac-btn oac-btn-sm" href={url} target="_blank" rel="noreferrer">{mt('mtOpenInMetaweb')}</a>
    : null
}

export function CandidateDrawer(props: {
  mt: Mt
  task: TaskProjection
  node: TaskNodeState
  cand: DrawerCandidate
  byPin: Map<string, CandidateLike>
  nameOf: (metaId: string) => string
  winningSet: Set<string> | null
  onClose: () => void
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, node, cand, byPin, nameOf, winningSet, onClose, onOpenCandidate } = props
  const veilRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const state = candidateState(node as unknown as NodeLike, cand as unknown as CandidateLike, byPin, winningSet)
  const artifact = candidateArtifactOf(cand)
  const summary = typeof cand.result?.summary === 'string' ? cand.result.summary
    : typeof cand.result?.note === 'string' ? cand.result.note
    : typeof cand.result?.verdict_text === 'string' ? cand.result.verdict_text
    : null
  const commit = typeof cand.result?.commit === 'string' ? cand.result.commit : null
  const baseCommit = typeof cand.result?.baseCommit === 'string' ? cand.result.baseCommit : null
  const members = Array.isArray(cand.result?.members) ? (cand.result?.members as unknown[]) : []

  return (
    <div className="oac-gt-drawer" role="dialog" aria-modal="true" aria-label={mt('mtDrawerTitle')}>
      <div className="oac-gt-drawer-veil" ref={veilRef} onClick={onClose} />
      <div className="oac-gt-drawer-body">
        <div className="oac-mt-drawer-head">
          <span className={`oac-mt-badge oac-mt-badge-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
          <span className="oac-mt-chip">{nameOf(cand.submitter)}</span>
          <span className="oac-mt-chip">{new Date(cand.atMs).toLocaleString()}</span>
          {cand.verified && <span className="oac-mt-chip">@{cand.verifiedHeight ?? '—'}</span>}
          <button type="button" className="oac-btn oac-btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="oac-mt-section-title">{mt('mtDrawerDelivered')}</div>
        <div className="oac-mt-summary">
          {summary ?? mt('mtResultTypeDefault', { type: artifact.resultType ?? '—' })}
        </div>
        <div className="oac-mt-facts">
          {artifact.kind === 'git' && commit && (
            <div className="oac-mt-fact">{mt('mtGitCommit')}: <code>{commit.slice(0, 12)}</code>{baseCommit ? ` @ ${baseCommit.slice(0, 12)}` : ''}</div>
          )}
          {artifact.kind === 'metafile' && members.length > 0 && (
            <div className="oac-mt-fact">{mt('mtMembers', { count: members.length })}</div>
          )}
          {typeof cand.result?.releaseSha256 === 'string' && (
            <div className="oac-mt-fact">sha256: <code>{cand.result.releaseSha256.slice(0, 16)}…</code></div>
          )}
        </div>
        {artifact.metafileUri && (
          <div className="oac-mt-actions">
            <code className="oac-mt-uri">{artifact.metafileUri}</code>
            <CopyMini mt={mt} value={artifact.metafileUri} />
            <a className="oac-btn oac-btn-sm" href={`/oac/api-file/${encodeURIComponent(artifact.metafileUri)}`} download>{mt('mtDownload')}</a>
            <MetaWebLink mt={mt} uri={artifact.metafileUri} />
            {artifact.metaAppUri && <a className="oac-btn oac-btn-sm" href={artifact.metaAppUri}>{mt('mtOpenApp')}</a>}
          </div>
        )}

        {(cand.parentrefs && Object.keys(cand.parentrefs).length > 0) && (
          <>
            <div className="oac-mt-section-title">{mt('mtDrawerParents')}</div>
            <div className="oac-mt-parentrefs">
              {Object.entries(cand.parentrefs).map(([dep, pin]) => (
                <button key={dep} type="button" className="oac-chip-btn" onClick={() => { onOpenCandidate(pin) }}>
                  {dep} → {pin.slice(0, 6)}…
                </button>
              ))}
            </div>
          </>
        )}

        <div className="oac-mt-section-title">{mt('mtDrawerReviews')}</div>
        <div className="oac-timeline">
          {(cand.votes ?? []).slice().sort((left, right) => left.timestampMs - right.timestampMs).map((vote) => (
            <div key={vote.pinId} className={`oac-timeline-item tone-${vote.verdict === 'pass' ? 'ok' : 'warn'}`}>
              <div className="oac-timeline-head">
                <span>{nameOf(vote.voter)}</span>
                <span className={`oac-mt-badge oac-mt-badge-verdict-${vote.verdict}`}>{vote.verdict}</span>
                <span className="oac-mt-chip">{new Date(vote.timestampMs).toLocaleString()} @{vote.height}</span>
                {!vote.counted && <span className="oac-mt-chip">{vote.ignoreReason}</span>}
              </div>
              {vote.failreasonText && <div className="oac-mt-evidence oac-mt-evidence-fail">{vote.failreasonText}</div>}
              {vote.semanticCheckText && <div className="oac-mt-evidence oac-mt-evidence-sem">{vote.semanticCheckText}</div>}
            </div>
          ))}
          {(cand.votes ?? []).length === 0 && <div className="oac-mt-empty-inline">{mt('mtNoVotes')}</div>}
        </div>

        <div className="oac-mt-section-title">{mt('mtDrawerCredentials')}</div>
        <div className="oac-mt-credentials">
          <div className="oac-mt-cred-row"><code>{cand.pinId}</code><CopyMini mt={mt} value={cand.pinId} /></div>
          {cand.hash && <div className="oac-mt-cred-row"><code>{cand.hash}</code><CopyMini mt={mt} value={cand.hash} /></div>}
        </div>
        <div className="oac-mt-freshness">{mt('mtFreshness', { events: task.freshness.eventCount, block: task.freshness.boundaryBlock })}</div>
      </div>
    </div>
  )
}
