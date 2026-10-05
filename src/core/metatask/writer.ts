/**
 * MetaTask writer (M6 — OAC port of the IDBots metataskAgentTools guards).
 *
 * Every check in this file exists to NOT SPEND A PIN on something replay
 * would ignore: a refused write costs 0 sats and returns the exact refusal
 * the IDBots tools return. The guard logic is ported verbatim; the seams
 * (actor identity, event pool, projection reads, pin writes, roster,
 * activation boundary) are injected so the daemon handlers stay thin wiring
 * and the tests drive the guards without a chain.
 *
 * Verb map (IDBots tool → OAC function):
 *   metatask_claim        → claimMetaTaskNode
 *   metatask_submit       → submitMetaTaskWork
 *   metatask_verify       → verifyMetaTaskSubmission
 *   metatask_release      → releaseMetaTaskClaim
 *   metatask_publish      → publishMetaTask
 *   metatask_publish_spec → publishMetaTaskSpec
 *   metatask_amend        → amendMetaTask
 */

import fs from 'node:fs';
import path from 'node:path';
import { innerHash, outerHash } from './engine/canon';
import { rosterPinsFromEvents } from './collector';
import { H_ACT3, METATASK_ROSTER_PATH } from './engine/constants';
import { replayMetaTask } from './engine/engine';
import type {
  MetaTaskChainEvent,
  MetaTaskTaskProjection,
} from './engine/types';

const PIN_VERSION = '1.1.0';

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Spec script reference form (protocol §3): pin:// or metafile://, no spaces. */
const SPEC_REF_RE = /^(pin:\/\/|metafile:\/\/)\S+$/;
/** Obvious "publish me later" tokens that must never reach the chain as a ref. */
const SPEC_PLACEHOLDER_RE = /PUBLISH_ARTIFACT_FIRST|PLACEHOLDER|TODO|FIXME|TBD/i;
/** A single-line URI-looking value must be a protocol reference, not e.g. https://. */
const URI_LOOKING_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
/** The v1.2.1 spec.validation items (protocol §3, mandatory at/after H_ACT2). */
const SPEC_VALIDATION_ITEMS = ['null_tolerance', 'enumeration_closure', 'proposition_fidelity'] as const;

/** Full git commit hash (sha1/sha256 hex) for git-bundle results (draft §4.2). */
const GIT_COMMIT_RE = /^[0-9a-f]{40}$/i;

export interface MetaTaskPinWriteResult {
  pinId: string;
  txids: string[];
  totalCost?: number;
}

/** Everything a verb needs from its host; the daemon supplies the real ones. */
export interface MetaTaskWriteSeams {
  /** The acting bot's globalMetaId (protocol §12 item 6 identity checks). */
  actorGlobalMetaId: string;
  /** globalMetaIds of every local bot (the same-owner roster side). */
  localRosterMetaIds: () => string[];
  /** The cached chain event pool (engine input). */
  loadEvents: () => Promise<MetaTaskChainEvent[]>;
  /** Persisted projection for a task root (null = unknown). */
  getProjection: (rootPinId: string) => Promise<MetaTaskTaskProjection | null>;
  /** H_ACT3 write gate inputs: announced height + local boundary block. */
  activation: () => { hAct3: number | null; boundaryBlock: number | null };
  /** Write one /protocols/metatask/<subpath> pin as the actor. */
  writeProtocolPin: (
    subpath: string,
    payload: Record<string, unknown>,
    origin: string
  ) => Promise<MetaTaskPinWriteResult>;
  /** Write one raw-path pin (the roster reference sibling). */
  writeRawPin: (
    protocolPath: string,
    payload: Record<string, unknown>,
    origin: string
  ) => Promise<MetaTaskPinWriteResult>;
  /** Fire-and-forget projection refresh after a successful write. */
  refreshInBackground: (reason: string) => void;
}

export type MetaTaskWriteOutcome<T> = { ok: true; data: T } | { ok: false; refusal: string };

interface SpecPayloadInput {
  name?: string;
  lang?: string;
  entry?: string;
  script?: string;
  input?: unknown;
  output?: unknown;
  validation?: Record<string, unknown>;
  /** v1.3 draft §4.1 workspace declaration (git/metafile/inline/pin/…). */
  workspace?: unknown;
}

/**
 * The canonical spec pin payload (protocol §3), shared by publish and
 * publish_spec so both writers emit byte-identical field order: name, lang,
 * entry, script, input, output, then validation when present.
 */
export const buildSpecPayload = (spec: SpecPayloadInput): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    name: asString(spec.name).trim(),
    lang: asString(spec.lang).trim() || 'bash',
    entry: asString(spec.entry).trim(),
    script: spec.script === undefined ? '' : spec.script,
    input: spec.input ?? '',
    output: spec.output ?? '',
  };
  if (isPlainObject(spec.workspace)) payload.workspace = spec.workspace;
  if (isPlainObject(spec.validation)) payload.validation = spec.validation;
  return payload;
};

/**
 * Writer-side check for the v1.3 draft §4.1 spec.workspace declaration. The
 * engine never reads `workspace` (except the submit guard's git-bundle
 * enforcement on type:"git"), so a malformed declaration would silently
 * dead-letter the artifact contract — refuse it before any spend.
 */
export const specWorkspaceRefusal = (workspace: unknown): string | null => {
  if (workspace === undefined || workspace === null) return null;
  if (!isPlainObject(workspace)) {
    return 'Refused: spec.workspace must be an object (draft §4.1: { type, baseRef?, baseCommit?, notes? }).';
  }
  const type = asString(workspace.type).trim();
  if (!type) {
    return 'Refused: spec.workspace.type is required when workspace is declared (draft §4.1: git | metafile | inline | pin).';
  }
  const baseRef = workspace.baseRef;
  if (baseRef !== undefined && baseRef !== null) {
    const ref = asString(baseRef).trim();
    if (!ref) return 'Refused: spec.workspace.baseRef is empty — drop the key or pin the base bundle (draft §4.4).';
    if (!SPEC_REF_RE.test(ref)) {
      return `Refused: spec.workspace.baseRef must be a real pin:// | metafile:// reference (draft §4.4) — got "${ref}". Publish the base bundle first and substitute the placeholder.`;
    }
  }
  const baseCommit = workspace.baseCommit;
  if (baseCommit !== undefined && baseCommit !== null && !GIT_COMMIT_RE.test(asString(baseCommit))) {
    return 'Refused: spec.workspace.baseCommit must be a full commit hash (40 hex chars) or null (draft §4.1).';
  }
  return null;
};

/** Refuse a missing/empty/bogus script reference; returns null when usable. */
export const specScriptRefusal = (script: unknown): string | null => {
  const text = typeof script === 'string' ? script.trim() : '';
  if (!text) {
    return 'Refused: a spec pin needs a verifier script — inline text, or a pin:// | metafile:// reference when too long (protocol §3).';
  }
  if (!text.includes('\n') && URI_LOOKING_RE.test(text) && !SPEC_REF_RE.test(text)) {
    return `Refused: the script looks like a URI reference but is not pin:// or metafile:// ("${text}") — protocol §3 allows inline text or a pin:// | metafile:// reference.`;
  }
  return null;
};

/**
 * True when an integer number appears ANYWHERE inside the value. The protocol
 * requires enumeration_closure to carry "at least one concrete self-check
 * vector whose expected count is an INTEGER field" without prescribing where
 * that field lives, so the campaign drafts nest it (e.g.
 * `selfcheck: { expected_count: 4 }`) and an array of vectors is equally valid.
 */
const hasIntegerAtAnyDepth = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'number') return Number.isInteger(value);
  if (depth > 8 || !value || typeof value !== 'object') return false;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.some((child) => hasIntegerAtAnyDepth(child, depth + 1));
};

// ── campaign drafts file mode ────────────────────────────────────────────────
// The launch kit ships one machine-validated drafts JSON (specs{} + tasks[]).
// Reading it directly removes the LLM transcription risk of re-typing a large
// nested spec/validation argument by hand.

/** Node specid placeholders the drafts carry until their spec pins exist. */
const SPEC_PIN_PREFIX = 'SPEC_PIN:';

interface DraftsPublishInput {
  taskId: string;
  title: string;
  brief: string;
  nodes: Array<Record<string, unknown>>;
  policy: Record<string, unknown>;
  tags: unknown;
  spec: SpecPayloadInput;
}

