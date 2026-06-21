export interface VerifyMetafileAvailabilityInput {
    pinId: string;
    fetchImpl?: typeof fetch;
    attempts?: number;
    delayMs?: number;
}
export interface VerifyMetafileAvailabilityResult {
    ok: boolean;
    url: string | null;
    attempts: number;
    error?: string;
}
export declare function verifyMetafileAvailability(input: VerifyMetafileAvailabilityInput): Promise<VerifyMetafileAvailabilityResult>;
