import { type MasterMessageArtifact, type MasterRequestMessage } from './masterMessageSchema';
import { type MasterAskContextMode, type MasterAskTargetRef, type MasterAskTriggerMode } from './masterContextTypes';
import type { MasterPayloadSafetySummary } from './masterAutoPolicy';
import type { MasterDirectoryItem } from './masterTypes';
export type MasterAskConfirmationMode = 'always' | 'sensitive_only' | 'never';
export interface MasterAskDraft {
    target: MasterAskTargetRef;
    triggerMode?: MasterAskTriggerMode | string | null;
    contextMode?: MasterAskContextMode | string | null;
    userTask: string;
    question: string;
    goal?: string | null;
    workspaceSummary?: string | null;
    errorSummary?: string | null;
    diffSummary?: string | null;
    relevantFiles?: string[];
    artifacts?: Array<Record<string, unknown>>;
    constraints?: string[];
    desiredOutput?: {
        mode?: string | null;
    } | null;
}
export interface PreparedMasterAskPreview {
    request: MasterRequestMessage;
    requestJson: string;
    preview: {
        target: {
            displayName: string;
            masterKind: string;
            providerGlobalMetaId: string;
            servicePinId: string;
            official: boolean;
            trustedTier: string | null;
            pricingMode: string | null;
            hostModes: string[];
        };
        intent: {
            userTask: string;
            question: string;
            goal: string | null;
        };
        context: {
            contextMode: 'compact' | 'standard';
            workspaceSummary: string | null;
            errorSummary: string | null;
            diffSummary: string | null;
            relevantFiles: string[];
            artifacts: MasterMessageArtifact[];
            constraints: string[];
        };
        safety: {
            noImplicitRepoUpload: true;
            noImplicitSecrets: true;
            transport: 'simplemsg';
            deliveryTarget: string;
            sensitivity: MasterPayloadSafetySummary;
        };
        confirmation: {
            requiresConfirmation: boolean;
            policyMode: MasterAskConfirmationMode;
            frictionMode: 'preview_confirm' | 'direct_send';
            confirmCommand: string;
        };
        request: MasterRequestMessage;
    };
}
export declare function buildMasterAskPreview(input: {
    draft: MasterAskDraft | Record<string, unknown>;
    resolvedTarget: MasterDirectoryItem;
    caller: {
        globalMetaId: string;
        name?: string | null;
        host: string;
    };
    traceId: string;
    requestId: string;
    confirmationMode: MasterAskConfirmationMode;
    requiresConfirmationOverride?: boolean | null;
}): PreparedMasterAskPreview;