const readDraftsFile = (draftsFile: string): Record<string, unknown> | string => {
  if (!path.isAbsolute(draftsFile)) {
    return `Refused: draftsFile must be an absolute path (got "${draftsFile}").`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(draftsFile, 'utf8'));
  } catch (error) {
    return `Refused: cannot read draftsFile "${draftsFile}" — ${error instanceof Error ? error.message : String(error)}.`;
  }
  if (!isPlainObject(parsed)) {
    return `Refused: draftsFile "${draftsFile}" must contain a JSON object.`;
  }
  return parsed;
};

const specFromDrafts = (drafts: Record<string, unknown>, specKey: string): SpecPayloadInput | string => {
  const specs = drafts.specs;
  if (!isPlainObject(specs)) {
    return 'Refused: draftsFile has no specs{} object (expected the campaign drafts shape).';
  }
  const raw = specs[specKey];
  if (!isPlainObject(raw)) {
    const available = Object.keys(specs).sort().join(', ');
    return `Refused: specs["${specKey}"] not found in the draftsFile (available: ${available || 'none'}).`;
  }
  return {
    name: asString(raw.name),
    lang: asString(raw.lang),
    entry: asString(raw.entry),
    script: typeof raw.script === 'string' ? raw.script : '',
    input: raw.input,
    output: raw.output,
    validation: isPlainObject(raw.validation) ? raw.validation : undefined,
    workspace: isPlainObject(raw.workspace) ? raw.workspace : undefined,
  };
};

/**
 * Replace `SPEC_PIN:<key>` node specid placeholders with the published pins
 * from `specPinByKey`; the returned string is a refusal listing EVERY unmapped
 * placeholder so the caller can publish those specs first. Nodes with a null
 * specid stay null (they inherit the task root spec).
 */
const substituteSpecPins = (nodes: unknown[], specPinByKey: Record<string, string>): unknown[] | string => {
  const unmapped = new Set<string>();
  const substituted = nodes.map((node) => {
    if (!isPlainObject(node)) return node;
    const specid = typeof node.specid === 'string' ? node.specid.trim() : '';
    if (!specid.startsWith(SPEC_PIN_PREFIX)) return node;
    const key = specid.slice(SPEC_PIN_PREFIX.length).trim();
    const pinId = asString(specPinByKey?.[key]).trim();
    if (!key || !pinId) {
      unmapped.add(key || specid);
      return node;
    }
    return { ...node, specid: pinId };
  });
  if (unmapped.size > 0) {
    const named = [...unmapped].sort().map((key) => `${SPEC_PIN_PREFIX}${key}`).join(', ');
    return `Refused: unmapped node specid placeholder(s) ${named} — publish each standalone spec first with metatask publish-spec and pass its specPinId in specPinByKey.`;
  }
  return substituted;
};

/** One `tasks[]` entry (its ready `publish` object plus the root spec). */
const taskFromDrafts = (
  drafts: Record<string, unknown>,
  taskId: string,
  specPinByKey: Record<string, string>
): DraftsPublishInput | string => {
  const tasks = Array.isArray(drafts.tasks) ? drafts.tasks : [];
  if (tasks.length === 0) {
    return 'Refused: draftsFile has no tasks[] array (expected the campaign drafts shape).';
  }
  const entry = tasks.find(
    (candidate) =>
      isPlainObject(candidate) && (asString(candidate.id) === taskId || asString(candidate.taskId) === taskId)
  );
  if (!isPlainObject(entry)) {
    const available = tasks
      .map((candidate) => (isPlainObject(candidate) ? asString(candidate.id) || asString(candidate.taskId) : ''))
      .filter(Boolean)
      .sort()
      .join(', ');
    return `Refused: no tasks[] entry with id "${taskId}" (available: ${available || 'none'}).`;
  }
  const publish = entry.publish;
  if (!isPlainObject(publish)) {
    return `Refused: tasks[] entry "${taskId}" has no publish object.`;
  }
  if (!Array.isArray(publish.nodes)) {
    return `Refused: tasks[] entry "${taskId}" publish.nodes must be an array.`;
  }
  const rootSpecKey = asString(entry.rootSpec).trim();
  if (!rootSpecKey) {
    return `Refused: tasks[] entry "${taskId}" has no rootSpec key for its root verifier spec.`;
  }
  const spec = specFromDrafts(drafts, rootSpecKey);
  if (typeof spec === 'string') return spec;
  const nodes = substituteSpecPins(publish.nodes, specPinByKey);
  if (typeof nodes === 'string') return nodes;
  return {
    taskId,
    title: asString(publish.title),
    brief: asString(publish.brief),
    nodes: nodes.filter(isPlainObject) as Array<Record<string, unknown>>,
    policy: isPlainObject(publish.policy) ? publish.policy : {},
    tags: publish.tags,
    spec,
  };
};

/**
 * Writer-side enforcement of the v1.2.1 spec.validation block (protocol §3,
 * mandatory for specs published at/after H_ACT2): all three items present,
 * null_tolerance boolean true, enumeration_closure declaring the closure plus
 * an integer self-check count, and proposition_fidelity pointing at a REAL
 * independent correspondence artifact. Returns a refusal message or null.
 */
export const specValidationRefusal = (validation: unknown): string | null => {
  if (!isPlainObject(validation)) {
    return `Refused: spec.validation is required (protocol §3, mandatory at/after H_ACT2) — a block carrying all three items: ${SPEC_VALIDATION_ITEMS.join(', ')}.`;
  }
  const missing = SPEC_VALIDATION_ITEMS.filter((item) => !(item in validation));
  if (missing.length > 0) {
    return `Refused: spec.validation is missing ${missing.join(', ')} — protocol §3 requires all three items (null/missing input -> verdict=invalid; the enumeration closure with an integer self-check count; proposition fidelity against an INDEPENDENT correspondence artifact).`;
  }
  if (validation.null_tolerance !== true) {
    return 'Refused: spec.validation.null_tolerance must be boolean true (protocol §3: every branch maps null/missing input to verdict=invalid with a location in detail).';
  }
  const closure = validation.enumeration_closure;
  if (!isPlainObject(closure) || !asString(closure.closure).trim() || !hasIntegerAtAnyDepth(closure)) {
    return 'Refused: spec.validation.enumeration_closure needs the closure declared in a string `closure` field AND at least one integer self-check count (any depth within the block), so replay can mechanically reconcile theory vs implementation (protocol §3).';
  }
  const fidelity = validation.proposition_fidelity;
  if (!isPlainObject(fidelity)) {
    return 'Refused: spec.validation.proposition_fidelity must be an object referencing an INDEPENDENT correspondence artifact (protocol §3).';
  }
  const booleanItem = Object.entries(fidelity).find(([, value]) => typeof value === 'boolean');
  if (booleanItem) {
    return `Refused: spec.validation.proposition_fidelity.${booleanItem[0]} is a self-attested boolean — protocol §3 makes that NON-compliant; the artifact pin itself must carry the per-item table (statement / definitions / proof direction).`;
  }
  const reference =
    typeof fidelity.correspondence === 'string'
      ? fidelity.correspondence
      : typeof fidelity.artifactPin === 'string'
        ? fidelity.artifactPin
        : typeof fidelity.artifact === 'string'
          ? fidelity.artifact
          : '';
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return 'Refused: spec.validation.proposition_fidelity needs the correspondence artifact referenced as pin:// | metafile:// (field `correspondence`, or `artifactPin` for the campaign shape) — a self-declared flag is non-compliant.';
  }
  if (SPEC_PLACEHOLDER_RE.test(trimmedReference)) {
    return `Refused: proposition_fidelity still carries the placeholder "${trimmedReference}" — publish the correspondence artifact pin FIRST, then substitute its pinId.`;
  }
  if (!SPEC_REF_RE.test(trimmedReference)) {
    return `Refused: proposition_fidelity must reference a REAL correspondence artifact (pin:// | metafile://) — got "${trimmedReference}".`;
  }
  return null;
};

// ── competitive mode (protocol v1.3.0 draft §3/§4) ───────────────────────────
// Writer-side mirrors of the engine's competitive invariants. Every check runs
// BEFORE the first pin is spent.

interface CompetitiveNodeShape {
  id: string;
  deps: string[];
  params: Record<string, unknown>;
}

/** deps-DAG sinks: nodes no other node lists in `deps` (draft §3.1). */
const depsSinkIds = (nodes: readonly CompetitiveNodeShape[]): string[] => {
  const referenced = new Set<string>();
  for (const node of nodes) for (const dep of node.deps) referenced.add(dep);
  return nodes.filter((node) => !referenced.has(node.id)).map((node) => node.id);
};

