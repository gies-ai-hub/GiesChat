import React from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { AdminAgentUsageResponse } from 'librechat-data-provider';
import AgentCards from '../AgentCards';

const mockGetAdminAgentUsage = jest.fn();
const mockGetAgentCategories = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminAgentUsage: (params?: unknown) => mockGetAdminAgentUsage(params),
      getAgentCategories: () => mockGetAgentCategories(),
    },
  };
});

const usage: AdminAgentUsageResponse = {
  agents: [
    {
      agent_id: 'agent_1',
      name: 'Case Study Coach',
      description: 'Walks students through Harvard-style cases.',
      avatar: { filepath: '/images/coach.png', source: 'local' },
      category: 'course',
      course: 'BADM 350',
      conversationCount: 42,
      userCount: 18,
      messageCount: 310,
      lastActivity: '2026-07-30T10:00:00.000Z',
      canDelete: true,
      embed: null,
    },
    {
      agent_id: 'agent_2',
      name: 'Bare Agent',
      description: null,
      avatar: null,
      category: null,
      course: null,
      conversationCount: 0,
      userCount: 0,
      messageCount: 0,
      lastActivity: null,
      canDelete: false,
      embed: null,
    },
  ],
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderCards(props: Partial<React.ComponentProps<typeof AgentCards>> = {}) {
  const onSelectAgent = jest.fn();
  render(
    <QueryClientProvider client={newClient()}>
      <AgentCards
        groupId=""
        days={30}
        selectedAgentId={null}
        onSelectAgent={onSelectAgent}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSelectAgent };
}

describe('AgentCards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAdminAgentUsage.mockResolvedValue(usage);
    mockGetAgentCategories.mockResolvedValue([{ value: 'course', label: 'Course' }]);
  });

  it('renders one card per agent with name, description, and stats', async () => {
    renderCards();

    expect(await screen.findByText('Case Study Coach')).toBeInTheDocument();
    expect(screen.getByText('Walks students through Harvard-style cases.')).toBeInTheDocument();
    expect(screen.getByText('BADM 350 · 42 convos · 18 students')).toBeInTheDocument();
    expect(screen.getByText('Bare Agent')).toBeInTheDocument();
  });

  it('omits the course from the stats line when the agent has none', async () => {
    renderCards();

    await screen.findByText('Bare Agent');
    expect(screen.getByText('0 convos · 0 students')).toBeInTheDocument();
  });

  it('renders an agent with no avatar, description, or category without crashing', async () => {
    renderCards();

    const bare = await screen.findByRole('button', { name: /Bare Agent/ });
    expect(bare).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText('Course')).toHaveLength(1);
  });

  it('calls onSelectAgent with the clicked agent', async () => {
    const { onSelectAgent } = renderCards();

    const card = await screen.findByRole('button', { name: /Case Study Coach/ });
    await userEvent.click(card);

    expect(onSelectAgent).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent_1' }));
  });

  it('marks only the selected card with aria-current', async () => {
    renderCards({ selectedAgentId: 'agent_2' });

    const selected = await screen.findByRole('button', { name: /Bare Agent/ });
    const other = screen.getByRole('button', { name: /Case Study Coach/ });

    expect(selected).toHaveAttribute('aria-current', 'true');
    expect(other).not.toHaveAttribute('aria-current');
  });

  it('renders nothing while loading and when the list is empty', async () => {
    mockGetAdminAgentUsage.mockResolvedValue({ agents: [] });
    const { container } = render(
      <QueryClientProvider client={newClient()}>
        <AgentCards groupId="" days={30} selectedAgentId={null} onSelectAgent={jest.fn()} />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(mockGetAdminAgentUsage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
