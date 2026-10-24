import React from 'react';
import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { AdminAgentDraftsResponse, AdminDraftUpdatePreview } from 'librechat-data-provider';
import DraftUpdate from '../DraftUpdate';

const mockGetDrafts = jest.fn();
const mockGetUpdate = jest.fn();
const mockApplyUpdate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getStartupConfig: async () => ({
        modelSpecs: {
          list: [
            { label: 'GPT-6 Luna', preset: { endpoint: 'Azure OpenAI', model: 'gpt-6-luna' } },
          ],
        },
      }),
      getAdminAgentDrafts: (id: string) => mockGetDrafts(id),
      getAdminDraftUpdate: (agentId: string, draftId: string) => mockGetUpdate(agentId, draftId),
      updateAdminAgentDraft: (agentId: string, draftId: string, payload: unknown) =>
        mockApplyUpdate(agentId, draftId, payload),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: mockShowToast }) };
});

const draftsList = (overrides: Partial<AdminAgentDraftsResponse['drafts'][number]> = {}) => ({
  agent_id: 'agent_prod',
  version: 7,
  collaborators: [],
  pending: [],
  coAdmins: [],
  pendingCoAdmins: [],
  drafts: [
    {
      draft_id: 'agent_prod_jordan',
      owner: { id: 'u1', name: 'Jordan Patel', email: 'jpatel7@illinois.edu' },
      draftBase: 5,
      postedVersion: null,
      updatedAt: null,
      mine: true,
      embed: null,
      ...overrides,
    },
  ],
});

const preview: AdminDraftUpdatePreview = {
  from: 5,
  to: 7,
  changes: [
    { field: 'model', from: 'production', before: 'gpt-6-luna', after: 'gpt-6.1-sol' },
    {
      field: 'tool_resources',
      from: 'production',
      before: null,
      after: '+ Week 9 - Capital budgeting.pdf',
    },
    {
      field: 'conversation_starters',
      from: 'draft',
      before: 'What is NPV?',
      after: 'What is NPV?, Explain WACC',
    },
  ],
  conflicts: [
    {
      id: 'instructions:0',
      field: 'instructions',
      context: 'Never hand over final answers to graded work.',
      mine: 'Office hours: Tuesdays 2-4 pm, and Thursdays on Zoom.',
      theirs: 'Office hours: Tuesdays 3-5 pm, BIF 2030.',
    },
  ],
};

function renderUpdate(onUpdated = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <DraftUpdate agentId="agent_prod" draftId="agent_prod_jordan" onUpdated={onUpdated} />
      </QueryClientProvider>
    </RecoilRoot>,
  );
  return onUpdated;
}

describe('DraftUpdate', () => {
  beforeEach(() => {
    mockGetDrafts.mockReset();
    mockGetUpdate.mockReset();
    mockApplyUpdate.mockReset();
    mockShowToast.mockReset();
  });

  it('shows nothing for a draft that is current or belongs to someone else', async () => {
    mockGetDrafts.mockResolvedValue(draftsList({ draftBase: 7 }));
    renderUpdate();
    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    mockGetDrafts.mockResolvedValue(draftsList({ mine: false }));
    renderUpdate();
    await waitFor(() => expect(mockGetDrafts).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('com_ui_admin_draft_update')).not.toBeInTheDocument();
  });

  it('previews the update and applies it only once every clash has a pick', async () => {
    mockGetDrafts.mockResolvedValue(draftsList());
    mockGetUpdate.mockResolvedValue(preview);
    mockApplyUpdate.mockResolvedValue({ draft_id: 'agent_prod_jordan', draftBase: 7 });
    const onUpdated = renderUpdate();

    expect(
      await screen.findByText('com_ui_admin_draft_update_notice {"from":5,"to":7}'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_admin_draft_update' }));

    expect(await screen.findByText(/GPT-6 Luna → GPT-6.1 Sol/)).toBeInTheDocument();
    expect(screen.getByText('+ Week 9 - Capital budgeting.pdf')).toBeInTheDocument();
    expect(screen.getByText(/What is NPV\?, Explain WACC/)).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    const apply = () =>
      screen
        .getAllByRole('button', { name: 'com_ui_admin_draft_update' })
        .find((button) => dialog.contains(button)) as HTMLElement;
    expect(apply()).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /com_ui_admin_draft_update_theirs/ }));
    expect(apply()).toBeEnabled();
    await userEvent.click(apply());

    await waitFor(() =>
      expect(mockApplyUpdate).toHaveBeenCalledWith('agent_prod', 'agent_prod_jordan', {
        to: 7,
        choices: { 'instructions:0': 'theirs' },
      }),
    );
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_admin_draft_update_success {"to":7}' }),
    );
  });

  it('warns and clears the picks when production moved again', async () => {
    mockGetDrafts.mockResolvedValue(draftsList());
    mockGetUpdate.mockResolvedValue(preview);
    mockApplyUpdate.mockRejectedValue({ status: 409 });
    const onUpdated = renderUpdate();

    await userEvent.click(await screen.findByRole('button', { name: 'com_ui_admin_draft_update' }));
    await userEvent.click(
      await screen.findByRole('radio', { name: /com_ui_admin_draft_update_yours/ }),
    );
    const dialog = screen.getByRole('dialog');
    const apply = screen
      .getAllByRole('button', { name: 'com_ui_admin_draft_update' })
      .find((button) => dialog.contains(button)) as HTMLElement;
    await userEvent.click(apply);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'com_ui_admin_draft_update_moved' }),
      ),
    );
    expect(
      screen.getByRole('radio', { name: /com_ui_admin_draft_update_yours/ }),
    ).not.toBeChecked();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('reports a preview that fails to load', async () => {
    mockGetDrafts.mockResolvedValue(draftsList());
    mockGetUpdate.mockRejectedValue(new Error('boom'));
    renderUpdate();
    await userEvent.click(await screen.findByRole('button', { name: 'com_ui_admin_draft_update' }));
    expect(await screen.findByText('com_ui_admin_draft_update_load_error')).toBeInTheDocument();
  });
});