/** DFS over deps edges (node -> what it depends on); dangling refs are ruled separately. */
const depsGraphAcyclic = (nodes: readonly CompetitiveNodeShape[]): boolean => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const state = new Map<string, 1 | 2>(); // 1 = on the DFS stack, 2 = done
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === 2) return true;
    if (mark === 1) return false;
    state.set(id, 1);
    for (const dep of byId.get(id)?.deps ?? []) {
      if (!byId.has(dep)) continue;
      if (!visit(dep)) return false;
    }
    state.set(id, 2);
    return true;
  };
  for (const node of nodes) {
    if (!visit(node.id)) return false;
  }
  return true;
};

/**
 * Writer-side competitive tree invariants (draft §3.1/§3.3, authoring list §5):
 * `finalnode` names a live node; the deps graph is acyclic with exactly ONE
 * sink and that sink IS the final node; every node is reachable from an entry
 * node (deps: []) and can reach the final node.
 */
export const competitiveGraphRefusal = (
  nodes: readonly CompetitiveNodeShape[],
  finalnode: string
): string | null => {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  if (!byId.has(finalnode)) {
    return `Refused: policy.finalnode "${finalnode}" is not a node of this task — competitive mode requires the designated terminal node to be a live tree node (draft §3.1).`;
  }
  if (!depsGraphAcyclic(nodes)) {
    return 'Refused: the deps graph is cyclic — competitive mode enforces deps as a partial-order DAG (draft §3.3).';
  }
  const sinks = depsSinkIds(nodes);
  if (sinks.length !== 1) {
    return `Refused: competitive mode requires exactly ONE deps sink (draft §3.1) — found ${sinks.length} (${[...sinks].sort().join(', ')}).`;
  }
  if (sinks[0] !== finalnode) {
    return `Refused: the unique deps sink is "${sinks[0]}" but policy.finalnode is "${finalnode}" — the designated terminal node must BE the sink (draft §3.1).`;
  }
  // Reverse adjacency: dep -> the nodes that depend on it (work-flow direction).
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.deps) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }
  const flowClosure = (starts: string[]): Set<string> => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const current = queue.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of dependents.get(current) ?? []) queue.push(next);
    }
    return seen;
  };
  const fromEntries = flowClosure(nodes.filter((node) => node.deps.length === 0).map((node) => node.id));
  for (const node of nodes) {
    if (!fromEntries.has(node.id)) {
      return `Refused: node ${node.id} is not reachable from any entry node (deps: []) — every node must sit on the work flow (draft §3.3).`;
    }
  }
  // "Can reach the final node" = sits inside finalnode's transitive deps
  // closure (walk deps edges backward from the terminal node).
  const toFinal = new Set<string>();
  const stack = [finalnode];
  while (stack.length) {
    const current = stack.pop() as string;
    if (toFinal.has(current)) continue;
    toFinal.add(current);
    for (const dep of byId.get(current)?.deps ?? []) stack.push(dep);
  }
  for (const node of nodes) {
    if (!toFinal.has(node.id)) {
      return `Refused: node ${node.id} can never feed the terminal node "${finalnode}" — every node must reach the final node through deps (draft §3.3).`;
    }
  }
  return null;
};

/**
 * Every competitive node carries a non-empty rubric (draft §3.3, pinned
 * location: `params.rubric` — an array of strings with at least one non-empty
 * entry).
 */
export const competitiveRubricRefusal = (node: { id: string; params: Record<string, unknown> }): string | null => {
  const rubric = node.params?.rubric;
  if (!Array.isArray(rubric)) {
    return `Refused: node ${node.id} has no rubric — competitive mode pins per-node acceptance criteria at params.rubric, an array of strings with at least one non-empty entry (draft §3.3).`;
  }
  const entries = rubric.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (entries.length === 0) {
    return `Refused: node ${node.id} rubric has no non-empty entry — params.rubric needs at least one concrete acceptance criterion (draft §3.3).`;
  }
  return null;
};

// ── verb implementations ─────────────────────────────────────────────────────

/**
 * Replay guard: the task must replay and the node must exist before any
 * spend. Status gating is the caller's job — it differs by mode (tree: the
 * node must be open; competitive: claims are intent-only and never gated).
 */
