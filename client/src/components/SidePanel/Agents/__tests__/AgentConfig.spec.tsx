import React from 'react';
import { render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import '@testing-library/jest-dom/extend-expect';
import type { AgentForm } from '~/common';
import AgentConfig from '../AgentConfig';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAgentCapabilities: () => ({ contextEnabled: false }),
}));
jest.mock('~/Providers', () => ({
  useAgentPanelContext: () => ({ setActivePanel: jest.fn() }),
}));
jest.mock('~/data-provider', () => ({ useGetAgentFiles: () => ({ data: undefined }) }));
jest.mock('../Tools/hooks', () => ({ useAgentFileEntries: () => ({ contextFiles: [] }) }));
jest.mock('../AgentCategorySelector', () => () => null);
jest.mock('../Instructions', () => () => null);
jest.mock('../SupportContact', () => () => null);
jest.mock('../AgentAvatar', () => () => null);
jest.mock('../Websites', () => ({
  __esModule: true,
  default: () => null,
  isWebsiteFile: () => false,
}));

function Harness() {
  const methods = useForm<AgentForm>({ defaultValues: { id: 'agent_1' } as Partial<AgentForm> });
  return (
    <FormProvider {...methods}>
      <AgentConfig />
    </FormProvider>
  );
}

it('labels the agent name as required instead of calling it optional', () => {
  render(<Harness />);
  const name = screen.getByRole('textbox', { name: 'com_ui_agent_name' });
  expect(name).toHaveAttribute('aria-required', 'true');
  expect(name).toHaveAttribute('placeholder', 'com_agents_name_example');
  expect(document.querySelector('label[for="name"]')).toHaveTextContent('com_ui_name *');
  expect(screen.getByText('com_agents_required_note')).toBeInTheDocument();
});
