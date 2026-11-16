/**
 * Peer-input message framing (local session adapters P3).
 *
 * Injected text is framed as peer input, never as the user: the frame names
 * the sender, and the trailing hint names the exact reply tool so the
 * receiving agent answers through our MCP surface instead of a native send
 * mechanism of its own. Keep the frame terse — it lands inside the agent's
 * own conversation.
 */
export interface PeerMessageFrameInput {
    /** Sender identity (peer GlobalMetaID, or a session key for local senders). */
    from: string;
    fromName?: string;
    /** The mail id (reply_to provenance for the reply tool). */
    mailId: string;
    body: string;
}
export declare function buildPeerMessageFrame(input: PeerMessageFrameInput): string;
