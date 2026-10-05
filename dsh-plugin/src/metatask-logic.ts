/**
 * MetaTask shared display logic (P5/P6) — a direct TypeScript port of the
 * IDBots renderer helpers (metaTaskCandidateState.ts + metaTaskArtifact.ts)
 * so the DSH panel and the src/ui page tag candidates the SAME way. Pure
 * functions over the daemon projection contract; the renderer never
 * re-derives replay state.
 */

export interface CandidateLike {
  pinId: string;
  verified: boolean;
  chainValid: boolean;
  superseded: boolean;
  failed: boolean;
  parentrefs: Record<string, string> | null;
  result?: Record<string, unknown> | null;
  attachment?: string | null;
  /** Display-only extras carried by daemon projections (optional in pure logic). */
  submitter?: string;
  atMs?: number;
  passVotes?: number;
  failVotes?: number;
}

export interface NodeLike {
  id: string;
  status: string;
  submission?: { pinId: string } | null;
  submissions?: CandidateLike[];
}

/** Candidate display states (the §4.1 mapping — pure display over engine flags). */
export type CandState =
  | 'winner'
  | 'leading'
  | 'behind'
  | 'inReview'
  | 'awaitingDeps'
  | 'optimistic'
  | 'replaced'
  | 'rejected'
  | 'stalled';

export const candidateState = (
  node: NodeLike,
  cand: CandidateLike,
  byPin: Map<string, CandidateLike>,
  winningSet: Set<string> | null,
): CandState => {
  if (cand.failed) return 'rejected';
  if (cand.superseded) return 'replaced';
  if (winningSet?.has(cand.pinId)) return 'winner';
  const refs = cand.parentrefs ?? {};
  const refPins = Object.values(refs);
  if (refPins.some((pin) => {
    const parent = byPin.get(pin);
    return parent !== undefined && (parent.failed || parent.superseded);
  })) {
    return 'stalled';
  }
  if (cand.verified && cand.chainValid) {
    return node.submission?.pinId === cand.pinId ? 'leading' : 'behind';
  }
  if (cand.verified) return 'awaitingDeps';
  const allParentsChainValid = refPins.every((pin) => byPin.get(pin)?.chainValid === true);
  return allParentsChainValid ? 'inReview' : 'optimistic';
};

/** Candidate lookup across every node of a task. */
export const candidatesByPin = (nodes: NodeLike[]): Map<string, CandidateLike> => {
  const byPin = new Map<string, CandidateLike>();
  for (const node of nodes) {
    for (const cand of node.submissions ?? []) byPin.set(cand.pinId, cand);
  }
  return byPin;
};

export const shortPin = (pinId: string): string =>
  pinId.length > 10 ? `${pinId.slice(0, 5)}…${pinId.slice(-3)}` : pinId;

export const shortMetaId = (metaId: string): string =>
  metaId.length > 14 ? `${metaId.slice(0, 8)}…${metaId.slice(-4)}` : metaId;

// ── race front (§4.2 — display geometry only) ────────────────────────────────

/**
 * The race tip: the UNVERIFIED live candidate maximizing (live ancestor
 * coverage in nodes, then passVotes, then earliest atMs). Returns null when
 * the task is complete (no race line) or no live unverified candidate exists.
 */
export const raceFrontTip = (
  nodes: NodeLike[],
  byPin: Map<string, CandidateLike>,
): CandidateLike | null => {
  const live: CandidateLike[] = [];
  for (const node of nodes) {
    for (const cand of node.submissions ?? []) {
      if (!cand.failed && !cand.superseded && !cand.verified) live.push(cand);
    }
  }
  if (live.length === 0) return null;
  const liveSet = new Set(live.map((cand) => cand.pinId));
  const liveAncestorClosure = (cand: CandidateLike, seen = new Set<string>()): number => {
    let count = 0;
    for (const pin of Object.values(cand.parentrefs ?? {})) {
      if (seen.has(pin) || !liveSet.has(pin)) continue;
      seen.add(pin);
      const parent = byPin.get(pin);
      if (!parent) continue;
      count += 1 + liveAncestorClosure(parent, seen);
    }
    return count;
  };
  let best: CandidateLike | null = null;
  let bestKey = { coverage: -1, passVotes: -1, atMs: Number.POSITIVE_INFINITY };
  for (const cand of live) {
    const race = cand as CandidateLike & { passVotes?: number; atMs?: number };
    const key = {
      coverage: liveAncestorClosure(cand),
      passVotes: race.passVotes ?? 0,
      atMs: race.atMs ?? Number.POSITIVE_INFINITY,
    };
    if (
      key.coverage > bestKey.coverage
      || (key.coverage === bestKey.coverage && key.passVotes > bestKey.passVotes)
      || (key.coverage === bestKey.coverage && key.passVotes === bestKey.passVotes && key.atMs < bestKey.atMs)
    ) {
      best = cand;
      bestKey = key;
    }
  }
  return best;
};

/** The pins on the race path: the tip plus its live ancestors via parentrefs. */
export const raceFrontPath = (
  tip: CandidateLike,
  byPin: Map<string, CandidateLike>,
): Set<string> => {
  const path = new Set<string>();
  const stack = [tip.pinId];
  while (stack.length) {
    const pin = stack.pop() as string;
    if (path.has(pin)) continue;
    const cand = byPin.get(pin);
    if (!cand || cand.failed || cand.superseded) continue;
    path.add(pin);
    for (const parentPin of Object.values(cand.parentrefs ?? {})) stack.push(parentPin);
  }
  return path;
};

