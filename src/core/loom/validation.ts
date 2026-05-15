import { LOOM_PROTOCOLS, type LoomProtocolName } from './protocols';

export interface LoomValidationError {
  path: string;
  code: string;
  message: string;
}

export interface LoomValidationResult {
  valid: boolean;
  protocol: LoomProtocolName;
  path: string;
  errors: LoomValidationError[];
}

type JsonObject = Record<string, unknown>;

const PIN_ID_RE = /^[0-9a-fA-F]{64}i\d+$/;
const POSITIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const BOUNTY_CURRENCIES = new Set(['SPACE', 'BTC', 'DOGE', 'OPCAT']);
const PROJECT_BASES = new Set(['github', 'chain']);
const DELIVERY_BASES = new Set(['github', 'chain']);
const STATUS_VALUES = new Set(['started', 'in_progress', 'completed', 'failed']);
const ACCEPTANCE_VERDICTS = new Set(['passed', 'rejected', 'revision_needed']);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function addError(
  errors: LoomValidationError[],
  path: string,
  code: string,
  message: string,
): void {
  errors.push({ path, code, message });
}

function fieldPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function requireObject(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): JsonObject | null {
  const path = fieldPath(prefix, key);
  if (!hasOwn(object, key)) {
    addError(errors, path, 'required', `${path} is required.`);
    return null;
  }
  const value = object[key];
  if (!isObject(value)) {
    addError(errors, path, 'invalid_type', `${path} must be an object.`);
    return null;
  }
  return value;
}

function requireNonEmptyString(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): void {
  const path = fieldPath(prefix, key);
  if (!hasOwn(object, key)) {
    addError(errors, path, 'required', `${path} is required.`);
    return;
  }
  if (!isNonEmptyString(object[key])) {
    addError(errors, path, 'invalid_string', `${path} must be a non-empty string.`);
  }
}

function requirePinId(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): void {
  const path = fieldPath(prefix, key);
  requireNonEmptyString(object, key, errors, prefix);
  const value = object[key];
  if (isNonEmptyString(value) && !PIN_ID_RE.test(value)) {
    addError(errors, path, 'invalid_pin_id', `${path} must be a PINID-like string.`);
  }
}

function validateOptionalTimestamp(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): void {
  if (!hasOwn(object, key) || object[key] === undefined || object[key] === null) {
    return;
  }
  const path = fieldPath(prefix, key);
  const value = object[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    addError(errors, path, 'invalid_timestamp', `${path} must be a positive millisecond timestamp.`);
  }
}

function requireEnum(
  object: JsonObject,
  key: string,
  values: Set<string>,
  errors: LoomValidationError[],
  prefix = '',
): void {
  const path = fieldPath(prefix, key);
  requireNonEmptyString(object, key, errors, prefix);
  const value = object[key];
  if (isNonEmptyString(value) && !values.has(value)) {
    addError(errors, path, 'invalid_enum', `${path} must be one of: ${Array.from(values).join(', ')}.`);
  }
}

