"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishPageViewModel = buildPublishPageViewModel;
function buildPublishPageViewModel(input) {
    // Localize through the injected translator when the caller provides one (the
    // browser page injects its i18n-backed uiText). Server-side callers (tests,
    // diagnostics) omit `t` and get the byte-identical English defaults.
    const replaceTokens = (template, replacements) => Object.keys(replacements || {}).reduce((text, name) => text.split('{' + name + '}').join(String((replacements || {})[name])), String(template == null ? '' : template));
    const t = input.t ?? ((_key, fallback, replacements) => replaceTokens(fallback ?? '', replacements));
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
        return normalizeText(entry.provider) && health === 'healthy';
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
            description: primaryProvider
                ? t('publish.primaryRuntime', 'Primary runtime: {provider}', { provider: primaryProvider })
                : '',
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
    pushRow(providerRows, t('publish.providerName', 'Provider Name'), identity.name);
    pushRow(providerRows, t('publish.metabotSlug', 'MetaBot Slug'), publishSkills.metaBotSlug);
    pushRow(providerRows, t('publish.providerGlobalMetaId', 'Provider GlobalMetaId'), identity.globalMetaId);
    pushRow(providerRows, t('publish.paymentAddress', 'Payment Address'), identity.mvcAddress);
    const runtimeRows = [];
    pushRow(runtimeRows, t('publish.runtime', 'Runtime'), runtime.displayName);
    pushRow(runtimeRows, t('publish.provider', 'Provider'), runtime.provider);
    pushRow(runtimeRows, t('publish.health', 'Health'), runtime.health);
    pushRow(runtimeRows, t('publish.version', 'Version'), runtime.version);
    if (rootDiagnostics.length > 0) {
        pushRow(runtimeRows, t('publish.readableRoots', 'Readable Roots'), t('publish.readableRootsCount', '{count} / {total}', {
            count: readableRootCount,
            total: rootDiagnostics.length,
        }));
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
                ? t('publish.identityMissing', 'The selected MetaBot has no chained identity yet.')
                : t('publish.selectMetabotFirst', 'Select a MetaBot with an available primary runtime before publishing.'),
        };
    }
    else if (errorCode) {
        availability = {
            canPublish: false,
            reasonCode: errorCode,
            message: errorMessage || t('publish.catalogUnavailable', 'The primary runtime catalog is unavailable.'),
        };
    }
    else if (!normalizeText(runtime.id) && !normalizeText(runtime.provider)) {
        availability = {
            canPublish: false,
            reasonCode: 'primary_runtime_missing',
            message: t('publish.primaryRuntimeMissing', 'The selected MetaBot has no enabled primary runtime binding.'),
        };
    }
    else if (runtimeHealth && runtimeHealth !== 'healthy') {
        availability = {
            canPublish: false,
            reasonCode: 'primary_runtime_unavailable',
            message: t('publish.primaryRuntimeUnhealthy', 'The selected MetaBot primary runtime is not healthy.'),
        };
    }
    else if (rootDiagnostics.length > 0 && readableRootCount === 0) {
        availability = {
            canPublish: false,
            reasonCode: 'primary_skill_roots_unreadable',
            message: t('publish.rootsUnreadable', 'No readable primary runtime skill roots are available.'),
        };
    }
    else if (skills.length === 0) {
        availability = {
            canPublish: false,
            reasonCode: 'provider_skill_missing',
            message: t('publish.noSkillsAvailable', 'No primary runtime skills are available for service publishing.'),
        };
    }
    else {
        availability = {
            canPublish: true,
            reasonCode: 'ready',
            message: t('publish.ready', 'Ready to publish with selected primary runtime skills.'),
        };
    }
    const runtimeSummary = errorCode
        ? errorMessage || t('publish.noRuntimeAvailable', 'No enabled primary runtime is available for publishing.')
        : normalizeText(runtime.displayName)
            ? t('publish.runtimeSummary', '{name} is the {health} primary runtime used for publish validation.', {
                name: normalizeText(runtime.displayName),
                health: runtimeHealth || t('publish.healthUnknown', 'unknown'),
            })
            : t('publish.noRuntimeAvailable', 'No enabled primary runtime is available for publishing.');
    return {
        providerCard: {
            title: t('publish.providerIdentityTitle', 'Provider Identity'),
            summary: normalizeText(identity.globalMetaId)
                ? t('publish.providerIdentityReady', 'This local MetaBot will publish the capability under its current chain identity.')
                : t('publish.providerIdentityMissing', 'No local provider identity is loaded yet.'),
            rows: providerRows,
        },
        runtimeCard: {
            title: t('publish.primaryRuntimeTitle', 'Primary Runtime'),
            summary: runtimeSummary,
            rows: runtimeRows,
        },
        metabots,
        selectedMetaBotSlug,
        skills,
        availability,
    };
}
