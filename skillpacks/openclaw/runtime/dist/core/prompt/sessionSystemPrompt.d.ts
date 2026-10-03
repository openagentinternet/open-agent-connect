import type { MetabotPaths } from '../state/paths';
export declare function buildPersonaSessionSystemPrompt(paths: MetabotPaths, input: {
    scenario: string;
}): Promise<string>;
