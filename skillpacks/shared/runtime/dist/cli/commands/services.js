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
async function runServicesCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'publish') {
        const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
        if (!payloadFile) {
            return (0, helpers_1.commandMissingFlag)('--payload-file');
        }
        const chainFlag = (0, helpers_1.readChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.services?.publish;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services publish handler is not configured.');
        }
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile);
        return handler(chainFlag.chain ? { ...payload, network: chainFlag.chain } : payload);
    }
    if (subcommand === 'call') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const handler = context.dependencies.services?.call;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services call handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        const result = await handler(request);
        if (result.state === 'waiting' &&
            'data' in result &&
            result.data &&
            typeof result.data === 'object' &&
            'traceId' in result.data &&
            result.localUiUrl &&
            process.stdout.isTTY) {
            const { pollTraceUntilComplete } = await Promise.resolve().then(() => __importStar(require('./pollTraceHelper')));
            const traceGet = context.dependencies.trace?.get;
            if (traceGet) {
                const poll = await pollTraceUntilComplete({
                    traceId: String(result.data.traceId),
                    localUiUrl: result.localUiUrl,
                    requestFn: async (method, path) => {
                        const traceId = path.split('/').pop() || '';
                        return traceGet({ traceId: decodeURIComponent(traceId) });
                    },
                    stderr: context.stderr,
                });
                if (poll.completed && poll.trace) {
                    const { commandSuccess } = await Promise.resolve().then(() => __importStar(require('../../core/contracts/commandResult')));
                    const sessions = Array.isArray(poll.trace.sessions) ? poll.trace.sessions : [];
                    const firstSession = sessions[0];
                    return commandSuccess({
                        ...result.data,
                        ...(firstSession?.responseText ? { responseText: firstSession.responseText } : {}),
                        localUiUrl: result.localUiUrl,
                    });
                }
            }
        }
        return result;
    }
    if (subcommand === 'rate') {
        const requestFile = (0, helpers_1.readFlagValue)(args, '--request-file');
        if (!requestFile) {
            return (0, helpers_1.commandMissingFlag)('--request-file');
        }
        const chainFlag = (0, helpers_1.readChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.services?.rate;
        if (!handler) {
            return (0, commandResult_1.commandFailed)('not_implemented', 'Services rate handler is not configured.');
        }
        const request = await (0, helpers_1.readJsonFile)(context, requestFile);
        return handler(chainFlag.chain ? { ...request, network: chainFlag.chain } : request);
    }
    return (0, helpers_1.commandUnknownSubcommand)(`services ${args.join(' ')}`.trim());
}