const guardKnownNode = (
  events: MetaTaskChainEvent[],
  rootPinId: string,
  node: string
): { ok: true; projection: MetaTaskTaskProjection } | { ok: false; reason: string } => {
  let projection: MetaTaskTaskProjection;
  try {
    projection = replayMetaTask(events, {
      rootPinId,
      now: Date.now(),
      rosterPins: rosterPinsFromEvents(events),
    });
  } catch (error) {
    return { ok: false, reason: `replay failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const nodeState = projection.nodeStates[node];
  if (!nodeState) return { ok: false, reason: `node "${node}" not found in task ${rootPinId}` };
  return { ok: true, projection };
};

/** Detail via a fresh replay when the persisted projection is missing. */
const projectionAfterRefresh = async (
  seams: MetaTaskWriteSeams,
  rootPinId: string
): Promise<MetaTaskTaskProjection | null> => {
  let detail = await seams.getProjection(rootPinId);
  if (!detail) {
    const events = await seams.loadEvents();
    try {
      detail = replayMetaTask(events, {
        rootPinId,
        now: Date.now(),
        rosterPins: rosterPinsFromEvents(events),
      });
    } catch {
      return null;
    }
  }
  return detail;
};

/**
 * H_ACT3 write-side gate (draft §7): competitive tasks must not be broadcast
 * before the announced activation height. allowPreActivation is the explicit
 * pilot/testing escape hatch — replay has no height gate, so an overridden
 * publish replays fine; the refusal only protects the activation procedure.
 */
const hAct3GateRefusal = (seams: MetaTaskWriteSeams, allowPreActivation: boolean): string | null => {
  if (allowPreActivation) return null;
  const { hAct3, boundaryBlock } = seams.activation();
  if (hAct3 === null || hAct3 === undefined) {
    return 'Refused: competitive mode is gated on H_ACT3, which has not been announced yet (draft §7 — activation lands only after the three-engine conformance set is green). For pilot/testing publishes pass allowPreActivation: true.';
  }
  if (typeof boundaryBlock !== 'number' || boundaryBlock < 0) {
    return `Refused: competitive mode activates at H_ACT3=${hAct3}, but the local chain boundary block is unknown (no refresh state yet) — run metatask list --refresh first, or pass allowPreActivation: true for pilot/testing.`;
  }
  if (boundaryBlock < hAct3) {
    return `Refused: competitive mode activates at H_ACT3=${hAct3}; the local boundary block is ${boundaryBlock}. Pre-activation competitive tasks must not be broadcast (draft §7); for pilot/testing publishes pass allowPreActivation: true.`;
  }
  return null;
};

// ── claim ────────────────────────────────────────────────────────────────────

export interface ClaimInput {
  rootPinId: string;
  node: string;
}

export async function claimMetaTaskNode(
  seams: MetaTaskWriteSeams,
  args: ClaimInput
): Promise<MetaTaskWriteOutcome<{
  claimPinId: string;
  txids: string[];
  node: string;
  taskid: string;
  intentOnly?: boolean;
  note: string;
}>> {
  const rootPinId = asString(args.rootPinId).trim();
  const node = asString(args.node).trim();
  const guard = guardKnownNode(await seams.loadEvents(), rootPinId, node);
  if (guard.ok === false) return { ok: false, refusal: guard.reason };
  const competitive = guard.projection.policy.mode === 'competitive';
  const nodeState = guard.projection.nodeStates[node];
  if (!competitive && nodeState?.status !== 'open') {
    return { ok: false, refusal: `claim-rejected:${node}:${nodeState?.status ?? 'unknown'}` };
  }
  if (guard.projection.publisher === seams.actorGlobalMetaId) {
    return {
      ok: false,
      refusal:
        'Refused: protocol §12 item 6 (submitter != task root author) — you published this MetaTask, so claiming its nodes would be a self-claim; publisher work does not earn a submitter share. Let another bot claim it.',
    };
  }
  const result = await seams.writeProtocolPin('claim', { taskid: rootPinId, node }, 'metatask:claim');
  seams.refreshInBackground('metatask:claim');
  return {
    ok: true,
    data: {
      claimPinId: result.pinId,
      txids: result.txids,
      node,
      taskid: rootPinId,
      ...(competitive ? { intentOnly: true } : {}),
      note: competitive
        ? 'competitive mode: this claim is an INTENT SIGNAL only (draft §3.2) — it takes no lock, expires nothing, and submit does not reference it. Other bots may submit on the same node; the first fully-verified chain wins.'
        : 'keep the claimPinId — your submission must reference it. Chain indexing lags; the guard result reflects the boundary block.',
    },
  };
}

// ── submit ───────────────────────────────────────────────────────────────────

export interface SubmitInput {
  rootPinId: string;
  node: string;
  result?: Record<string, unknown>;
  contentType?: string;
  attachment?: string;
  claimPinId?: string;
  childIds?: string[];
  parentRefs?: Record<string, string>;
  supersedePinId?: string;
}

export async function submitMetaTaskWork(
  seams: MetaTaskWriteSeams,
  args: SubmitInput
): Promise<MetaTaskWriteOutcome<{
  submissionPinId: string;
  txids: string[];
  innerHash: string;
  outerHash: string;
  mode?: 'competitive';
  parentrefs?: Record<string, string> | null;
  optimistic?: boolean;
  optimisticParents?: { parent: string; pinId: string; state: string }[];
  claimPinIdIgnored?: boolean;
  note: string;
}>> {
  const rootPinId = asString(args.rootPinId).trim();
  const node = asString(args.node).trim();
  const detail = await projectionAfterRefresh(seams, rootPinId);
  if (!detail) return { ok: false, refusal: `MetaTask root not found: ${rootPinId}` };
  const nodeState = detail.nodeStates[node];
  if (!nodeState) return { ok: false, refusal: `Node "${node}" not found.` };
  const competitive = detail.policy.mode === 'competitive';
  // One event-pool snapshot for every check in this call (parentRefs
  // existence, spec workspace, fresh replay) — never mix snapshots.
  const allEvents = await seams.loadEvents();
  const childIds = (args.childIds ?? []).map((id) => String(id));
  let claimPinId = '';
  let parentrefs: Record<string, string> | null = null;
  let optimisticParents: { parent: string; pinId: string; state: string }[] = [];
  let claimPinIdIgnored = false;
  let effectiveProjection = detail;
  if (!competitive) {
    // ── tree mode (v1.2.1 semantics, unchanged) ──
    claimPinId = asString(args.claimPinId).trim();
    if (!nodeState.holder || nodeState.holder.pinId !== claimPinId) {
      return {
        ok: false,
        refusal: `claim-rejected:${node}:${nodeState.status} — the effective claim is ${nodeState.holder?.pinId ?? 'none'} (yours: ${claimPinId}).`,
      };
    }
    if (nodeState.holder.claimant !== seams.actorGlobalMetaId) {
      return { ok: false, refusal: 'That claim belongs to a different bot.' };
    }
    if (detail.nodes.length > 0) {
      const treeNode = detail.nodes.find((candidate) => candidate.id === node);
      const isAggregate = treeNode?.kind === 'aggregate';
      if (isAggregate && childIds.length === 0) {
        return { ok: false, refusal: 'Aggregate nodes require childIds (all children verified).' };
      }
      if (!isAggregate && childIds.length > 0) {
        return { ok: false, refusal: 'Leaf nodes must not carry childIds.' };
      }
    }
  } else {
    // ── competitive mode (v1.3 draft §3.3) ──
    if (detail.publisher === seams.actorGlobalMetaId) {
      return {
        ok: false,
        refusal:
          'Refused: protocol §12 item 6 (submitter != task root author) — you published this MetaTask, so its submissions must come from other bots (publisher work earns no submitter share).',
      };
    }
    if (childIds.length > 0) {
      return {
        ok: false,
        refusal: 'Refused: childIds are the tree-mode aggregation rule — competitive mode enforces deps via parentRefs instead (draft §3.10).',
      };
    }
    claimPinIdIgnored = Boolean(asString(args.claimPinId).trim());
    // Fresh replay over the current event pool, so the parentRefs existence
    // check and the optimistic evaluation read the SAME event set the engine
    // would (a persisted projection could lag the pool).
    const guard = guardKnownNode(allEvents, rootPinId, node);
    if (guard.ok === false) return { ok: false, refusal: guard.reason };
    effectiveProjection = guard.projection;
    const treeNode = guard.projection.nodes.find((candidate) => candidate.id === node);
    const deps = (Array.isArray(treeNode?.deps) ? treeNode?.deps : [])?.map((dep) => String(dep)) ?? [];
    const rawRefs = isPlainObject(args.parentRefs) ? args.parentRefs : null;
    const refs: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawRefs ?? {})) refs[key] = asString(value).trim();
    if (deps.length === 0) {
      if (Object.keys(refs).length > 0) {
        return {
          ok: false,
          refusal: `Refused: node ${node} is an entry node (deps: []) — parentRefs must be omitted (an empty object counts as omitted; any key replays as invalid_reference, draft §3.3).`,
        };
      }
    } else {
      const missing = deps.filter((dep) => !refs[dep]);
      const extra = Object.keys(refs).filter((key) => !deps.includes(key));
      if (missing.length > 0 || extra.length > 0) {
        return {
          ok: false,
          refusal: `Refused: parentRefs must name exactly one submission pin per dep of node ${node} (${deps.join(', ')}) — ${[
            missing.length ? `missing: ${missing.join(', ')}` : '',
            extra.length ? `extra: ${extra.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; ')}. Anything else replays as invalid_reference (draft §3.3).`,
        };
      }
      // Engine parity: each referenced pin must be an EXISTING submission of
      // THIS task sitting on THAT dep node — the same check that makes a bad
      // reference invalid_reference on-chain.
      const taskSubmissions = allEvents.filter(
        (event) => event.path === 'submission' && asString(event.body.taskid) === rootPinId
      );
      for (const dep of deps) {
        const ref = refs[dep];
        if (!ref) {
          return { ok: false, refusal: `Refused: parentRefs.${dep} is empty — one submission pinId per dep (draft §3.3).` };
        }
        const target = taskSubmissions.find((event) => event.pinId === ref);
        if (!target) {
          return {
            ok: false,
            refusal: `Refused: parentRefs.${dep} = ${ref} is not a submission of this task in the local event pool — it would replay as invalid_reference (draft §3.3). If the parent was just published, refresh first (metatask list --refresh).`,
          };
        }
        const targetNode = asString(target.body.node);
        if (targetNode !== dep) {
          return {
            ok: false,
            refusal: `Refused: parentRefs.${dep} = ${ref} sits on node "${targetNode}", not on dep node "${dep}" — it would replay as invalid_reference (draft §3.3).`,
          };
        }
      }
      parentrefs = Object.fromEntries(deps.map((dep) => [dep, refs[dep]]));
      // Optimistic pipelining (draft §3.3): a parent need not be verified YET —
      // allowed, but flagged. A DEAD parent can never become chain-valid, so
      // building on it is guaranteed-wasted gas: refused.
      const doomed: string[] = [];
      optimisticParents = [];
      for (const dep of deps) {
        const ref = (parentrefs as Record<string, string>)[dep];
        const candidate = (guard.projection.nodeStates[dep]?.submissions ?? []).find(
          (entry) => entry.pinId === ref
        );
        if (!candidate) {
          doomed.push(`${dep}:${ref} (itself invalid_reference at replay)`);
        } else if (candidate.failed) {
          doomed.push(`${dep}:${ref} (killed by a counted fail verdict)`);
        } else if (candidate.superseded) {
          doomed.push(`${dep}:${ref} (superseded by its author)`);
        } else if (!candidate.verified) {
          optimisticParents.push({ parent: dep, pinId: ref, state: 'unverified' });
        } else if (!candidate.chainValid) {
          optimisticParents.push({ parent: dep, pinId: ref, state: 'verified_but_ancestor_chain_unverified' });
        }
      }
      if (doomed.length > 0) {
        return {
          ok: false,
          refusal: `Refused: referenced parent submission(s) can never become chain-valid — ${doomed.join('; ')}. Resubmit against a live parent (draft §3.4).`,
        };
      }
    }
  }
  // Artifact enforcement (draft §4.2): when the node's EFFECTIVE spec (per-node
  // specid override, else the task root spec) declares workspace.type "git",
  // the submission must be a verifiable git bundle.
  const taskPin = allEvents.find((event) => event.path === 'task' && event.pinId === rootPinId);
  const effectiveSpecid =
    effectiveProjection.nodeStates[node]?.specid ?? asString(taskPin?.body?.specid ?? '');
  const specPin = effectiveSpecid
    ? allEvents.find((event) => event.path === 'spec' && event.pinId === effectiveSpecid)
    : undefined;
  const workspace = specPin?.body?.workspace;
  if (isPlainObject(workspace) && workspace.type === 'git') {
    const resultObject = args.result ?? {};
    if (resultObject.type !== 'git-bundle') {
      return {
        ok: false,
        refusal: `Refused: node ${node} runs in a git workspace (draft §4.2) — result.type must be "git-bundle" (got ${asString(resultObject.type) || 'missing'}).`,
      };
    }
    if (!GIT_COMMIT_RE.test(asString(resultObject.commit))) {
      return { ok: false, refusal: 'Refused: git-bundle result.commit must be the full commit hash (40 hex chars).' };
    }
    const baseCommit = resultObject.baseCommit;
    if (!(baseCommit === null || GIT_COMMIT_RE.test(asString(baseCommit)))) {
      return { ok: false, refusal: 'Refused: git-bundle result.baseCommit must be a full commit hash (40 hex chars), or null for a greenfield node (draft §4.4).' };
    }
    if (!asString(args.attachment).startsWith('metafile://')) {
      return {
        ok: false,
        refusal: 'Refused: a git-workspace submission must attach the git bundle as attachment metafile://<bundle> (draft §4.2) — upload it first (metabot file upload).',
      };
    }
  }
  const result = { ...(args.result ?? {}) };
  delete result.hash;
  const inner = innerHash(result);
  result.hash = inner;
  const outer = outerHash(result);
  if (!competitive && childIds.length > 0) {
    result.childids = childIds; // canonical source; top-level mirrors it
  }
  const payload: Record<string, unknown> = {
    taskid: rootPinId,
    node,
    ...(competitive ? {} : { claimid: claimPinId }),
    result,
    hash: outer,
    contentType: args.contentType ?? 'application/json;utf-8',
    attachment: args.attachment ?? null,
    childids: competitive ? [] : childIds,
  };
  if (parentrefs) payload.parentrefs = parentrefs;
  if (args.supersedePinId) payload.supersedeid = String(args.supersedePinId);
  const written = await seams.writeProtocolPin('submission', payload, 'metatask:submit');
  seams.refreshInBackground('metatask:submit');
  return {
    ok: true,
    data: {
      submissionPinId: written.pinId,
      txids: written.txids,
      innerHash: inner,
      outerHash: outer,
      ...(competitive
        ? {
            mode: 'competitive' as const,
            parentrefs,
            optimistic: optimisticParents.length > 0,
            ...(optimisticParents.length > 0 ? { optimisticParents } : {}),
            ...(claimPinIdIgnored ? { claimPinIdIgnored: true } : {}),
            note:
              optimisticParents.length > 0
                ? 'OPTIMISTIC PIPELINE: at least one referenced parent is not yet verified (or its own ancestor chain is unverified) — if a referenced parent never verifies, or is killed by a fail verdict, this submission can NEVER become chain-valid (draft §3.3). Reviewers vote on each candidate independently.'
                : 'all referenced parents are verified and chain-valid at the local boundary block — reviewers now vote on this submission pinId.',
          }
        : {
            note: 'the review window is now open — independent reviewers vote on this submission pinId.',
          }),
    },
  };
}

