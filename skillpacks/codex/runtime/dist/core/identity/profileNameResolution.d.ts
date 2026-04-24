export interface ProfileNameResolutionRecord {
    name: string;
    slug: string;
    aliases?: string[];
}
export interface ProfileNameCandidateScore<TProfile extends ProfileNameResolutionRecord> {
    profile: TProfile;
    score: number;
    matchedField: 'slug' | 'name' | 'alias';
    matchedValue: string;
}
export type ProfileNameMatchType = 'exact_slug' | 'exact_name' | 'exact_alias' | 'ranked';
export type ProfileNameResolutionResult<TProfile extends ProfileNameResolutionRecord> = {
    status: 'matched';
    match: TProfile;
    matchType: ProfileNameMatchType;
    score: number;
} | {
    status: 'not_found';
    message: string;
} | {
    status: 'ambiguous';
    message: string;
    candidates: TProfile[];
};
export declare function normalizeProfileLookupKey(value: unknown): string;
export declare function generateProfileSlug(value: unknown): string;
export declare function buildProfileAliases(name: unknown, slug?: unknown, existingAliases?: unknown[]): string[];
export declare function scoreProfileNameCandidate<TProfile extends ProfileNameResolutionRecord>(query: unknown, profile: TProfile): ProfileNameCandidateScore<TProfile>;
export declare function detectAmbiguousProfileNameMatch<TProfile extends ProfileNameResolutionRecord>(scores: ProfileNameCandidateScore<TProfile>[]): boolean;
export declare function resolveProfileNameMatch<TProfile extends ProfileNameResolutionRecord>(query: unknown, profiles: TProfile[]): ProfileNameResolutionResult<TProfile>;
