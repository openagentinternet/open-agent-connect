/**
 * Deliverables (F5, competitive): the settled hero (the terminal node's
 * winner artifact) plus one row per winning-chain node; while in progress,
 * the satisfied nodes' current leaders under "current output (in progress)".
 */
import { type ReactNode } from 'react'
import {
  candidateArtifactOf,
  metafileViewUrl,
  type CandidateLike,
} from '../../metatask-logic.js'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export function Deliverables(props: {
  mt: Mt
  task: TaskProjection
  nameOf: (metaId: string) => string
  byPin: Map<string, CandidateLike>
  onOpenCandidate: (pinId: string) => void
}): ReactNode {
  const { mt, task, nameOf, byPin, onOpenCandidate } = props
  const terminalId = task.policy.finalNode
    ?? (task.nodes.length > 0 ? findUniqueSink(task) : null)
  if (!terminalId) return null

  const terminal = task.nodeStates[terminalId]
  const hero = terminal?.submission ?? null
  const heroCand = hero ? byPin.get(hero.pinId) ?? null : null
  const heroArtifact = heroCand ? candidateArtifactOf(heroCand) : null
  const heroResult = heroCand?.result ?? null
  const heroSummary = typeof heroResult?.summary === 'string' ? heroResult.summary : null
  const heroMembers = Array.isArray(heroResult?.members) ? (heroResult.members as unknown[]) : []
  const heroSha = typeof heroResult?.releaseSha256 === 'string' ? heroResult.releaseSha256 : null
  const settled = Boolean(task.settlement)

  const chainRows = (task.settlement?.winningChain ?? [])
    .map((pinId) => ({ pinId, cand: byPin.get(pinId) }))
    .filter((row): row is { pinId: string; cand: CandidateLike } => Boolean(row.cand))

  const inProgressLeaders = settled
    ? []
    : Object.values(task.nodeStates)
      .filter((node) => node.status === 'verified' && node.submission)
      .map((node) => ({ node, cand: byPin.get(node.submission?.pinId ?? '') }))
      .filter((row): row is { node: typeof task.nodeStates[string]; cand: CandidateLike } => Boolean(row.cand))

  return (
    <div className="oac-mt-deliverables">
      <div className="oac-mt-section-title">
        {settled ? mt('mtDlvTitle') : mt('mtDlvTitleProgress')}
      </div>

      {hero && heroCand && (
        <div className="oac-mt-dlv-hero">
          <div className="oac-mt-dlv-kicker">
            <span className="oac-mt-chip">{terminalId} · {terminal.title}</span>
            <span className="oac-mt-chip">{nameOf(hero.submitter)}</span>
            {heroArtifact?.resultType && <span className="oac-mt-chip">{heroArtifact.resultType}</span>}
          </div>
          <div className="oac-mt-dlv-name">{heroSummary ?? mt('mtDlvDefaultName', { type: heroArtifact?.resultType ?? '—' })}</div>
          {heroMembers.length > 0 && (
            <div className="oac-mt-dlv-members">
              {heroMembers.map((member, index) => (
                <span key={index} className="oac-mt-chip">{typeof member === 'string' ? nameOf(member) : String(member)}</span>
              ))}
            </div>
          )}
          {heroSha && <div className="oac-mt-fact">sha256: <code>{heroSha}</code></div>}
          {heroArtifact?.metafileUri && (
            <div className="oac-mt-actions">
              <code className="oac-mt-uri">{heroArtifact.metafileUri}</code>
              <a className="oac-btn oac-btn-sm" href={`/oac/api-file/${encodeURIComponent(heroArtifact.metafileUri)}`} download>{mt('mtDownload')}</a>
              {heroArtifact.metafileViewUrl && (
                <a className="oac-btn oac-btn-sm" href={heroArtifact.metafileViewUrl} target="_blank" rel="noreferrer">{mt('mtOpenInMetaweb')}</a>
              )}
            </div>
          )}
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
            return (
              <div key={pinId} className="oac-mt-dlv-row">
                <span className="oac-mt-chip">{node?.id ?? '—'}</span>
                <span className="oac-mt-chip">{nameOf((cand as { submitter?: string }).submitter ?? '')}</span>
                {artifact.kind === 'git' && commit
                  ? <span className="oac-mt-dlv-git"><code>{commit.slice(0, 12)}</code>{baseCommit ? <> @ <code>{baseCommit.slice(0, 12)}</code></> : null}
                    {repoHint && <a href={repoHint} target="_blank" rel="noreferrer"> {mt('mtRepo')}</a>}</span>
                  : artifact.metafileUri
                    ? <code className="oac-mt-uri">{artifact.metafileUri}</code>
                    : <span>{mt('mtDlvNoArtifact')}</span>}
                <button type="button" className="oac-btn oac-btn-sm" onClick={() => { onOpenCandidate(pinId) }}>{mt('mtDetails')}</button>
              </div>
            )
          })}
        </div>
      )}

      {inProgressLeaders.length > 0 && (
        <div className="oac-mt-dlv-progress">
          <div className="oac-mt-section-title">{mt('mtDlvCurrentOutput')}</div>
          {inProgressLeaders.map(({ node, cand }) => (
            <div key={node.id} className="oac-mt-dlv-row">
              <span className="oac-mt-chip">{node.id}</span>
              <span>{nameOf((cand as { submitter?: string }).submitter ?? '')}</span>
              <button type="button" className="oac-btn oac-btn-sm" onClick={() => { onOpenCandidate(node.submission?.pinId ?? '') }}>{mt('mtDetails')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
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