// ── verify ───────────────────────────────────────────────────────────────────

export interface VerifyInput {
  targetPinId: string;
  verdict: 'pass' | 'fail';
  method: string;
  semanticCheck: string;
  failReason?: string;
  evidence?: string;
}

export async function verifyMetaTaskSubmission(
  seams: MetaTaskWriteSeams,
  args: VerifyInput
): Promise<MetaTaskWriteOutcome<{ verifyPinId: string; txids: string[] }>> {
  const targetPinId = asString(args.targetPinId).trim();
  const verdict = args.verdict === 'fail' ? 'fail' : 'pass';
  const method = asString(args.method).trim();
  const semanticCheck = asString(args.semanticCheck).trim();
  if (!method) return { ok: false, refusal: 'Refused: method is empty — a vote must map to an actually-performed replay.' };
  if (!semanticCheck) {
    return { ok: false, refusal: 'Refused: semantic_check is empty (ruling #9 — the vote would not be counted).' };
  }
  if (verdict === 'fail' && !asString(args.failReason).trim()) {
    return { ok: false, refusal: 'Refused: verdict=fail requires failReason (ruling #8 — without it the vote is treated as invalid).' };
  }
  // Locate the target across cached events: submitter + root author.
  const events = await seams.loadEvents();
  const target = events.find((event) => event.pinId === targetPinId && event.path === 'submission');
  if (!target) {
    return { ok: false, refusal: `Submission pin not found locally: ${targetPinId} (try metatask list --refresh first).` };
  }
  const submitter = target.author;
  const taskPin = events.find((event) => event.path === 'task' && event.pinId === asString(target.body.taskid));
  const rootAuthor = taskPin?.author ?? '';
  if (seams.actorGlobalMetaId === submitter || seams.actorGlobalMetaId === rootAuthor) {
    return { ok: false, refusal: 'Refused: reviewer must differ from the submitter and the task root author.' };
  }
  const roster = new Set(seams.localRosterMetaIds().filter(Boolean));
  if (roster.has(submitter) || roster.has(rootAuthor)) {
    return {
      ok: false,
      refusal: `Refused: same_side_roster — the submitter or publisher is on the local roster, so a local bot's vote is not independent. Review a different node.`,
    };
  }
  const payload: Record<string, unknown> = {
    targetid: targetPinId,
    verdict,
    method,
    evidence: asString(args.evidence),
    semantic_check: semanticCheck,
  };
  if (verdict === 'fail') payload.failreason = asString(args.failReason).trim();
  const written = await seams.writeProtocolPin('verify', payload, 'metatask:verify');
  seams.refreshInBackground('metatask:verify');
  return { ok: true, data: { verifyPinId: written.pinId, txids: written.txids } };
}

// ── release ──────────────────────────────────────────────────────────────────

export interface ReleaseInput {
  rootPinId: string;
  node: string;
  claimPinId: string;
}

export async function releaseMetaTaskClaim(
  seams: MetaTaskWriteSeams,
  args: ReleaseInput
): Promise<MetaTaskWriteOutcome<{ releasePinId: string; txids: string[] }>> {
  const rootPinId = asString(args.rootPinId).trim();
  const node = asString(args.node).trim();
  const claimPinId = asString(args.claimPinId).trim();
  const detail = await projectionAfterRefresh(seams, rootPinId);
  if (!detail) return { ok: false, refusal: `MetaTask root not found: ${rootPinId}` };
  if (detail.policy.mode === 'competitive') {
    return {
      ok: false,
      refusal:
        'Refused: competitive mode has no claim locks — release is accepted on-chain but ignored (draft §3.2), so spending a pin on it buys nothing. To correct your own submission use submit with supersedePinId; to signal abandonment, simply stop working the node.',
    };
  }
  const nodeState = detail.nodeStates[node];
  if (!nodeState?.holder || nodeState.holder.pinId !== claimPinId) {
    return { ok: false, refusal: 'That claim is not the current effective holder of the node.' };
  }
  if (nodeState.holder.claimant !== seams.actorGlobalMetaId) {
    return { ok: false, refusal: 'That claim belongs to a different bot.' };
  }
  const written = await seams.writeProtocolPin(
    'release',
    { taskid: rootPinId, node, claimid: claimPinId },
    'metatask:release'
  );
  seams.refreshInBackground('metatask:release');
  return { ok: true, data: { releasePinId: written.pinId, txids: written.txids } };
}

// ── publish ──────────────────────────────────────────────────────────────────

export interface PublishInput {
  title?: string;
  brief?: string;
  nodes?: Array<Record<string, unknown>>;
  spec?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  tags?: string[];
  allowPreActivation?: boolean;
  draftsFile?: string;
  taskId?: string;
  specPinByKey?: Record<string, string>;
}

