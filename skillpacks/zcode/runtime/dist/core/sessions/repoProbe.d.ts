/**
 * Best-effort repo identity for a session cwd (local session adapters P1).
 *
 * Directory listings show `repo@branch` like reason-network does: the repo
 * slug comes from the origin remote basename (falling back to the directory
 * basename), the branch from `git rev-parse --abbrev-ref HEAD`. Everything
 * is bounded and never throws — a cwd that is not a work tree just yields
 * the directory basename and an empty branch.
 */
export declare function probeRepoIdentity(cwd: string): Promise<{
    repo: string;
    branch: string;
}>;
