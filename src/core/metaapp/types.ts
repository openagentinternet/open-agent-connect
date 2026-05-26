export type MetaAppProjectType = 'static' | 'npm' | 'manual';

export type MetaAppPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export interface MetaAppManifestInput {
  title?: string;
  appName?: string;
  prompt?: string;
  icon?: string;
  coverImg?: string;
  introImgs?: string[];
  intro?: string;
  runtime?: string;
  version?: string;
  contentType?: string;
  content?: string;
  indexFile?: string;
  code?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  disabled?: boolean;
  codeType?: string;
  artifactDir?: string;
  sourceArchive?: boolean;
}

export interface MetaAppManualAction {
  code: string;
  message: string;
}

export interface MetaAppPreviewPlan {
  projectDir: string;
  projectType: MetaAppProjectType;
  artifactDir: string | null;
  indexFile: string;
  buildCommand: string | null;
  packageManager: MetaAppPackageManager | null;
  manifest: MetaAppManifestInput;
  manualAction?: MetaAppManualAction;
}
