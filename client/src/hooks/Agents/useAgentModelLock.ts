import { useMemo } from 'react';
import { isAgentsEndpoint } from 'librechat-data-provider';
import type { Agent, TModelSpec, TConversation } from 'librechat-data-provider';
import { getModelLabel } from '~/components/SidePanel/Agents/ModelCards';
import { useGetAgentByIdQuery, useGetStartupConfig } from '~/data-provider';
import { useAgentsMapContext } from '~/Providers';

/** The dashboard stamps every agent it builds; those run the model the professor chose. */
const DASHBOARD = 'dashboard';

/** The label a locked badge shows for this agent, or null when the user picks the model. */
export function modelLockLabel(
  agent: Agent | undefined,
  specs: TModelSpec[] | undefined,
): string | null {
  if (agent?.createdVia !== DASHBOARD || agent.model == null) {
    return null;
  }
  return getModelLabel(specs, agent.provider, agent.model);
}

/**
 * The display name of a class-dashboard agent's model, or null when the model is the
 * user's to pick. The chat shows it in place of the model selector so a student sees
 * what they are talking to and cannot move the conversation off it.
 */
export default function useAgentModelLock(conversation?: TConversation | null): string | null {
  const agentsMap = useAgentsMapContext();
  const { data: startupConfig } = useGetStartupConfig();

  const agentId = conversation?.agent_id ?? '';
  const mapped = agentsMap?.[agentId];
  const needsFetch =
    isAgentsEndpoint(conversation?.endpoint) && agentId !== '' && mapped?.model == null;
  const { data: fetched } = useGetAgentByIdQuery(agentId, { enabled: needsFetch });
  const agent = mapped?.model != null ? mapped : fetched;

  return useMemo(
    () => modelLockLabel(agent, startupConfig?.modelSpecs?.list),
    [agent, startupConfig],
  );
}
