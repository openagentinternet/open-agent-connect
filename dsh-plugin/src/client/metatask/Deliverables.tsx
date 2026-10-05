/**
 * Deliverables (F5, competitive) — full-fidelity port of IDBots'
 * MetaTaskDeliverables: the settled hero (terminal node's winner artifact:
 * type badge, kicker, name, summary, member chips, sha256, copy/download/
 * MetaWeb/app actions) plus one artifact row per winning-chain node
 * (git rows show `commit @ baseCommit` + repoHint); while in progress the
 * satisfied nodes' current leaders render under "current output".
 */
import { type ReactNode } from 'react'
import {
  candidateArtifactOf,
  shortPin,
  type CandidateLike,
} from '../../metatask-logic.js'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

const TYPE_BADGE: Record<string, string> = { git: '⌥', metafile: '▤', metaapp: '▦', other: '·' }

export function Deliverables(props: {
  mt: Mt
  task: TaskProjection
  identityOf: IdentityOf
  byPin: Map<string, CandidateLike>
  youLabel: string
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, identityOf, byPin, youLabel, onOpenCandidate } = props
  const terminalId = task.policy.finalNode && task.nodeStates[task.policy.finalNode]
    ? task.policy.finalNode
    : findUniqueSink(task)
  if (!terminalId) return null

  const terminal = task.nodeStates[terminalId]
  const hero = terminal?.submission ?? null
  const heroCand = hero ? byPin.get(hero.pinId) ?? null : null
  const heroArtifact = heroCand ? candidateArtifactOf(heroCand) : null
  const heroResult = heroCand?.result ?? null
  const heroSummary = typeof heroResult?.summary === 'string' ? heroResult.summary : null
  const heroMembers = Array.isArray(heroResult?.members) ? (heroResult.members as unknown[]).filter((m): m is string => typeof m === 'string') : []
  const heroSha = typeof heroResult?.releaseSha256 === 'string' ? heroResult.releaseSha256 : null
  const settled = Boolean(task.settlement)

  const chainRows = (task.settlement?.winningChain ?? [])
    .map((pinId) => ({ pinId, cand: byPin.get(pinId) }))
    .filter((row): row is { pinId: string; cand: CandidateLike & { submitter?: string } } => Boolean(row.cand))

  const inProgressLeaders = settled
    ? []
    : Object.values(task.nodeStates)
      .filter((node) => node.status === 'verified' && node.submission)
      .map((node) => ({ node, cand: byPin.get(node.submission?.pinId ?? '') }))
      .filter((row): row is { node: TaskProjection['nodeStates'][string]; cand: CandidateLike & { submitter?: string } } => Boolean(row.cand))

  if (!hero && chainRows.length === 0 && inProgressLeaders.length === 0) return null

  return (
    <section className="oac-mt-deliverables">
      <div className="oac-mt-h3">{settled ? mt('mtDlvTitle') : mt('mtDlvTitleProgress')}</div>

      {hero && heroCand && (
        <div className="oac-mt-dlv-hero">
          <span className="oac-mt-dlv-type">{TYPE_BADGE[heroArtifact?.kind ?? 'other'] ?? '·'}</span>
          <div className="oac-mt-dlv-main">
            <div className="oac-mt-dlv-kicker">
              {terminalId} · {terminal.title}
              {heroArtifact?.resultType && <span className="oac-mt-chip">{heroArtifact.resultType}</span>}
            </div>
            <div className="oac-mt-dlv-name">{heroSummary ?? mt('mtDlvDefaultName', { type: heroArtifact?.resultType ?? '—' })}</div>
            <div className="oac-mt-dlv-by">
              <MtBadge
                metaId={(heroCand as { submitter?: string }).submitter ?? ''}
                name={identityOf((heroCand as { submitter?: string }).submitter ?? '').name}
                avatar={identityOf((heroCand as { submitter?: string }).submitter ?? '').avatar}
                you={false}
                youLabel={youLabel}
              />
            </div>
            {heroMembers.length > 0 && (
              <div className="oac-mt-dlv-members">
                {heroMembers.map((member, index) => (
                  <span key={index} className="oac-mt-memberchip">{member}</span>
                ))}
              </div>
            )}
            {heroSha && <div className="oac-mt-fact">sha256 <code>{heroSha.slice(0, 24)}…</code></div>}
            {heroArtifact?.metafileUri && (
              <div className="oac-mt-actions">
                <code className="oac-mt-uri">{heroArtifact.metafileUri}</code>
                <a className="oac-mt-btn oac-mt-btn-sm" href={`/oac/api-file/${encodeURIComponent(heroArtifact.metafileUri)}`} download>{mt('mtDownload')}</a>
                {heroArtifact.metafileViewUrl && (
                  <a className="oac-mt-btn oac-mt-btn-sm" href={heroArtifact.metafileViewUrl} target="_blank" rel="noreferrer">{mt('mtOpenInMetaweb')}</a>
                )}
                {heroArtifact.metaAppUri && <a className="oac-mt-btn oac-mt-btn-sm oac-mt-btn-primary" href={heroArtifact.metaAppUri}>{mt('mtOpenApp')}</a>}
              </div>
            )}
          </div>
        </div>
      )}

      {chainRows.length > 0 && (
        <div className="oac-mt-dlv-rows">
          {chainRows.map(({ pinId, cand }) => {
            const artifact = candidateArtifactOf(cand)
            const commit = typeof cand.result?.commit === 'string' ? cand.result.commit : null
            const baseCommit = typeof cand.result?.baseCommit === 'string' ? cand.result.baseCommit : null
            const repoHint = typeof cand.result?.repoHint === 'string' ? cand.result.repoHint : null
            const node = Object.values(task.nodeStates).find((entry) => (entry.submissions ?? []).some((c) => c.pinId === pinId))
            const submitter = (cand as { submitter?: string }).submitter ?? ''
            return (
              <div key={pinId} className="oac-mt-dlv-row">
                <span className={`oac-mt-dlv-rowtype oac-mt-dlv-rowtype-${artifact.kind}`}>{TYPE_BADGE[artifact.kind] ?? '·'}</span>
                <div className="oac-mt-dlv-rowmain">
                  <b>{node?.id ?? '—'} · {node?.title ?? ''}</b>
                  {artifact.kind === 'git' && commit
                    ? <span className="oac-mt-dlv-git"><code>{commit.slice(0, 10)}</code>{baseCommit ? <> @ <code>{baseCommit.slice(0, 10)}</code></> : null}
                      {repoHint && <a href={repoHint} target="_blank" rel="noreferrer"> {mt('mtRepo')}</a>}</span>
                    : artifact.metafileUri
                      ? <code className="oac-mt-uri">{artifact.metafileUri}</code>
                      : <span>{mt('mtDlvNoArtifact')}</span>}
                </div>
                <MtBadge metaId={submitter} name={identityOf(submitter).name} avatar={identityOf(submitter).avatar} youLabel={youLabel} />
                <button type="button" className="oac-mt-btn oac-mt-btn-sm" onClick={() => { onOpenCandidate(pinId) }}>{mt('mtDetails')}</button>
              </div>
            )
          })}
        </div>
      )}

      {inProgressLeaders.length > 0 && (
        <div className="oac-mt-dlv-progress">
          <div className="oac-mt-dim">{mt('mtDlvCurrentOutput')}</div>
          {inProgressLeaders.map(({ node, cand }) => {
            const submitter = (cand as { submitter?: string }).submitter ?? ''
            return (
              <div key={node.id} className="oac-mt-dlv-row">
                <b>{node.id}</b>
                <MtBadge metaId={submitter} name={identityOf(submitter).name} avatar={identityOf(submitter).avatar} youLabel={youLabel} />
                <button type="button" className="oac-mt-btn oac-mt-btn-sm" onClick={() => { onOpenCandidate(node.submission?.pinId ?? '') }}>{mt('mtDetails')}</button>
              </div>
            )
          })}
        </div>
      )}
      <div className="oac-mt-dim oac-mt-pinlink">root <code>{shortPin(task.rootPinId)}</code></div>
    </section>
  )
}

/** The unique deps sink (finalnode fallback, §3.1). */
const findUniqueSink = (task: TaskProjection): string | null => {
  const referenced = new Set<string>()
  for (const node of Object.values(task.nodeStates)) {
    for (const dep of node.deps) referenced.add(dep)
  }
  const sinks = Object.values(task.nodeStates).filter((node) => !referenced.has(node.id))
  return sinks.length === 1 ? sinks[0].id : null
}
