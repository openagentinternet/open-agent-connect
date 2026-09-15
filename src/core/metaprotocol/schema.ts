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

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateNode(value: unknown, schema: Schema, path: string, errors: SchemaValidationIssue[]): void {
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type && !typeMatches(value, type)) {
    errors.push({ path, message: `must be of type ${type}` });
    return;
  }

  if (typeof schema.enum === 'object' && Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.some((option) => option === value)) {
      errors.push({ path, message: `must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}` });
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.trim().length < schema.minLength) {
      errors.push({ path, message: `must be at least ${schema.minLength} character(s) long` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `must match the pattern ${schema.pattern}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      value.forEach((item, index) => {
        validateNode(item, schema.items as Schema, `${path}[${index}]`, errors);
      });
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {}) as Record<string, Schema>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in record)) {
          errors.push({ path, message: `is missing the required field "${key}"` });
        }
      }
    }
    for (const [key, subschema] of Object.entries(properties)) {
      if (key in record) {
        validateNode(record[key], subschema, path ? `${path}.${key}` : key, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(properties));
      for (const key of Object.keys(record)) {
        if (!known.has(key)) {
          errors.push({ path, message: `has an unexpected field "${key}"` });
        }
      }
    }
  }
}

export function validateAgainstSchema(value: unknown, schema: Schema): SchemaValidationResult {
  const errors: SchemaValidationIssue[] = [];
  validateNode(value, schema, '', errors);
  return { ok: errors.length === 0, errors };
}

/** Draft-07 gate for the §5.3 on-chain body JSON of a metaprotocol registration pin. */
export const METAPROTOCOL_PIN_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'path', 'version', 'authors', 'intro', 'protocolName', 'protocolAttachments', 'metadata', 'protocolContent', 'protocolContentType'],
  properties: {
    title: { type: 'string', minLength: 1 },
    path: { type: 'string', pattern: '^/protocols/[a-z0-9_]+(/[a-z0-9_]+)*$' },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    authors: { type: 'string' },
    intro: { type: 'string' },
    protocolName: { type: 'string', minLength: 1 },
    protocolAttachments: { type: 'array', items: { type: 'string' } },
    // metadata is free-form: object, or string (the on-chain default is '').
    metadata: {},
    protocolContent: { type: 'string', minLength: 1 },
    protocolContentType: {
      type: 'string',
      enum: [
        'application/json',
        'application/json5',
        'application/xml',
        'text/plain',
        'text/html',
        'application/javascript',
        'application/yaml',
      ],
    },
  },
};
