"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishPageViewModel = buildPublishPageViewModel;
function buildPublishPageViewModel(input) {
    const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';
    const readObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const pushRow = (rows, label, value) => {
        const normalized = normalizeText(value);
        if (!normalized) {
            return;
        }
        rows.push({ label, value: normalized });
    };
    const providerSummary = input.providerSummary && typeof input.providerSummary === 'object'
        ? input.providerSummary
        : {};
    const selectedMetaBotSlug = normalizeText(input.selectedMetaBotSlug);
    const profiles = Array.isArray(input.profiles)
        ? input.profiles.filter((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry)))
        : [];
    const runtimes = Array.isArray(input.runtimes)
        ? input.runtimes.filter((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry)))
        : [];
    const availableRuntimeProviders = new Set(runtimes
        .filter((entry) => {
        const health = normalizeText(entry.health).toLowerCase();
        return normalizeText(entry.provider) && (health === 'healthy' || health === 'degraded');
    })
        .map((entry) => normalizeText(entry.provider)));
    const metabots = profiles
        .map((entry) => {
        const slug = normalizeText(entry.slug);
        const name = normalizeText(entry.name) || slug;
        const primaryProvider = normalizeText(entry.primaryProvider);
        return {
            value: slug,
            label: name,
            title: name,
            description: primaryProvider ? `Primary runtime: ${primaryProvider}` : '',
            globalMetaId: normalizeText(entry.globalMetaId),
            primaryProvider,
        };
    })
        .filter((entry) => (entry.value
        && entry.primaryProvider
        && (availableRuntimeProviders.size === 0 || availableRuntimeProviders.has(entry.primaryProvider))));
    const publishSkills = input.publishSkills && typeof input.publishSkills === 'object'
        ? input.publishSkills
        : {};
    const publishSkillsError = input.publishSkillsError && typeof input.publishSkillsError === 'object'
        ? input.publishSkillsError
        : {};
    const summaryIdentity = readObject(providerSummary.identity);
    const catalogIdentity = readObject(publishSkills.identity);
    const identity = {
        ...summaryIdentity,
        ...catalogIdentity,
    };
    const runtime = readObject(publishSkills.runtime);
    const rootDiagnostics = Array.isArray(publishSkills.rootDiagnostics)
        ? publishSkills.rootDiagnostics.filter((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry)))
        : [];
    const readableRootCount = rootDiagnostics.filter((entry) => normalizeText(entry.status) === 'readable').length;
    const skills = Array.isArray(publishSkills.skills)
        ? publishSkills.skills
            .filter((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry) && Boolean(normalizeText(entry.skillName))))
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
    const providerRows = [];
    pushRow(providerRows, 'Provider Name', identity.name);
    pushRow(providerRows, 'MetaBot Slug', publishSkills.metaBotSlug);
    pushRow(providerRows, 'Provider GlobalMetaId', identity.globalMetaId);
    pushRow(providerRows, 'Payment Address', identity.mvcAddress);
    const runtimeRows = [];
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
    let availability;
    if (!identityGlobalMetaId) {
        availability = {
            canPublish: false,
            reasonCode: 'identity_missing',
            message: selectedMetaBotSlug
                ? 'The selected MetaBot has no chained identity yet.'
                : 'Select a MetaBot with an available primary runtime before publishing.',
        };
    }
    else if (errorCode) {
        availability = {
            canPublish: false,
            reasonCode: errorCode,
            message: errorMessage || 'The primary runtime catalog is unavailable.',
        };
    }
    else if (!normalizeText(runtime.id) && !normalizeText(runtime.provider)) {
        availability = {
            canPublish: false,
            reasonCode: 'primary_runtime_missing',
            message: 'The selected MetaBot has no enabled primary runtime binding.',
        };
    }
    else if (runtimeHealth && runtimeHealth !== 'healthy') {
        availability = {
            canPublish: false,
            reasonCode: 'primary_runtime_unavailable',
            message: 'The selected MetaBot primary runtime is not healthy.',
        };
    }
    else if (rootDiagnostics.length > 0 && readableRootCount === 0) {
        availability = {
            canPublish: false,
            reasonCode: 'primary_skill_roots_unreadable',
            message: 'No readable primary runtime skill roots are available.',
        };
    }
    else if (skills.length === 0) {
        availability = {
            canPublish: false,
            reasonCode: 'provider_skill_missing',
            message: 'No primary runtime skills are available for service publishing.',
        };
    }
    else {
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
        metabots,
        selectedMetaBotSlug,
        skills,
        availability,
    };
}
