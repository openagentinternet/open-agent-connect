import { type MetabotCommandResult } from '../contracts/commandResult';
export interface LoomUiActionRequest {
    action: string;
    from?: string;
    confirm?: boolean;
    [key: string]: unknown;
}
export interface LoomUiActionService {
    run(input: LoomUiActionRequest): Promise<MetabotCommandResult<unknown>>;
}
type LoomUiWorkflowDependency = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
export interface LoomUiActionServiceDependencies {
    postTask: LoomUiWorkflowDependency;
    claimAndStart: LoomUiWorkflowDependency;
    runDevRound: LoomUiWorkflowDependency;
    deliver: LoomUiWorkflowDependency;
    acceptAndPay: LoomUiWorkflowDependency;
    reviewDelivery: LoomUiWorkflowDependency;
    dashboardAfterAction?: (input: {
        action: string;
        request: LoomUiActionRequest;
        result: MetabotCommandResult<unknown>;
    }) => Promise<unknown> | unknown;
}
export declare function createLoomUiActionService(dependencies: LoomUiActionServiceDependencies): LoomUiActionService;
export {};
