/**
 * Session naming (local session adapters P1).
 *
 * Directory names default to `<dir>-<agent>` (`api-claude`), get `-2`/`-3`
 * on collision, and stay with their conversation: a re-registered session
 * key keeps the name it already had (reason-network's name-keeping rule),
 * and a NEW session never pushes a kept name aside — it takes the next free
 * suffix. A name someone asked for (`--name`, later `claim`/`listen --as`)
 * is honored when free and suffixed when not.
 */

const AGENT_SHORT_NAMES: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
};

export function slugifySessionName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug;
}

export function shortAgentName(agent: string): string {
  return AGENT_SHORT_NAMES[agent] ?? agent;
}

/** `<basename(cwd)>-<agent>`, slugified; `session-<agent>` without a usable cwd. */
export function defaultSessionName(input: { cwd?: string; agent: string }): string {
  const base = input.cwd ? slugifySessionName(input.cwd.split('/').filter(Boolean).pop() ?? '') : '';
  return `${base || 'session'}-${shortAgentName(input.agent)}`;
}

/**
 * First free name: the requested/default name when untaken, else `-2`,
 * `-3`, … `takenNames` should already exclude the session being named.
 */
export function resolveSessionName(input: {
  requested?: string;
  defaultName: string;
  takenNames: Iterable<string>;
}): string {
  const taken = new Set(input.takenNames);
  const preferred = (input.requested ?? '').trim() || input.defaultName;
  if (!taken.has(preferred)) {
    return preferred;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${preferred}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Unreachable in practice (999 collisions); deterministic anyway.
  return `${preferred}-${Date.now()}`;
}
