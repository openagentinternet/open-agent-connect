// Contact display-name resolution for the impression/contact surfaces
// (IDBots metaidContactViewService.resolveContactName parity): a contact's
// identity is always its GlobalMetaID; names are display-only and may change.
// Resolution order: local Bot profile name > A2A conversation peer name.
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { listIdentityProfiles } from '../identity/identityProfiles';
import type { MetabotPaths } from '../state/paths';

/** Map each known subject GlobalMetaID to a display name; unknown ids are absent. */
export async function resolveContactNames(
  paths: MetabotPaths,
  subjectGlobalMetaIds: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(subjectGlobalMetaIds.map((id) => id.trim()).filter(Boolean));
  const resolved = new Map<string, string>();
  if (wanted.size === 0) return resolved;

  try {
    for (const profile of await listIdentityProfiles(paths.systemHomeDir)) {
      const id = typeof profile.globalMetaId === 'string' ? profile.globalMetaId.trim() : '';
      const name = typeof profile.name === 'string' ? profile.name.trim() : '';
      if (id && name && wanted.has(id) && !resolved.has(id)) resolved.set(id, name);
    }
  } catch {
    // Profile enumeration is best effort; A2A names below still apply.
  }

  let a2aFiles: string[] = [];
  try {
    a2aFiles = (await fs.readdir(paths.a2aRoot))
      .filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
  } catch {
    a2aFiles = [];
  }
  for (const fileName of a2aFiles) {
    let conversation: { peer?: { globalMetaId?: unknown; name?: unknown } | null } | null = null;
    try {
      conversation = JSON.parse(await fs.readFile(path.join(paths.a2aRoot, fileName), 'utf8'));
    } catch {
      continue;
    }
    const peer = conversation && typeof conversation === 'object' ? conversation.peer : null;
    const id = typeof peer?.globalMetaId === 'string' ? peer.globalMetaId.trim() : '';
    const name = typeof peer?.name === 'string' ? peer.name.trim() : '';
    if (id && name && wanted.has(id) && !resolved.has(id)) resolved.set(id, name);
  }
  return resolved;
}
