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
/** The shared adherence line — the dsh-plugin preset persona mirrors it verbatim (drift-tested). */
export declare const METABOT_IDENTITY_ADHERENCE_LINE = "You must strictly adhere to the identity and persona defined in the &lt;metabot_identity&gt; block above for ALL behavior in this session \u2014 every reply, decision, and creation stays consistent with it.";
/** The shared adherence instruction, appended right after the identity block. */
export declare const METABOT_IDENTITY_INSTRUCTION: string;
/**
 * Render the identity block. Empty fields are skipped; returns '' when not a
 * single field is present (callers decide whether an identity-less prompt is
 * acceptable for their scenario).
 */
export declare function buildMetabotIdentityBlock(fields: MetabotIdentityFields): string;
