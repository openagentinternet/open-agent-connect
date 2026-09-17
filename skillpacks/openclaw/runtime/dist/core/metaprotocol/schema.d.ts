/**
 * Minimal JSON Schema draft-07 validator covering exactly the keyword subset
 * the metaprotocol pin schema uses (see METAPROTOCOL_PIN_SCHEMA below):
 * type / required / properties / additionalProperties:false / enum / pattern
 * / minLength / items. Zero-dependency by design (ajv is not a dependency of
 * this repo). This validator is the pre-write gate for metaprotocol publish
 * and update payloads — invalid payloads never reach the wallet. OAC port of
 * the IDBots agentpediaSchemaValidator subset.
 */
export interface SchemaValidationIssue {
    path: string;
    message: string;
}
export interface SchemaValidationResult {
    ok: boolean;
    errors: SchemaValidationIssue[];
}
type Schema = Record<string, unknown>;
export declare function validateAgainstSchema(value: unknown, schema: Schema): SchemaValidationResult;
/** Draft-07 gate for the §5.3 on-chain body JSON of a metaprotocol registration pin. */
export declare const METAPROTOCOL_PIN_SCHEMA: Schema;
export {};
