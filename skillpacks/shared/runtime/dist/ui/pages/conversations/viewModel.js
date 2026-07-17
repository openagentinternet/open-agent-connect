"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConversationsPageViewModel = buildConversationsPageViewModel;
exports.buildConversationsPageViewModelRuntimeSource = buildConversationsPageViewModelRuntimeSource;
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function readArray(value) {
    return Array.isArray(value) ? value : [];
}
function normalizeTimestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value < 1_000_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
        }
        const dateMs = new Date(value).getTime();
        return Number.isFinite(dateMs) ? dateMs : 0;
    }
    return 0;
}
function formatTimestamp(value) {
    if (!Number.isFinite(value) || value <= 0)
        return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '-';
    const pad = (part) => String(part).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('-') + ' ' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}
function titleCase(value) {
    if (!value)
        return 'Unknown';
    return value
        .split(/[\s_-]+/u)
        .filter(Boolean)
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ') || 'Unknown';
}
function readAvatar(record) {
    return normalizeText(record.avatarDataUrl)
        || normalizeText(record.avatar)
        || normalizeText(record.avatarUrl)
        || normalizeText(record.avatarImage)
        || normalizeText(record.avatarUri)
        || normalizeText(record.avatar_uri);
}
function normalizeTxid(value) {
    const normalized = normalizeText(value).toLowerCase();
    return /^[0-9a-f]{64}$/iu.test(normalized) ? normalized : '';
}
function normalizePinIdTxid(value) {
    const normalized = normalizeText(value).toLowerCase();
    const match = normalized.match(/^([0-9a-f]{64})i\d+$/iu);
    return match ? match[1] : '';
}
function resolveMessageTxid(record) {
    const txids = readArray(record.txids).map(normalizeTxid).find(Boolean);
    return txids
        || normalizeTxid(record.txid)
        || normalizeTxid(record.txId)
        || normalizePinIdTxid(record.pinId)
        || normalizePinIdTxid(record.messagePinId);
}
function formatTxidPreview(txid) {
    return txid ? `${txid.slice(0, 8)}...${txid.slice(-6)}` : '';
}
function formatConversationIdPreview(conversationId) {
    return conversationId.length > 28
        ? `${conversationId.slice(0, 8)}...${conversationId.slice(-6)}`
        : conversationId;
}
function isMarkdownContentType(contentType) {
    return /^text\/markdown(?:\s*;|$)/iu.test(contentType);
}
function extractLocalBots(input) {
    if (Array.isArray(input.localBots))
        return input.localBots;
    const response = readObject(input.botProfilesResponse);
    const data = readObject(response.data);
    return readArray(data.profiles).length > 0
        ? readArray(data.profiles)
        : readArray(response.profiles);
}
function extractConversations(input) {
    if (Array.isArray(input.conversations))
        return input.conversations;
    const response = readObject(input.conversationsResponse);
    const data = readObject(response.data);
    return readArray(data.conversations).length > 0
        ? readArray(data.conversations)
        : readArray(response.conversations);
}
function extractMessages(input) {
    if (Array.isArray(input.messages))
        return input.messages;
    const response = readObject(input.messagesResponse);
    const data = readObject(response.data);
    return readArray(data.messages).length > 0
        ? readArray(data.messages)
        : readArray(response.messages);
}
function normalizeKindLabel(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'order_protocol' || normalized === 'service' || normalized === 'service_order') {
        return 'Service';
    }
    return 'Chat';
}
function normalizeKindLabels(value) {
    const raw = readArray(value);
    const labels = raw.length > 0 ? raw.map(normalizeKindLabel) : ['Chat'];
    return labels.filter((label, index) => labels.indexOf(label) === index);
}
function buildLocalBotOption(row, selectedLocalGlobalMetaId) {
    const record = readObject(row);
    const globalMetaId = normalizeText(record.globalMetaId);
    if (!globalMetaId)
        return null;
    const label = normalizeText(record.name) || normalizeText(record.slug) || globalMetaId;
    return {
        label,
        slug: normalizeText(record.slug),
        globalMetaId,
        avatar: readAvatar(record),
        isSelected: selectedLocalGlobalMetaId === globalMetaId,
    };
}
function buildConversationId(record, localGlobalMetaId, peerGlobalMetaId) {
    return normalizeText(record.conversationId)
        || normalizeText(record.id)
        || `peer-${localGlobalMetaId || 'local'}-${peerGlobalMetaId || 'peer'}`;
}
function buildSyntheticConversationSummary(localGlobalMetaId, peerGlobalMetaId) {
    const conversationId = buildConversationId({}, localGlobalMetaId, peerGlobalMetaId);
    return {
        conversationId,
        conversationIdPreview: formatConversationIdPreview(conversationId),
        localGlobalMetaId,
        localAvatar: '',
        peerLabel: peerGlobalMetaId,
        peerGlobalMetaId,
        peerAvatar: '',
        peerLlmPrimaryProvider: '',
        peerLlmPrimaryProviderLabel: '',
        latestText: `Conversation with ${peerGlobalMetaId}`,
        latestAt: 0,
        latestAtLabel: '-',
        kinds: ['Chat'],
        stateLabel: 'Active',
        messageCountLabel: '0 messages',
        localBotLabel: '',
        isSelected: true,
    };
}
function buildConversationSummary(row, selected) {
    const record = readObject(row);
    const localGlobalMetaId = normalizeText(record.localGlobalMetaId)
        || normalizeText(record.localBotGlobalMetaId);
    const peerGlobalMetaId = normalizeText(record.peerGlobalMetaId)
        || normalizeText(record.peer);
    const conversationId = buildConversationId(record, localGlobalMetaId, peerGlobalMetaId);
    const peerLabel = normalizeText(record.peerName)
        || normalizeText(record.peerDisplayName)
        || peerGlobalMetaId
        || 'Unknown peer';
    const latestAt = normalizeTimestampMs(record.latestAt || record.updatedAt || record.lastMessageAt || record.createdAt);
    const count = Number(record.messageCount ?? record.turnCount ?? 0);
    const messageCount = Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
    const peerLlmPrimaryProvider = normalizeText(record.peerLlmPrimaryProvider);
    return {
        conversationId,
        conversationIdPreview: formatConversationIdPreview(conversationId),
        localGlobalMetaId,
        localAvatar: normalizeText(record.localAvatar)
            || normalizeText(record.localBotAvatar)
            || normalizeText(record.localMetabotAvatar),
        peerLabel,
        peerGlobalMetaId,
        peerAvatar: normalizeText(record.peerAvatar)
            || normalizeText(record.avatar)
            || normalizeText(record.peerAvatarUrl)
            || normalizeText(record.peerAvatarImage),
        peerLlmPrimaryProvider,
        peerLlmPrimaryProviderLabel: peerLlmPrimaryProvider ? titleCase(peerLlmPrimaryProvider) : '',
        latestText: normalizeText(record.latestText)
            || normalizeText(record.lastMessage)
            || normalizeText(record.preview)
            || `Conversation with ${peerLabel}`,
        latestAt,
        latestAtLabel: formatTimestamp(latestAt),
        kinds: normalizeKindLabels(record.kinds),
        stateLabel: titleCase(normalizeText(record.state) || 'active'),
        messageCountLabel: `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`,
        localBotLabel: normalizeText(record.localBotName)
            || normalizeText(record.localMetabotName)
            || normalizeText(record.localName),
        isSelected: Boolean((selected.peerGlobalMetaId && peerGlobalMetaId === selected.peerGlobalMetaId)
            || (selected.conversationId && conversationId === selected.conversationId)),
    };
}
function buildMessage(row) {
    const record = readObject(row);
    const direction = normalizeText(record.direction).toLowerCase();
    const timestamp = normalizeTimestampMs(record.timestamp || record.createdAt);
    const sender = readObject(record.sender);
    const contentType = normalizeText(record.contentType) || 'text/plain';
    const txid = resolveMessageTxid(record);
    return {
        messageId: normalizeText(record.messageId)
            || normalizeText(record.id)
            || normalizeText(record.pinId)
            || normalizeText(record.messagePinId),
        direction,
        directionLabel: direction === 'outgoing' || direction === 'outbound' ? 'Bot' : 'Peer',
        kindLabel: normalizeKindLabel(record.kind || record.protocolTag),
        content: normalizeText(record.content) || normalizeText(record.text) || normalizeText(record.body),
        contentType,
        isMarkdown: isMarkdownContentType(contentType),
        senderLabel: normalizeText(sender.name)
            || normalizeText(sender.displayName)
            || normalizeText(sender.globalMetaId)
            || (direction === 'outgoing' || direction === 'outbound' ? 'Local Bot' : 'Remote Bot'),
        senderAvatar: readAvatar(sender),
        txid,
        txidPreview: formatTxidPreview(txid),
        timestampLabel: formatTimestamp(timestamp || normalizeTimestampMs(sender.timestamp)),
    };
}
function buildConversationsPageViewModel(input = {}) {
    const selectedLocalInput = normalizeText(input.selectedLocalGlobalMetaId);
    const localBotRows = extractLocalBots(input);
    const selectedLocalGlobalMetaId = selectedLocalInput
        || normalizeText(readObject(localBotRows[0]).globalMetaId);
    const localBots = localBotRows
        .map((row) => buildLocalBotOption(row, selectedLocalGlobalMetaId))
        .filter((bot) => Boolean(bot));
    const selected = {
        peerGlobalMetaId: normalizeText(input.selectedPeerGlobalMetaId),
        conversationId: normalizeText(input.selectedConversationId),
    };
    const summaries = extractConversations(input)
        .map((row) => buildConversationSummary(row, selected))
        .filter((summary) => summary.peerGlobalMetaId)
        .sort((left, right) => right.latestAt - left.latestAt);
    const matchedSummary = selected.conversationId
        ? summaries.find((summary) => summary.conversationId === selected.conversationId) ?? null
        : selected.peerGlobalMetaId
            ? summaries.find((summary) => summary.peerGlobalMetaId === selected.peerGlobalMetaId) ?? null
            : summaries[0] ?? null;
    const syntheticSummary = !matchedSummary && selected.peerGlobalMetaId
        ? buildSyntheticConversationSummary(selectedLocalGlobalMetaId, selected.peerGlobalMetaId)
        : null;
    const activeSummary = matchedSummary ?? syntheticSummary;
    const selectedPeer = activeSummary?.peerGlobalMetaId ?? '';
    const selectedConversationId = activeSummary?.conversationId ?? '';
    const displaySummaries = syntheticSummary
        ? [syntheticSummary, ...summaries]
        : summaries;
    const conversations = displaySummaries.map((summary) => ({
        ...summary,
        isSelected: Boolean((selectedPeer && summary.peerGlobalMetaId === selectedPeer)
            || (selectedConversationId && summary.conversationId === selectedConversationId)),
    }));
    const selectedConversation = conversations.find((summary) => summary.isSelected) || null;
    const messages = extractMessages(input)
        .sort((left, right) => {
        const leftRecord = readObject(left);
        const rightRecord = readObject(right);
        return normalizeTimestampMs(leftRecord.timestamp || leftRecord.createdAt)
            - normalizeTimestampMs(rightRecord.timestamp || rightRecord.createdAt);
    })
        .map(buildMessage);
    return {
        localBots,
        selectedLocalGlobalMetaId,
        selectedPeerGlobalMetaId: selectedPeer,
        conversations,
        selectedConversation,
        messages,
        emptyState: {
            title: 'No conversations yet',
            message: 'Peer conversations for the selected local Bot will appear here.',
        },
        detailEmptyState: {
            title: selectedConversation ? 'No messages yet' : 'Select a conversation',
            message: selectedConversation
                ? 'Messages for this Bot pair will appear here.'
                : 'Choose a remote Bot from the conversation list.',
        },
    };
}
function buildConversationsPageViewModelRuntimeSource() {
    return [
        normalizeText,
        readObject,
        readArray,
        normalizeTimestampMs,
        formatTimestamp,
        titleCase,
        readAvatar,
        normalizeTxid,
        normalizePinIdTxid,
        resolveMessageTxid,
        formatTxidPreview,
        formatConversationIdPreview,
        isMarkdownContentType,
        extractLocalBots,
        extractConversations,
        extractMessages,
        normalizeKindLabel,
        normalizeKindLabels,
        buildLocalBotOption,
        buildConversationId,
        buildSyntheticConversationSummary,
        buildConversationSummary,
        buildMessage,
        buildConversationsPageViewModel,
    ].map((fn) => fn.toString()).join('\n');
}
