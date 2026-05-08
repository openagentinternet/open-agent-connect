"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProviderCommand = runProviderCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
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
async function runProviderCommand(args, context) {
    const [group, subcommand] = args;
    if (group === 'order' && subcommand === 'inspect') {
        const selector = readSellerOrderSelector(args.slice(2));
        if (!selector.ok) {
            return selector.result;
        }
        const handler = context.dependencies.provider?.inspectOrder;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Provider order inspection handler is not configured.');
        }
        return handler(selector.selector);
    }
    if (group === 'refund' && subcommand === 'settle') {
        const selector = readSellerOrderSelector(args.slice(2));
        if (!selector.ok) {
            return selector.result;
        }
        const handler = context.dependencies.provider?.settleRefund;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Provider refund settlement handler is not configured.');
        }
        return handler(selector.selector);
    }
    return (0, helpers_1.commandUnknownSubcommand)(`provider ${args.join(' ')}`.trim());
}
