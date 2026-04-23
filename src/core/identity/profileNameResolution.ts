import { createHash } from 'node:crypto';

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

export type ProfileNameResolutionResult<TProfile extends ProfileNameResolutionRecord> =
  | {
    status: 'matched';
    match: TProfile;
    matchType: ProfileNameMatchType;
    score: number;
  }
  | {
    status: 'not_found';
    message: string;
  }
  | {
    status: 'ambiguous';
    message: string;
    candidates: TProfile[];
  };

const RANKED_MATCH_MIN_SCORE = 550;
const AMBIGUITY_SCORE_DELTA = 25;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAsciiBase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function collapseSeparators(value: string, separator: ' ' | '-'): string {
  return value
    .replace(/[\s._/\\-]+/g, separator)
    .replace(separator === ' ' ? /\s+/g : /-+/g, separator)
    .trim();
}

function sanitizeForLookup(value: string): string {
  return value
    .replace(/[\s._/\\-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeForSlug(value: string): string {
  return value
    .replace(/[\s._/\\-]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildStableShortHash(value: string): string {
  return createHash('sha256')
    .update(value.normalize('NFKC'))
    .digest('hex')
    .slice(0, 8);
}

function normalizeCandidateValues(profile: ProfileNameResolutionRecord): Array<{
  field: 'slug' | 'name' | 'alias';
  value: string;
}> {
  const values: Array<{ field: 'slug' | 'name' | 'alias'; value: string }> = [
    { field: 'slug', value: normalizeProfileLookupKey(profile.slug) },
    { field: 'name', value: normalizeProfileLookupKey(profile.name) },
  ];

  for (const alias of profile.aliases ?? []) {
    const normalizedAlias = normalizeProfileLookupKey(alias);
    if (normalizedAlias) {
      values.push({ field: 'alias', value: normalizedAlias });
    }
  }

  return values;
}

function normalizeExactSlugQuery(value: string): string {
  const trimmed = normalizeText(value).toLowerCase();
  if (!trimmed || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function formatAmbiguousMatchMessage(
  query: string,
  profiles: ProfileNameResolutionRecord[],
  reason: string,
): string {
  const labels = profiles.map((profile) => `"${profile.name}" (${profile.slug})`).join(', ');
  return `Profile name "${query}" is ambiguous by ${reason}. Matches: ${labels}.`;
}

function rankNormalizedCandidate(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0;
  }
  if (query === candidate) {
    return 1_200 + query.length;
  }
  if (candidate.startsWith(query)) {
    return 900 + query.length;
  }
  if (candidate.includes(query)) {
    return 700 + query.length;
  }

  const queryTokens = query.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }

  let matchedTokens = 0;
  let matchedChars = 0;
  for (const queryToken of queryTokens) {
    const matchedCandidateToken = candidateTokens.find((candidateToken) => (
      candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)
    ));
    if (matchedCandidateToken) {
      matchedTokens += 1;
      matchedChars += Math.min(queryToken.length, matchedCandidateToken.length);
    }
  }

  if (matchedTokens === queryTokens.length) {
    return 550 + (matchedChars * 10);
  }
  if (matchedTokens > 0) {
    return 350 + (matchedTokens * 40) + matchedChars;
  }
  return 0;
}

function sortScoredCandidates<TProfile extends ProfileNameResolutionRecord>(
  scores: ProfileNameCandidateScore<TProfile>[],
): ProfileNameCandidateScore<TProfile>[] {
  return [...scores].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.profile.slug !== right.profile.slug) {
      return left.profile.slug.localeCompare(right.profile.slug);
    }
    return left.profile.name.localeCompare(right.profile.name);
  });
}

export function normalizeProfileLookupKey(value: unknown): string {
  const normalized = normalizeAsciiBase(normalizeText(value));
  return sanitizeForLookup(collapseSeparators(normalized, ' '));
}

export function generateProfileSlug(value: unknown): string {
  const raw = normalizeText(value);
  const normalized = normalizeAsciiBase(raw);
  const slug = sanitizeForSlug(collapseSeparators(normalized, '-'));
  if (slug) {
    return slug;
  }
  return `mb-${buildStableShortHash(raw || normalized || 'metabot-profile')}`;
}

export function buildProfileAliases(
  name: unknown,
  slug?: unknown,
  existingAliases: unknown[] = [],
): string[] {
  const normalizedName = normalizeText(name);
  const resolvedSlug = normalizeText(slug) || generateProfileSlug(normalizedName);
  const normalizedLookupKey = normalizeProfileLookupKey(normalizedName);
  const aliases: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [normalizedName, ...existingAliases.map((entry) => normalizeText(entry)), normalizedLookupKey, resolvedSlug]) {
    const alias = normalizeText(candidate);
    if (!alias || seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    aliases.push(alias);
  }

  return aliases;
}

export function scoreProfileNameCandidate<TProfile extends ProfileNameResolutionRecord>(
  query: unknown,
  profile: TProfile,
): ProfileNameCandidateScore<TProfile> {
  const normalizedQuery = normalizeProfileLookupKey(query);
  let best: ProfileNameCandidateScore<TProfile> = {
    profile,
    score: 0,
    matchedField: 'name',
    matchedValue: '',
  };

  for (const candidate of normalizeCandidateValues(profile)) {
    const score = rankNormalizedCandidate(normalizedQuery, candidate.value);
    if (
      score > best.score
      || (score === best.score && best.matchedValue && candidate.value < best.matchedValue)
      || (score === best.score && !best.matchedValue)
    ) {
      best = {
        profile,
        score,
        matchedField: candidate.field,
        matchedValue: candidate.value,
      };
    }
  }

  return best;
}

export function detectAmbiguousProfileNameMatch<TProfile extends ProfileNameResolutionRecord>(
  scores: ProfileNameCandidateScore<TProfile>[],
): boolean {
  const ranked = sortScoredCandidates(scores);
  if (ranked.length < 2) {
    return false;
  }
  const [top, second] = ranked;
  return top.score >= RANKED_MATCH_MIN_SCORE && second.score >= (top.score - AMBIGUITY_SCORE_DELTA);
}

export function resolveProfileNameMatch<TProfile extends ProfileNameResolutionRecord>(
  query: unknown,
  profiles: TProfile[],
): ProfileNameResolutionResult<TProfile> {
  const rawQuery = normalizeText(query);
  const normalizedQuery = normalizeProfileLookupKey(rawQuery);
  if (!normalizedQuery) {
    return {
      status: 'not_found',
      message: 'A profile name is required.',
    };
  }

  const exactSlugQuery = normalizeExactSlugQuery(rawQuery);
  if (exactSlugQuery) {
    const exactSlugMatches = profiles.filter((profile) => profile.slug === exactSlugQuery);
    if (exactSlugMatches.length === 1) {
      return {
        status: 'matched',
        match: exactSlugMatches[0],
        matchType: 'exact_slug',
        score: 2_000,
      };
    }
    if (exactSlugMatches.length > 1) {
      return {
        status: 'ambiguous',
        message: formatAmbiguousMatchMessage(rawQuery, exactSlugMatches, 'exact slug'),
        candidates: sortScoredCandidates(exactSlugMatches.map((profile) => ({
          profile,
          score: 2_000,
          matchedField: 'slug' as const,
          matchedValue: profile.slug,
        }))).map((entry) => entry.profile),
      };
    }
  }

  const exactNameMatches = profiles.filter((profile) => normalizeProfileLookupKey(profile.name) === normalizedQuery);
  if (exactNameMatches.length === 1) {
    return {
      status: 'matched',
      match: exactNameMatches[0],
      matchType: 'exact_name',
      score: 1_800,
    };
  }
  if (exactNameMatches.length > 1) {
    return {
      status: 'ambiguous',
      message: formatAmbiguousMatchMessage(rawQuery, exactNameMatches, 'display name'),
      candidates: sortScoredCandidates(exactNameMatches.map((profile) => ({
        profile,
        score: 1_800,
        matchedField: 'name' as const,
        matchedValue: normalizeProfileLookupKey(profile.name),
      }))).map((entry) => entry.profile),
    };
  }

  const exactAliasMatches = profiles.filter((profile) => (
    (profile.aliases ?? []).some((alias) => normalizeProfileLookupKey(alias) === normalizedQuery)
  ));
  if (exactAliasMatches.length === 1) {
    return {
      status: 'matched',
      match: exactAliasMatches[0],
      matchType: 'exact_alias',
      score: 1_600,
    };
  }
  if (exactAliasMatches.length > 1) {
    return {
      status: 'ambiguous',
      message: formatAmbiguousMatchMessage(rawQuery, exactAliasMatches, 'alias'),
      candidates: sortScoredCandidates(exactAliasMatches.map((profile) => ({
        profile,
        score: 1_600,
        matchedField: 'alias' as const,
        matchedValue: normalizedQuery,
      }))).map((entry) => entry.profile),
    };
  }

  const rankedScores = sortScoredCandidates(
    profiles
      .map((profile) => scoreProfileNameCandidate(rawQuery, profile))
      .filter((entry) => entry.score > 0),
  );

  if (!rankedScores.length || rankedScores[0].score < RANKED_MATCH_MIN_SCORE) {
    return {
      status: 'not_found',
      message: `No local MetaBot profile matching "${rawQuery}" was found.`,
    };
  }

  if (detectAmbiguousProfileNameMatch(rankedScores)) {
    const topScore = rankedScores[0].score;
    const ambiguousProfiles = rankedScores
      .filter((entry) => entry.score >= (topScore - AMBIGUITY_SCORE_DELTA))
      .map((entry) => entry.profile);
    return {
      status: 'ambiguous',
      message: formatAmbiguousMatchMessage(rawQuery, ambiguousProfiles, 'ranked search'),
      candidates: ambiguousProfiles,
    };
  }

  return {
    status: 'matched',
    match: rankedScores[0].profile,
    matchType: 'ranked',
    score: rankedScores[0].score,
  };
}