function validateMetafileUriArray(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): void {
  const path = fieldPath(prefix, key);
  if (!hasOwn(object, key) || object[key] === undefined || object[key] === null) {
    return;
  }
  const value = object[key];
  if (!Array.isArray(value)) {
    addError(errors, path, 'invalid_type', `${path} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}.${index}`;
    if (!isNonEmptyString(item) || !item.startsWith('metafile://')) {
      addError(errors, itemPath, 'invalid_metafile_uri', `${itemPath} must be a metafile:// URI.`);
    }
  }
}

function validateStringArray(
  object: JsonObject,
  key: string,
  errors: LoomValidationError[],
  prefix = '',
): void {
  const path = fieldPath(prefix, key);
  if (!hasOwn(object, key) || object[key] === undefined || object[key] === null) {
    return;
  }
  const value = object[key];
  if (!Array.isArray(value)) {
    addError(errors, path, 'invalid_type', `${path} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      const itemPath = `${path}.${index}`;
      addError(errors, itemPath, 'invalid_string', `${itemPath} must be a non-empty string.`);
    }
  }
}

function validateTask(payload: JsonObject, errors: LoomValidationError[]): void {
  requireNonEmptyString(payload, 'title', errors);
  requireNonEmptyString(payload, 'requirementContentType', errors);
  requireNonEmptyString(payload, 'requirement', errors);
  requireNonEmptyString(payload, 'criteriaContentType', errors);
  requireNonEmptyString(payload, 'criteria', errors);
  requireEnum(payload, 'projectBase', PROJECT_BASES, errors);

  const project = requireObject(payload, 'project', errors);
  if (project && payload.projectBase === 'github') {
    requireNonEmptyString(project, 'repoUri', errors, 'project');
    requireNonEmptyString(project, 'baseBranch', errors, 'project');
  }

  const bounty = requireObject(payload, 'bounty', errors);
  if (bounty) {
    requireNonEmptyString(bounty, 'amount', errors, 'bounty');
    if (isNonEmptyString(bounty.amount)) {
      const amount = Number(bounty.amount);
      if (!POSITIVE_DECIMAL_RE.test(bounty.amount) || amount <= 0) {
        addError(errors, 'bounty.amount', 'invalid_decimal', 'bounty.amount must be a positive decimal string.');
      }
    }
    requireEnum(bounty, 'currency', BOUNTY_CURRENCIES, errors, 'bounty');
  }

  validateOptionalTimestamp(payload, 'deadline', errors);
  validateStringArray(payload, 'tags', errors);
  validateMetafileUriArray(payload, 'attachments', errors);
}

function validateClaim(payload: JsonObject, errors: LoomValidationError[]): void {
  requirePinId(payload, 'taskPinId', errors);
  requireNonEmptyString(payload, 'payoutAddress', errors);
  validateOptionalTimestamp(payload, 'estimatedStartAt', errors);
  if (hasOwn(payload, 'message')) {
    requireNonEmptyString(payload, 'message', errors);
  }
}

function validateStatus(payload: JsonObject, errors: LoomValidationError[]): void {
  requirePinId(payload, 'taskPinId', errors);
  requirePinId(payload, 'claimPinId', errors);
  requireEnum(payload, 'status', STATUS_VALUES, errors);
  requireNonEmptyString(payload, 'progressSummary', errors);
  if (hasOwn(payload, 'branchName')) {
    requireNonEmptyString(payload, 'branchName', errors);
  }

  if (hasOwn(payload, 'commits') && payload.commits !== undefined && payload.commits !== null) {
    if (!Array.isArray(payload.commits)) {
      addError(errors, 'commits', 'invalid_type', 'commits must be an array.');
    } else {
      for (const [index, commit] of payload.commits.entries()) {
        const path = `commits.${index}`;
        if (!isObject(commit)) {
          addError(errors, path, 'invalid_type', `${path} must be an object.`);
          continue;
        }
        requireNonEmptyString(commit, 'sha', errors, path);
        requireNonEmptyString(commit, 'message', errors, path);
        validateStringArray(commit, 'files', errors, path);
      }
    }
  }

  validateMetafileUriArray(payload, 'processLogs', errors);
  validateMetafileUriArray(payload, 'artifactUris', errors);
}

function validateDelivery(payload: JsonObject, errors: LoomValidationError[]): void {
  requirePinId(payload, 'taskPinId', errors);
  requirePinId(payload, 'claimPinId', errors);
  requireEnum(payload, 'deliveryBase', DELIVERY_BASES, errors);
  requireNonEmptyString(payload, 'deliverySummary', errors);
  requireObject(payload, 'delivery', errors);

  if (!hasOwn(payload, 'reviewChecklist')) {
    addError(errors, 'reviewChecklist', 'required', 'reviewChecklist is required.');
  } else if (!Array.isArray(payload.reviewChecklist)) {
    addError(errors, 'reviewChecklist', 'invalid_type', 'reviewChecklist must be an array.');
  } else {
    for (const [index, entry] of payload.reviewChecklist.entries()) {
      const path = `reviewChecklist.${index}`;
      if (!isObject(entry)) {
        addError(errors, path, 'invalid_type', `${path} must be an object.`);
        continue;
      }
      requireNonEmptyString(entry, 'item', errors, path);
      requireEnum(entry, 'status', new Set(['passed']), errors, path);
    }
  }

  validateMetafileUriArray(payload, 'attachments', errors);
}

function validateAcceptance(payload: JsonObject, errors: LoomValidationError[]): void {
  requirePinId(payload, 'taskPinId', errors);
  requirePinId(payload, 'deliveryPinId', errors);
  requireEnum(payload, 'verdict', ACCEPTANCE_VERDICTS, errors);
  requireNonEmptyString(payload, 'comment', errors);

  if (!hasOwn(payload, 'score')) {
    addError(errors, 'score', 'required', 'score is required.');
  } else {
    const score = payload.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      addError(errors, 'score', 'invalid_score', 'score must be an integer from 1 to 5.');
    }
  }

  if (!hasOwn(payload, 'releasePayment')) {
    addError(errors, 'releasePayment', 'required', 'releasePayment is required.');
  } else if (typeof payload.releasePayment !== 'boolean') {
    addError(errors, 'releasePayment', 'invalid_type', 'releasePayment must be a boolean.');
  }

  if (payload.verdict === 'passed') {
    if (payload.releasePayment !== true) {
      addError(errors, 'releasePayment', 'invalid_payment_state', 'passed acceptance requires releasePayment: true.');
    }
    if (!isNonEmptyString(payload.paymentTxId)) {
      addError(errors, 'paymentTxId', 'required', 'passed acceptance requires a non-empty paymentTxId.');
    }
  }

  if (payload.verdict === 'rejected' || payload.verdict === 'revision_needed') {
    if (payload.releasePayment !== false) {
      addError(errors, 'releasePayment', 'invalid_payment_state', `${payload.verdict} requires releasePayment: false.`);
    }
    if (hasOwn(payload, 'paymentTxId')) {
      addError(errors, 'paymentTxId', 'invalid_payment_state', `${payload.verdict} must not include paymentTxId.`);
    }
  }

  validateMetafileUriArray(payload, 'attachments', errors);
}

function validateClaimReject(payload: JsonObject, errors: LoomValidationError[]): void {
  requirePinId(payload, 'taskPinId', errors);
  requirePinId(payload, 'claimPinId', errors);
  requireNonEmptyString(payload, 'reason', errors);
  validateMetafileUriArray(payload, 'attachments', errors);
}

export function validateLoomPayload(
  protocol: LoomProtocolName,
  payload: unknown,
): LoomValidationResult {
  const spec = LOOM_PROTOCOLS[protocol];
  const errors: LoomValidationError[] = [];

  if (!isObject(payload)) {
    addError(errors, '', 'invalid_type', 'payload must be an object.');
    return {
      valid: false,
      protocol,
      path: spec.path,
      errors,
    };
  }

  switch (protocol) {
    case 'task':
      validateTask(payload, errors);
      break;
    case 'claim':
      validateClaim(payload, errors);
      break;
    case 'status':
      validateStatus(payload, errors);
      break;
    case 'delivery':
      validateDelivery(payload, errors);
      break;
    case 'acceptance':
      validateAcceptance(payload, errors);
      break;
    case 'claim-reject':
      validateClaimReject(payload, errors);
      break;
  }

  return {
    valid: errors.length === 0,
    protocol,
    path: spec.path,
    errors,
  };
}
