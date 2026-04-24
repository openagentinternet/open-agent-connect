import { type MetabotPaths } from './paths';
export interface ExportStore {
    paths: MetabotPaths;
    ensureLayout(): Promise<MetabotPaths>;
    writeJson(name: string, value: unknown): Promise<string>;
    writeMarkdown(name: string, content: string): Promise<string>;
}
export declare function createExportStore(homeDirOrPaths: string | MetabotPaths): ExportStore;
