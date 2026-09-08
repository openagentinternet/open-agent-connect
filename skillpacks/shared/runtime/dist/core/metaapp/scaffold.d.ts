import { type MetabotCommandResult } from '../contracts/commandResult';
export declare const METAAPP_SCAFFOLD_TEMPLATES: readonly ["blank", "demo"];
export type MetaAppScaffoldTemplate = (typeof METAAPP_SCAFFOLD_TEMPLATES)[number];
export interface MetaAppScaffoldInput {
    /** Target directory; created when missing. Relative paths resolve against `cwd`. */
    projectDir: string;
    cwd?: string;
    title?: string;
    appName?: string;
    template?: string;
    /** Overwrite the template's own files inside a non-empty directory. Other files are never touched. */
    force?: boolean;
}
export declare function scaffoldMetaAppProject(input: MetaAppScaffoldInput): Promise<MetabotCommandResult<Record<string, unknown>>>;
