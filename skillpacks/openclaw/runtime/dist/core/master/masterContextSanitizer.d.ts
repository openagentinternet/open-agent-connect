import type { MasterMessageArtifact } from './masterMessageSchema';
export declare function isSensitivePath(filePath: string | null): boolean;
export declare function hasSensitiveContent(content: string): boolean;
export declare function hasSensitivePathSnippet(value: unknown): boolean;
export declare function sanitizeRelevantFiles(value: unknown, limit: number): string[];
export declare function sanitizeSummaryText(value: unknown, options?: {
    rejectSensitivePaths?: boolean;
}): string | null;
export declare function sanitizeTaskText(value: unknown, fallback: string): string;
export declare function sanitizeConstraintList(value: unknown): string[];
export declare function sanitizeArtifacts(value: unknown, limit: number, maxChars: number): MasterMessageArtifact[];
