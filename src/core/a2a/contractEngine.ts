/**
 * A2A collaboration contract state machine.
 *
 * A collaboration contract is the middle layer between a bare peer A2A chat and
 * a paid service order. It carries a shared spec reference, roles, deadlines,
 * verifiable acceptance criteria, and a state machine that only moves forward
 * through explicit events. Once a contract is locked, further discussion is
 * forbidden unless a spec discrepancy is filed as a bug (reopen).
 *
 * This module is pure logic: it does not touch transport, persistence or
 * routing. The wire encoding lives in `./protocol/contractProtocol` and the
 * conversation-session shape lives in `./conversationTypes`.
 */

export type A2AContractState =
  | 'draft'
  | 'proposed'
  | 'open'
  | 'decided'
  | 'locked'
  | 'rejected'
  | 'closed';

export type A2AContractEventKind =
  | 'propose' // draft -> proposed: spec owner finalizes and submits
  | 'confirm' // proposed -> open: both sides confirm, contract effective
  | 'objection' // proposed | open -> draft: objection with a position, back to revision
  | 'insufficient' // proposed | open -> draft: missing information, back to revision
  | 'decide' // open -> decided: direction decided, work can start
  | 'accept' // open | decided -> locked: acceptance passes, frozen
  | 'reopen' // locked -> open: spec discrepancy (bug), reopened as a bug record
  | 'reject' // draft | proposed | open -> rejected: rejected / abandoned
  | 'bye'; // any non-terminal -> closed: explicit close

export interface A2AContractRoles {
  specOwner: string;
  contributors: string[];
  acceptanceOwner: string;
}

export interface A2AContractDeadlines {
  firstResponseDeadline?: number | null;
  deliveryDeadline?: number | null;
}

export interface A2AContractDeliveryFact {
  deliveryTxid?: string | null;
  acceptanceState?: 'accepted' | 'rejected' | 'pending' | null;
  deadlineMet?: boolean | null;
  recordedAt: number;
}

export interface A2AContractRecord {
  contractId: string;
  specRef: string;
  roles: A2AContractRoles;
  state: A2AContractState;
  deadlines: A2AContractDeadlines;
  acceptance?: string | null;
  openQuestions: string[];
  deliveryFacts: A2AContractDeliveryFact[];
  createdAt: number;
  updatedAt: number;
  revisionNote?: string | null;
}

export interface A2AContractMutation {
  contract: A2AContractRecord;
  event: A2AContractEventKind;
  previousState: A2AContractState;
}

export interface CreateA2AContractInput {
  specRef: string;
  roles: A2AContractRoles;
  deadlines?: A2AContractDeadlines;
  acceptance?: string | null;
  openQuestions?: string[];
}

export interface ApplyA2AContractEventInput {
  contract: A2AContractRecord;
  event: A2AContractEventKind;
  note?: string | null;
}

export interface A2AContractEngineOptions {
  now?: () => number;
  createContractId?: () => string;
}

export interface A2AContractEngine {
  createDraft(input: CreateA2AContractInput): A2AContractRecord;
  canApplyEvent(contract: A2AContractRecord, event: A2AContractEventKind): boolean;
  applyEvent(input: ApplyA2AContractEventInput): A2AContractMutation;
}

const CONTRACT_TRANSITIONS: Record<A2AContractEventKind, Partial<Record<A2AContractState, A2AContractState>>> = {
  propose: { draft: 'proposed' },
  confirm: { proposed: 'open' },
  objection: { proposed: 'draft', open: 'draft' },
  insufficient: { proposed: 'draft', open: 'draft' },
  decide: { open: 'decided' },
  accept: { open: 'locked', decided: 'locked' },
  reopen: { locked: 'open' },
  reject: { draft: 'rejected', proposed: 'rejected', open: 'rejected' },
  bye: {
    draft: 'closed',
    proposed: 'closed',
    open: 'closed',
    decided: 'closed',
    locked: 'closed',
    rejected: 'closed',
  },
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalDeadline(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.trunc(normalized) : null;
}

function normalizeRoles(value: unknown): A2AContractRoles {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const contributors = Array.isArray(record.contributors)
    ? (record.contributors as unknown[]).map(normalizeText).filter(Boolean)
    : [];
  return {
    specOwner: normalizeText(record.specOwner) || normalizeText(record.spec_owner),
    contributors,
    acceptanceOwner: normalizeText(record.acceptanceOwner) || normalizeText(record.acceptance_owner),
  };
}

function normalizeOpenQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[]).map(normalizeText).filter(Boolean);
}

export function createA2AContractEngine(options: A2AContractEngineOptions = {}): A2AContractEngine {
  let fallbackIdSequence = 0;
  const now = options.now ?? (() => Date.now());
  const createContractId = options.createContractId
    ?? (() => `contract-${now().toString(36)}-${(++fallbackIdSequence).toString(36)}`);

  const createDraft = (input: CreateA2AContractInput): A2AContractRecord => {
    const timestamp = now();
    return {
      contractId: createContractId(),
      specRef: normalizeText(input.specRef),
      roles: normalizeRoles(input.roles),
      state: 'draft',
      deadlines: {
        firstResponseDeadline: normalizeOptionalDeadline(input.deadlines?.firstResponseDeadline),
        deliveryDeadline: normalizeOptionalDeadline(input.deadlines?.deliveryDeadline),
      },
      acceptance: normalizeText(input.acceptance) || null,
      openQuestions: normalizeOpenQuestions(input.openQuestions),
      deliveryFacts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  const canApplyEvent = (contract: A2AContractRecord, event: A2AContractEventKind): boolean =>
    Boolean(CONTRACT_TRANSITIONS[event]?.[contract.state]);

  const applyEvent = (input: ApplyA2AContractEventInput): A2AContractMutation => {
    const previousState = input.contract.state;
    const nextState = CONTRACT_TRANSITIONS[input.event]?.[previousState];
    if (!nextState) {
      throw new Error(`Invalid A2A contract transition: ${previousState} --${input.event}--> ?`);
    }
    const timestamp = now();
    const note = normalizeText(input.note) || null;
    return {
      event: input.event,
      previousState,
      contract: {
        ...input.contract,
        state: nextState,
        updatedAt: timestamp,
        ...(note ? { revisionNote: note } : {}),
      },
    };
  };

  return { createDraft, canApplyEvent, applyEvent };
}
