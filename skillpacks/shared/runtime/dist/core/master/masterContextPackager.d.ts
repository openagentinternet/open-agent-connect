import type { CollectedMasterContext, MasterAskTargetRef, PackagedMasterAskDraft } from './masterContextTypes';
export declare function packageMasterContextForAsk(input: {
    collected: CollectedMasterContext;
    target?: MasterAskTargetRef | null;
    triggerMode?: string | null;
    contextMode?: string | null;
    explicitUserTask?: string | null;
    explicitQuestion?: string | null;
    desiredOutputMode?: string | null;
}): PackagedMasterAskDraft;
