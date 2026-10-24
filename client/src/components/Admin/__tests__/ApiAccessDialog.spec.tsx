import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecoilRoot } from 'recoil';
import type { AdminAgentUsage } from 'librechat-data-provider';
import ApiAccessDialog from '../ApiAccessDialog';

const mockGetAdminApiKeys = jest.fn();
const mockCreate = jest.fn();
const mockRevoke = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminApiKeys: () => mockGetAdminApiKeys(),
      createAdminAgentApiKey: (agentId: string, params: unknown) => mockCreate(agentId, params),
      revokeAdminApiKey: (keyId: string) => mockRevoke(keyId),
    },
  };
});

const APP_ID = '11111111-2222-3333-4444-555555555555';
const agent = { agent_id: 'agent_1', name: 'Case Coach' } as AdminAgentUsage;
const key = (id: string, agentId: string, name: string) => ({
  id,
  agentId,
  name,
  keyPrefix: 'sk-abcde',
  audience: APP_ID,
  lastUsedAt: null,
  requestCount: 4,
  createdAt: '2026-10-24T12:00:00.000Z',
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <ApiAccessDialog agent={agent} onOpenChange={jest.fn()} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAdminApiKeys.mockResolvedValue({
    keys: [key('k1', 'agent_1', 'BADM 350 site'), key('k2', 'agent_2', 'Other agent site')],
  });
});

it("lists only this agent's keys", async () => {
  renderDialog();
  expect(await screen.findByText('BADM 350 site')).toBeInTheDocument();
  expect(screen.queryByText('Other agent site')).not.toBeInTheDocument();
  expect(screen.getByText(/4 requests/)).toBeInTheDocument();
});

it('explains a bad app ID next to the field', async () => {
  renderDialog();
  await userEvent.click(await screen.findByRole('button', { name: 'New key' }));
  await userEvent.type(screen.getByLabelText('Key name'), 'Site');
  await userEvent.type(screen.getByLabelText("Site's Entra app ID"), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
  expect(screen.getByLabelText("Site's Entra app ID")).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(/Enter the app ID in the form/)).toBeInTheDocument();
  expect(mockCreate).not.toHaveBeenCalled();
});

it('shows a new key once with a quickstart', async () => {
  mockCreate.mockResolvedValue({ key: 'sk-secret-123', apiKey: key('k3', 'agent_1', 'New site') });
  renderDialog();
  await userEvent.click(await screen.findByRole('button', { name: 'New key' }));
  await userEvent.type(screen.getByLabelText('Key name'), 'New site');
  await userEvent.type(screen.getByLabelText("Site's Entra app ID"), APP_ID);
  await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
  expect(await screen.findByText(/won't see it again/)).toBeInTheDocument();
  expect(screen.getAllByText(/sk-secret-123/).length).toBeGreaterThan(0);
  expect(screen.getByText(/X-GiesChat-User-Token/)).toBeInTheDocument();
  expect(mockCreate).toHaveBeenCalledWith('agent_1', { name: 'New site', audience: APP_ID });
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByText(/sk-secret-123/)).not.toBeInTheDocument();
});

it('revokes a key', async () => {
  mockRevoke.mockResolvedValue({ deleted: true });
  renderDialog();
  await userEvent.click(await screen.findByRole('button', { name: 'Revoke key BADM 350 site' }));
  await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('k1'));
});
