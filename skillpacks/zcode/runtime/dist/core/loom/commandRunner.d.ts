export interface LoomCommandRunInput {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    shell?: boolean;
}
export interface LoomCommandRunResult {
    command: string;
    args: string[];
    cwd?: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
}
export interface LoomCommandRunner {
    run(input: LoomCommandRunInput): Promise<LoomCommandRunResult>;
}
export declare function createNodeLoomCommandRunner(): LoomCommandRunner;
