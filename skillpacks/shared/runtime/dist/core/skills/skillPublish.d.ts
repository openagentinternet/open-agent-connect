/**
 * On-chain skill package publishing — OAC port of the IDBots
 * metabot-post-skill producer half, the mirror of skillInstall. Packages a
 * local skill directory as a metabot-skill zip, uploads it as a `/file` pin,
 * and writes the `/protocols/metabot-skill` JSON pin that advertises it to
 * learners (publisher identity comes from pin authorship, never the payload).
 *
 * Stricter than the IDBots script on the three points the install side
 * depends on: the payload name must satisfy normalizeSkillName (otherwise the
 * package cannot be installed by payload name), `version` is required with no
 * default (consumers dedupe by name and keep the highest version), and the
 * pinned metadata is derived from the package SKILL.md frontmatter so the two
 * can never disagree — flags may override, the merged result must validate.
 */
import { type MetabotCommandResult } from '../contracts/commandResult';
/** Parity with IDBots: the protocol path learners and indexers scan. */
export declare const SKILL_PROTOCOL_PATH = "/protocols/metabot-skill";
export declare class SkillPublishError extends Error {
    code: 'invalid_project' | 'package_too_large' | 'invalid_metadata' | 'publish_failed';
    constructor(code: 'invalid_project' | 'package_too_large' | 'invalid_metadata' | 'publish_failed', message: string);
}
export interface SkillPublishUploadResult {
    pinId?: string;
    metafileUri?: string;
    txids?: string[];
    network?: string;
    [key: string]: unknown;
}
export interface SkillPublishChainResult {
    pinId?: string;
    firstPinId?: string;
    txids?: string[];
    totalCost?: number;
    network?: string;
    [key: string]: unknown;
}
export interface SkillPublishDependencies {
    uploadFile: (input: {
        filePath: string;
        contentType?: string;
        network?: string;
    }) => Promise<SkillPublishUploadResult>;
    writeChain: (input: Record<string, unknown>) => Promise<SkillPublishChainResult>;
    makeTempDir?: () => Promise<string>;
}
export interface SkillPublishInput {
    skillDir: string;
    name?: string;
    version?: string;
    description?: string;
    network?: string;
    confirm?: boolean;
}
export interface SkillPublishPlan {
    skillDir: string;
    skillMdPath: string;
    name: string;
    version: string;
    description: string;
    network: string;
    archive: {
        bytes: number;
        sha256: string;
        fileCount: number;
    };
    /** The pin payload as it will be written; `skill-file` is a placeholder until upload. */
    payload: Record<string, string>;
    warnings: string[];
}
export interface SkillPublishResult {
    name: string;
    version: string;
    description: string;
    pinId: string;
    skillFileUri: string;
    payload: Record<string, string>;
    archive: {
        bytes: number;
        sha256: string;
        fileCount: number;
    };
    upload: SkillPublishUploadResult;
    chainWrite: SkillPublishChainResult;
    formatted: string;
}
/**
 * The directory to package: the given dir when it carries the SKILL.md, else
 * its single skill-bearing subdirectory (the "pointed at the parent" case),
 * mirroring install's unwrap tolerance. Deeper nesting is ambiguous and
 * refused.
 */
export declare function resolveSkillPackageRoot(skillDir: string): Promise<{
    packageRoot: string;
    skillMdPath: string;
}>;
/** The canonical pin payload; only non-empty optional fields ride along. */
export declare function buildSkillPinPayload(input: {
    name: string;
    version: string;
    description?: string;
    skillFileUri: string;
}): Record<string, string>;
/**
 * Build the publish plan without writing anything: resolves the package root,
 * merges frontmatter with flag overrides, validates, and produces the real
 * archive so the confirmation shows actual bytes and checksum.
 */
export declare function previewSkillProject(input: SkillPublishInput, deps?: Pick<SkillPublishDependencies, 'makeTempDir'>): Promise<SkillPublishPlan>;
/**
 * Publish a skill directory on-chain. Without `confirm`, returns the
 * awaiting-confirmation envelope carrying the plan; with it, uploads the
 * package and writes the metabot-skill protocol pin.
 */
export declare function publishSkill(input: SkillPublishInput, deps: SkillPublishDependencies): Promise<MetabotCommandResult<SkillPublishResult | {
    plan: SkillPublishPlan;
    formatted: string;
}>>;
