import type { BaseSkillContract, SkillPermissionScope } from './skillContractTypes';

const BASE_SKILL_REGISTRY: Record<string, BaseSkillContract> = {
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

