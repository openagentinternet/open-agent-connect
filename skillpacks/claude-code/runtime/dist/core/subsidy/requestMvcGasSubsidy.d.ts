export interface RequestMvcGasSubsidyOptions {
    mvcAddress: string;
    mnemonic?: string;
    path?: string;
}
export interface RequestMvcGasSubsidyResult {
    success: boolean;
    step1?: unknown;
    step2?: unknown;
    error?: string;
}
export interface RequestMvcGasSubsidyDependencies {
    addressInitUrl?: string;
    addressRewardUrl?: string;
    fetchImpl?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
    waitMs?: number;
}
export declare function requestMvcGasSubsidy(options: RequestMvcGasSubsidyOptions, dependencies?: RequestMvcGasSubsidyDependencies): Promise<RequestMvcGasSubsidyResult>;
