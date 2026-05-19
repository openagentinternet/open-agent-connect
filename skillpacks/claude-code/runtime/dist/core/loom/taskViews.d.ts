import type { LoomCachedRecord, LoomRawCacheState } from './rawCache';
export interface LoomTaskListFilters {
    limit?: number;
    tag?: string;
    currency?: string;
}
export declare function listLoomTasksFromCache(state: LoomRawCacheState, filters?: LoomTaskListFilters): {
    tasks: {
        pinId: string;
        title: string;
        bounty: {} | null;
        tags: any[];
        timestamp: number;
        creatorAddress: string;
        creatorMetaId: string;
        globalMetaId: string;
        payloadValid: boolean;
        validationErrors: import("./validation").LoomValidationError[];
        relatedCounts: {
            claims: number;
            statuses: number;
            deliveries: number;
            acceptances: number;
            claimRejects: number;
        };
    }[];
};
export declare function showLoomTaskFromCache(state: LoomRawCacheState, taskPinId: string): {
    found: boolean;
    code: string;
    message: string;
    taskPinId: string;
    task?: undefined;
    related?: undefined;
} | {
    found: boolean;
    task: LoomCachedRecord;
    related: Record<"claims" | "statuses" | "deliveries" | "acceptances" | "claimRejects", LoomCachedRecord[]>;
    code?: undefined;
    message?: undefined;
    taskPinId?: undefined;
};