export async function publishMetaTask(
  seams: MetaTaskWriteSeams,
  args: PublishInput
): Promise<MetaTaskWriteOutcome<{
  taskRootPinId: string;
  treePinId: string;
  specPinId: string;
  rosterPinId: string | null;
  txids: string[];
  source: 'draftsFile' | 'inline';
  taskId?: string;
  mode?: 'competitive';
  finalnode?: string;
  preActivationOverride?: boolean;
  activationNote?: string;
  policyWarnings?: string[];
  reminder: string;
}>> {
  const draftsFile = asString(args.draftsFile).trim();
  const taskId = asString(args.taskId).trim();
  const fileModeRequested = Boolean(draftsFile || taskId);
  const inlineProvided =
    args.title !== undefined ||
    args.brief !== undefined ||
    args.nodes !== undefined ||
    args.spec !== undefined ||
    args.policy !== undefined ||
    args.tags !== undefined;
  let fileInput: DraftsPublishInput | null = null;
  if (fileModeRequested) {
    if (!draftsFile || !taskId) {
      return {
        ok: false,
        refusal: 'Refused: draftsFile and taskId must be passed together (draftsFile = absolute path to the campaign drafts file, taskId = its tasks[] entry id).',
      };
    }
    if (inlineProvided) {
      return {
        ok: false,
        refusal: 'Refused: pass either draftsFile+taskId OR inline arguments (title/brief/nodes/spec/policy/tags), not both.',
      };
    }
    const drafts = readDraftsFile(draftsFile);
    if (typeof drafts === 'string') return { ok: false, refusal: drafts };
    const fromFile = taskFromDrafts(drafts, taskId, args.specPinByKey ?? {});
    if (typeof fromFile === 'string') return { ok: false, refusal: fromFile };
    fileInput = fromFile;
  } else if (args.specPinByKey !== undefined) {
    return { ok: false, refusal: 'Refused: specPinByKey only applies in draftsFile mode (pass draftsFile + taskId).' };
  }

  const title = fileInput ? fileInput.title.trim() : asString(args.title).trim();
  if (!title) return { ok: false, refusal: 'Refused: title is empty.' };
  const policy = (fileInput ? fileInput.policy : args.policy ?? {}) as Record<string, unknown>;
  const quorum = Number(policy.verifyQuorum ?? 0);
  if (!Number.isInteger(quorum) || quorum < 1) return { ok: false, refusal: 'Refused: verifyQuorum must be an integer >= 1.' };

  // Mode selection (draft §2): absent/"tree" = tree mode; "competitive" opts
  // into the v1.3 rules.
  const modeRaw = asString(policy.mode).trim();
  if (modeRaw && modeRaw !== 'tree' && modeRaw !== 'competitive') {
    return {
      ok: false,
      refusal: `Refused: policy.mode must be "tree" or "competitive" (got "${modeRaw}") — unknown modes replay as tree mode, which is never the intent of passing one.`,
    };
  }
  const competitive = modeRaw === 'competitive';
  const finalnode = asString(policy.finalnode).trim();
  if (!competitive && finalnode) {
    return { ok: false, refusal: 'Refused: policy.finalnode only applies to competitive mode (draft §3.1) — drop it or set policy.mode="competitive".' };
  }
  if (competitive && !finalnode) {
    return { ok: false, refusal: 'Refused: competitive mode requires policy.finalnode — the designated terminal node, which must be the unique deps sink (draft §3.1).' };
  }
  if (competitive) {
    const gate = hAct3GateRefusal(seams, args.allowPreActivation === true);
    if (gate) return { ok: false, refusal: gate };
  }

  // claim_ttl_hours / verify_window_hours carry no semantics in competitive
  // mode (draft §3.10): any provided value is normalized to 0 and reported.
  const policyWarnings: string[] = [];
  let ttlHours = Number(policy.claimTtlHours ?? 0);
  let windowHours = Number(policy.verifyWindowHours ?? 0);
  if (competitive) {
    if (ttlHours !== 0) {
      policyWarnings.push(`claim_ttl_hours normalized to 0 (provided ${asString(policy.claimTtlHours) || policy.claimTtlHours}; ignored in competitive mode, draft §3.10)`);
      ttlHours = 0;
    }
    if (windowHours !== 0) {
      policyWarnings.push(`verify_window_hours normalized to 0 (provided ${asString(policy.verifyWindowHours) || policy.verifyWindowHours}; ignored in competitive mode, draft §3.10)`);
      windowHours = 0;
    }
  } else {
    if (!Number.isInteger(ttlHours) || ttlHours <= 0) return { ok: false, refusal: 'Refused: claimTtlHours must be a positive integer.' };
    if (!Number.isInteger(windowHours) || windowHours <= 0) return { ok: false, refusal: 'Refused: verifyWindowHours must be a positive integer.' };
  }

  const rawNodes: Array<Record<string, unknown>> = fileInput
    ? fileInput.nodes
    : ((args.nodes ?? []) as Array<Record<string, unknown>>);
  const nodes = rawNodes.map((raw) => ({
    id: asString(raw.id),
    parent: raw.parent === null || raw.parent === undefined ? null : asString(raw.parent),
    title: asString(raw.title),
    kind: asString(raw.kind, 'proof'),
    specid: raw.specid === undefined || raw.specid === null ? null : asString(raw.specid),
    params: (raw.params && typeof raw.params === 'object' ? raw.params : {}) as Record<string, unknown>,
    deps: (Array.isArray(raw.deps) ? raw.deps : []).map((dep) => String(dep)),
    weight: Number(raw.weight),
  }));
  if (nodes.length === 0) return { ok: false, refusal: 'Refused: empty node list.' };
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) return { ok: false, refusal: 'Refused: duplicate node ids.' };
  if (nodes.some((node) => !node.id || !node.title)) return { ok: false, refusal: 'Refused: every node needs id and title.' };
  const roots = nodes.filter((node) => node.parent === null);
  if (roots.length !== 1) return { ok: false, refusal: `Refused: exactly one root (parent=null) required, found ${roots.length}.` };
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  let totalWeight = 0;
  for (const node of nodes) {
    if (!Number.isInteger(node.weight) || node.weight < 1 || node.weight > 10000) {
      return { ok: false, refusal: `Refused: node ${node.id} weight must be an integer in [1, 10000].` };
    }
    totalWeight += node.weight;
    if (node.parent !== null && !byId.has(node.parent)) {
      return { ok: false, refusal: `Refused: node ${node.id} references unknown parent ${node.parent}.` };
    }
    for (const dep of node.deps) {
      if (!byId.has(dep)) return { ok: false, refusal: `Refused: node ${node.id} references unknown dep ${dep}.` };
    }
  }
  if (totalWeight !== 10000) {
    return { ok: false, refusal: `Refused: node weights must sum to exactly 10000 (got ${totalWeight}).` };
  }
  // Acyclicity via parent-chain walk.
  for (const start of nodes) {
    const seen = new Set<string>();
    let cursor: string | null = start.id;
    while (cursor !== null) {
      if (seen.has(cursor)) return { ok: false, refusal: 'Refused: parent graph is cyclic.' };
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent ?? null;
    }
  }
  // Competitive publish invariants (draft §3.1/§3.3): deps DAG with exactly
  // one sink == finalnode, full work-flow reachability, rubric per node.
  if (competitive) {
    const graphRefusal = competitiveGraphRefusal(nodes, finalnode);
    if (graphRefusal) return { ok: false, refusal: graphRefusal };
    for (const node of nodes) {
      const rubricRefusal = competitiveRubricRefusal(node);
      if (rubricRefusal) return { ok: false, refusal: rubricRefusal };
    }
  }
  const spec: SpecPayloadInput = fileInput
    ? fileInput.spec
    : {
        name: asString(args.spec?.name) || undefined,
        lang: asString(args.spec?.lang) || undefined,
        entry: asString(args.spec?.entry) || undefined,
        script: typeof args.spec?.script === 'string' ? args.spec.script : undefined,
        input: args.spec?.input,
        output: args.spec?.output,
        validation: isPlainObject(args.spec?.validation) ? args.spec?.validation : undefined,
        workspace: isPlainObject(args.spec?.workspace) ? args.spec?.workspace : undefined,
      };
  if (!asString(spec.name).trim() || !asString(spec.entry).trim()) {
    return { ok: false, refusal: 'Refused: a root verifier spec (name + entry) is required — every task needs a machine-checkable spec.' };
  }
  const workspaceRefusal = specWorkspaceRefusal(spec.workspace);
  if (workspaceRefusal) return { ok: false, refusal: workspaceRefusal };

  // roster pin (same-side declaration) when the local roster can cross-review.
  // Flat sibling of the protocol root (the collector sweeps it as the tenth
  // pool); a reference pin, never a replay event.
  const roster = seams.localRosterMetaIds().filter(Boolean);
  let rosterid: string | null = null;
  if (roster.length >= 2) {
    const rosterPin = await seams
      .writeRawPin(
        METATASK_ROSTER_PATH,
        // `groups: string[][]` is exactly what the engine's rosterGroupsFor
        // reads (and what the collector round-trips).
        { groups: [roster], owner: 'oac-local-roster', createdAt: Date.now() },
        'metatask:publish'
      )
      .catch(() => null);
    rosterid = rosterPin?.pinId ?? null;
  }

  const treePayload = {
    root: roots[0].id,
    nodes: nodes.map((node) => ({
      id: node.id,
      parent: node.parent,
      title: node.title,
      kind: node.kind,
      specid: node.specid,
      params: node.params,
      deps: node.deps,
      weight: node.weight,
    })),
  };
  const treePin = await seams.writeProtocolPin('tree', treePayload, 'metatask:publish');

  const specPin = await seams.writeProtocolPin('spec', buildSpecPayload(spec), 'metatask:publish');

  const shareBP = Number(policy.submitterShareBP ?? 8000);
  const rawTags = fileInput ? fileInput.tags : args.tags;
  const tags = (Array.isArray(rawTags) ? rawTags : []).map((tag) => String(tag));
  const taskPayload: Record<string, unknown> = {
    title,
    brief: fileInput ? fileInput.brief : asString(args.brief),
    treeid: treePin.pinId,
    specid: specPin.pinId,
    policy: {
      claim_ttl_hours: ttlHours,
      verify_quorum: quorum,
      verify_window_hours: windowHours,
      reward_sat: Number.isInteger(policy.rewardSat) ? Number(policy.rewardSat) : 0,
      challenge_ttl_days: Number.isInteger(policy.challengeTtlDays) ? Number(policy.challengeTtlDays) : 14,
      // Tree mode publishes byte-identically to pre-v1.3: mode/finalnode keys
      // exist only on competitive tasks.
      ...(competitive ? { mode: 'competitive', finalnode } : {}),
      split: { submitterShareBP: shareBP, rosterid },
    },
    tags,
  };
  const taskPin = await seams.writeProtocolPin('task', taskPayload, 'metatask:publish');

  seams.refreshInBackground('metatask:publish');
  return {
    ok: true,
    data: {
      taskRootPinId: taskPin.pinId,
      treePinId: treePin.pinId,
      specPinId: specPin.pinId,
      rosterPinId: rosterid,
      txids: [...treePin.txids, ...specPin.txids, ...taskPin.txids],
      source: fileInput ? 'draftsFile' : 'inline',
      ...(fileInput ? { taskId: fileInput.taskId } : {}),
      ...(competitive
        ? {
            mode: 'competitive' as const,
            finalnode,
            ...(args.allowPreActivation === true
              ? { preActivationOverride: true, activationNote: 'published before H_ACT3 via allowPreActivation (pilot/testing escape hatch, draft §7) — replay accepts it, but production campaigns must wait for the announced activation height.' }
              : {}),
            ...(policyWarnings.length > 0 ? { policyWarnings } : {}),
          }
        : {}),
      reminder: 'Post the discovery buzz within 24h: title + the FULL task root pinId + #metatask tag (use metabot buzz).',
    },
  };
}

