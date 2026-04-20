import type { MasterContextCollectionInput } from './masterContextTypes'
import { buildMasterHostObservation } from './masterHostObservation'
import { assessMasterAskWorthiness } from './masterStuckDetector'
import type { TriggerObservation } from './masterTriggerEngine'

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    unique.push(value)
  }
  return unique
}

export function buildTriggerObservationFromHostObservationFrame(
  observation: Parameters<typeof assessMasterAskWorthiness>[0]
): TriggerObservation {
  const assessment = assessMasterAskWorthiness(observation)
  const uncertaintySignals = uniqueStrings([
    ...observation.diagnostics.uncertaintySignals,
    ...(observation.hints.reviewCheckpointRisk || assessment.opportunityType === 'review_checkpoint'
      ? ['review_checkpoint_risk']
      : []),
  ])

  return {
    now: observation.now,
    traceId: observation.traceId,
    hostMode: observation.hostMode,
    workspaceId: observation.workspaceId,
    userIntent: {
      explicitlyAskedForMaster: observation.userIntent.explicitlyAskedForMaster,
      explicitlyRejectedSuggestion: observation.userIntent.explicitlyRejectedSuggestion,
      explicitlyRejectedAutoAsk: observation.userIntent.explicitlyRejectedAutoAsk,
    },
    activity: {
      recentUserMessages: observation.activity.recentUserMessages,
      recentAssistantMessages: observation.activity.recentAssistantMessages,
      recentToolCalls: observation.activity.recentToolCalls,
      recentFailures: observation.activity.recentFailures,
      repeatedFailureCount: observation.activity.repeatedFailureCount,
      noProgressWindowMs: observation.activity.noProgressWindowMs,
    },
    diagnostics: {
      failingTests: observation.diagnostics.failingTests,
      failingCommands: observation.diagnostics.failingCommands,
      repeatedErrorSignatures: observation.diagnostics.repeatedErrorSignatures,
      uncertaintySignals,
    },
    workState: {
      hasPlan: observation.workState.hasPlan,
      todoBlocked: observation.workState.todoBlocked,
      diffChangedRecently: observation.workState.diffChangedRecently,
      onlyReadingWithoutConverging: observation.workState.onlyReadingWithoutConverging,
    },
    directory: {
      availableMasters: observation.directory.availableMasters,
      trustedMasters: observation.directory.trustedMasters,
      onlineMasters: observation.directory.onlineMasters,
    },
    candidateMasterKindHint: assessment.candidateMasterKind ?? observation.hints.candidateMasterKindHint,
  }
}

export function buildTriggerObservationFromHostContext(
  input: MasterContextCollectionInput | Record<string, unknown>
): TriggerObservation {
  return buildTriggerObservationFromHostObservationFrame(buildMasterHostObservation(input))
}
