import type {
  SkillContractPatch,
  SkillPermissionScope,
  SkillVariantArtifact as SkillContractVariantArtifact,
  SkillVariantScopeMetadata,
  SkillVariantStatus,
} from '../skills/skillContractTypes';

export type SkillExecutionTriggerSource = 'hard_failure' | 'soft_failure' | 'manual_recovery';
export type SkillEvolutionType = 'FIX';
export type SkillAdoptionState = 'active' | 'manual';
export type SkillVariantSource = 'local' | 'remote';

export interface SkillActiveVariantRef {
  source: SkillVariantSource;
  variantId: string;
}

export interface SkillExecutionRecord {
  executionId: string;
  skillName: string;
  activeVariantId: string | null;
  commandTemplate: string;
  startedAt: number;
  finishedAt: number;
  envelope: Record<string, unknown>;
  stdout: string;
  stderr: string;
  usedUiFallback: boolean;
  manualRecovery: boolean;
}

export interface SkillExecutionAnalysis {
  analysisId: string;
  executionId: string;
  skillName: string;
  triggerSource: SkillExecutionTriggerSource;
  evolutionType: SkillEvolutionType;
  shouldGenerateCandidate: boolean;
  summary: string;
  analyzedAt: number;
}

export interface SkillLineageRecord {
  lineageId: string;
  parentVariantId: string | null;
  rootVariantId: string;
  executionId: string;
  analysisId: string;
  createdAt: number;
}

export interface SkillVerificationSummary {
  passed: boolean;
  checkedAt: number;
  protocolCompatible: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  notes?: string;
}

export interface SkillVariantArtifact extends Omit<SkillContractVariantArtifact, 'status' | 'scope' | 'metadata' | 'patch'> {
  status: SkillVariantStatus;
  scope: SkillPermissionScope;
  metadata: SkillVariantScopeMetadata;
  patch: SkillContractPatch;
  lineage: SkillLineageRecord;
  verification: SkillVerificationSummary;
  adoption: SkillAdoptionState;
  createdAt: number;
  updatedAt: number;
}

export interface SkillEvolutionIndex {
  schemaVersion: 1;
  executions: string[];
  analyses: string[];
  artifacts: string[];
  activeVariants: Record<string, SkillActiveVariantRef>;
}

export interface ImportedRemoteArtifactSidecar {
  pinId: string;
  variantId: string;
  publisherGlobalMetaId: string;
  artifactUri: string;
  skillName: string;
  scopeHash: string;
  publishedAt: number;
  importedAt: number;
}

export interface RemoteEvolutionIndexRow {
  variantId: string;
  pinId: string;
}

export interface RemoteEvolutionIndex {
  schemaVersion: 1;
  imports: string[];
  byVariantId: Record<string, RemoteEvolutionIndexRow>;
}

export interface PublishedEvolutionSearchResultSummaryRow {
  pinId: string;
  variantId: string;
  skillName: string;
  artifactUri: string;
  publisherGlobalMetaId: string;
  publishedAt: number;
  scopeHash: string;
  triggerSource: SkillExecutionTriggerSource;
  verificationPassed: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  alreadyImported: boolean;
  importedPinId: string | null;
}

export interface ImportedEvolutionArtifactSummaryRow {
  variantId: string;
  pinId: string;
  skillName: string;
  publisherGlobalMetaId: string;
  artifactUri: string;
  publishedAt: number;
  importedAt: number;
  scopeHash: string;
  verificationPassed: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  active: boolean;
}
