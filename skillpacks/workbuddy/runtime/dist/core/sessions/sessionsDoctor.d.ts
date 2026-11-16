/**
 * Doctor check for the local session layer (local session adapters P5a).
 *
 * Read-only: reports the registry state (readable? how many live sessions?
 * how many deliverable/bound?) and which host wiring files exist (ZCode MCP,
 * Cursor, Gemini). Never throws — doctor must degrade to an informative
 * check when nothing is set up yet.
 */
export interface SessionsDoctorCheck {
    code: 'local_sessions_layer';
    ok: boolean;
    registryPath: string;
    registryReadable: boolean;
    liveSessions: number;
    deliverableSessions: number;
    boundConversations: number;
    wiring: Record<string, string>;
    note?: string;
}
export declare function buildSessionsDoctorCheck(systemHomeDir: string, homes?: {
    zcodeDir?: string;
    cursorDir?: string;
    geminiDir?: string;
    kimiDir?: string;
}): Promise<SessionsDoctorCheck>;
