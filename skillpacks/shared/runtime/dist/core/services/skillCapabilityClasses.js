"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SKILL_CAPABILITY_CLASSES = exports.DEFAULT_UNKNOWN_SKILL_CAPABILITY_CLASS = void 0;
exports.classifySkill = classifySkill;
exports.normalizeSkillClassOverrides = normalizeSkillClassOverrides;
// Skill capability registry (trust tiers P3): the built-in default mapping
// of every SKILLs/* skill to a capability class (design: capability classes
// + permission matrix in 2026-10-16-trust-tiers-permission-matrix-design.md).
// A skill is classified by its MOST PRIVILEGED action — granting a skill
// grants everything it can do — and remote peers receive it only when the
// peer's tier allows that class. Per-profile overrides live in profile
// config (`trust.skillClassOverrides`); unknown skills default to C3
// (conservative). The policy engine (core/trust/trustPolicy.ts) intersects
// this registry with the profile's allowChatSkills.
const capabilityClasses_1 = require("../trust/capabilityClasses");
exports.DEFAULT_UNKNOWN_SKILL_CAPABILITY_CLASS = 'C3';
/**
 * Default class per shipped skill, each classified by its most privileged
 * action:
 *   C0 chat        — pure conversational knowledge transfer
 *   C1 read-local  — read-only local/chain state access
 *   C2 collab      — on-chain writes + sandbox-local (<profile>/.runtime) writes
 *   C3 write-local — local execution, real browser control, host/platform changes
 *   C4 admin       — funds and identity operations (human-only, never remote)
 */
exports.DEFAULT_SKILL_CAPABILITY_CLASSES = {
    // Purely informational — safe for any tier that may chat.
    'metabot-help': 'C0',
    // Read-only MetaWeb/chain access.
    'metabot-omni-reader': 'C1',
    'metabot-metaweb': 'C1',
    // On-chain collaboration writes (messages, posts, tasks, uploads, services).
    'metabot-chat-privatechat': 'C2',
    'metabot-post-buzz': 'C2',
    'metabot-simplenote': 'C2',
    'metabot-upload-file': 'C2',
    'metabot-grouptask': 'C2',
    'metabot-metatask': 'C2',
    'metabot-metatask-wizard': 'C2',
    'metabot-qanda': 'C2',
    'metabot-protocol': 'C2',
    'metabot-metaapp': 'C2',
    'metabot-call-remote-service': 'C2',
    'metabot-post-skill': 'C2',
    'metabot-post-skillservice': 'C2',
    // Sandboxed local writes (profile-local corpora/memory state).
    'metabot-knowledge-base': 'C2',
    'metabot-memory': 'C2',
    // Local media handling: uploads local files to the MetaWeb relay.
    'metabot-media': 'C2',
    // Local state + view-only discovery (source registry lives in the profile).
    'metabot-network-manage': 'C2',
    // Local execution / host-level changes / autonomous pipelines.
    'metabot-browser': 'C3',
    'metabot-browser-open': 'C3',
    'metabot-create-wiki': 'C3',
    'metabot-dream': 'C3',
    'metabot-schedule': 'C3',
    'metabot-surf': 'C3',
    'metabot-twin': 'C3',
    // Funds and identity operations — human-only (C4 is never remote-reachable).
    'metabot-wallet-manage': 'C4',
    'metabot-identity-manage': 'C4',
    'metabot-grok-bot': 'C4',
};
function normalizeSkillName(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Effective class for a skill: per-profile override wins, then the default
 * table; unknown skills are C3 (conservative).
 */
function classifySkill(skillName, overrides) {
    const normalized = normalizeSkillName(skillName);
    const override = normalized && overrides ? overrides[normalized] : undefined;
    if ((0, capabilityClasses_1.isCapabilityClass)(override)) {
        return override;
    }
    return exports.DEFAULT_SKILL_CAPABILITY_CLASSES[normalized] ?? exports.DEFAULT_UNKNOWN_SKILL_CAPABILITY_CLASS;
}
/** Defensive normalizer for the `trust.skillClassOverrides` config field. */
function normalizeSkillClassOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const result = {};
    for (const [skillName, className] of Object.entries(value)) {
        const name = normalizeSkillName(skillName);
        if (name && (0, capabilityClasses_1.isCapabilityClass)(className)) {
            result[name] = className;
        }
    }
    return result;
}