// ── publish-spec ─────────────────────────────────────────────────────────────

export interface PublishSpecInput {
  name?: string;
  lang?: string;
  entry?: string;
  script?: string;
  input?: unknown;
  output?: unknown;
  workspace?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  enforceHAct2Validation?: boolean;
  draftsFile?: string;
  specKey?: string;
}

export async function publishMetaTaskSpec(
  seams: MetaTaskWriteSeams,
  args: PublishSpecInput
): Promise<MetaTaskWriteOutcome<{
  specPinId: string;
  txids: string[];
  totalCost?: number;
  name: string;
  lang: string;
  entry: string;
  hasValidation: boolean;
  source: 'draftsFile' | 'inline';
  specKey?: string;
  note: string;
}>> {
  const draftsFile = asString(args.draftsFile).trim();
  const specKey = asString(args.specKey).trim();
  const inlineProvided =
    args.name !== undefined ||
    args.lang !== undefined ||
    args.entry !== undefined ||
    args.script !== undefined ||
    args.input !== undefined ||
    args.output !== undefined ||
    args.workspace !== undefined ||
    args.validation !== undefined;
  let spec: SpecPayloadInput;
  if (draftsFile || specKey) {
    if (!draftsFile || !specKey) {
      return {
        ok: false,
        refusal: 'Refused: draftsFile and specKey must be passed together (draftsFile = absolute path to the campaign drafts file, specKey = key under its specs{} map).',
      };
    }
    if (inlineProvided) {
      return {
        ok: false,
        refusal: 'Refused: pass either draftsFile+specKey OR inline arguments (name/lang/entry/script/input/output/validation/workspace), not both.',
      };
    }
    const drafts = readDraftsFile(draftsFile);
    if (typeof drafts === 'string') return { ok: false, refusal: drafts };
    const fromFile = specFromDrafts(drafts, specKey);
    if (typeof fromFile === 'string') return { ok: false, refusal: fromFile };
    spec = fromFile;
  } else {
    spec = {
      name: args.name,
      lang: args.lang,
      entry: args.entry,
      script: args.script,
      input: args.input,
      output: args.output,
      workspace: args.workspace,
      validation: args.validation,
    };
  }

  const name = asString(spec.name).trim();
  const entry = asString(spec.entry).trim();
  if (!name || !entry) {
    return { ok: false, refusal: 'Refused: a spec needs name + entry (the offline verifier entry point).' };
  }
  const scriptRefusal = specScriptRefusal(spec.script);
  if (scriptRefusal) return { ok: false, refusal: scriptRefusal };
  const workspaceRefusal = specWorkspaceRefusal(spec.workspace);
  if (workspaceRefusal) return { ok: false, refusal: workspaceRefusal };
  const rawScript = typeof spec.script === 'string' ? spec.script : '';
  const trimmedScript = rawScript.trim();
  // A pin://|metafile:// reference is normalized; inline script bytes are
  // published verbatim (they are the verifier that reviewers replay).
  const script = SPEC_REF_RE.test(trimmedScript) ? trimmedScript : rawScript;
  // Chains at/after H_ACT2 owe the protocol's validation block; the writer
  // cannot measure height, so it enforces by default and the caller must
  // explicitly declare a pre-H_ACT2 (v1.1-era) spec to opt out.
  if (args.enforceHAct2Validation !== false) {
    const validationRefusal = specValidationRefusal(spec.validation);
    if (validationRefusal) return { ok: false, refusal: validationRefusal };
  }
  const written = await seams.writeProtocolPin(
    'spec',
    buildSpecPayload({
      name,
      lang: spec.lang,
      entry,
      script,
      input: spec.input,
      output: spec.output,
      workspace: spec.workspace,
      validation: spec.validation,
    }),
    'metatask:publish-spec'
  );
  seams.refreshInBackground('metatask:publish-spec');
  return {
    ok: true,
    data: {
      specPinId: written.pinId,
      txids: written.txids,
      totalCost: written.totalCost,
      name,
      lang: asString(spec.lang).trim() || 'bash',
      entry,
      hasValidation: isPlainObject(spec.validation),
      source: draftsFile ? 'draftsFile' : 'inline',
      ...(draftsFile ? { specKey } : {}),
      note: 'Standalone spec pin written — no task/tree was spent. Reference this specPinId from any tree node specid override (replace SPEC_PIN:<key> placeholders before publishing the tree) or as a task root specid.',
    },
  };
}

// ── amend ────────────────────────────────────────────────────────────────────

export interface AmendInput {
  rootPinId: string;
  ops: Array<Record<string, unknown>>;
}

