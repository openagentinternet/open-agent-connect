export type SimplemsgOrderProtocolTag = 'ORDER' | 'ORDER_STATUS' | 'DELIVERY' | 'NeedsRating' | 'ORDER_END';
export type SimplemsgOpenTeamTag = 'OPENTEAM_INVITE' | 'OPENTEAM_ACCEPT' | 'OPENTEAM_DECLINE' | 'OPENTEAM_KICK';
export type SimplemsgClassification = {
    kind: 'private_chat';
} | {
    kind: 'order_protocol';
    tag: SimplemsgOrderProtocolTag;
    orderTxid: string | null;
    orderPinId: string | null;
    reason: string | null;
} | {
    /** OpenTeam group-task recruitment envelope — record-only, never LLM. */
    kind: 'openteam_envelope';
    tag: SimplemsgOpenTeamTag;
};
export declare function classifySimplemsgContent(content: unknown): SimplemsgClassification;
