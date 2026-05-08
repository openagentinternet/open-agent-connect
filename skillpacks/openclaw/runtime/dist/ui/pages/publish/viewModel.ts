export interface PublishDefinitionRow {
  label: string;
  value: string;
}

export interface PublishProviderCardViewModel {
  title: string;
  summary: string;
  rows: PublishDefinitionRow[];
}

export interface PublishResultCardViewModel {
  hasResult: boolean;
  title: string;
  summary: string;
  rows: PublishDefinitionRow[];
}

export interface PublishSkillOptionViewModel {
  value: string;
  label: string;
  title: string;
  description: string;
}

export interface PublishAvailabilityViewModel {
  canPublish: boolean;
  reasonCode: string;
  message: string;
}

export interface PublishPageViewModel {
  providerCard: PublishProviderCardViewModel;
  runtimeCard: PublishProviderCardViewModel;
  resultCard: PublishResultCardViewModel;
  skills: PublishSkillOptionViewModel[];
  availability: PublishAvailabilityViewModel;
}

export function buildPublishPageViewModel(input: {
  providerSummary?: Record<string, unknown> | null;
  publishSkills?: Record<string, unknown> | null;
  publishSkillsError?: Record<string, unknown> | null;
  publishResult?: Record<string, unknown> | null;
}): PublishPageViewModel {
  const normalizeText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  const readObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  const pushRow = (rows: PublishDefinitionRow[], label: string, value: unknown): void => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return;
    }
    rows.push({ label, value: normalized });
  };

  const providerSummary = input.providerSummary && typeof input.providerSummary === 'object'
    ? input.providerSummary
    : {};
  const publishSkills = input.publishSkills && typeof input.publishSkills === 'object'
    ? input.publishSkills
    : {};
  const publishSkillsError = input.publishSkillsError && typeof input.publishSkillsError === 'object'
    ? input.publishSkillsError
    : {};
  const summaryIdentity = readObject(providerSummary.identity);
  const catalogIdentity = readObject(publishSkills.identity);
  const identity = {
    ...catalogIdentity,
    ...summaryIdentity,
  };
  const runtime = readObject(publishSkills.runtime);
  const publishResult = input.publishResult && typeof input.publishResult === 'object'
    ? input.publishResult
    : {};
  const rootDiagnostics = Array.isArray(publishSkills.rootDiagnostics)
    ? publishSkills.rootDiagnostics.filter((entry): entry is Record<string, unknown> => (
        entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ))
    : [];
  const readableRootCount = rootDiagnostics.filter((entry) => normalizeText(entry.status) === 'readable').length;
  const skills = Array.isArray(publishSkills.skills)
    ? publishSkills.skills
        .filter((entry): entry is Record<string, unknown> => (
          entry !== null && typeof entry === 'object' && !Array.isArray(entry) && Boolean(normalizeText(entry.skillName))
        ))
        .map((entry) => {
          const skillName = normalizeText(entry.skillName);
          return {
            value: skillName,
            label: skillName,
            title: normalizeText(entry.title),
            description: normalizeText(entry.description),
          };
        })
    : [];

  const providerRows: PublishDefinitionRow[] = [];
  pushRow(providerRows, 'Provider Name', identity.name);
  pushRow(providerRows, 'MetaBot Slug', publishSkills.metaBotSlug);
  pushRow(providerRows, 'Provider GlobalMetaId', identity.globalMetaId);
  pushRow(providerRows, 'Payment Address', identity.mvcAddress);

  const runtimeRows: PublishDefinitionRow[] = [];
  pushRow(runtimeRows, 'Runtime', runtime.displayName);
  pushRow(runtimeRows, 'Provider', runtime.provider);
  pushRow(runtimeRows, 'Health', runtime.health);
  pushRow(runtimeRows, 'Version', runtime.version);
  if (rootDiagnostics.length > 0) {
    pushRow(runtimeRows, 'Readable Roots', `${readableRootCount} / ${rootDiagnostics.length}`);
  }

  const identityGlobalMetaId = normalizeText(identity.globalMetaId);
  const runtimeHealth = normalizeText(runtime.health);
  const errorCode = normalizeText(publishSkillsError.code);
  const errorMessage = normalizeText(publishSkillsError.message);
  let availability: PublishAvailabilityViewModel;
  if (!identityGlobalMetaId) {
    availability = {
      canPublish: false,
      reasonCode: 'identity_missing',
      message: 'Create a local MetaBot identity before publishing services.',
    };
  } else if (errorCode) {
    availability = {
      canPublish: false,
      reasonCode: errorCode,
      message: errorMessage || 'The primary runtime catalog is unavailable.',
    };
  } else if (!normalizeText(runtime.id) && !normalizeText(runtime.provider)) {
    availability = {
      canPublish: false,
      reasonCode: 'primary_runtime_missing',
      message: 'The selected MetaBot has no enabled primary runtime binding.',
    };
  } else if (runtimeHealth && runtimeHealth !== 'healthy') {
    availability = {
      canPublish: false,
      reasonCode: 'primary_runtime_unavailable',
      message: 'The selected MetaBot primary runtime is not healthy.',
    };
  } else if (rootDiagnostics.length > 0 && readableRootCount === 0) {
    availability = {
      canPublish: false,
      reasonCode: 'primary_skill_roots_unreadable',
      message: 'No readable primary runtime skill roots are available.',
    };
  } else if (skills.length === 0) {
    availability = {
      canPublish: false,
      reasonCode: 'provider_skill_missing',
      message: 'No primary runtime skills are available for service publishing.',
    };
  } else {
    availability = {
      canPublish: true,
      reasonCode: 'ready',
      message: 'Ready to publish with the selected primary runtime skill.',
    };
  }

  const runtimeSummary = errorCode
    ? errorMessage || 'No enabled primary runtime is available for publishing.'
    : normalizeText(runtime.displayName)
      ? `${normalizeText(runtime.displayName)} is the ${runtimeHealth || 'unknown'} primary runtime used for publish validation.`
      : 'No enabled primary runtime is available for publishing.';

  const resultRows: PublishDefinitionRow[] = [];
  pushRow(resultRows, 'Service Pin ID', publishResult.servicePinId);
  pushRow(resultRows, 'Source Pin ID', publishResult.sourceServicePinId);
  pushRow(resultRows, 'Provider Skill', publishResult.providerSkill);
  pushRow(resultRows, 'Price', [
    normalizeText(publishResult.price),
    normalizeText(publishResult.currency),
  ].filter(Boolean).join(' '));
  pushRow(resultRows, 'Output Type', publishResult.outputType);
  pushRow(resultRows, 'Path', publishResult.path);

  return {
    providerCard: {
      title: 'Provider Identity',
      summary: normalizeText(identity.globalMetaId)
        ? 'This local MetaBot will publish the capability under its current chain identity.'
        : 'No local provider identity is loaded yet.',
      rows: providerRows,
    },
    runtimeCard: {
      title: 'Primary Runtime',
      summary: runtimeSummary,
      rows: runtimeRows,
    },
    resultCard: {
      hasResult: Boolean(normalizeText(publishResult.servicePinId)),
      title: 'Publish Result',
      summary: normalizeText(publishResult.servicePinId)
        ? 'The service has been published to MetaWeb and now has a real chain pin.'
        : 'No publish result yet. Submit the form to create one on-chain.',
      rows: resultRows,
    },
    skills,
    availability,
  };
}
