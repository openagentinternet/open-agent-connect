/**
 * Local session registry types (local session adapters P1).
 *
 * The registry is OAC's directory of LOCAL agent sessions on this machine —
 * Claude Code, Codex, and later other hosts — so remote Bot messages can be
 * routed to a session the user is actually sitting in instead of only ever
 * being answered by OAC's own bot runtime. Design:
 * docs/superpowers/specs/2026-11-11-oac-local-session-adapters-design.md.
 *
 * P1 is presence-only: discovery scans and MCP/hook/claim registrations
 * populate the registry, nothing is delivered yet. Delivery (adapters,
 * routing, mail queue) lands in P2+.
 */

/** How a session can receive mail (declared per registration; see spec). */
export type SessionDeliveryTier = 'push' | 'turn' | 'pull';

/** How the registry learned about the session. */
export type SessionRegistrationSource = 'mcp' | 'hook' | 'claim' | 'discovery';

/** Last-reported activity state from the session's own host. */
export type SessionActivityStatus = 'busy' | 'idle' | 'unknown';

/** A private-chat conversation routed to this session (local session adapters P2b). */
export interface SessionConversationBinding {
  conversationId: string;
  /** The Bot profile whose conversation this is (its orchestrator routed mail). */
  profileSlug?: string;
  /**
   * The remote peer observed on routed mail (enriched on each route). The
   * send path anchors replies to this peer — no conversation-id parsing.
   */
  peerGlobalMetaId?: string;
}

export interface LocalSessionRecord {
  /** `<agent>:<session-id>`; discovery entries without an id use `<agent>:pid:<pid>`. */
  sessionKey: string;
  /** Agent platform id (`claude-code`, `codex`, … — platformRegistry ids). */
  agent: string;
  /** The agent's own session id; empty for presence-only discovery entries. */
  sessionId: string;
  /** Directory name, unique among live sessions (see naming.ts). */
  name: string;
  tier: SessionDeliveryTier;
  source: SessionRegistrationSource;
  /**
   * Whether the session can actually receive mail today. Registration via
   * MCP/hooks/CLI claim is deliverable; passive discovery entries are
   * presence-only (deliverable=false) until the host is wired in P2+.
   */
  deliverable: boolean;
  cwd: string;
  /** Repo slug (origin remote basename) or the working-directory basename. */
  repo: string;
  /** Git branch, when the cwd is a git work tree. */
  branch: string;
  /** One-line what-it-is-doing (host title), when exposed. */
  doing: string;
  status: SessionActivityStatus;
  /** Host process id, when known (Claude registry files are per-pid). */
  pid?: number;
  /** Epoch ms of the last observation (registration, hook, or scan hit). */
  lastSeenAt: number;
  /** Epoch ms reported by the host; 0 when unknown. */
  startedAt: number;
  /** Adapter material recorded at registration (e.g. Claude inbox socket; used in P3). */
  inboxSocketPath?: string;
  /** Private-chat conversations routed to this session (P2b binding). */
  boundConversations?: SessionConversationBinding[];
}

/** Registry list row: the stored record plus registry-computed liveness. */
export interface LocalSessionView extends LocalSessionRecord {
  /**
   * True while the session was seen within the live window (10 minutes,
   * reason-network's seen-every-10-minutes discipline). Outside the window
   * the record reads as offline until it lapses.
   */
  alive: boolean;
}

export interface LocalSessionsState {
  version: 1;
  updatedAt: string;
  sessions: LocalSessionRecord[];
}

/** Discovery scan output: what a host exposes about its live sessions. */
export interface DiscoveredSession {
  agent: string;
  sessionId?: string;
  pid?: number;
  cwd?: string;
  name?: string;
  doing?: string;
  status?: SessionActivityStatus;
  startedAt?: number;
  inboxSocketPath?: string;
  /**
   * Epoch ms of the host's own observation (Codex's updated_at), when the
   * scan has a better timestamp than the scan itself; the registry merge
   * uses it for lastSeenAt.
   */
  observedAt?: number;
}
