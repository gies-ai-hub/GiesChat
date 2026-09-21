import React from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { AdminAgentUsage, AdminAgentDraftsResponse } from 'librechat-data-provider';
import DraftsPanel from '../DraftsPanel';

const mockGetDrafts = jest.fn();
const mockPostDraft = jest.fn();
const mockOpenDraft = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminAgentDrafts: (id: string) => mockGetDrafts(id),
      postAdminAgentDraft: (agentId: string, draftId: string) => mockPostDraft(agentId, draftId),
      openAdminAgentDraft: (id: string) => mockOpenDraft(id),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: jest.fn() }) };
});

const row = (overrides: Partial<AdminAgentUsage> = {}): AdminAgentUsage => ({
  agent_id: 'agent_prod',
  name: 'Case Coach',
  description: null,
  avatar: null,
  category: null,
  course: 'BADM 350',
  conversationCount: 0,
  userCount: 0,
  messageCount: 0,
  lastActivity: null,
  canDelete: true,
  embed: null,
  version: 7,
  isAuthor: true,
  isCollaborator: false,
  draftCount: 2,
  ...overrides,
});

const drafts: AdminAgentDraftsResponse = {
  agent_id: 'agent_prod',
  version: 7,
  collaborators: [{ id: 'u1', name: 'Priya Natarajan', email: 'p@illinois.edu' }],
  pending: [],
  drafts: [
    {
      draft_id: 'agent_prod_priya',
      owner: { id: 'u1', name: 'Priya Natarajan', email: 'p@illinois.edu' },
      draftBase: 7,
      postedVersion: null,
      updatedAt: '2026-09-20T10:00:00.000Z',
      mine: false,
      embed: { key: 'abc', audience: 'public', greeting: null },
    },
    {
      draft_id: 'agent_prod_marcus',
      owner: { id: 'u2', name: 'Marcus Lee', email: 'm@illinois.edu' },
      draftBase: 5,
      postedVersion: null,
      updatedAt: null,
      mine: false,
      embed: null,
    },
  ],
};

function renderPanel(agent = row(), props: Partial<React.ComponentProps<typeof DraftsPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handlers = {
    onEditDraft: jest.fn(),
    onTestLink: jest.fn(),
    onOpenInChat: jest.fn(),
    onManageCollaborators: jest.fn(),
    ...props,
  };
  render(
    <QueryClientProvider client={client}>
      <DraftsPanel agent={agent} {...handlers} />
    </QueryClientProvider>,
  );
  return handlers;
}

describe('DraftsPanel (author)', () => {
  beforeEach(() => {
    mockGetDrafts.mockResolvedValue(drafts);
    mockPostDraft.mockResolvedValue({ agent_id: 'agent_prod', version: 8 });
  });

  it('lists every draft with owner, base version and a stale flag where production moved on', async () => {
    renderPanel();
    expect(await screen.findByText('Priya Natarajan')).toBeInTheDocument();
    expect(screen.getByText('Marcus Lee')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_draft_based_on {"version":7}')).toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_draft_stale {"version":5}')).toBeInTheDocument();
  });

  it('offers Test link only when the draft has one, and routes the actions', async () => {
    const handlers = renderPanel();
    await screen.findByText('Priya Natarajan');
    const testLinks = screen.getAllByRole('button', { name: /com_ui_admin_draft_test_link/ });
    expect(testLinks).toHaveLength(1);
    await userEvent.click(testLinks[0]);
    expect(handlers.onTestLink).toHaveBeenCalledWith(drafts.drafts[0]);
    await userEvent.click(
      screen.getAllByRole('button', { name: /com_ui_admin_draft_open_in_chat/ })[1],
    );
    expect(handlers.onOpenInChat).toHaveBeenCalledWith('agent_prod_marcus');
    await userEvent.click(screen.getByRole('button', { name: /com_ui_admin_collaborators_count/ }));
    expect(handlers.onManageCollaborators).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agent_prod' }),
      drafts.collaborators,
      drafts.pending,
    );
  });

  it('posts a draft after confirmation', async () => {
    renderPanel();
    await screen.findByText('Priya Natarajan');
    await userEvent.click(screen.getAllByRole('button', { name: /com_ui_admin_draft_post$/ })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('com_ui_admin_draft_post_title');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_admin_draft_post' }));
    await waitFor(() =>
      expect(mockPostDraft).toHaveBeenCalledWith('agent_prod', 'agent_prod_priya'),
    );
  });

  it('shows the empty state when there are no drafts', async () => {
    mockGetDrafts.mockResolvedValue({ ...drafts, drafts: [] });
    renderPanel();
    expect(await screen.findByText('com_ui_admin_drafts_empty')).toBeInTheDocument();
  });

  it('lets a collaborator start a draft', async () => {
    mockGetDrafts.mockResolvedValue({ ...drafts, collaborators: [], drafts: [] });
    mockOpenDraft.mockResolvedValue({ draft_id: 'agent_prod_me', created: true });
    const handlers = renderPanel(row({ isAuthor: false, isCollaborator: true, draftCount: 0 }));
    await userEvent.click(await screen.findByRole('button', { name: 'com_ui_admin_start_draft' }));
    await waitFor(() => expect(handlers.onEditDraft).toHaveBeenCalledWith('agent_prod_me'));
    expect(screen.queryByRole('button', { name: /com_ui_admin_collaborators_count/ })).toBeNull();
  });
});
