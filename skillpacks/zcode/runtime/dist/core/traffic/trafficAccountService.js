"use strict";
/**
 * Traffic account service client (account-quota billing, 「流量」).
 * Ported from IDBots src/main/services/trafficAccountService.ts onto OAC's
 * file-based stores: the machine-wide owner identity
 * (src/core/owner/ownerIdentity.ts) replaces IDBots' user_identity, the
 * identity-profile registry + per-profile secret stores replace the
 * MetaBot/wallet tables, and traffic.json + traffic-journal.jsonl under
 * ~/.metabot/owner/ (src/core/traffic/trafficStore.ts) replace the kvStore and
 * the SQLite traffic_spend_journal.
 *
 * Talks to the backend traffic APIs (/v1/traffic/*) with identity-signed
 * requests, manages the local account record and bot-address bindings, keeps
 * a ~30s in-memory balance cache (decremented locally on each sponsored
 * commit for instant UI feedback), and journals every locally-initiated
 * sponsored spend into the JSONL journal.
 *
 * Signature canonical strings follow the backend deployment doc
 * (assist-base-service docs/traffic-deployment.md §4) exactly:
 * - POST /v1/traffic/accounts:          "traffic-account:<accountId>:<ts>"
 * - POST /v1/traffic/accounts/bindings: "traffic-bind:<botAddress>:<accountId>:<ts>"
 *   (owner identity signs via X-Signature header, bot key signs via body botSignature)
 * - sponsor pre trafficAccount:         "traffic-pre:<accountId>:<challengeId>"
 * Headers: X-Identity-Address / X-Timestamp (unix seconds, ±300s) / X-Signature
 * (Bitcoin Signed Message compact, base64).
 *
 * Defensive by design: the accountId is always taken from the server response
 * and persisted locally (never assumed to equal the locally-computed
 * GlobalMetaID), and every failure in the sponsor-flow resolver degrades to
 * "no trafficAccount" so the legacy quota path keeps working while the
 * backend feature is off (404) or the bot is unbound.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRAFFIC_RECHARGE_STATUS = exports.TrafficApiError = exports.TRAFFIC_CLIENT_APP_ID = exports.DEFAULT_TRAFFIC_API_BASE_URL = void 0;
exports.createTrafficAccountService = createTrafficAccountService;
const version_1 = require("../../cli/version");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const identityProfiles_1 = require("../identity/identityProfiles");
const ownerIdentity_1 = require("../owner/ownerIdentity");
const fileSecretStore_1 = require("../secrets/fileSecretStore");
const mvcMessageSigning_1 = require("../subsidy/mvcMessageSigning");
const trafficStore_1 = require("./trafficStore");
exports.DEFAULT_TRAFFIC_API_BASE_URL = 'https://www.metaso.network/assist-open-api';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const BALANCE_CACHE_TTL_MS = 30_000;
/** clientApp reported to the free-grant claim endpoint (user decision: 'oac'). */
exports.TRAFFIC_CLIENT_APP_ID = 'oac';
class TrafficApiError extends Error {
    code;
    stage;
    status;
    serviceMessage;
    /** True when the backend returned 404 for /v1/traffic/* (feature disabled). */
    featureUnavailable;
    /**
     * Backend error code delivered as data.errorCode (e.g. CAMPAIGN_DISABLED,
     * ALREADY_CLAIMED, CODE_USED), same envelope pattern as TRAFFIC_INSUFFICIENT
     * (backend-spec §12 errata 1). Empty when the backend sent none.
     */
    errorCode;
    constructor(input) {
        super(input.message);
        this.name = 'TrafficApiError';
        this.code = `traffic_${input.stage}_failed`;
        this.stage = input.stage;
        if (input.status !== undefined)
            this.status = input.status;
        this.serviceMessage = input.message;
        this.featureUnavailable = input.featureUnavailable === true;
        this.errorCode = normalizeText(input.errorCode);
    }
}
exports.TrafficApiError = TrafficApiError;
/** Recharge order status values delivered by the backend (int64 in JSON). */
exports.TRAFFIC_RECHARGE_STATUS = {
    CREATED: 1,
    PAID: 2,
    CREDITED: 3,
    CLOSED: 4,
};
// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pickText(record, ...keys) {
    for (const key of keys) {
        const value = normalizeText(record[key]);
        if (value)
            return value;
    }
    return '';
}
function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
function normalizeBoolean(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value === 1;
    if (typeof value === 'string')
        return /^(true|1|yes)$/i.test(normalizeText(value));
    return false;
}
function pickErrorCode(data) {
    const record = readObject(data);
    return record ? normalizeText(record.errorCode ?? record.error_code) : '';
}
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}
// Canonical request strings (backend traffic_service/message.go — do not change).
function buildTrafficAccountMessage(accountId, timestamp) {
    return `traffic-account:${accountId}:${timestamp}`;
}
function buildTrafficBindMessage(botAddress, accountId, timestamp) {
    return `traffic-bind:${botAddress}:${accountId}:${timestamp}`;
}
function buildTrafficPreMessage(accountId, challengeId) {
    return `traffic-pre:${accountId}:${challengeId}`;
}
function buildTrafficRechargeMessage(accountId, planId, timestamp) {
    return `traffic-recharge:${accountId}:${planId}:${timestamp}`;
}
function buildTrafficRechargeConfirmMessage(orderId, gatewayTxnId, timestamp) {
    return `traffic-recharge-confirm:${orderId}:${gatewayTxnId}:${timestamp}`;
}
// Free-grant campaign + recharge code canonical strings, following the
// existing traffic-<purpose>:<accountId>:<ts> convention.
function buildTrafficFreeGrantStatusMessage(accountId, timestamp) {
    return `traffic-free-grant-status:${accountId}:${timestamp}`;
}
function buildTrafficFreeGrantClaimMessage(accountId, timestamp) {
    return `traffic-free-grant-claim:${accountId}:${timestamp}`;
}
function buildTrafficRedeemCodeMessage(accountId, timestamp) {
    return `traffic-redeem-code:${accountId}:${timestamp}`;
}
// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------
function createTrafficAccountService(deps) {
    const store = (0, trafficStore_1.createTrafficStore)(deps.systemHomeDir);
    let balanceCache = null;
    /** Coalesces concurrent first-run POSTs so a fresh install does not race-create. */
    let ensureAccountInFlight = null;
    function getClientVersion() {
        return normalizeText(deps.clientVersion) || version_1.CLI_VERSION;
    }
    /**
     * The configured assist-service base URL override (stored traffic.apiBase),
     * or undefined when unset — callers then fall back to the production default.
     * Never throws: a corrupt traffic.json reads as "no override".
     */
    async function getConfiguredTrafficApiBase() {
        try {
            const configured = (0, trafficStore_1.normalizeTrafficApiBase)((await store.read()).apiBase);
            return configured || undefined;
        }
        catch {
            return undefined;
        }
    }
    async function resolveApiBaseUrl() {
        if (deps.baseUrl && normalizeText(deps.baseUrl)) {
            return normalizeText(deps.baseUrl).replace(/\/+$/, '');
        }
        const configured = await getConfiguredTrafficApiBase();
        if (configured)
            return configured;
        return exports.DEFAULT_TRAFFIC_API_BASE_URL;
    }
    // -------------------------------------------------------------------------
    // HTTP layer (same {code, message, data} envelope as the sponsor v2 API)
    // -------------------------------------------------------------------------
    async function trafficRequestJson(input) {
        const fetchImpl = deps.fetchImpl ?? fetch;
        const url = new URL(`${await resolveApiBaseUrl()}${input.path}`);
        for (const [key, value] of Object.entries(input.query ?? {})) {
            if (value !== undefined && normalizeText(value) !== '') {
                url.searchParams.set(key, String(value));
            }
        }
        const headers = { accept: 'application/json' };
        if (input.body) {
            headers['content-type'] = 'application/json';
        }
        if (input.identity) {
            headers['X-Identity-Address'] = input.identity.address;
            headers['X-Timestamp'] = String(input.identity.timestamp);
            headers['X-Signature'] = input.identity.signature;
        }
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
        try {
            const response = await fetchImpl(url.toString(), {
                method: input.method,
                headers,
                body: input.body ? JSON.stringify(input.body) : undefined,
                signal: controller.signal,
            });
            let body;
            try {
                body = await response.json();
            }
            catch {
                throw new TrafficApiError({
                    stage: input.stage,
                    message: `Traffic service returned invalid JSON (HTTP ${response.status}).`,
                    status: response.status,
                });
            }
            if (!response.ok) {
                const bodyRecord = readObject(body);
                throw new TrafficApiError({
                    stage: input.stage,
                    message: pickText(bodyRecord ?? {}, 'message', 'msg', 'error')
                        || `Traffic service request failed with HTTP ${response.status}.`,
                    status: response.status,
                    featureUnavailable: response.status === 404,
                    errorCode: pickErrorCode(bodyRecord?.data),
                });
            }
            const record = readObject(body);
            if (!record) {
                throw new TrafficApiError({ stage: input.stage, message: 'Traffic service returned a non-object response.' });
            }
            const code = Number(record.code);
            if (Number.isFinite(code) && code === 0) {
                if (Array.isArray(record.data))
                    return record.data;
                const data = readObject(record.data);
                if (!data) {
                    throw new TrafficApiError({ stage: input.stage, message: 'Traffic service returned an empty data payload.' });
                }
                return data;
            }
            throw new TrafficApiError({
                stage: input.stage,
                message: pickText(record, 'message', 'msg', 'error')
                    || `Traffic service returned code ${normalizeText(record.code) || 'unknown'}.`,
                errorCode: pickErrorCode(record.data),
            });
        }
        catch (error) {
            if (error instanceof TrafficApiError)
                throw error;
            if (controller.signal.aborted) {
                throw new TrafficApiError({
                    stage: input.stage,
                    message: `Traffic service request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms.`,
                });
            }
            throw new TrafficApiError({
                stage: input.stage,
                message: error instanceof Error && error.message ? error.message : 'Traffic service request failed.',
            });
        }
        finally {
            clearTimeout(timeoutHandle);
        }
    }
    // -------------------------------------------------------------------------
    // Local persistence (traffic.json via the store; reads never throw)
    // -------------------------------------------------------------------------
    async function readLocalAccount() {
        try {
            return await store.readAccount();
        }
        catch {
            return null;
        }
    }
    async function persistLocalAccount(account) {
        try {
            await store.writeAccount(account);
        }
        catch {
            // local cache loss is non-fatal
        }
    }
    async function readLocalBindings() {
        try {
            return await store.readBindings();
        }
        catch {
            return {};
        }
    }
    async function persistLocalBinding(botAddress, accountId) {
        try {
            await store.writeBinding(botAddress, accountId);
        }
        catch {
            // local cache loss is non-fatal
        }
    }
    async function isBotBoundLocally(botAddress, accountId) {
        return (await readLocalBindings())[botAddress]?.accountId === accountId;
    }
    /** Local account record for UI/daemon status; null when never ensured. */
    async function getLocalTrafficAccount() {
        return readLocalAccount();
    }
    // -------------------------------------------------------------------------
    // Identity + bot signing
    // -------------------------------------------------------------------------
    async function requireIdentity() {
        const identity = await (0, ownerIdentity_1.readOwnerIdentity)(deps.systemHomeDir);
        if (!identity) {
            throw new TrafficApiError({ stage: 'account', message: 'local owner identity is missing' });
        }
        const globalMetaId = normalizeText(identity.globalMetaId);
        const mvcAddress = normalizeText(identity.mvcAddress);
        if (!identity.mnemonic?.trim() || !globalMetaId || !mvcAddress) {
            throw new TrafficApiError({
                stage: 'account',
                message: 'local owner identity is incomplete (mnemonic/mvc address/globalmetaid required)',
            });
        }
        return {
            mnemonic: identity.mnemonic.trim(),
            path: identity.path || deriveIdentity_1.DEFAULT_DERIVATION_PATH,
            mvcAddress,
            globalMetaId,
        };
    }
    function signWithKey(input) {
        // Never log mnemonic/message signatures; the message itself is non-sensitive.
        return (0, mvcMessageSigning_1.signMvcAddressMessage)({ mnemonic: input.mnemonic, path: input.path, message: input.message });
    }
    /**
     * Enumerate bindable local bots: every identity profile with an MVC address
     * whose profile secret store still holds the mnemonic.
     */
    async function listLocalBotTargets() {
        const targets = [];
        const seen = new Set();
        let profiles;
        try {
            profiles = await (0, identityProfiles_1.listIdentityProfiles)(deps.systemHomeDir);
        }
        catch {
            return targets;
        }
        for (const profile of profiles) {
            let secrets = null;
            try {
                secrets = await (0, fileSecretStore_1.createFileSecretStore)(profile.homeDir).readIdentitySecrets();
            }
            catch {
                continue;
            }
            const botAddress = normalizeText(profile.mvcAddress) || normalizeText(secrets?.addresses?.mvc);
            if (!botAddress || seen.has(botAddress.toLowerCase()))
                continue;
            const mnemonic = normalizeText(secrets?.mnemonic);
            if (!mnemonic)
                continue;
            seen.add(botAddress.toLowerCase());
            targets.push({ botAddress, mnemonic, path: normalizeText(secrets?.path) || deriveIdentity_1.DEFAULT_DERIVATION_PATH });
        }
        return targets;
    }
    // -------------------------------------------------------------------------
    // Account + bindings
    // -------------------------------------------------------------------------
    function normalizeAccountRecord(data, stage) {
        const accountId = pickText(data, 'accountId', 'account_id');
        if (!accountId) {
            throw new TrafficApiError({ stage, message: 'Traffic account response is missing accountId.' });
        }
        return {
            accountId,
            identityAddress: pickText(data, 'identityAddress', 'identity_address'),
            balanceBytes: toNumber(data.balanceBytes ?? data.balance_bytes),
            reservedBytes: toNumber(data.reservedBytes ?? data.reserved_bytes),
            grantedBytesTotal: toNumber(data.grantedBytesTotal ?? data.granted_bytes_total),
            spentBytesTotal: toNumber(data.spentBytesTotal ?? data.spent_bytes_total),
            status: toNumber(data.status),
        };
    }
    /**
     * Get-or-create the traffic account for the local owner identity. The
     * accountId in the response is authoritative (the backend derives it from
     * the identity address) and is persisted locally. Concurrent callers share
     * one in-flight POST so a fresh install (balance + campaign + usage + ledger
     * all calling requireAccount at once) cannot lose the campaign status
     * request to a create-conflict on the backend.
     */
    async function ensureTrafficAccount() {
        if (ensureAccountInFlight)
            return ensureAccountInFlight;
        ensureAccountInFlight = createTrafficAccount().finally(() => {
            ensureAccountInFlight = null;
        });
        return ensureAccountInFlight;
    }
    async function createTrafficAccount() {
        const identity = await requireIdentity();
        const timestamp = nowSeconds();
        const message = buildTrafficAccountMessage(identity.globalMetaId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'account',
            method: 'POST',
            path: '/v1/traffic/accounts',
            body: { accountId: identity.globalMetaId },
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const account = normalizeAccountRecord(data, 'account');
        await persistLocalAccount(account);
        balanceCache = { ...account, fetchedAt: Date.now() };
        return account;
    }
    async function bindOneBot(account, identity, target) {
        try {
            const timestamp = nowSeconds();
            const bindMessage = buildTrafficBindMessage(target.botAddress, account.accountId, timestamp);
            const identitySignature = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message: bindMessage });
            const botSignature = await signWithKey({ mnemonic: target.mnemonic, path: target.path, message: bindMessage });
            await trafficRequestJson({
                stage: 'bind',
                method: 'POST',
                path: '/v1/traffic/accounts/bindings',
                body: {
                    botAddress: target.botAddress,
                    botSignature: botSignature.signature,
                    bindMessage,
                },
                identity: { address: identity.mvcAddress, timestamp, signature: identitySignature.signature },
            });
            await persistLocalBinding(target.botAddress, account.accountId);
            return { botAddress: target.botAddress, status: 'bound' };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/already bound to another account/i.test(message)) {
                return { botAddress: target.botAddress, status: 'conflict', error: message };
            }
            return { botAddress: target.botAddress, status: 'failed', error: message };
        }
    }
    /**
     * Bind every local MetaBot wallet address plus the owner identity address to
     * the traffic account. Idempotent: the backend returns the existing binding
     * when the address is already bound to this account; an address bound to a
     * different account is reported as 'conflict' without failing the batch.
     */
    async function bindAllLocalBots() {
        const identity = await requireIdentity();
        const account = await ensureTrafficAccount();
        const targets = await listLocalBotTargets();
        const seen = new Set(targets.map((target) => target.botAddress.toLowerCase()));
        if (!seen.has(identity.mvcAddress.toLowerCase())) {
            targets.push({ botAddress: identity.mvcAddress, mnemonic: identity.mnemonic, path: identity.path });
        }
        const results = [];
        for (const target of targets) {
            results.push(await bindOneBot(account, identity, target));
        }
        return {
            accountId: account.accountId,
            results,
            boundCount: results.filter((item) => item.status === 'bound').length,
            conflictCount: results.filter((item) => item.status === 'conflict').length,
            failedCount: results.filter((item) => item.status === 'failed').length,
        };
    }
    // -------------------------------------------------------------------------
    // Balance / ledger / usage (read APIs)
    // -------------------------------------------------------------------------
    async function requireAccount() {
        const local = await readLocalAccount();
        if (local)
            return local;
        return ensureTrafficAccount();
    }
    async function getTrafficBalance(options = {}) {
        const account = await requireAccount();
        if (!options.forceRefresh
            && balanceCache
            && balanceCache.accountId === account.accountId
            && Date.now() - balanceCache.fetchedAt < BALANCE_CACHE_TTL_MS) {
            const { fetchedAt: _fetchedAt, ...cached } = balanceCache;
            return cached;
        }
        const data = await trafficRequestJson({
            stage: 'balance',
            method: 'GET',
            path: `/v1/traffic/accounts/${encodeURIComponent(account.accountId)}/balance`,
        });
        const fresh = normalizeAccountRecord(data, 'balance');
        balanceCache = { ...fresh, fetchedAt: Date.now() };
        await persistLocalAccount(fresh);
        return fresh;
    }
    async function getTrafficLedger(input = {}) {
        const account = await requireAccount();
        const data = await trafficRequestJson({
            stage: 'ledger',
            method: 'GET',
            path: `/v1/traffic/accounts/${encodeURIComponent(account.accountId)}/ledger`,
            query: { direction: input.direction, cursor: input.cursor, limit: input.limit },
        });
        const record = data;
        const entries = Array.isArray(record.entries) ? record.entries : [];
        return {
            entries: await enrichLedgerEntriesFromLocalJournal(entries.flatMap((item) => {
                const entry = readObject(item);
                if (!entry)
                    return [];
                return [{
                        id: toNumber(entry.id),
                        direction: toNumber(entry.direction),
                        amountBytes: toNumber(entry.amountBytes ?? entry.amount_bytes),
                        balanceAfter: toNumber(entry.balanceAfter ?? entry.balance_after),
                        sourceType: pickText(entry, 'sourceType', 'source_type'),
                        sourceId: pickText(entry, 'sourceId', 'source_id'),
                        remark: pickText(entry, 'remark'),
                        timestamp: toNumber(entry.timestamp),
                    }];
            })),
            nextCursor: toNumber(record.nextCursor ?? record.next_cursor),
        };
    }
    /**
     * Best-effort local enrichment: sponsor ledger entries carry the sponsor
     * orderId as sourceId, which the local spend journal also records at commit
     * time — so entries for commits made on this device get their txId, bot
     * address, and pin kind attached. Entries from other devices, recharge
     * credits, and expired reservations have no local match and stay untouched.
     * Never throws: the raw ledger must keep rendering without the journal.
     */
    async function enrichLedgerEntriesFromLocalJournal(entries) {
        try {
            if (entries.length === 0)
                return entries;
            const byOrderId = await store.latestJournalByOrderId({ limit: 1000 });
            if (byOrderId.size === 0)
                return entries;
            return entries.map((entry) => {
                const match = entry.sourceId ? byOrderId.get(entry.sourceId) : undefined;
                if (!match)
                    return entry;
                const enriched = { ...entry, txId: match.txId, botAddress: match.botAddress };
                if (match.kind)
                    enriched.kind = match.kind;
                return enriched;
            });
        }
        catch {
            return entries;
        }
    }
    async function getTrafficDailyUsage(input = {}) {
        const account = await requireAccount();
        const data = await trafficRequestJson({
            stage: 'usage',
            method: 'GET',
            path: `/v1/traffic/accounts/${encodeURIComponent(account.accountId)}/usage/daily`,
            query: { from: input.from, to: input.to, botAddress: input.botAddress },
        });
        const rows = Array.isArray(data) ? data : [];
        return rows.flatMap((item) => {
            const row = readObject(item);
            if (!row)
                return [];
            return [{
                    date: pickText(row, 'date'),
                    botAddress: pickText(row, 'botAddress', 'bot_address'),
                    bytes: toNumber(row.bytes),
                    txCount: toNumber(row.txCount ?? row.tx_count),
                }];
        });
    }
    /**
     * Usage read with the journal fallback ported from the IDBots renderer: when
     * the usage API fails the local spend journal is aggregated by UTC day + bot
     * address so the table stays useful offline. The fallback filters by
     * botAddress but ignores the from/to window, same as IDBots.
     */
    async function getTrafficDailyUsageWithFallback(input = {}) {
        try {
            return { rows: await getTrafficDailyUsage(input), source: 'remote', error: '' };
        }
        catch (error) {
            const message = error instanceof Error && error.message ? error.message : String(error);
            try {
                const rows = await store.aggregateDailyUsage({ botAddress: normalizeText(input.botAddress) || undefined });
                return { rows, source: 'local', error: message };
            }
            catch {
                return { rows: [], source: 'local', error: message };
            }
        }
    }
    async function getTrafficUsageSummary() {
        const account = await requireAccount();
        const data = await trafficRequestJson({
            stage: 'usage',
            method: 'GET',
            path: `/v1/traffic/accounts/${encodeURIComponent(account.accountId)}/usage/summary`,
        });
        const record = data;
        return {
            todayBytes: toNumber(record.todayBytes ?? record.today_bytes),
            weekBytes: toNumber(record.weekBytes ?? record.week_bytes),
            monthBytes: toNumber(record.monthBytes ?? record.month_bytes),
        };
    }
    // -------------------------------------------------------------------------
    // Pricing + recharge (mock payment for development; real gateways in Phase 4)
    // -------------------------------------------------------------------------
    /** Public rate table; no identity signature required. */
    async function getTrafficPricing() {
        const data = await trafficRequestJson({
            stage: 'pricing',
            method: 'GET',
            path: '/v1/traffic/pricing',
        });
        const rows = Array.isArray(data) ? data : [];
        return rows.flatMap((item) => {
            const row = readObject(item);
            if (!row)
                return [];
            const planId = pickText(row, 'planId', 'plan_id');
            if (!planId)
                return [];
            return [{
                    planId,
                    chain: pickText(row, 'chain'),
                    payCurrency: pickText(row, 'payCurrency', 'pay_currency'),
                    payAmount: toNumber(row.payAmount ?? row.pay_amount),
                    trafficBytes: toNumber(row.trafficBytes ?? row.traffic_bytes),
                    status: toNumber(row.status),
                    remark: pickText(row, 'remark'),
                }];
        });
    }
    /**
     * Create a recharge order for the local identity's account. The gateway is
     * hardcoded to 'mock' for the development rollout; Phase 4 swaps in real
     * payment gateways behind this same call site.
     */
    async function createRechargeOrder(planId) {
        const normalizedPlanId = normalizeText(planId);
        if (!normalizedPlanId) {
            throw new TrafficApiError({ stage: 'recharge', message: 'planId is required' });
        }
        const identity = await requireIdentity();
        const account = await requireAccount();
        const timestamp = nowSeconds();
        const message = buildTrafficRechargeMessage(account.accountId, normalizedPlanId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'recharge',
            method: 'POST',
            path: '/v1/traffic/recharge/orders',
            body: { planId: normalizedPlanId, gateway: 'mock' },
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const record = data;
        const orderId = pickText(record, 'orderId', 'order_id');
        if (!orderId) {
            throw new TrafficApiError({ stage: 'recharge', message: 'Traffic recharge order response is missing orderId.' });
        }
        return {
            orderId,
            payAmount: toNumber(record.payAmount ?? record.pay_amount),
            payCurrency: pickText(record, 'payCurrency', 'pay_currency'),
            trafficBytes: toNumber(record.trafficBytes ?? record.traffic_bytes),
            gatewayParams: record.gatewayParams ?? record.gateway_params ?? null,
        };
    }
    function normalizeRechargeOrderStatus(data) {
        const orderId = pickText(data, 'orderId', 'order_id');
        if (!orderId) {
            throw new TrafficApiError({ stage: 'recharge', message: 'Traffic recharge order status response is missing orderId.' });
        }
        const result = {
            orderId,
            status: toNumber(data.status),
        };
        const paidAt = toNumber(data.paidAt ?? data.paid_at);
        const creditedAt = toNumber(data.creditedAt ?? data.credited_at);
        if (paidAt > 0)
            result.paidAt = paidAt;
        if (creditedAt > 0)
            result.creditedAt = creditedAt;
        return result;
    }
    /** Poll the recharge order status (created/paid/credited/closed). */
    async function getRechargeOrder(orderId) {
        const normalizedOrderId = normalizeText(orderId);
        if (!normalizedOrderId) {
            throw new TrafficApiError({ stage: 'recharge', message: 'orderId is required' });
        }
        const data = await trafficRequestJson({
            stage: 'recharge',
            method: 'GET',
            path: `/v1/traffic/recharge/orders/${encodeURIComponent(normalizedOrderId)}`,
        });
        return normalizeRechargeOrderStatus(data);
    }
    /**
     * Dev/staging only: simulate gateway success for a mock recharge order
     * (backend gates this on traffic.mock_payment_enabled). On credit the local
     * balance cache is invalidated so the next read refetches.
     */
    async function mockConfirmRechargeOrder(orderId) {
        const normalizedOrderId = normalizeText(orderId);
        if (!normalizedOrderId) {
            throw new TrafficApiError({ stage: 'recharge', message: 'orderId is required' });
        }
        const identity = await requireIdentity();
        const gatewayTxnId = `mock-${normalizedOrderId}`;
        const timestamp = nowSeconds();
        const message = buildTrafficRechargeConfirmMessage(normalizedOrderId, gatewayTxnId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'recharge',
            method: 'POST',
            path: `/v1/traffic/recharge/orders/${encodeURIComponent(normalizedOrderId)}/mock-confirm`,
            body: { gatewayTxnId },
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const status = normalizeRechargeOrderStatus(data);
        if (status.status === exports.TRAFFIC_RECHARGE_STATUS.CREDITED) {
            balanceCache = null;
        }
        return status;
    }
    // -------------------------------------------------------------------------
    // Free-grant campaign + recharge codes
    // -------------------------------------------------------------------------
    /** Free-grant campaign state for the local account (signed GET). */
    async function getFreeGrantCampaignStatus() {
        const identity = await requireIdentity();
        const account = await requireAccount();
        const timestamp = nowSeconds();
        const message = buildTrafficFreeGrantStatusMessage(account.accountId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'campaign',
            method: 'GET',
            path: '/v1/traffic/campaign/free-grant/status',
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const record = data;
        return {
            enabled: normalizeBoolean(record.enabled),
            grantBytes: toNumber(record.grantBytes ?? record.grant_bytes),
            claimed: normalizeBoolean(record.claimed),
            claimable: normalizeBoolean(record.claimable),
        };
    }
    /**
     * Claim the one-time free traffic grant for the local account. On success the
     * balance cache is invalidated so the next read refetches from the backend
     * (same contract as mockConfirmRechargeOrder).
     */
    async function claimFreeGrant() {
        const identity = await requireIdentity();
        const account = await requireAccount();
        const timestamp = nowSeconds();
        const message = buildTrafficFreeGrantClaimMessage(account.accountId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'campaign',
            method: 'POST',
            path: '/v1/traffic/campaign/free-grant/claim',
            body: { clientApp: exports.TRAFFIC_CLIENT_APP_ID, clientVersion: getClientVersion() },
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const record = data;
        balanceCache = null;
        return {
            grantId: toNumber(record.grantId ?? record.grant_id),
            grantBytes: toNumber(record.grantBytes ?? record.grant_bytes),
            balanceAfter: toNumber(record.balanceAfter ?? record.balance_after),
        };
    }
    /**
     * Redeem a one-time recharge code for the local account. The server trims and
     * uppercases the code itself; the client normalizes too so the request always
     * carries the canonical IDB-XXXX-XXXX-XXXX shape. On success the balance cache
     * is invalidated like the other credit paths.
     */
    async function redeemTrafficCode(code) {
        const normalizedCode = normalizeText(code).toUpperCase();
        if (!normalizedCode) {
            throw new TrafficApiError({ stage: 'redeem', message: 'code is required' });
        }
        const identity = await requireIdentity();
        const account = await requireAccount();
        const timestamp = nowSeconds();
        const message = buildTrafficRedeemCodeMessage(account.accountId, timestamp);
        const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
        const data = await trafficRequestJson({
            stage: 'redeem',
            method: 'POST',
            path: '/v1/traffic/redeem-code',
            body: { code: normalizedCode },
            identity: { address: identity.mvcAddress, timestamp, signature },
        });
        const record = data;
        balanceCache = null;
        return {
            codeId: toNumber(record.codeId ?? record.code_id),
            trafficBytes: toNumber(record.trafficBytes ?? record.traffic_bytes),
            balanceAfter: toNumber(record.balanceAfter ?? record.balance_after),
        };
    }
    // -------------------------------------------------------------------------
    // Settings (traffic.json via the store)
    // -------------------------------------------------------------------------
    async function getTrafficPinMode() {
        try {
            return (await store.readSettings()).mode;
        }
        catch {
            return (0, trafficStore_1.normalizeTrafficPinMode)(undefined);
        }
    }
    /** Renderer/daemon-facing traffic settings (mode + fallback policy + apiBase). */
    async function getTrafficSettingsSnapshot() {
        try {
            return await store.readSettings();
        }
        catch {
            return { mode: (0, trafficStore_1.normalizeTrafficPinMode)(undefined), fallbackPolicy: 'selfpay', apiBase: '' };
        }
    }
    async function setTrafficSettingsSnapshot(input) {
        return store.writeSettings(input);
    }
    // -------------------------------------------------------------------------
    // Local spend journal + balance cache deduction
    // -------------------------------------------------------------------------
    /**
     * Record one locally-initiated sponsored commit. Traffic-billed spends also
     * decrement the in-memory balance cache by the known txSize so the UI reflects
     * the deduction immediately; quota-billed spends never touch the traffic
     * balance. Best-effort by design: never throws into the pin flow.
     */
    async function recordLocalTrafficSpend(entry) {
        try {
            const txId = normalizeText(entry.txId);
            const botAddress = normalizeText(entry.botAddress);
            if (!txId || !botAddress)
                return;
            const txSize = Math.max(0, Math.trunc(toNumber(entry.txSize)));
            await store.appendJournal({
                txId,
                botAddress,
                orderId: normalizeText(entry.orderId),
                txSize,
                sponsoredMinerFee: Math.max(0, Math.trunc(toNumber(entry.sponsoredMinerFee))),
                savedFee: Math.max(0, Math.trunc(toNumber(entry.savedFee))),
                billedBy: entry.billedBy === 'traffic' ? 'traffic' : 'quota',
                kind: normalizeText(entry.kind),
                createdAt: Date.now(),
            });
            if (entry.billedBy === 'traffic' && balanceCache && txSize > 0) {
                balanceCache = {
                    ...balanceCache,
                    balanceBytes: Math.max(0, balanceCache.balanceBytes - txSize),
                    spentBytesTotal: balanceCache.spentBytesTotal + txSize,
                };
            }
        }
        catch (error) {
            console.warn('[TrafficAccount] failed to record local spend:', error instanceof Error ? error.message : error);
        }
    }
    async function listLocalTrafficJournal(input = {}) {
        try {
            return await store.listJournal(input);
        }
        catch {
            return [];
        }
    }
    // -------------------------------------------------------------------------
    // Sponsor pre integration (trafficAccount resolver)
    // -------------------------------------------------------------------------
    /**
     * Build the trafficAccount block for a sponsor pre call, or return undefined
     * to keep the legacy quota path. Never throws: traffic mode off, no identity,
     * no account (backend 404 / offline), or an unbindable bot all degrade to
     * undefined. Lazily ensures the account and binds the bot on first use.
     */
    async function resolveSponsorTrafficAccount(input) {
        try {
            if ((await getTrafficPinMode()) !== 'traffic')
                return undefined;
            const botAddress = normalizeText(input.botAddress);
            if (!botAddress || !normalizeText(input.challengeId))
                return undefined;
            const identity = await requireIdentity();
            let account = await readLocalAccount();
            if (!account) {
                account = await ensureTrafficAccount();
            }
            if (!(await isBotBoundLocally(botAddress, account.accountId))) {
                const botMnemonic = normalizeText(input.botMnemonic);
                if (!botMnemonic)
                    return undefined;
                const bindResult = await bindOneBot(account, identity, {
                    botAddress,
                    mnemonic: botMnemonic,
                    path: normalizeText(input.botWalletPath) || deriveIdentity_1.DEFAULT_DERIVATION_PATH,
                });
                if (bindResult.status !== 'bound')
                    return undefined;
            }
            const timestamp = nowSeconds();
            const message = buildTrafficPreMessage(account.accountId, normalizeText(input.challengeId));
            const { signature } = await signWithKey({ mnemonic: identity.mnemonic, path: identity.path, message });
            return { accountId: account.accountId, authSignature: signature, timestamp };
        }
        catch {
            return undefined;
        }
    }
    return {
        store,
        ensureTrafficAccount,
        getLocalTrafficAccount,
        bindAllLocalBots,
        getTrafficBalance,
        getTrafficLedger,
        getTrafficDailyUsage,
        getTrafficDailyUsageWithFallback,
        getTrafficUsageSummary,
        getTrafficPricing,
        createRechargeOrder,
        getRechargeOrder,
        mockConfirmRechargeOrder,
        getFreeGrantCampaignStatus,
        claimFreeGrant,
        redeemTrafficCode,
        getTrafficPinMode,
        getTrafficSettingsSnapshot,
        setTrafficSettingsSnapshot,
        getConfiguredTrafficApiBase,
        recordLocalTrafficSpend,
        listLocalTrafficJournal,
        resolveSponsorTrafficAccount,
    };
}
