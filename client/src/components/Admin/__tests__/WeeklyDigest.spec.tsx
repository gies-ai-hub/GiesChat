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
  mockGet.mockResolvedValue({ agentIds: [], emails: [], ...FRIDAY_5_CENTRAL });
  mockUpdate.mockImplementation(async (settings: unknown) => settings);
});

const FRIDAY_5_CENTRAL = { sendDay: 5, sendHour: 17, timezone: 'America/Chicago' };

it('starts on Friday at 5 PM Central', async () => {
  renderDigest();
  await openDialog();
  expect(screen.getByLabelText('Day')).toHaveValue('5');
  expect(screen.getByLabelText('Time')).toHaveValue('17');
  expect(screen.getByLabelText('Timezone')).toHaveValue('America/Chicago');
  expect(screen.getByRole('option', { name: 'Friday' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '5 PM' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Central.*Chicago/ })).toBeInTheDocument();
});

it('saves the day, time and timezone that were picked', async () => {
  renderDigest();
  await openDialog();
  await userEvent.selectOptions(screen.getByLabelText('Day'), '1');
  await userEvent.selectOptions(screen.getByLabelText('Time'), '8');
  await userEvent.selectOptions(screen.getByLabelText('Timezone'), 'America/New_York');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({
      agentIds: ['agent_a'],
      emails: ['dwhitfield@illinois.edu'],
      sendDay: 1,
      sendHour: 8,
      timezone: 'America/New_York',
    }),
  );
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
      ...FRIDAY_5_CENTRAL,
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
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith({ agentIds: [], emails: [], ...FRIDAY_5_CENTRAL }),
  );
});

it('shows On and reopens with what was saved, schedule included', async () => {
  mockGet.mockResolvedValue({
    agentIds: ['agent_b'],
    emails: ['ta@illinois.edu'],
    sendDay: 1,
    sendHour: 8,
    timezone: 'America/Denver',
  });
  renderDigest();
  expect(await screen.findByText('On')).toBeInTheDocument();
  await openDialog();
  expect(screen.getByText('ta@illinois.edu')).toBeInTheDocument();
  expect(screen.queryByText('dwhitfield@illinois.edu')).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Resume Reviewer' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'ACCY 502A Case Coach' })).not.toBeChecked();
  expect(screen.getByLabelText('Day')).toHaveValue('1');
  expect(screen.getByLabelText('Time')).toHaveValue('8');
  expect(screen.getByLabelText('Timezone')).toHaveValue('America/Denver');
});
