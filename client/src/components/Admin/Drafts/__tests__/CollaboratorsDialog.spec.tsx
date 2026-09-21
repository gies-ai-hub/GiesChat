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
      updateAdminAgentCollaborators: (id: string, userIds: string[], emails: string[]) =>
        mockUpdate(id, userIds, emails),
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

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: mockShowToast }) };
});

const agent = { agent_id: 'agent_prod', name: 'Case Coach' } as AdminAgentUsage;
const priya = { id: 'u1', name: 'Priya Natarajan', email: 'p@illinois.edu' };

function renderDialog(pending: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <CollaboratorsDialog
        agent={agent}
        collaborators={[priya]}
        pending={pending}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe('CollaboratorsDialog', () => {
  beforeEach(() => mockUpdate.mockResolvedValue({ collaborators: [], pending: [], invited: [] }));

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

  it('adds a picked person with an account and invites one without', async () => {
    const onOpenChange = renderDialog();
    act(() =>
      addPeople([
        { type: 'user', id: 'u2', name: 'Jordan Okafor', email: 'j@illinois.edu' } as TPrincipal,
        {
          type: 'user',
          name: 'No Account',
          email: 'no.account@illinois.edu',
          idOnTheSource: 'entra-1',
        } as TPrincipal,
      ]),
    );
    expect(await screen.findByText('Jordan Okafor')).toBeInTheDocument();
    expect(screen.getByText('no.account@illinois.edu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'agent_prod',
        ['u1', 'u2'],
        ['no.account@illinois.edu'],
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('invites a typed Illinois address and rejects any other domain', async () => {
    renderDialog();
    const field = screen.getByLabelText('com_ui_admin_collaborators_invite_label');
    await userEvent.type(field, 'someone@gmail.com');
    await userEvent.click(
      screen.getByRole('button', { name: 'com_ui_admin_collaborators_invite_add' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_admin_collaborators_invite_domain');
    expect(screen.queryByText('someone@gmail.com')).not.toBeInTheDocument();

    await userEvent.clear(field);
    await userEvent.type(field, 'JOkafor@illinois.edu{enter}');
    expect(screen.getByText('jokafor@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_collaborators_invited_new')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('agent_prod', ['u1'], ['jokafor@illinois.edu']),
    );
  });

  it('shows an already-invited address and lets it be removed', async () => {
    renderDialog(['waiting@illinois.edu']);
    expect(screen.getByText('waiting@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_collaborators_invited_pending')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'com_ui_admin_collaborators_remove {"name":"waiting@illinois.edu"}',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('agent_prod', ['u1'], []));
  });

  it('reports how many invitations went out', async () => {
    mockUpdate.mockResolvedValue({
      collaborators: [],
      pending: ['jokafor@illinois.edu'],
      invited: ['jokafor@illinois.edu'],
    });
    renderDialog();
    await userEvent.type(
      screen.getByLabelText('com_ui_admin_collaborators_invite_label'),
      'jokafor@illinois.edu{enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'com_ui_admin_collaborators_invited_sent {"count":1}',
        }),
      ),
    );
  });
});
