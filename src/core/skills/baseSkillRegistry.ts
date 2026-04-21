import type { BaseSkillContract, SkillPermissionScope } from './skillContractTypes';

const BASE_SKILL_REGISTRY: Record<string, BaseSkillContract> = {
  'metabot-ask-master': {
    skillName: 'metabot-ask-master',
    title: 'MetaBot Ask Master',
    summary: 'Preview, confirm, and inspect one Ask Master request across manual / suggest / auto flows through the validated master runtime.',
    instructions: 'Use metabot master list to resolve a target Master. In manual flow, start with metabot master ask --request-file so the runtime can prepare preview metadata; when confirmationMode=never, the runtime may continue immediately after request preparation instead of waiting for confirm. Accepted suggest flows follow the same local confirmation rule. Auto flows may stop at preview/confirm or direct-send depending local policy. confirmationMode=always / sensitive_only / never stays a local policy boundary: always requires preview/confirm, sensitive_only only allows direct send for trusted non-sensitive auto payloads, and never allows immediate manual/suggest continuation plus trusted safe auto direct send when explicit auto policy enables it. Stop on failure instead of falling back to private chat, advisor commands, simplemsg, or services call.',
    commandTemplate: 'metabot master ask --request-file master-request.json',
    outputExpectation: 'Return structured JSON. Manual and suggest flows usually surface awaiting_confirmation with preview, traceId, and requestId, but confirmationMode=never may continue immediately after request preparation. Auto may also stop at awaiting_confirmation when local policy selects preview_confirm; direct_send is only valid when local config/policy explicitly allows it. After confirm or direct send, follow with metabot master trace --id when more evidence is needed.',
    fallbackPolicy: 'If no matching Master is available, local policy blocks auto send, or the human declines confirmation, stop and surface the failure. Do not fall back to private chat, simplemsg, advisor commands, or services call.',
    scope: {
      allowedCommands: [
        'metabot master list --online',
        'metabot master ask --request-file master-request.json',
        'metabot master ask --trace-id trace-master-123 --confirm',
        'metabot master trace --id trace-master-123',
      ],
      chainRead: true,
      chainWrite: true,
      localUiOpen: false,
      remoteDelegation: true,
    },
  },
  'metabot-network-directory': {
    skillName: 'metabot-network-directory',
    title: 'MetaBot Network Directory',
    summary: 'Resolve machine-first online MetaBot services before optional human UI browsing.',
    instructions: 'Run the machine-first online services command and prefer structured output for agent continuation.',
    commandTemplate: 'metabot network services --online',
    outputExpectation: 'Return structured JSON with a services array suitable for selecting a remote MetaBot.',
    fallbackPolicy: 'Only open the local hub page when a human explicitly asks to browse services.',
    scope: {
      allowedCommands: [
        'metabot network services --online',
        'metabot ui open --page hub',
      ],
      chainRead: true,
      chainWrite: false,
      localUiOpen: true,
      remoteDelegation: false,
    },
  },
};

function cloneScope(scope: SkillPermissionScope): SkillPermissionScope {
  return {
    allowedCommands: [...scope.allowedCommands],
    chainRead: scope.chainRead,
    chainWrite: scope.chainWrite,
    localUiOpen: scope.localUiOpen,
    remoteDelegation: scope.remoteDelegation,
  };
}

function cloneBaseSkillContract(contract: BaseSkillContract): BaseSkillContract {
  return {
    skillName: contract.skillName,
    title: contract.title,
    summary: contract.summary,
    instructions: contract.instructions,
    commandTemplate: contract.commandTemplate,
    outputExpectation: contract.outputExpectation,
    fallbackPolicy: contract.fallbackPolicy,
    scope: cloneScope(contract.scope),
  };
}

export function listBaseSkillNames(): string[] {
  return Object.keys(BASE_SKILL_REGISTRY);
}

export function getBaseSkillContract(skillName: string): BaseSkillContract {
  const contract = BASE_SKILL_REGISTRY[skillName];
  if (!contract) {
    throw new Error(`Unknown base skill contract: ${skillName}`);
  }
  return cloneBaseSkillContract(contract);
}
