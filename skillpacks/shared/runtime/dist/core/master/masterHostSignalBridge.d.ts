import type { MasterContextCollectionInput } from './masterContextTypes';
import { assessMasterAskWorthiness } from './masterStuckDetector';
import type { TriggerObservation } from './masterTriggerEngine';
export declare function buildTriggerObservationFromHostObservationFrame(observation: Parameters<typeof assessMasterAskWorthiness>[0]): TriggerObservation;
export declare function buildTriggerObservationFromHostContext(input: MasterContextCollectionInput | Record<string, unknown>): TriggerObservation;
