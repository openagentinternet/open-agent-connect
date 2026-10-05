/**
 * Roster (F10) + settlement (F11) — IDBots parity: identity-badged
 * participants sorted by verified contribution inside a full-width card
 * table (local bots carry the "local" tag), the settled manifest table with
 * share split + percentage, the unpaid-history + legacy-completion notes,
 * and the dashed pending card with the closing checklist while no manifest
 * exists yet.
 */
import { type ReactNode } from 'react'
import { MtBadge } from './MtBadge.tsx'
import type { IdentityOf } from './ChainView.tsx'
import type { TaskProjection } from './MetataskDetail.tsx'
import type { MetataskBoardLocale } from './MetataskBoard.tsx'

type Mt = MetataskBoardLocale['mt']

const pctOf = (shareBP: number): string => (shareBP / 100).toFixed(2)

export function RosterSettlement(props: {
  mt: Mt
  task: TaskProjection
  identityOf: IdentityOf
  rosterIds: Set<string>
  youLabel: string
}): ReactNode {
  const { mt, task, identityOf, rosterIds, youLabel } = props
  const settlement = task.settlement
  const estimation = task.estimation ?? null
  const showEstShare = !settlement && Boolean(estimation)
  const estShareByMetaId = new Map((estimation?.shares ?? []).map((share) => [share.metaId, share.shareBP]))
  const roster = [...task.participants]
    .sort((left, right) => right.verifiedContrib - left.verifiedContrib || left.metaId.localeCompare(right.metaId))

  return (
    <section className="oac-mt-roster-settlement">
      <div className="oac-mt-sectioncard">
        <div className="oac-mt-h3">{mt('mtRosterTitle')}</div>
        <div className="oac-mt-tablewrap">
          <table className="oac-mt-table">
            <thead>
              <tr>
                <th>{mt('mtRosterIdentity')}</th>
                <th>{mt('mtRosterClaims')}</th>
                <th>{mt('mtRosterVerified')}</th>
                <th>{mt('mtRosterReviews')}</th>
                {showEstShare && <th>{mt('mtRosterEstShare')}</th>}
              </tr>
            </thead>
            <tbody>
              {roster.map((participant) => {
                const identity = identityOf(participant.metaId)
                const estShareBP = estShareByMetaId.get(participant.metaId)
                return (
                  <tr key={participant.metaId}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <MtBadge metaId={participant.metaId} name={identity.name} avatar={identity.avatar} />
                        {rosterIds.has(participant.metaId) && <span className="oac-mt-you">{youLabel}</span>}
                      </span>
                    </td>
                    <td className="oac-mt-sharenum">{participant.effectiveClaims}</td>
                    <td className="oac-mt-sharenum">{participant.verifiedContrib}</td>
                    <td className="oac-mt-sharenum">{participant.reviewVotes}</td>
                    {showEstShare && (
                      <td className="oac-mt-sharenum">{estShareBP === undefined ? '—' : `${pctOf(estShareBP)}%`}</td>
                    )}
                  </tr>
                )
              })}
              {roster.length === 0 && (
                <tr><td colSpan={showEstShare ? 5 : 4} className="oac-mt-empty-inline">{mt('mtMineEmpty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="oac-mt-sectioncard">
        <div className="oac-mt-h3">{mt('mtSettleTitle')}</div>
        {settlement ? (
          <>
            <div className="oac-mt-tablewrap">
              <table className="oac-mt-table">
                <thead>
                  <tr>
                    <th>{mt('mtSettleIdentity')}</th>
                    <th>{mt('mtSettleShare')}</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {settlement.shares.map((share) => {
                    const identity = identityOf(share.metaId)
                    return (
                      <tr key={share.metaId}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <MtBadge metaId={share.metaId} name={identity.name} avatar={identity.avatar} />
                            {rosterIds.has(share.metaId) && <span className="oac-mt-you">{youLabel}</span>}
                          </span>
                        </td>
                        <td className="oac-mt-sharenum">
                          {share.shareBP} bp
                          <small>({share.from.submittedBP}+{share.from.reviewedBP})</small>
                        </td>
                        <td className="oac-mt-sharenum">{pctOf(share.shareBP)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {settlement.unpaidHistory.length > 0 && (
              <div className="oac-mt-unpaid">{mt('mtUnpaidCount', { count: settlement.unpaidHistory.length })}</div>
            )}
            {task.progress.verified < task.progress.total && (
              <div className="oac-mt-unpaid">{mt('mtLegacyNote')}</div>
            )}
          </>
        ) : (
          <div className="oac-mt-pending">
            {mt('mtSettlementPending', { verified: task.progress.verified, total: task.progress.total })}
            <ul className="oac-mt-checklist" style={{ marginTop: 8 }}>
              <li data-done={task.progress.verified === task.progress.total ? 'true' : undefined}>
                {mt('mtClosingAll', { verified: task.progress.verified, total: task.progress.total })}
              </li>
              <li data-done={task.taskComplete ? 'true' : undefined}>{mt('mtClosingRoot')}</li>
              <li data-done={task.progress.disputed === 0 ? 'true' : undefined}>
                {mt('mtClosingNoChallenges', { count: task.progress.disputed })}
              </li>
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
