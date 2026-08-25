/**
 * On-chain skill package installation — OAC port of the IDBots
 * skillInstallService consumer half. A `metabot-skill` protocol pin points at
 * a zip package (`skill-file: metafile://<pinId>.zip`); this module downloads
 * that archive, extracts it safely, and installs it as a regular skill
 * directory under the shared skills root (`~/.metabot/skills/<name>/`),
 * recording provenance in the installed-skills registry so host skill
 * binding can pick it up like any local skill.
 *
 * Everything here is untrusted third-party input: the archive size is capped,
 * extraction reuses the zip-slip-guarded MetaApp extractor, and skill names
 * are validated before they become directory names.
 */
/** Parity with IDBots MAX_SKILL_PACKAGE_BYTES — the published zip must stay small. */
export declare const MAX_SKILL_PACKAGE_BYTES: number;
/** Registry file inside the shared skills root; one entry per chain-installed skill. */
export declare const SKILL_REGISTRY_FILENAME = "installed-skills.json";
export declare class SkillInstallError extends Error {
    code: 'invalid_source' | 'download_failed' | 'invalid_package' | 'name_conflict';
    constructor(code: 'invalid_source' | 'download_failed' | 'invalid_package' | 'name_conflict', message: string);
}
export interface InstalledSkillRecord {
    name: string;
    version: string;
    description: string;
    /** Publisher GlobalMetaID from the source pin; empty when unknown. */
    creatorMetaId: string;
    creatorName: string;
    /** The metabot-skill protocol pin that advertised this package. */
    sourcePinId: string;
    /** The package archive URI (metafile://…) that was downloaded. */
    skillFileUri: string;
    installedAt: number;
    updatedAt: number;
    enabled: boolean;
}
export interface InstalledSkillsRegistry {
    version: 1;
    skills: Record<string, InstalledSkillRecord>;
}
export interface SkillInstallSource {
    creatorMetaId?: string;
    creatorName?: string;
    sourcePinId?: string;
    skillFileUri?: string;
    /** Fallbacks when the package SKILL.md lacks frontmatter fields. */
    payloadName?: string;
    payloadVersion?: string;
    payloadDescription?: string;
}
export interface SkillInstallResult {
    name: string;
    version: string;
    description: string;
    skillDir: string;
    skillMdPath: string;
    replaced: boolean;
    previousVersion: string | null;
    files: string[];
}
/** Directory-safe skill name: must round-trip as a single path segment. */
export declare function normalizeSkillName(value: unknown): string;
/**
 * Minimal YAML frontmatter scan for the fields installation needs. Skill
 * frontmatter in practice is flat scalars; nested keys are ignored rather
 * than mis-parsed.
 */
export declare function parseSkillFrontmatter(markdown: string): {
    name?: string;
    version?: string;
    description?: string;
};
/**
 * Read the install descriptor out of a `metabot-skill` protocol pin record
 * (as returned by the pin-read API). Accepts the payload field spellings
 * seen across publishers, matching the IDBots protocolPinContent parser.
 */
export declare function extractSkillPinDescriptor(pin: {
    payload?: unknown;
    creator?: {
        globalMetaId?: unknown;
        name?: unknown;
    };
}): {
    name: string;
    description: string;
    version: string;
    skillFileUri: string;
} | null;
/**
 * Download a skill package archive. `contentReference` is the pin payload's
 * package URI (`metafile://<pinId>[.zip]`) or a plain https URL; resolution
 * and URL fallbacks reuse the MetaApp artifact download path.
 */
export declare function downloadSkillArchive(input: {
    contentReference: string;
    fetchImpl: typeof fetch;
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<Buffer>;
export declare function readInstalledSkillsRegistry(skillsRoot: string): Promise<InstalledSkillsRegistry>;
export declare function writeInstalledSkillsRegistry(skillsRoot: string, registry: InstalledSkillsRegistry): Promise<void>;
/**
 * Install an already-downloaded skill package archive under the shared skills
 * root. Existing installations of the same name are replaced in place (same
 * publisher or explicit override); a name owned by a different publisher or
 * by a non-registry local skill is a conflict, not a clobber.
 */
export declare function installSkillArchive(input: {
    skillsRoot: string;
    archive: Buffer;
    source?: SkillInstallSource;
    force?: boolean;
    now?: () => number;
}): Promise<SkillInstallResult>;
/** Full flow: download the package archive, then install it. */
export declare function installSkillFromReference(input: {
    skillsRoot: string;
    contentReference: string;
    fetchImpl: typeof fetch;
    source?: SkillInstallSource;
    force?: boolean;
    maxBytes?: number;
    now?: () => number;
}): Promise<SkillInstallResult>;
/** Registry view enriched with on-disk presence, for `skills list`. */
export declare function listInstalledSkills(skillsRoot: string): Promise<Array<InstalledSkillRecord & {
    present: boolean;
}>>;
/** Load one installed skill's SKILL.md and file listing, for `skills read`. */
export declare function readInstalledSkill(input: {
    skillsRoot: string;
    name: string;
}): Promise<{
    name: string;
    skillDir: string;
    skillMdPath: string;
    skillMd: string;
    files: string[];
}>;
/** Remove one chain-installed skill (registry entry + directory). Built-in/local skills are refused. */
export declare function uninstallInstalledSkill(input: {
    skillsRoot: string;
    name: string;
}): Promise<{
    name: string;
    removedDir: boolean;
}>;
