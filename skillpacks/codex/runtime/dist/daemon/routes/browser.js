"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBrowserRoutes = void 0;
const http_1 = require("../../browser/http");
const handleBrowserRoutes = async (context) => (0, http_1.handleBrowserApiRoutes)({
    method: context.req.method ?? 'GET',
    url: context.url,
    handlers: context.handlers.browser,
    readJsonBody: context.readJsonBody,
    sendJson: context.sendJson,
    sendMethodNotAllowed: context.sendMethodNotAllowed,
});
exports.handleBrowserRoutes = handleBrowserRoutes;
