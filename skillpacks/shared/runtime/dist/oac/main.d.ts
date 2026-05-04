#!/usr/bin/env node
export interface OacContext {
    stdout?: Pick<NodeJS.WriteStream, 'write'>;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}
export declare function runOac(argv: string[], contextInput?: OacContext): Promise<number>;
