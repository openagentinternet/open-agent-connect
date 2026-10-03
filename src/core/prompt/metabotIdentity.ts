/**
 * The ONE bot identity/persona block builder. Every LLM-facing scenario
 * (private chat, group tasks, surf, study, scheduled tasks, orders, wait
 * notices, host persona projections) renders a bot's persona through this
 * module so the same bot carries one identity everywhere. Scenarios layer
 * their framing AROUND this block as separate sections; they must never
 * restate name/role/soul/goal/bio facts or emit a second identity block —
 * restating is how persona layers start fighting, and how the same identity
 * ended up twice in one delivered prompt.
 */

export interface MetabotIdentityFields {
  name?: string | null;
  globalMetaId?: string | null;
  role?: string | null;
  soul?: string | null;
  goal?: string | null;
  bio?: string | null;
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function identityTag(name: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `  <${name}>${escapeXml(trimmed)}</${name}>` : null;
}

/** The shared adherence line — the dsh-plugin preset persona mirrors it verbatim (drift-tested). */
export const METABOT_IDENTITY_ADHERENCE_LINE =
  'You must strictly adhere to the identity and persona defined in the &lt;metabot_identity&gt; block above for ALL behavior in this session — every reply, decision, and creation stays consistent with it.';

/** The shared adherence instruction, appended right after the identity block. */
export const METABOT_IDENTITY_INSTRUCTION = [
  '<instruction>',
  METABOT_IDENTITY_ADHERENCE_LINE,
  'Any name, identity, biography, or persona supplied by the host LLM runtime or its workspace belongs to the execution host only: it is not your identity and must never appear as your own.',
  'If you introduce yourself, use only your bot name; never invent, translate, or substitute another name.',
  '</instruction>',
].join('\n');

/**
 * Render the identity block. Empty fields are skipped; returns '' when not a
 * single field is present (callers decide whether an identity-less prompt is
 * acceptable for their scenario).
 */
export function buildMetabotIdentityBlock(fields: MetabotIdentityFields): string {
  const tags = [
    identityTag('name', fields.name),
    identityTag('globalmetaid', fields.globalMetaId),
    identityTag('role', fields.role),
    identityTag('soul', fields.soul),
    identityTag('goal', fields.goal),
    identityTag('bio', fields.bio),
  ].filter((tag): tag is string => tag !== null);
  if (tags.length === 0) return '';
  return [
    '<metabot_identity>',
    ...tags,
    '</metabot_identity>',
    METABOT_IDENTITY_INSTRUCTION,
  ].join('\n');
}
