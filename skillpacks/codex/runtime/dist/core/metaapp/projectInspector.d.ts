import type { MetaAppPreviewPlan } from './types';
export declare function inspectMetaAppProject(input: {
    cwd?: string;
    projectDir: string;
    manifestFile?: string;
}): Promise<MetaAppPreviewPlan>;
