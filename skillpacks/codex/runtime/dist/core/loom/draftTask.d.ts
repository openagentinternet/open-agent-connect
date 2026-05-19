import { type MetabotCommandResult } from '../contracts/commandResult';
import { type LoomValidationResult } from './validation';
export interface DraftLoomTaskInput {
    wish: string;
    allowInvalid: boolean;
    executePrompt: (input: {
        prompt: string;
        systemPrompt: string;
    }) => Promise<string>;
}
export interface DraftLoomTaskData {
    protocol: 'task';
    path: '/protocols/loom-task';
    valid: boolean;
    payload: unknown;
    validation: LoomValidationResult;
}
export declare function draftLoomTask(input: DraftLoomTaskInput): Promise<MetabotCommandResult<DraftLoomTaskData>>;
