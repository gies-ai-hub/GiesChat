import React from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TPrincipal, AdminAgentUsage } from 'librechat-data-provider';
import CollaboratorsDialog from '../CollaboratorsDialog';

const mockUpdate = jest.fn();
let addPeople: (principals: TPrincipal[]) => void = () => undefined;

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      updateAdminAgentCollaborators: (id: string, userIds: string[]) => mockUpdate(id, userIds),
    },
  };
});

jest.mock('~/components/Sharing/PeoplePicker/UnifiedPeopleSearch', () => ({
  __esModule: true,
  default: ({ onAddPeople }: { onAddPeople: (p: TPrincipal[]) => void }) => {
    addPeople = onAddPeople;
    return <div data-testid="people-search" />;
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: jest.fn() }) };
});

const agent = { agent_id: 'agent_prod', name: 'Case Coach' } as AdminAgentUsage;
const priya = { id: 'u1', name: 'Priya Natarajan', email: 'p@illinois.edu' };

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <CollaboratorsDialog agent={agent} collaborators={[priya]} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe('CollaboratorsDialog', () => {
  beforeEach(() => mockUpdate.mockResolvedValue({ collaborators: [] }));

  it('lists current collaborators and removes one', async () => {
    renderDialog();
    expect(screen.getByText('Priya Natarajan')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'com_ui_admin_collaborators_remove {"name":"Priya Natarajan"}',
      }),
    );
    expect(screen.queryByText('Priya Natarajan')).not.toBeInTheDocument();
  });

  it('adds a picked person with a local account and saves the id list', async () => {
    const onOpenChange = renderDialog();
    act(() =>
      addPeople([
        { type: 'user', id: 'u2', name: 'Jordan Okafor', email: 'j@illinois.edu' } as TPrincipal,
        { type: 'user', name: 'No Account', idOnTheSource: 'entra-1' } as TPrincipal,
      ]),
    );
    expect(await screen.findByText('Jordan Okafor')).toBeInTheDocument();
    expect(
      screen.getByText('com_ui_admin_collaborators_needs_account {"name":"No Account"}'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('agent_prod', ['u1', 'u2']));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
