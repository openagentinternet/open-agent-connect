"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runServicesCommand = runServicesCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readFromFlag(args, options = {}) {
    return (0, helpers_1.readFlagValue)(args, '--from')
        ?? (options.allowSlugAlias ? (0, helpers_1.readFlagValue)(args, '--slug') : null)
        ?? undefined;
}
function applyOptionalActor(input, from) {
    return from ? { ...input, from } : input;
}
function readPositiveIntegerFlag(args, flag, fallback) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function readOwnedListInput(args) {
    return {
        ...(readFromFlag(args) ? { from: readFromFlag(args) } : {}),
        all: (0, helpers_1.hasFlag)(args, '--all'),
        page: readPositiveIntegerFlag(args, '--page', 1),
        pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    };
}
function readRefundListKind(args) {
    const selectedKinds = [];
    if ((0, helpers_1.hasFlag)(args, '--initiated')) {
        selectedKinds.push('initiated');
    }
    if ((0, helpers_1.hasFlag)(args, '--received')) {
        selectedKinds.push('received');
    }
    const rawKind = (0, helpers_1.readFlagValue)(args, '--kind');
    if (rawKind !== null) {
        if (!rawKind || rawKind.startsWith('--')) {
            return {
                kind: 'all',
                error: (0, commandResult_1.commandFailed)('invalid_flag', 'Missing value for --kind. Supported values: all, initiated, received.'),
            };
        }
        const normalizedKind = rawKind.trim().toLowerCase();
        if (normalizedKind !== 'all' && normalizedKind !== 'initiated' && normalizedKind !== 'received') {
            return {
                kind: 'all',
                error: (0, commandResult_1.commandFailed)('invalid_refund_kind', 'Refund kind must be one of all, initiated, or received.'),
            };
        }
        selectedKinds.push(normalizedKind);
    }
    const uniqueKinds = [...new Set(selectedKinds)];
    if (uniqueKinds.length > 1) {
        return {
            kind: 'all',
            error: (0, commandResult_1.commandFailed)('invalid_flag', 'Use only one refund kind selector: --kind, --initiated, or --received.'),
        };
    }
    return {
        kind: uniqueKinds[0] ?? 'all',
    };
}
function readSellerOrderSelector(args) {
    const orderId = (0, helpers_1.readFlagValue)(args, '--order-id');
    const paymentTxid = (0, helpers_1.readFlagValue)(args, '--payment-txid');
    if (!orderId && !paymentTxid) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('missing_seller_order_selector', 'Provide --order-id <id> or --payment-txid <txid>.'),
        };
    }
    if (orderId && paymentTxid) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('ambiguous_seller_order_selector', 'Use only one seller order selector: --order-id or --payment-txid.'),
        };
    }
    return {
        ok: true,
        selector: {
            ...(orderId ? { orderId } : {}),
            ...(paymentTxid ? { paymentTxid } : {}),
        },
    };
}
async function runServicesCommand(args, context) {
    const shouldPollTrace = Boolean(context.stdout
        && typeof context.stdout === 'object'
        && 'isTTY' in context.stdout
        && context.stdout.isTTY);
    const subcommand = args[0];
    if (subcommand === 'publish') {
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        const from = readFromFlag(args);
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.services?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services publish handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler(applyOptionalActor(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload, from));
    }
    if (subcommand === 'skills' || subcommand === 'publish-skills') {
        const from = readFromFlag(args, { allowSlugAlias: subcommand === 'publish-skills' });
        const handler = context.dependencies.services?.listPublishSkills;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services publish skills handler is not configured.');
        }
        return handler(from ? { from } : undefined);
    }
    if (subcommand === 'owned') {
        const ownedSubcommand = args[1];
        const ownedArgs = args.slice(2);
        if (ownedSubcommand === 'list') {
            const handler = context.dependencies.services?.listOwned;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owned services list handler is not configured.');
            }
            return handler(readOwnedListInput(ownedArgs));
        }
        if (ownedSubcommand === 'orders') {
            const serviceId = (0, helpers_1.readFlagValue)(ownedArgs, '--service-id');
            if (!serviceId) {
                return (0, helpers_1.commandMissingFlag)('--service-id');
            }
            const handler = context.dependencies.services?.listOwnedOrders;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owned service orders handler is not configured.');
            }
            return handler({
                serviceId,
                ...readOwnedListInput(ownedArgs),
            });
        }
        if (ownedSubcommand === 'modify') {
            if ((0, helpers_1.hasFlag)(ownedArgs, '--all')) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--all is only valid for owned service read commands.');
            }
            const payloadFile = (0, helpers_1.readFlagValue)(ownedArgs, '--payload-file');
            if (!payloadFile) {
                return (0, helpers_1.commandMissingFlag)('--payload-file');
            }
            const chainFlag = (0, helpers_1.readChainWriteFlag)(ownedArgs);
            if (chainFlag.error) {
                return chainFlag.error;
            }
            const handler = context.dependencies.services?.modifyOwned;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owned service modify handler is not configured.');
            }
            const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
            return handler(applyOptionalActor(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload, readFromFlag(ownedArgs)));
        }
        if (ownedSubcommand === 'revoke') {
            if ((0, helpers_1.hasFlag)(ownedArgs, '--all')) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--all is only valid for owned service read commands.');
            }
            const serviceId = (0, helpers_1.readFlagValue)(ownedArgs, '--service-id');
            if (!serviceId) {
                return (0, helpers_1.commandMissingFlag)('--service-id');
            }
            const chainFlag = (0, helpers_1.readChainWriteFlag)(ownedArgs);
            if (chainFlag.error) {
                return chainFlag.error;
            }
            const handler = context.dependencies.services?.revokeOwned;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owned service revoke handler is not configured.');
            }
            const from = readFromFlag(ownedArgs);
            return handler({
                serviceId,
                ...(from ? { from } : {}),
                ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`services owned ${ownedArgs.join(' ')}`.trim());
    }
    if (subcommand === 'refunds') {
        const refundsSubcommand = args[1];
        const refundsArgs = args.slice(2);
        if (refundsSubcommand === 'list') {
            const handler = context.dependencies.services?.listRefunds;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Services refund list handler is not configured.');
            }
            const from = readFromFlag(refundsArgs);
            const all = (0, helpers_1.hasFlag)(refundsArgs, '--all');
            if (from && all) {
                return (0, commandResult_1.commandFailed)('invalid_flag', 'Use either --from <bot-slug> or --all for refund listing, not both.');
            }
            const kindResult = readRefundListKind(refundsArgs);
            if (kindResult.error) {
                return kindResult.error;
            }
            return handler({
                ...(from ? { from } : {}),
                all,
                kind: kindResult.kind,
            });
        }
        if (refundsSubcommand === 'settle') {
            const selector = readSellerOrderSelector(refundsArgs);
            if (!selector.ok) {
                return selector.result;
            }
            const handler = context.dependencies.services?.settleRefund;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Services refund settlement handler is not configured.');
            }
            const from = readFromFlag(refundsArgs);
            return handler({
                ...(from ? { from } : {}),
                ...selector.selector,
            });
        }
        if (refundsSubcommand === 'sync') {
            const handler = context.dependencies.services?.syncRefunds;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Services refund sync handler is not configured.');
            }
            const from = readFromFlag(refundsArgs);
            const all = (0, helpers_1.hasFlag)(refundsArgs, '--all');
            if (from && all) {
                return (0, commandResult_1.commandFailed)('invalid_flag', 'Use either --from <bot-slug> or --all for refund sync, not both.');
            }
            return handler({
                ...(from ? { from } : {}),
                all,
            });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`services refunds ${refundsArgs.join(' ')}`.trim());
    }
    if (subcommand === 'orders') {
        const ordersSubcommand = args[1];
        const ordersArgs = args.slice(2);
        if (ordersSubcommand === 'inspect') {
            const selector = readSellerOrderSelector(ordersArgs);
            if (!selector.ok) {
                return selector.result;
            }
            const handler = context.dependencies.services?.inspectOrder;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Services order inspection handler is not configured.');
            }
            const from = readFromFlag(ordersArgs);
            return handler({
                ...(from ? { from } : {}),
                ...selector.selector,
            });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`services orders ${ordersArgs.join(' ')}`.trim());
    }
    if (subcommand === 'call') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        const from = readFromFlag(args);
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const handler = context.dependencies.services?.call;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services call handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        const result = await handler(applyOptionalActor(request, from));
        if (result.state === 'waiting' &&
            'data' in result &&
            result.data &&
            typeof result.data === 'object' &&
            'traceId' in result.data &&
            result.localUiUrl &&
            shouldPollTrace) {
            const { pollTraceUntilComplete } = await Promise.resolve().then(() => __importStar(require('./pollTraceHelper')));
            const traceGet = context.dependencies.trace?.get;
            if (traceGet) {
                const poll = await pollTraceUntilComplete({
                    traceId: String(result.data.traceId),
                    localUiUrl: result.localUiUrl,
                    requestFn: async (method, path) => {
                        const traceId = path.split('/').pop() || '';
                        return traceGet({
                            ...(from ? { from } : {}),
                            traceId: decodeURIComponent(traceId),
                        });
                    },
                    stderr: context.stderr,
                });
                if (poll.completed && poll.trace) {
                    const sessions = Array.isArray(poll.trace.sessions) ? poll.trace.sessions : [];
                    const firstSession = sessions[0];
                    const sessionFromTrace = (typeof poll.trace.session === 'object' && poll.trace.session !== null
                        ? poll.trace.session
                        : firstSession);
                    const responseTextFromTrace = typeof poll.trace.resultText === 'string'
                        ? poll.trace.resultText
                        : firstSession?.responseText;
                    const deliveryPinIdFromTrace = typeof poll.trace.resultDeliveryPinId === 'string'
                        ? poll.trace.resultDeliveryPinId
                        : undefined;
                    const ratingRequestTextFromTrace = typeof poll.trace.ratingRequestText === 'string'
                        ? poll.trace.ratingRequestText
                        : poll.trace.ratingRequestText === null
                            ? null
                            : undefined;
                    return (0, commandResult_1.commandSuccess)({
                        ...result.data,
                        ...(sessionFromTrace ? { session: sessionFromTrace } : {}),
                        ...(responseTextFromTrace ? { responseText: responseTextFromTrace } : {}),
                        ...(deliveryPinIdFromTrace ? { deliveryPinId: deliveryPinIdFromTrace } : {}),
                        ...(ratingRequestTextFromTrace !== undefined ? { ratingRequestText: ratingRequestTextFromTrace } : {}),
                        localUiUrl: result.localUiUrl,
                    });
                }
            }
        }
        return result;
    }
    if (subcommand === 'rate') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        const from = readFromFlag(args);
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.services?.rate;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services rate handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(applyOptionalActor(chainFlag.chain ? { ...request, network: chainFlag.chain } : request, from));
    }
    return (0, helpers_1.commandUnknownSubcommand)(`services ${args.join(' ')}`.trim());
}
