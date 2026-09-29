import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import AgentDetailContent from '../AgentDetailContent';

jest.mock('librechat-data-provider', () => ({
  QueryKeys: {
    agents: 'agents',
    messages: 'messages',
  },
  Constants: {
    NEW_CONVO: 'new',
  },
  EModelEndpoint: {
    agents: 'agents',
  },
  PermissionBits: {
    EDIT: 2,
  },
  LocalStorageKeys: {
    AGENT_ID_PREFIX: 'agent:',
  },
}));

const mockMutate = jest.fn();

jest.mock(
  '@librechat/client',
  () => ({
    OGDialogContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-content">{children}</div>
    ),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
    OGDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    OGDialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    OGDialogTemplate: ({
      main,
      selection,
    }: {
      main: React.ReactNode;
      selection: { selectHandler: () => void; selectText: string };
    }) => (
      <div>
        {main}
        <button onClick={selection.selectHandler}>{selection.selectText}</button>
      </div>
    ),
    TrashIcon: () => <span data-testid="trash-icon" />,
    TooltipAnchor: ({ render }: { render: React.ReactNode }) => <>{render}</>,
    useToastContext: () => ({
      showToast: jest.fn(),
    }),
  }),
  { virtual: true },
);

jest.mock('~/data-provider', () => ({
  useDeleteAgentMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useDefaultConvo: () => jest.fn((value) => value.conversation),
  useFavorites: () => ({
    isFavoriteAgent: jest.fn(() => false),
    toggleFavoriteAgent: jest.fn(),
  }),
  useLocalize: () => (key: string, values?: Record<string, string>) => {
    const translations: Record<string, string> = {
      com_agents_contact: 'Contact',
      com_agents_no_contact_available: 'No contact available',
      com_agents_loading: 'Loading',
      com_agents_link_copied: 'Link copied',
      com_agents_link_copy_failed: 'Link copy failed',
      com_agents_start_chat: 'Start chat',
      com_agents_chat_with: `Chat with ${values?.name ?? ''}`,
      com_ui_agent: 'Agent',
      com_ui_pin: 'Pin',
      com_ui_unpin: 'Unpin',
      com_agents_copy_link: 'Copy link',
      com_ui_delete: 'Delete',
      com_ui_delete_agent: 'Delete Agent',
      com_ui_delete_agent_named: `Delete ${values?.name ?? ''}`,
      com_ui_delete_agent_named_confirm: `Delete "${values?.name ?? ''}"? This cannot be undone.`,
    };
    return translations[key] || key;
  },
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    conversation: undefined,
    newConversation: jest.fn(),
  }),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  clearMessagesCache: jest.fn(),
  renderAgentAvatar: () => <div data-testid="agent-avatar" />,
}));

const renderWithClient = (children: React.ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
};

const baseAgent = {
  id: 'agent-1',
  name: 'Agent One',
  description: 'Agent description',
  provider: 'openai',
  model: 'gpt-4',
  model_parameters: {},
};

describe('AgentDetailContent', () => {
  it('renders support contact with mailto link', () => {
    renderWithClient(
      <AgentDetailContent
        agent={
          {
            ...baseAgent,
            support_contact: { name: 'Support Team', email: 'support@example.com' },
            owner_contact: { name: 'Owner User', email: 'owner@example.com' },
          } as any
        }
      />,
    );

    expect(screen.getByText('Contact:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Support Team' })).toHaveAttribute(
      'href',
      'mailto:support@example.com',
    );
    expect(screen.queryByText('Owner User')).not.toBeInTheDocument();
  });

  it('falls back to owner contact when support contact is missing', () => {
    renderWithClient(
      <AgentDetailContent
        agent={
          {
            ...baseAgent,
            owner_contact: { name: 'Owner User', email: 'owner@example.com' },
          } as any
        }
      />,
    );

    expect(screen.getByRole('link', { name: 'Owner User' })).toHaveAttribute(
      'href',
      'mailto:owner@example.com',
    );
  });

  it('hides the delete control unless the caller opts in', () => {
    renderWithClient(<AgentDetailContent agent={baseAgent as any} />);

    expect(screen.queryByRole('button', { name: 'Delete Agent One' })).not.toBeInTheDocument();
  });

  it('deletes the agent only after the confirm step', () => {
    mockMutate.mockClear();
    renderWithClient(<AgentDetailContent agent={baseAgent as any} canDelete />);

    expect(screen.getByRole('button', { name: 'Delete Agent One' })).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Delete "Agent One"? This cannot be undone.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mockMutate).toHaveBeenCalledWith({ agent_id: 'agent-1' });
  });
});
