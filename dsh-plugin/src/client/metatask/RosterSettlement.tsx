/**
 * Roster (F10) + settlement (F11) tables: participants sorted by verified
 * contribution, and the settlement shares with the from-split and the unpaid
 * history; the closing checklist while no manifest exists.
 */
import { type ReactNode } from 'react'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

export function RosterSettlement(props: {
  mt: Mt
  task: TaskProjection
  nameOf: (metaId: string) => string
}): ReactNode {
  const { mt, task, nameOf } = props
  const settlement = task.settlement

  return (
    <div className="oac-mt-roster-settlement">
      <div className="oac-mt-section-title">{mt('mtRosterTitle')}</div>
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
            .map((participant) => (
              <tr key={participant.metaId}>
                <td>{nameOf(participant.metaId)}</td>
                <td>{participant.effectiveClaims}</td>
                <td>{participant.verifiedContrib}</td>
                <td>{participant.reviewVotes}</td>
                {!settlement && <td>—</td>}
              </tr>
            ))}
        </tbody>
      </table>

      <div className="oac-mt-section-title">{mt('mtSettleTitle')}</div>
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
              {settlement.shares.map((share) => (
                <tr key={share.metaId}>
                  <td>{nameOf(share.metaId)}</td>
                  <td>{share.shareBP} bp ({Math.round(share.shareBP / 100)}%)</td>
                  <td>{mt('mtSettleFromSplit', { sub: share.from.submittedBP, rev: share.from.reviewedBP })}</td>
                </tr>
              ))}
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
    </div>
  )
}
