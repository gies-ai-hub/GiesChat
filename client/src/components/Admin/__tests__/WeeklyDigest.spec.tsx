import React from 'react';
import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/extend-expect';
import type { TUser } from 'librechat-data-provider';
import WeeklyDigest from '../WeeklyDigest';
import store from '~/store';

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminWeeklyDigest: () => mockGet(),
      updateAdminWeeklyDigest: (settings: unknown) => mockUpdate(settings),
    },
  };
});

const agents = [
  { agent_id: 'agent_a', name: 'ACCY 502A Case Coach', conversationCount: 18 },
  { agent_id: 'agent_b', name: 'Resume Reviewer', conversationCount: 0 },
];

function renderDigest() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RecoilRoot
      initializeState={({ set }) =>
        set(store.user, { name: 'Dana Whitfield', email: 'dwhitfield@illinois.edu' } as TUser)
      }
    >
      <QueryClientProvider client={client}>
        <WeeklyDigest agents={agents} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

async function openDialog() {
  const button = await screen.findByRole('button', { name: /Weekly email/ });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return screen.findByRole('dialog');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ agentIds: [], emails: [] });
  mockUpdate.mockImplementation(async (settings: unknown) => settings);
});

it('prefills my own address and checks the agent that has activity', async () => {
  renderDigest();
  await openDialog();
  expect(screen.getByText('dwhitfield@illinois.edu')).toBeInTheDocument();
  expect(screen.getByText('you')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'ACCY 502A Case Coach' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Resume Reviewer' })).not.toBeChecked();
});

it('refuses an address outside Illinois', async () => {
  renderDigest();
  await openDialog();
  await userEvent.type(screen.getByLabelText('Send it to'), 'x@gmail.com');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Use an @illinois.edu address.');
  expect(screen.queryByText('x@gmail.com')).not.toBeInTheDocument();
});

it('saves the picked agents and every address', async () => {
  renderDigest();
  await openDialog();
  await userEvent.type(screen.getByLabelText('Send it to'), 'jkim42@illinois.edu');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      agentIds: ['agent_a'],
      emails: ['dwhitfield@illinois.edu', 'jkim42@illinois.edu'],
    }),
  );
});

it('will not save addresses with no agent picked', async () => {
  renderDigest();
  await openDialog();
  await userEvent.click(screen.getByRole('checkbox', { name: 'ACCY 502A Case Coach' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one agent.');
});

it('turns the email off', async () => {
  renderDigest();
  await openDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ agentIds: [], emails: [] }));
});

it('shows On and reopens with what was saved', async () => {
  mockGet.mockResolvedValue({ agentIds: ['agent_b'], emails: ['ta@illinois.edu'] });
  renderDigest();
  expect(await screen.findByText('On')).toBeInTheDocument();
  await openDialog();
  expect(screen.getByText('ta@illinois.edu')).toBeInTheDocument();
  expect(screen.queryByText('dwhitfield@illinois.edu')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Resume Reviewer' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'ACCY 502A Case Coach' })).not.toBeChecked();
});
