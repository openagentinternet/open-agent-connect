/**
 * Roster (F10) + settlement (F11) — identity-badged participants sorted by
 * verified contribution, settlement shares with the submitted/reviewed split,
 * the unpaid-history summary, and the closing checklist while no manifest
 * exists yet.
 */
import { type ReactNode } from 'react'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export function RosterSettlement(props: {
  mt: Mt
  task: TaskProjection
  identityOf: IdentityOf
}): ReactNode {
  const { mt, task, identityOf } = props
  const settlement = task.settlement
  const estimation = task.estimation ?? null

  return (
    <section className="oac-mt-roster-settlement">
      <div className="oac-mt-h3">{mt('mtRosterTitle')}</div>
      <table className="oac-sch-table">
        <thead>
          <tr>
            <th>{mt('mtRosterIdentity')}</th>
            <th>{mt('mtRosterClaims')}</th>
            <th>{mt('mtRosterVerified')}</th>
            <th>{mt('mtRosterReviews')}</th>
            {!settlement && <th>{mt('mtRosterEstShare')}</th>}
          </tr>
        </thead>
        <tbody>
          {[...task.participants]
            .sort((left, right) => right.verifiedContrib - left.verifiedContrib)
            .map((participant) => {
              const identity = identityOf(participant.metaId)
              const est = estimation?.shares.find((share) => share.metaId === participant.metaId)
              return (
                <tr key={participant.metaId}>
                  <td><MtBadge metaId={participant.metaId} name={identity.name} avatar={identity.avatar} /></td>
                  <td>{participant.effectiveClaims}</td>
                  <td>{participant.verifiedContrib}</td>
                  <td>{participant.reviewVotes}</td>
                  {!settlement && <td>{est ? `${est.shareBP} bp` : '—'}</td>}
                </tr>
              )
            })}
          {task.participants.length === 0 && (
            <tr><td colSpan={5} className="oac-mt-empty-inline">{mt('mtMineEmpty')}</td></tr>
          )}
        </tbody>
      </table>

      <div className="oac-mt-h3">{mt('mtSettleTitle')}</div>
      {settlement ? (
        <>
          <table className="oac-sch-table">
            <thead>
              <tr>
                <th>{mt('mtSettleIdentity')}</th>
                <th>{mt('mtSettleShare')}</th>
                <th>{mt('mtSettleFrom')}</th>
              </tr>
            </thead>
            <tbody>
              {settlement.shares.map((share) => {
                const identity = identityOf(share.metaId)
                return (
                  <tr key={share.metaId}>
                    <td><MtBadge metaId={share.metaId} name={identity.name} avatar={identity.avatar} /></td>
                    <td>{share.shareBP} bp ({Math.round(share.shareBP / 100)}%)</td>
                    <td>{mt('mtSettleFromSplit', { sub: share.from.submittedBP, rev: share.from.reviewedBP })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {settlement.unpaidHistory.length > 0 && (
            <div className="oac-mt-unpaid">
              <div className="oac-mt-fact">
                {mt('mtUnpaidCount', {
                  count: settlement.unpaidHistory.length,
                  reasons: [...new Set(settlement.unpaidHistory.map((entry) => entry.reason))].join(', '),
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <ul className="oac-mt-checklist">
          <li data-done={task.progress.satisfied === task.progress.total ? 'true' : undefined}>
            {mt('mtCheckAllNodes', { done: task.progress.satisfied, total: task.progress.total })}
          </li>
          <li data-done={task.taskComplete ? 'true' : undefined}>{mt('mtCheckRootVerified')}</li>
          <li data-done={task.progress.disputed === 0 ? 'true' : undefined}>{mt('mtCheckNoChallenges')}</li>
        </ul>
      )}
    </section>
  )
}
