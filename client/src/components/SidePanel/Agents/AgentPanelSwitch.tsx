import { useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { AgentPanelProvider, useAgentPanelContext } from '~/Providers/AgentPanelContext';
import { Panel, isEphemeralAgent } from '~/common';
import VersionPanel from './Version/VersionPanel';
import AgentPanel from './AgentPanel';
import store from '~/store';

interface AgentPanelSwitchProps {
  /** Fired after an agent is created, so a host (e.g. a dialog) can react. */
  onAgentCreated?: (agentId: string) => void;
  /** Stamped onto agents created here, so a host can later filter to its own builds. */
  createdVia?: string;
  /** Opens the panel on an existing agent instead of a blank form. */
  initialAgentId?: string;
  /** Hides the agent switcher and the chat-navigation buttons. */
  hideAgentSelect?: boolean;
}

export default function AgentPanelSwitch({
  onAgentCreated,
  createdVia,
  initialAgentId,
  hideAgentSelect,
}: AgentPanelSwitchProps = {}) {
  return (
    <AgentPanelProvider>
      <AgentPanelSwitchWithContext
        onAgentCreated={onAgentCreated}
        createdVia={createdVia}
        initialAgentId={initialAgentId}
        hideAgentSelect={hideAgentSelect}
      />
    </AgentPanelProvider>
  );
}

function AgentPanelSwitchWithContext({
  onAgentCreated,
  createdVia,
  initialAgentId,
  hideAgentSelect,
}: AgentPanelSwitchProps) {
  const { activePanel, setCurrentAgentId } = useAgentPanelContext();
  const agentId = useRecoilValue(store.conversationAgentIdByIndex(0));

  /** Hosts outside the chat route have no conversation to seed from, so an explicitly
   *  requested agent takes precedence over the chat-derived one. */
  useEffect(() => {
    if (initialAgentId != null && initialAgentId !== '') {
      setCurrentAgentId(initialAgentId);
      return;
    }
    const agent_id = agentId ?? '';
    if (!isEphemeralAgent(agent_id)) {
      setCurrentAgentId(agent_id);
    }
  }, [setCurrentAgentId, agentId, initialAgentId]);

  if (activePanel === Panel.version) {
    return <VersionPanel />;
  }
  return (
    <AgentPanel
      onAgentCreated={onAgentCreated}
      createdVia={createdVia}
      hideAgentSelect={hideAgentSelect}
    />
  );
}
