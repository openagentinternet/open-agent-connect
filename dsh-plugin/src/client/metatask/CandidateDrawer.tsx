/**
 * Candidate drawer (F8) — full-fidelity port of IDBots' MetaTaskCandidateDrawer
 * (detail v2): slides in from the right over a veil inside the detail view;
 * the identity header (avatar + name + local chip + state tag), "what was
 * delivered" (summary box + label/fact rows + artifact actions), parentrefs
 * chips that navigate to the parent candidate, the per-candidate review
 * timeline (voter identity, verdict, time + block, ignore reasons, failreason
 * in a red box, semantic_check evidence in a gray box), and the on-chain
 * receipts (pin / hash / supersedes, each copyable).
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  candidateArtifactOf,
  candidateState,
  metafileViewUrl,
  pinViewUrl,
  shortMetaId,
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
  supersedeid?: string
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

const FactRow = (props: { k: string; children: ReactNode }): ReactNode => (
  <div className="oac-mt-factrow">
    <span className="oac-mt-factrow-k">{props.k}</span>
    <span className="oac-mt-factrow-v">{props.children}</span>
  </div>
)

const SectionTitle = (props: { children: ReactNode }): ReactNode => (
  <div className="oac-mt-h4">{props.children}</div>
)

const shortHash = (hash: string): string => (hash.length > 16 ? `${hash.slice(0, 12)}…` : hash)

const relativeTime = (ms: number, mt: Mt): string => {
  if (!ms) return '—'
  const delta = Date.now() - ms
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return mt('mtJustNow')
  if (minutes < 60) return mt('mtMinutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return mt('mtHoursAgo', { count: hours })
  return mt('mtDaysAgo', { count: Math.round(hours / 24) })
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
  const repoHint = typeof cand.result?.repoHint === 'string' ? cand.result.repoHint : null
  const engine = typeof cand.result?.engine === 'string' ? cand.result.engine : null
  const members = Array.isArray(cand.result?.members) ? (cand.result?.members as unknown[]).filter((m): m is string => typeof m === 'string') : []
  const sha = (typeof cand.result?.releaseSha256 === 'string' ? cand.result.releaseSha256 : null) ?? cand.hash
  const submitterIdentity = identityOf(cand.submitter)
  const isYou = rosterIds.has(cand.submitter)
  const parentrefs = Object.entries(cand.parentrefs ?? {})
  const viewUrl = artifact.metafileViewUrl ?? (metafileViewUrl(cand.attachment ?? '') || pinViewUrl(cand.pinId))
  const quorum = Math.max(1, task.policy.verifyQuorum)
  const votes = (cand.votes ?? [])
    .filter((vote) => !vote.targetid || vote.targetid === cand.pinId)
    .slice()
    .sort((left, right) => left.timestampMs - right.timestampMs)

  return (
    <div className="oac-gt-drawer" role="dialog" aria-modal="true" aria-label={mt('mtDrawerTitle')}>
      <div className="oac-gt-drawer-veil" onClick={onClose} />
      <div className="oac-gt-drawer-body">
        <button type="button" className="oac-mt-btn oac-mt-btn-xs oac-mt-drawer-close" onClick={onClose}>
          {mt('mtClose')} ✕
        </button>

        {/* Identity header */}
        <div className="oac-mt-drawer-head">
          <MtBadge
            metaId={cand.submitter}
            name={submitterIdentity.name}
            avatar={submitterIdentity.avatar}
            size="md"
          />
        </div>
        <div className="oac-mt-drawer-sub">
          {mt('mtSubLine', { node: node.id, title: node.title, when: relativeTime(cand.atMs, mt) })}
          {cand.verified && cand.verifiedHeight !== null && cand.verifiedHeight >= 0 && (
            <span className="oac-mt-dim"> · {mt('mtVerifiedBlock', { height: cand.verifiedHeight })}</span>
          )}
        </div>
        <div className="oac-mt-drawer-tags">
          <span className={`oac-mt-statetag oac-mt-statetag-lg oac-tag-cand-${state}`}>{mt(`mtCand_${state}`)}</span>
          {isYou && <span className="oac-mt-you">{youLabel}</span>}
        </div>

        {/* What was delivered */}
        <div>
          <SectionTitle>{mt('mtDrawerDelivered')}</SectionTitle>
          <div className="oac-mt-summary">
            {summary ?? mt(`mtResultTypeDesc_${artifact.kind === 'git' ? 'git' : artifact.kind === 'metafile' ? 'metafile' : artifact.kind === 'metaapp' ? 'metaapp' : 'other'}`)}
          </div>
          <div className="oac-mt-drawer-facts">
            <FactRow k={mt('mtFactType')}>{artifact.resultType ?? artifact.kind}</FactRow>
            {artifact.kind === 'git' && commit && (
              <FactRow k={mt('mtGitCommit')}><code title={commit}>{shortHash(commit)}</code></FactRow>
            )}
            {artifact.kind === 'git' && baseCommit && (
              <FactRow k="base"><code title={baseCommit}>{shortHash(baseCommit)}</code></FactRow>
            )}
            {artifact.kind === 'git' && repoHint && (
              <FactRow k="repo">
                {/^https?:\/\//.test(repoHint)
                  ? <a href={repoHint} target="_blank" rel="noreferrer"><code>{repoHint}</code></a>
                  : <code>{repoHint}</code>}
              </FactRow>
            )}
            {artifact.kind === 'git' && engine && <FactRow k="engine"><code>{engine}</code></FactRow>}
            {members.length > 0 && (
              <FactRow k={mt('mtFactMembers')}>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                  {members.map((member) => <span key={member} className="oac-mt-memberchip-mini">{member}</span>)}
                </span>
              </FactRow>
            )}
            {artifact.metafileUri && (
              <FactRow k={mt('mtFactArtifact')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <code style={{ wordBreak: 'break-all' }} title={artifact.metafileUri}>{artifact.metafileUri}</code>
                  <CopyMini mt={mt} value={artifact.metafileUri} />
                </span>
              </FactRow>
            )}
            {cand.attachment && cand.attachment !== artifact.metafileUri && (
              <FactRow k={mt('mtFactAttachment')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <code style={{ wordBreak: 'break-all' }} title={cand.attachment}>{cand.attachment}</code>
                  <CopyMini mt={mt} value={cand.attachment} />
                </span>
              </FactRow>
            )}
            {sha && (
              <FactRow k="sha256">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <code title={sha}>{shortHash(sha)}</code>
                  <CopyMini mt={mt} value={sha} />
                </span>
              </FactRow>
            )}
          </div>
          <div className="oac-mt-drawer-actions">
            {artifact.metaAppUri && (
              <a className="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" href={artifact.metaAppUri}>{mt('mtOpenApp')}</a>
            )}
            <a className="oac-mt-btn oac-mt-btn-sm" href={viewUrl} target="_blank" rel="noreferrer">{mt('mtOpenInMetaweb')}</a>
          </div>
        </div>

        {/* What it builds on */}
        <div>
          <SectionTitle>{mt('mtDrawerParents')}</SectionTitle>
          {parentrefs.length > 0 ? (
            <div className="oac-mt-parentrefs">
              {parentrefs.map(([dep, pin]) => {
                const parent = byPin.get(pin)
                return (
                  <button key={`${dep}-${pin}`} type="button" title={pin} className="oac-chip-btn"
                    onClick={() => { onOpenCandidate(pin) }}>
                    <code>{dep}</code> · {parent ? (identityOf(parent.submitter ?? '').name ?? shortMetaId(parent.submitter ?? '')) : shortPin(pin)} <code>{shortPin(pin)}</code> →
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="oac-mt-empty-inline">{mt('mtParentrefsNone')}</div>
          )}
        </div>

        {/* Review timeline */}
        <div>
          <SectionTitle>{mt('mtReviewsTitle', { count: votes.length, quorum })}</SectionTitle>
          {votes.length === 0 ? (
            <div className="oac-mt-empty-inline">{mt('mtNoVotes')}</div>
          ) : (
            <div className="oac-mt-timeline">
              {votes.map((vote) => {
                const voterIdentity = identityOf(vote.voter)
                return (
                  <div key={vote.pinId} className="oac-mt-timeline-item">
                    <div className="oac-mt-timeline-head">
                      <MtBadge metaId={vote.voter} name={voterIdentity.name} avatar={voterIdentity.avatar} />
                      <span className={`oac-mt-badge oac-mt-badge-verdict-${vote.verdict}`}>
                        {vote.verdict === 'pass' ? mt('mtVerdictPass') : vote.verdict === 'fail' ? mt('mtVerdictFail') : vote.verdict}
                      </span>
                      <span className="oac-mt-dim">
                        {vote.timestampMs ? relativeTime(vote.timestampMs, mt) : ''}
                        {typeof vote.height === 'number' && (
                          <> · {vote.height >= 0 ? mt('mtBlockHeight', { height: vote.height }) : mt('mtMempool')}</>
                        )}
                      </span>
                      {!vote.counted && (
                        <span className="oac-mt-chip">{mt('mtNotCounted', { reason: vote.ignoreReason ?? '—' })}</span>
                      )}
                    </div>
                    {vote.failreasonText && (
                      <div className="oac-mt-evidence oac-mt-evidence-fail">
                        <span className="oac-mt-evidence-label">{mt('mtFailreasonLabel')}</span>
                        {vote.failreasonText}
                      </div>
                    )}
                    {vote.semanticCheckText && (
                      <div className="oac-mt-evidence oac-mt-evidence-sem">
                        <span className="oac-mt-evidence-label">{mt('mtSemanticLabel')}</span>
                        {vote.semanticCheckText}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* On-chain receipts */}
        <div>
          <SectionTitle>{mt('mtReceipts')}</SectionTitle>
          <FactRow k={mt('mtFactPin')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <code style={{ wordBreak: 'break-all' }} title={cand.pinId}>{cand.pinId}</code>
              <CopyMini mt={mt} value={cand.pinId} />
            </span>
          </FactRow>
          {cand.hash && (
            <FactRow k="hash"><code title={cand.hash}>{shortHash(cand.hash)}</code></FactRow>
          )}
          {cand.supersedeid && (
            <FactRow k={mt('mtSupersede')}><code title={cand.supersedeid}>{shortPin(cand.supersedeid)}</code></FactRow>
          )}
        </div>
        <div className="oac-mt-freshness">{mt('mtFreshness', { events: task.freshness.eventCount, block: task.freshness.boundaryBlock })}</div>
      </div>
    </div>
  )
}
