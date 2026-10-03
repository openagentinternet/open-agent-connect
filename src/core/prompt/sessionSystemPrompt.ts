/**
 * System prompt for unattended persona-driven sessions (MetaWeb surf, nightly
 * study, QA surf): scenario framing + the shared identity block + the
 * experience hot layer (self-identity / value boundaries / work reviews /
 * recent dream diaries). Scoped owner memories are deliberately NOT included
 * — these sessions act publicly on MetaWeb, and the prompts previously
 * referenced a persona that was never injected.
 */
import { loadChatPersona } from '../chat/chatPersonaLoader';
import { buildExperienceContext } from '../memory/memoryService';
import type { MetabotPaths } from '../state/paths';
import { composeSystemPrompt, SYSTEM_PROMPT_ORDER } from './compose';
import { buildMetabotIdentityBlock } from './metabotIdentity';

export async function buildPersonaSessionSystemPrompt(
  paths: MetabotPaths,
  input: { scenario: string },
): Promise<string> {
  const persona = await loadChatPersona(paths).catch(() => null);
  const experienceXml = await buildExperienceContext(paths);
  return composeSystemPrompt([
    { name: 'scenario', order: SYSTEM_PROMPT_ORDER.scenario, text: input.scenario },
    {
      name: 'identity',
      order: SYSTEM_PROMPT_ORDER.identity,
      text: persona
        ? buildMetabotIdentityBlock({
          name: persona.identity?.name,
          globalMetaId: persona.identity?.globalMetaId,
          role: persona.role,
          soul: persona.soul,
          goal: persona.goal,
        })
        : '',
    },
    { name: 'experience', order: SYSTEM_PROMPT_ORDER.experience, text: experienceXml },
  ]);
}
