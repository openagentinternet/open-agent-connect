import type { MetaAppManifestInput, MetaAppPreviewPlan } from './types';
export declare function normalizeMetaAppManifestInput(value: unknown): MetaAppManifestInput;
export declare function readMetaAppManifestFile(filePath: string): Promise<MetaAppManifestInput>;
export declare function buildMetaAppManifestDraft(plan: MetaAppPreviewPlan): MetaAppManifestInput;
