/**
 * Candidate drawer (F8) — full-fidelity port of IDBots' MetaTaskCandidateDrawer:
 * identity header (avatar + name + YOU chip + state), "what was delivered"
 * (summary + type-aware facts + artifact actions: copy URI / download /
 * open in MetaWeb / open app), parentrefs chips that navigate to the parent
 * candidate, the per-candidate review timeline (voter identity, verdict,
 * time + block, ignore reasons, failreason in a red box, semantic_check
 * evidence in a gray box), and the on-chain credentials.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  candidateArtifactOf,
  candidateState,
  metafileViewUrl,
  shortPin,
  type CandidateLike,
  type NodeLike,
} from '../../metatask-logic.js'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
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
      className="oac-mt-btn oac-mt-btn-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, 1200)
        })
      }}
    >
      {copied ? mt('mtCopied') : mt('mtCopy')}
    </button>
  )
}

export function CandidateDrawer(props: {
  mt: Mt
  task: TaskProjection
  node: TaskNodeState
  cand: DrawerCandidate
  byPin: Map<string, CandidateLike>
  identityOf: IdentityOf
  rosterIds: Set<string>
  youLabel: string
  winningSet: Set<string> | null
  onClose: () => void
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, node, cand, byPin, identityOf, rosterIds, youLabel, winningSet, onClose, onOpenCandidate } = props

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
  const members = Array.isArray(cand.result?.members) ? (cand.result?.members as unknown[]).filter((m): m is string => typeof m === 'string') : []
  const submitterIdentity = identityOf(cand.submitter)
  const votes = (cand.votes ?? []).slice().sort((left, right) => left.timestampMs - right.timestampMs)

  return (
    <div className="oac-gt-drawer" role="dialog" aria-modal="true" aria-label={mt('mtDrawerTitle')}>
      <div className="oac-gt-drawer-veil" onClick={onClose} />
      <div className="oac-gt-drawer-body">
        <div className="oac-mt-drawer-head">
          <MtBadge
            metaId={cand.submitter}
            name={submitterIdentity.name}
            avatar={submitterIdentity.avatar}
            size="md"
            you={rosterIds.has(cand.submitter)}
            youLabel={youLabel}
          />
          <div className="oac-mt-drawer-sub">
            {node.id} · {node.title} · {new Date(cand.atMs).toLocaleString()}
            {cand.verified && cand.verifiedHeight !== null && <span className="oac-mt-dim"> · @ {cand.verifiedHeight}</span>}
          </div>
          <span className={`oac-mt-statetag oac-mt-statetag-lg oac-tag-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
          <button type="button" className="oac-mt-btn oac-mt-btn-xs oac-mt-drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="oac-mt-h3">{mt('mtDrawerDelivered')}</div>
        <div className="oac-mt-summary">
          {summary ?? mt('mtResultTypeDefault', { type: artifact.resultType ?? '—' })}
        </div>
        <div className="oac-mt-facts">
          {artifact.kind === 'git' && commit && (
            <div className="oac-mt-fact">{mt('mtGitCommit')}: <code>{commit.slice(0, 12)}</code>{baseCommit ? <> @ <code>{baseCommit.slice(0, 12)}</code></> : null}</div>
          )}
          {artifact.kind === 'metafile' && members.length > 0 && (
            <div className="oac-mt-fact">{mt('mtMembers', { count: members.length })}</div>
          )}
          {typeof cand.result?.releaseSha256 === 'string' && (
            <div className="oac-mt-fact">sha256: <code>{cand.result.releaseSha256.slice(0, 20)}…</code></div>
          )}
        </div>
        {artifact.metafileUri && (
          <div className="oac-mt-actions">
            <code className="oac-mt-uri">{artifact.metafileUri}</code>
            <CopyMini mt={mt} value={artifact.metafileUri} />
            <a className="oac-mt-btn oac-mt-btn-sm" href={`/oac/api-file/${encodeURIComponent(artifact.metafileUri)}`} download>{mt('mtDownload')}</a>
            {metafileViewUrl(artifact.metafileUri) && (
              <a className="oac-mt-btn oac-mt-btn-sm" href={metafileViewUrl(artifact.metafileUri) as string} target="_blank" rel="noreferrer">{mt('mtOpenInMetaweb')}</a>
            )}
            {artifact.metaAppUri && <a className="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" href={artifact.metaAppUri}>{mt('mtOpenApp')}</a>}
          </div>
        )}

        {(cand.parentrefs && Object.keys(cand.parentrefs).length > 0) && (
          <>
            <div className="oac-mt-h3">{mt('mtDrawerParents')}</div>
            <div className="oac-mt-parentrefs">
              {Object.entries(cand.parentrefs).map(([dep, pin]) => (
                <button key={dep} type="button" className="oac-chip-btn" onClick={() => { onOpenCandidate(pin) }}>
                  {dep} · {shortPin(pin)} →
                </button>
              ))}
            </div>
          </>
        )}

        <div className="oac-mt-h3">{mt('mtDrawerReviews')}</div>
        <div className="oac-timeline">
          {votes.map((vote) => {
            const voterIdentity = identityOf(vote.voter)
            return (
              <div key={vote.pinId} className={`oac-timeline-item tone-${vote.verdict === 'pass' ? 'ok' : 'warn'}`}>
                <div className="oac-timeline-head">
                  <MtBadge metaId={vote.voter} name={voterIdentity.name} avatar={voterIdentity.avatar} />
                  <span className={`oac-mt-badge oac-mt-badge-verdict-${vote.verdict}`}>{vote.verdict}</span>
                  <span className="oac-mt-chip oac-mt-mono">{vote.height >= 0 ? `@ ${vote.height}` : 'mempool'}</span>
                  <span className="oac-mt-dim">{new Date(vote.timestampMs).toLocaleString()}</span>
                  {!vote.counted && <span className="oac-mt-chip">{vote.ignoreReason}</span>}
                </div>
                {vote.failreasonText && <div className="oac-mt-evidence oac-mt-evidence-fail"><b>{mt('mtCand_rejected')}</b> · {vote.failreasonText}</div>}
                {vote.semanticCheckText && <div className="oac-mt-evidence oac-mt-evidence-sem">{vote.semanticCheckText}</div>}
              </div>
            )
          })}
          {votes.length === 0 && <div className="oac-mt-empty-inline">{mt('mtNoVotes')}</div>}
        </div>

        <div className="oac-mt-h3">{mt('mtDrawerCredentials')}</div>
        <div className="oac-mt-credentials">
          <div className="oac-mt-cred-row"><code>{cand.pinId}</code><CopyMini mt={mt} value={cand.pinId} /></div>
          {cand.hash && <div className="oac-mt-cred-row"><code>{cand.hash}</code><CopyMini mt={mt} value={cand.hash} /></div>}
        </div>
        <div className="oac-mt-freshness">{mt('mtFreshness', { events: task.freshness.eventCount, block: task.freshness.boundaryBlock })}</div>
      </div>
    </div>
  )
}
