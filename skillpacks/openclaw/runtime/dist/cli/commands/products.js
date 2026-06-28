"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProductsCommand = runProductsCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
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
    const from = (0, helpers_1.readFromFlag)(args);
    return {
        ...(from ? { from } : {}),
        all: (0, helpers_1.hasFlag)(args, '--all'),
        page: readPositiveIntegerFlag(args, '--page', 1),
        pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    };
}
function readProductOrderRole(args) {
    const role = (0, helpers_1.readFlagValue)(args, '--role')?.trim().toLowerCase();
    return role === 'seller' || role === 'all' ? role : 'buyer';
}
function readProductOrderListInput(args) {
    const from = (0, helpers_1.readFromFlag)(args);
    const state = (0, helpers_1.readFlagValue)(args, '--state')?.trim();
    return {
        ...(from ? { from } : {}),
        all: (0, helpers_1.hasFlag)(args, '--all'),
        role: readProductOrderRole(args),
        ...(state ? { state } : {}),
        page: readPositiveIntegerFlag(args, '--page', 1),
        pageSize: readPositiveIntegerFlag(args, '--page-size', 20),
    };
}
function readProductOrderSelector(args) {
    const selectors = [
        ['orderId', (0, helpers_1.readFlagValue)(args, '--order-id')],
        ['productOrderPinId', (0, helpers_1.readFlagValue)(args, '--product-order-pin-id')],
        ['paymentTxid', (0, helpers_1.readFlagValue)(args, '--payment-txid')],
        ['orderTxid', (0, helpers_1.readFlagValue)(args, '--order-txid')],
    ];
    const selected = selectors.filter(([, value]) => typeof value === 'string' && value.trim() && !value.startsWith('--'));
    if (selected.length === 0) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('missing_product_order_selector', 'Provide exactly one product order selector: --order-id, --product-order-pin-id, --payment-txid, or --order-txid.'),
        };
    }
    if (selected.length > 1) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('ambiguous_product_order_selector', 'Use only one product order selector: --order-id, --product-order-pin-id, --payment-txid, or --order-txid.'),
        };
    }
    const [key, value] = selected[0];
    return {
        ok: true,
        selector: { [key]: value.trim() },
    };
}
async function runProductsCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'skills') {
        const handler = context.dependencies.products?.listPublishSkills;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Product publish skills handler is not configured.');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        return handler(from ? { from } : undefined);
    }
    if (subcommand === 'publish') {
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.products?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Product publish handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        const from = (0, helpers_1.readFromFlag)(args);
        return handler(applyOptionalActor(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload, from));
    }
    if (subcommand === 'buy') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const handler = context.dependencies.products?.buy;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Product buy handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        const from = (0, helpers_1.readFromFlag)(args);
        return handler(applyOptionalActor(request, from));
    }
    if (subcommand === 'owned') {
        const ownedSubcommand = args[1];
        const ownedArgs = args.slice(2);
        if (ownedSubcommand === 'list') {
            const handler = context.dependencies.products?.listOwned;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Owned products list handler is not configured.');
            }
            return handler(readOwnedListInput(ownedArgs));
        }
        return (0, helpers_1.commandUnknownSubcommand)(`products owned ${ownedArgs.join(' ')}`.trim());
    }
    if (subcommand === 'orders') {
        const ordersSubcommand = args[1];
        const ordersArgs = args.slice(2);
        if (ordersSubcommand === 'list') {
            const handler = context.dependencies.products?.listOrders;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Product orders list handler is not configured.');
            }
            return handler(readProductOrderListInput(ordersArgs));
        }
        if (ordersSubcommand === 'inspect') {
            const selector = readProductOrderSelector(ordersArgs);
            if (!selector.ok) {
                return selector.result;
            }
            const handler = context.dependencies.products?.inspectOrder;
            if (!handler) {
                return (0, commandResult_1.commandFailed)('not_implemented', 'Product order inspection handler is not configured.');
            }
            const from = (0, helpers_1.readFromFlag)(ordersArgs);
            return handler({
                ...(from ? { from } : {}),
                ...selector.selector,
            });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`products orders ${ordersArgs.join(' ')}`.trim());
    }
    return (0, helpers_1.commandUnknownSubcommand)(`products ${args.join(' ')}`.trim());
}
