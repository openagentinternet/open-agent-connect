/**
 * Browser half of open-agent-connect-dsh.
 *
 * Round 2 is a mount stub: Settings sections (`oac-bots` and siblings) and
 * the preset chip register in later rounds. `inject` lists the services those
 * surfaces will need so the DSH client composition stays stable.
 */

/** Services required before the client half activates. */
export const inject = ['slots', 'locale']

/** Client plugin body. Round 2 does not register settings.section rows. */
export function apply(): void {}
