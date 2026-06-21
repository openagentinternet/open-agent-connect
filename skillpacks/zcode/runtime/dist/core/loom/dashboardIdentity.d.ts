import type { LoomCachedRecord } from './rawCache';
import type { LoomDashboardBotIdentity, LoomDashboardBotRole, LoomDashboardIdentityMap, LoomDashboardIdentityProfile } from './dashboardTypes';
export interface LoomDashboardIdentityAuthor {
    globalMetaId?: string;
    creatorAddress?: string;
    address?: string;
}
export interface ProjectLoomDashboardBotIdentityInput {
    role: LoomDashboardBotRole;
    author: LoomDashboardIdentityAuthor | LoomCachedRecord;
    profile?: LoomDashboardIdentityProfile;
    identityMap?: LoomDashboardIdentityMap;
    address?: string;
}
export declare function resolveLoomDashboardIdentityProfile(author: LoomDashboardIdentityAuthor | LoomCachedRecord, identityMap?: LoomDashboardIdentityMap): LoomDashboardIdentityProfile | undefined;
export declare function projectLoomDashboardBotIdentity(input: ProjectLoomDashboardBotIdentityInput): LoomDashboardBotIdentity;
