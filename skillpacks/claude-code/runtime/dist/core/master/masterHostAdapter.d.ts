import type { AskMasterConfig } from '../config/configTypes';
import type { CollectedMasterContext, MasterContextCollectionInput, PackagedMasterAskDraft } from './masterContextTypes';
import type { MasterDirectoryItem } from './masterTypes';
export interface ManualAskHostAction {
    kind: 'manual_ask';
    utterance: string;
    preferredMasterName?: string | null;
    preferredMasterKind?: string | null;
}
export type HostAskMasterAction = ManualAskHostAction | {
    kind: 'accept_suggest';
    traceId: string;
    suggestionId: string;
} | {
    kind: 'reject_suggest';
    traceId: string;
    suggestionId: string;
    reason?: string | null;
};
export interface PreparedManualAskHostAction {
    action: ManualAskHostAction;
    collected: CollectedMasterContext;
    draft: PackagedMasterAskDraft;
    selectedTarget: MasterDirectoryItem;
}
export declare function selectMasterForManualAsk(input: {
    action: ManualAskHostAction | Record<string, unknown>;
    masters: MasterDirectoryItem[];
    hostMode?: string | null;
    trustedMasters?: string[];
}): MasterDirectoryItem | null;
export declare function prepareManualAskHostAction(input: {
    action: ManualAskHostAction | Record<string, unknown>;
    context: MasterContextCollectionInput | Record<string, unknown>;
    masters: MasterDirectoryItem[];
    config: Pick<AskMasterConfig, 'contextMode' | 'trustedMasters'> & Partial<Pick<AskMasterConfig, 'enabled' | 'triggerMode' | 'confirmationMode'>>;
}): PreparedManualAskHostAction;
