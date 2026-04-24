#!/usr/bin/env node
import { type CliContext } from './types';
export declare function runCli(argv: string[], cliContext?: CliContext): Promise<number>;