export async function amendMetaTask(
  seams: MetaTaskWriteSeams,
  args: AmendInput
): Promise<MetaTaskWriteOutcome<{ amendPinId: string; bases: string; txids: string[] }>> {
  const rootPinId = asString(args.rootPinId).trim();
  const detail = await projectionAfterRefresh(seams, rootPinId);
  if (!detail) return { ok: false, refusal: `MetaTask root not found: ${rootPinId}` };
  if (detail.publisher !== seams.actorGlobalMetaId) {
    return { ok: false, refusal: 'Refused: only the task root author (publisher) may amend.' };
  }
  if (detail.taskComplete) {
    return { ok: false, refusal: 'Refused: the task is finalized (root verified) — settlement must never be retroactively recomputable.' };
  }
  // Writer-side checks. Tree mode: conservative — ANY claim ever seen freezes a
  // node. Competitive mode (draft §3.9): the freeze condition is SATISFACTION.
  const competitive = detail.policy.mode === 'competitive';
  const events = await seams.loadEvents();
  const claimedEver = new Set(
    events
      .filter((event) => event.path === 'claim' && asString(event.body.taskid) === rootPinId)
      .map((event) => asString(event.body.node))
  );
  const satisfiedNow = (nodeId: string): boolean => detail.nodeStates[nodeId]?.status === 'verified';
  const isFrozen = competitive ? satisfiedNow : (nodeId: string): boolean => claimedEver.has(nodeId);
  const frozenMessage = (nodeId: string): string =>
    competitive
      ? `Refused: node ${nodeId} is satisfied (a chain-valid verified submission exists) — frozen against amends (draft §3.9).`
      : `Refused: node ${nodeId} has been claimed before — frozen-on-start (v1.2 minimal amend).`;
  const byId = new Map<
    string,
    { id: string; parent: string | null; title: string; kind: string; specid?: string | null; params?: Record<string, unknown>; deps?: string[]; weight?: number }
  >(
    detail.nodes.map((node) => [node.id, { ...node }])
  );
  for (const rawOp of args.ops ?? []) {
    const op = asString(rawOp?.op);
    const nodeId = asString(rawOp?.node);
    if (op === 'add_node') {
      const raw = (rawOp?.node && typeof rawOp.node === 'object' ? rawOp.node : null) as Record<string, unknown> | null;
      const id = asString(raw?.id);
      const parent = asString(raw?.parent);
      if (!raw || !id || byId.has(id)) return { ok: false, refusal: 'Refused: add_node with missing or duplicate id.' };
      const parentNode = byId.get(parent);
      if (!parentNode) return { ok: false, refusal: `Refused: add_node parent ${parent} not found.` };
      if (competitive ? satisfiedNow(parent) : detail.nodeStates[parent]?.status === 'verified' || detail.nodeStates[parent]?.holder) {
        return {
          ok: false,
          refusal: competitive
            ? `Refused: parent ${parent} is satisfied — new nodes cannot hang off a frozen node (draft §3.9).`
            : `Refused: parent ${parent} is claimed or verified.`,
        };
      }
      const newDeps = (Array.isArray(raw.deps) ? raw.deps : []).map((dep) => String(dep));
      const newParams = (raw.params && typeof raw.params === 'object' ? raw.params : {}) as Record<string, unknown>;
      if (competitive) {
        // §3.9: new deps edges may only land on unfrozen existing nodes.
        for (const dep of newDeps) {
          if (!byId.has(dep)) return { ok: false, refusal: `Refused: add_node ${id} references unknown dep ${dep}.` };
          if (satisfiedNow(dep)) {
            return { ok: false, refusal: `Refused: add_node ${id} may not depend on ${dep} — it is satisfied (frozen), so the edge would bind new work to a sealed result (draft §3.9).` };
          }
        }
        // The publish rubric invariant (§3.3) applies to added nodes too.
        const rubricRefusal = competitiveRubricRefusal({ id, params: newParams });
        if (rubricRefusal) return { ok: false, refusal: rubricRefusal };
      }
      byId.set(id, {
        id,
        parent,
        title: asString(raw.title),
        kind: asString(raw.kind, 'proof'),
        specid: raw.specid === undefined || raw.specid === null ? null : asString(raw.specid),
        params: newParams,
        deps: newDeps,
        weight: Number(raw.weight),
      });
    } else {
      const target = byId.get(nodeId);
      if (!target) return { ok: false, refusal: `Refused: node ${nodeId} not found.` };
      if (isFrozen(nodeId)) {
        return { ok: false, refusal: frozenMessage(nodeId) };
      }
      if (op === 'remove_node') {
        const stack = [nodeId];
        while (stack.length) {
          const current = stack.pop() as string;
          if (isFrozen(current)) {
            return {
              ok: false,
              refusal: competitive
                ? `Refused: subtree of ${nodeId} contains a satisfied node (${current}) — frozen (draft §3.9).`
                : `Refused: subtree of ${nodeId} contains a claimed node.`,
            };
          }
          for (const candidate of byId.values()) {
            if (candidate.parent === current) stack.push(candidate.id);
          }
        }
        if (competitive) {
          // §3.9: a node referenced by another node's deps cannot be removed.
          const referencing = Array.from(byId.values()).filter(
            (candidate) => candidate.id !== nodeId && (candidate.deps ?? []).includes(nodeId)
          );
          if (referencing.length > 0) {
            return {
              ok: false,
              refusal: `Refused: node ${nodeId} is listed in deps by ${referencing.map((candidate) => candidate.id).join(', ')} — remove or rewire the dependents first (draft §3.9).`,
            };
          }
        }
        byId.delete(nodeId);
      } else if (op === 'reweight') {
        target.weight = Number(rawOp?.weight);
      } else if (op === 'retitle') {
        target.title = asString(rawOp?.title);
      } else if (op === 'respec') {
        target.specid = asString(rawOp?.specid);
      } else {
        return { ok: false, refusal: `Refused: unknown op "${op}".` };
      }
    }
  }
  let totalWeight = 0;
  for (const node of byId.values()) {
    const weight = Number((node as { weight?: unknown }).weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 10000) {
      return { ok: false, refusal: 'Refused: every node weight must be an integer in [1, 10000].' };
    }
    totalWeight += weight;
  }
  if (totalWeight !== 10000) {
    return { ok: false, refusal: `Refused: weights must sum to exactly 10000 after the fold (got ${totalWeight}).` };
  }
  if (competitive) {
    // §3.9 fold invariants, writer-side (the engine re-checks them and ignores
    // the whole amend on violation): deps reference live nodes, deps acyclic,
    // and the TERMINAL STAYS PINNED — policy.finalnode must still be a live
    // deps sink after the fold.
    const folded = Array.from(byId.values()).map((node) => ({
      id: node.id,
      deps: (node.deps ?? []).map((dep) => String(dep)),
      params: (node.params ?? {}) as Record<string, unknown>,
    }));
    for (const node of folded) {
      for (const dep of node.deps) {
        if (!byId.has(dep)) {
          return { ok: false, refusal: `Refused: after the fold, node ${node.id} references dep ${dep} which no longer exists (draft §3.9 deps integrity).` };
        }
      }
    }
    if (!depsGraphAcyclic(folded)) {
      return { ok: false, refusal: 'Refused: the fold makes the deps graph cyclic (draft §3.9).' };
    }
    const finalnode = asString(detail.policy.finalNode).trim();
    if (!byId.has(finalnode)) {
      return { ok: false, refusal: `Refused: the fold must keep the designated terminal node "${finalnode}" alive (draft §3.9) — competitive amends cannot remove policy.finalnode.` };
    }
    const sinks = depsSinkIds(folded);
    if (!sinks.includes(finalnode)) {
      return {
        ok: false,
        refusal: `Refused: the fold moves the deps sink off policy.finalnode "${finalnode}" (sink would become ${[...sinks].sort().join(', ') || 'none'}) — v1.3 does not allow a new layer above the finalnode (draft §3.9); terminal growth, including finalnode reassignment, is deferred to the multi-sink extension (§9 Q1). A middle-layer or side-branch add_node (deps onto unfrozen existing nodes, finalnode NOT among them) keeps the sink at finalnode and is allowed.`,
      };
    }
  }
  const ops = (args.ops ?? []).map((rawOp) => {
    if (asString(rawOp?.op) === 'add_node') {
      return { op: 'add_node', node: rawOp?.node };
    }
    const mapped: Record<string, unknown> = { op: rawOp?.op, node: rawOp?.node };
    if (rawOp?.weight !== undefined) mapped.weight = rawOp.weight;
    if (rawOp?.title !== undefined) mapped.title = rawOp.title;
    if (rawOp?.specid !== undefined) mapped.specid = rawOp.specid;
    return mapped;
  });
  const written = await seams.writeProtocolPin(
    'amend',
    { taskid: rootPinId, bases: detail.amendHead, ops },
    'metatask:amend'
  );
  seams.refreshInBackground('metatask:amend');
  return { ok: true, data: { amendPinId: written.pinId, bases: detail.amendHead, txids: written.txids } };
}