// ── artifacts (pure read of the published result payload) ────────────────────

export type ArtifactKind = 'git' | 'metafile' | 'metaapp' | 'other';

export interface CandidateArtifact {
  kind: ArtifactKind;
  resultType: string | null;
  metafileUri: string | null;
  metafileViewUrl: string | null;
  metaAppUri: string | null;
  metaAppId: string | null;
}

const METAWEB_BROWSER_BASE = 'https://openagentinternet.org/browser';

export const pinViewUrl = (pinId: string): string => `${METAWEB_BROWSER_BASE}/pin/${pinId}`;

/** metafile://<pin>[.ext…] → browser view URL (extension chrome drops). */
export const metafileViewUrl = (uri: string): string | null => {
  if (!uri.toLowerCase().startsWith('metafile://')) return null;
  const base = uri.slice('metafile://'.length).trim().split(/[?#]/)[0] || '';
  const pinId = base.split('.')[0] || '';
  return pinId ? `${METAWEB_BROWSER_BASE}/metafile/${pinId}` : null;
};

const normalizeMetafileUri = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith('metafile://')) return trimmed;
  if (/^[0-9a-zA-Z]+(\.[0-9a-zA-Z]+)*$/.test(trimmed)) return `metafile://${trimmed}`;
  return null;
};

const findMetaAppUri = (result: Record<string, unknown> | null): string | null => {
  if (!result) return null;
  for (const value of Object.values(result)) {
    if (typeof value === 'string' && value.trim().toLowerCase().startsWith('metaapp://')) {
      return value.trim();
    }
  }
  return null;
};

export const candidateArtifactOf = (
  cand: Pick<CandidateLike, 'result' | 'attachment'>,
): CandidateArtifact => {
  const result = cand.result ?? null;
  const resultType = typeof result?.type === 'string' ? result.type : null;

  let metafileUri: string | null = null;
  if (resultType === 'metafile') {
    const pin = typeof result?.artifactPin === 'string' ? result.artifactPin : null;
    if (pin) metafileUri = normalizeMetafileUri(pin);
  }
  if (!metafileUri && typeof result?.uri === 'string') {
    metafileUri = normalizeMetafileUri(result.uri);
  }
  if (!metafileUri && typeof cand.attachment === 'string') {
    metafileUri = normalizeMetafileUri(cand.attachment);
  }
  if (!metafileUri && resultType === 'git-bundle' && typeof cand.attachment === 'string') {
    metafileUri = cand.attachment.startsWith('metafile://') ? cand.attachment : null;
  }

  const metaAppUri = findMetaAppUri(result);
  const kind: ArtifactKind = resultType === 'git-bundle'
    ? 'git'
    : resultType === 'metafile' || metafileUri
      ? 'metafile'
      : metaAppUri
        ? 'metaapp'
        : 'other';
  return {
    kind,
    resultType,
    metafileUri,
    metafileViewUrl: metafileUri ? metafileViewUrl(metafileUri) : null,
    metaAppUri,
    metaAppId: metaAppUri ? metaAppUri.slice('metaapp://'.length) : null,
  };
};

// ── misc shared derivations ──────────────────────────────────────────────────

/** Task lifecycle badge (§4.4): settled > completed > inProgress > open. */
export type TaskLifecycle = 'settled' | 'completed' | 'inProgress' | 'open';
export const taskLifecycleOf = (task: {
  settlementFinalized?: boolean;
  taskComplete?: boolean;
  progress?: { verified?: number; claimed?: number; total?: number };
}): TaskLifecycle => {
  if (task.settlementFinalized) return 'settled';
  if (task.taskComplete) return 'completed';
  const progress = task.progress ?? {};
  if ((progress.claimed ?? 0) > 0) return 'inProgress';
  return 'open';
};

export const percentOf = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

// ── tree structure (tree-mode detail: TreeMap + branch node table) ──────────

export interface TreeNodeLike {
  id: string;
  parent: string | null;
  title: string;
  status: string;
  disputed: boolean;
  weight: number | null;
}

/** parent-id → children map (children sorted by natural node id). */
export const treeChildrenOf = (nodes: TreeNodeLike[]): Map<string, TreeNodeLike[]> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, TreeNodeLike[]>();
  for (const node of nodes) {
    if (node.parent && byId.has(node.parent)) {
      const list = childrenOf.get(node.parent) ?? [];
      list.push(node);
      childrenOf.set(node.parent, list);
    }
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  return childrenOf;
};

/** Verified/total across all descendants (the group node itself excluded). */
export const treeSubtreeStats = (
  childrenOf: Map<string, TreeNodeLike[]>,
  id: string,
): { verified: number; total: number } => {
  let verified = 0;
  let total = 0;
  const walk = (nid: string): void => {
    for (const child of childrenOf.get(nid) ?? []) {
      total += 1;
      if (child.status === 'verified') verified += 1;
      walk(child.id);
    }
  };
  walk(id);
  return { verified, total };
};

/** A group worth default-expanding: any descendant in flight or disputed. */
export const treeSubtreeHasAttention = (
  childrenOf: Map<string, TreeNodeLike[]>,
  id: string,
): boolean =>
  (childrenOf.get(id) ?? []).some(
    (child) =>
      child.status === 'claimed' || child.disputed || treeSubtreeHasAttention(childrenOf, child.id),
  );
