import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { UseMutationResult, QueryObserverResult } from '@tanstack/react-query';
import type { Agent, AgentCreateParams } from 'librechat-data-provider';
import type { AgentForm } from '~/common';
import AgentSelect from '../AgentSelect';

/** The VIEW list never holds an agent a `manage:agents` admin opens from the dashboard. */
jest.mock('~/data-provider', () => ({
  useListAgentsQuery: () => ({ data: [] }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAgentDefaultPermissionLevel: () => 1,
}));

const othersAgent = {
  id: 'agent_dana',
  name: 'ACCY 502A Audit Tutor',
  instructions: 'Walk students through audit sampling.',
  provider: 'Azure OpenAI',
  model: 'gpt-6-luna',
} as Agent;

let formValues: () => AgentForm;

function Harness({ setCurrentAgentId }: { setCurrentAgentId: jest.Mock }) {
  const methods = useForm<AgentForm>();
  formValues = methods.getValues;
  return (
    <FormProvider {...methods}>
      <AgentSelect
        selectedAgentId="agent_dana"
        agentQuery={{ data: othersAgent, isSuccess: true } as QueryObserverResult<Agent>}
        setCurrentAgentId={setCurrentAgentId}
        createMutation={
          { reset: jest.fn() } as unknown as UseMutationResult<Agent, Error, AgentCreateParams>
        }
      />
    </FormProvider>
  );
}

describe('AgentSelect', () => {
  it('keeps an agent loaded by id that the shared list lacks, instead of blanking the form', async () => {
    const setCurrentAgentId = jest.fn();
    render(<Harness setCurrentAgentId={setCurrentAgentId} />);

    await waitFor(() => expect(setCurrentAgentId).toHaveBeenCalledWith('agent_dana'));
    expect(setCurrentAgentId).not.toHaveBeenCalledWith(undefined);
    expect(formValues().instructions).toBe('Walk students through audit sampling.');
  });
});
