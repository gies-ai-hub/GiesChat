import React from 'react';
import userEvent from '@testing-library/user-event';
import { RecoilRoot } from 'recoil';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TUser, TPrincipal, AdminAgentUsage } from 'librechat-data-provider';
import CollaboratorsDialog from '../CollaboratorsDialog';
import store from '~/store';

const mockUpdate = jest.fn();
let addPeople: (principals: TPrincipal[]) => void = () => undefined;

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      updateAdminAgentCollaborators: (id: string, people: unknown) => mockUpdate(id, people),
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

const people = (
  overrides: Partial<{
    pending: string[];
    coAdmins: (typeof priya)[];
    pendingCoAdmins: string[];
  }> = {},
) => ({ collaborators: [priya], pending: [], coAdmins: [], pendingCoAdmins: [], ...overrides });

const saved = (overrides: Record<string, string[]> = {}) => ({
  userIds: ['u1'],
  coAdminIds: [],
  emails: [],
  coAdminEmails: [],
  ...overrides,
});

function renderDialog(lists = people()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = jest.fn();
  render(
    <RecoilRoot
      initializeState={({ set }) =>
        set(store.user, { name: 'Prof Castelino', email: 'prof@illinois.edu' } as TUser)
      }
    >
      <QueryClientProvider client={client}>
        <CollaboratorsDialog agent={agent} people={lists} onOpenChange={onOpenChange} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
  return onOpenChange;
}

describe('CollaboratorsDialog', () => {
  beforeEach(() =>
    mockUpdate.mockResolvedValue({
      collaborators: [],
      pending: [],
      coAdmins: [],
      pendingCoAdmins: [],
      invited: [],
      roleChanged: [],
    }),
  );

  it('lists the owner first, without a role picker', () => {
    renderDialog();
    expect(screen.getByText('Prof Castelino')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_role_owner')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'com_ui_admin_role_for {"name":"Prof Castelino"}' }),
    ).not.toBeInTheDocument();
  });

  it('makes a collaborator a co-admin through the role picker', async () => {
    renderDialog();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'com_ui_admin_role_for {"name":"Priya Natarajan"}' }),
      'coAdmin',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'agent_prod',
        saved({ userIds: [], coAdminIds: ['u1'] }),
      ),
    );
  });

  it('invites a typed address straight in as a co-admin', async () => {
    renderDialog();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'com_ui_admin_invite_role' }),
      'coAdmin',
    );
    await userEvent.type(
      screen.getByLabelText('com_ui_admin_collaborators_invite_label'),
      'co@illinois.edu{enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'agent_prod',
        saved({ coAdminEmails: ['co@illinois.edu'] }),
      ),
    );
  });

  it('reminds the owner to have people check spam once emails go out', async () => {
    mockUpdate.mockResolvedValue({
      collaborators: [],
      pending: [],
      coAdmins: [priya],
      pendingCoAdmins: [],
      invited: [],
      roleChanged: ['p@illinois.edu'],
    });
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'com_ui_admin_people_emailed {"count":1}',
          duration: expect.any(Number),
        }),
      ),
    );
  });

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
        saved({ userIds: ['u1', 'u2'], emails: ['no.account@illinois.edu'] }),
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
      expect(mockUpdate).toHaveBeenCalledWith(
        'agent_prod',
        saved({ emails: ['jokafor@illinois.edu'] }),
      ),
    );
  });

  it('shows an already-invited address and lets it be removed', async () => {
    renderDialog(people({ pending: ['waiting@illinois.edu'] }));
    expect(screen.getByText('waiting@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_collaborators_invited_pending')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'com_ui_admin_collaborators_remove {"name":"waiting@illinois.edu"}',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('agent_prod', saved()));
  });
});
