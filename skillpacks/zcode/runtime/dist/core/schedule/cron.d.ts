export interface CronFieldSet {
    /** Day-of-month bits; -1 when the field is unrestricted (`*`). */
    dom: Set<number> | null;
    /** Day-of-week bits (0-6, Sunday first); -1 when unrestricted (`*`). */
    dow: Set<number> | null;
    minute: Set<number>;
    hour: Set<number>;
    month: Set<number>;
}
export declare function parseCronExpression(expression: string): CronFieldSet;
/**
 * Next occurrence of the expression strictly after `afterMs`, in the
 * machine-local timezone, or null when none exists within 4 years.
 */
export declare function nextCronOccurrence(expression: string, afterMs: number): number | null;
