export type MetabotBotType = 'twin' | 'worker';
export interface BotRoleInfo {
    botType?: MetabotBotType | null;
    ownerGlobalMetaId?: string | null;
}
export declare function normalizeBotType(value: unknown): MetabotBotType | null;
export declare function normalizeOptionalGlobalMetaId(value: unknown): string | null;
export declare function normalizeBotRoleInfo(value: unknown): BotRoleInfo;
/** Field patch view: only keys present on the input are patched (null clears). */
export declare function botRolePatchFromInput(input: BotRoleInfo): BotRoleInfo;
export declare function hasBotRolePatch(patch: BotRoleInfo): boolean;
export declare function mergeBotRoleInfo(current: BotRoleInfo, patch: BotRoleInfo): BotRoleInfo;
export declare function readBotRoleInfo(filePath: string): Promise<BotRoleInfo>;
/** Sync variant of readBotRoleInfo for the sync home-selection path. */
export declare function readBotRoleInfoSync(filePath: string): BotRoleInfo;
export declare function writeBotRoleInfo(filePath: string, info: BotRoleInfo): Promise<void>;
