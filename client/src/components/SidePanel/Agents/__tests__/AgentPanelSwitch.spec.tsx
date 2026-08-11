import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import AgentPanelSwitch from '../AgentPanelSwitch';

const mockSetCurrentAgentId = jest.fn();

jest.mock('../AgentPanel', () => ({
  __esModule: true,
  default: ({ hideAgentSelect }: { hideAgentSelect?: boolean }) => (
    <div data-testid="agent-panel" data-hide-agent-select={String(hideAgentSelect === true)} />
  ),
}));

jest.mock('../Version/VersionPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="version-panel" />,
}));

jest.mock('~/Providers/AgentPanelContext', () => ({
  AgentPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAgentPanelContext: () => ({
    activePanel: 'builder',
    setCurrentAgentId: mockSetCurrentAgentId,
  }),
}));

const renderSwitch = (props: Record<string, unknown> = {}) =>
  render(
    <RecoilRoot>
      <AgentPanelSwitch {...props} />
    </RecoilRoot>,
  );

describe('AgentPanelSwitch', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Hosts outside the chat route have no conversation to seed from, so without this the
   * panel opens blank — which reads as a loading state rather than a bug.
   */
  it('opens on an explicitly requested agent', async () => {
    renderSwitch({ initialAgentId: 'agent_1' });

    await waitFor(() => expect(mockSetCurrentAgentId).toHaveBeenCalledWith('agent_1'));
    expect(mockSetCurrentAgentId).not.toHaveBeenCalledWith('');
  });

  it('seeds nothing when there is no chat conversation and no requested agent', () => {
    renderSwitch();

    expect(mockSetCurrentAgentId).not.toHaveBeenCalled();
  });

  it('forwards hideAgentSelect to the panel', () => {
    const { getByTestId } = renderSwitch({ initialAgentId: 'agent_1', hideAgentSelect: true });

    expect(getByTestId('agent-panel')).toHaveAttribute('data-hide-agent-select', 'true');
  });
});
