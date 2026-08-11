import React from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type {
  AdminAgentUsageResponse,
  AdminGroupListResponse,
  AdminAnalyticsResponse,
  AdminAgentStudentUsageResponse,
} from 'librechat-data-provider';
import AdminDashboard from '../Dashboard';

const mockGetAdminEffectiveCapabilities = jest.fn();
const mockGetAdminGroups = jest.fn();
const mockGetAdminAgentUsage = jest.fn();
const mockGetAdminAgentStudentUsage = jest.fn();
const mockGetAdminAgentAnalytics = jest.fn();
const mockGetAgentById = jest.fn();
const mockDeleteAgent = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminEffectiveCapabilities: () => mockGetAdminEffectiveCapabilities(),
      getAdminGroups: () => mockGetAdminGroups(),
      getAdminAgentUsage: (params?: unknown) => mockGetAdminAgentUsage(params),
      getAdminAgentStudentUsage: () => mockGetAdminAgentStudentUsage(),
      getAdminAgentAnalytics: (params?: unknown) => mockGetAdminAgentAnalytics(params),
      getAgentCategories: () => Promise.resolve([{ value: 'course', label: 'Course' }]),
      getAgentById: () => mockGetAgentById(),
      deleteAgent: (body: unknown) => mockDeleteAgent(body),
    },
  };
});

jest.mock('~/components/Sharing/GenericGrantAccessDialog', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

/**
 * The real builder pulls in the whole agent-panel provider tree; only its presence
 * matters here. The button stands in for a successful create so the `onAgentCreated`
 * wiring can be exercised without the real mutation.
 */
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => ({
  __esModule: true,
  default: ({
    onAgentCreated,
    createdVia,
    initialAgentId,
    hideAgentSelect,
  }: {
    onAgentCreated?: (agentId: string) => void;
    createdVia?: string;
    initialAgentId?: string;
    hideAgentSelect?: boolean;
  }) => (
    <div
      data-testid="agent-panel-switch"
      data-created-via={createdVia}
      data-initial-agent-id={initialAgentId}
      data-hide-agent-select={String(hideAgentSelect === true)}
    >
      <button
        type="button"
        data-testid="simulate-create"
        onClick={() => onAgentCreated?.('agent_new')}
      />
    </div>
  ),
}));

/** Mocked at the leaf, not the `~/hooks` barrel — mocking the barrel deadlocks its circular requires. */
const mockUseHasAccess = jest.fn();
jest.mock('~/hooks/Roles/useHasAccess', () => ({
  __esModule: true,
  default: () => mockUseHasAccess(),
}));

const forbidden = () =>
  Promise.reject({ isAxiosError: true, response: { status: 403 }, message: 'Forbidden' });

const serverError = () =>
  Promise.reject({ isAxiosError: true, response: { status: 500 }, message: 'Server error' });

/** What a professor actually holds: the dashboard reads usage AND class rosters. */
const professorCapabilities = ['access:admin', 'read:usage', 'read:groups'];

const groups: AdminGroupListResponse = {
  groups: [{ _id: 'group-1', name: 'BADM 350' }],
  total: 1,
  limit: 200,
  offset: 0,
};

const agentUsage: AdminAgentUsageResponse = {
  agents: [
    {
      agent_id: 'agent_1',
      name: 'Case Study Coach',
      description: 'Walks students through Harvard-style cases.',
      avatar: null,
      category: 'course',
      course: 'BADM 350',
      conversationCount: 12,
      userCount: 4,
      messageCount: 96,
      lastActivity: '2026-07-20T10:00:00.000Z',
      canDelete: true,
    },
  ],
};

const studentUsage: AdminAgentStudentUsageResponse = {
  agent_id: 'agent_1',
  students: [
    {
      userId: 'user-1',
      name: 'Active Student',
      email: 'active@illinois.edu',
      conversationCount: 3,
      messageCount: 21,
      lastActivity: '2026-07-20T10:00:00.000Z',
    },
    {
      userId: 'user-2',
      name: 'Quiet Student',
      email: 'quiet@illinois.edu',
      conversationCount: 0,
      messageCount: 0,
      lastActivity: null,
    },
  ],
};

const analytics: AdminAnalyticsResponse = {
  activeStudents: 4,
  enrolledStudents: 9,
  conversationCount: 12,
  medianTurns: 3,
  returnRate: 0.5,
  dailyActivity: [{ date: '2026-07-20', conversationCount: 12 }],
  reachBuckets: [
    { label: '1', count: 2 },
    { label: '2–4', count: 2 },
    { label: '5–9', count: 0 },
    { label: '10+', count: 0 },
  ],
  depthBuckets: [
    { label: '1', count: 3 },
    { label: '2', count: 4 },
    { label: '3', count: 3 },
    { label: '4–5', count: 2 },
    { label: '6–9', count: 0 },
    { label: '10+', count: 0 },
  ],
  oneTurnShare: 0.25,
  errorRate: 0,
};

const emptyAnalytics: AdminAnalyticsResponse = {
  activeStudents: 0,
  enrolledStudents: 0,
  conversationCount: 0,
  medianTurns: 0,
  returnRate: 0,
  dailyActivity: [],
  reachBuckets: [],
  depthBuckets: [],
  oneTurnShare: 0,
  errorRate: 0,
};

const renderDashboard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AdminDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseHasAccess.mockReturnValue(true);
    mockGetAdminEffectiveCapabilities.mockResolvedValue({ capabilities: professorCapabilities });
    mockGetAdminGroups.mockResolvedValue(groups);
    mockGetAdminAgentUsage.mockResolvedValue(agentUsage);
    mockGetAdminAgentStudentUsage.mockResolvedValue(studentUsage);
    mockGetAdminAgentAnalytics.mockResolvedValue(analytics);
    mockGetAgentById.mockResolvedValue({ _id: 'db-id-1', id: 'agent_1', name: 'Case Study Coach' });
    mockDeleteAgent.mockResolvedValue(undefined);
  });

  it('opens the agent builder inline without leaving the dashboard', async () => {
    renderDashboard();
    const build = await screen.findByRole('button', { name: /build an agent/i });
    await userEvent.click(build);
    /**
     * Asserts the builder actually renders, not merely that a handler fired. The first
     * implementation navigated to /c/new and preselected the agent-builder side panel,
     * which the unified sidebar filters out — so the click silently did nothing.
     */
    expect(await screen.findByTestId('agent-panel-switch')).toBeInTheDocument();
    /** The modal aria-hides the page behind it, so "never left" is proved on close. */
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: /class dashboard/i })).toBeInTheDocument();
  });

  /**
   * The builder never closes itself, so before this the new agent sat behind an open
   * dialog and the list never refreshed — the usage query opts out of refetch-on-mount,
   * making a full page reload the only recovery.
   */
  /**
   * The usage endpoint lists only agents carrying this stamp, so a builder opened here
   * that failed to pass it would create agents invisible to the dashboard that made them.
   */
  it('stamps agents built here so the usage endpoint will list them', async () => {
    renderDashboard();

    await userEvent.click(await screen.findByRole('button', { name: /build an agent/i }));

    expect(await screen.findByTestId('agent-panel-switch')).toHaveAttribute(
      'data-created-via',
      'dashboard',
    );
  });

  it('closes the builder and refetches usage when an agent is created', async () => {
    renderDashboard();

    await userEvent.click(await screen.findByRole('button', { name: /build an agent/i }));
    await screen.findByTestId('agent-panel-switch');
    const callsBefore = mockGetAdminAgentUsage.mock.calls.length;

    await userEvent.click(screen.getByTestId('simulate-create'));

    await waitFor(() => expect(screen.queryByTestId('agent-panel-switch')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(mockGetAdminAgentUsage.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('refetches usage when the builder closes so a new agent shows up', async () => {
    renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: /build an agent/i }));
    await screen.findByTestId('agent-panel-switch');
    const callsBefore = mockGetAdminAgentUsage.mock.calls.length;
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(mockGetAdminAgentUsage.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('hides the build button from a professor without create permission', async () => {
    mockUseHasAccess.mockReturnValue(false);
    renderDashboard();
    await screen.findByRole('heading', { name: 'Your agents' });
    expect(screen.queryByRole('button', { name: /build an agent/i })).not.toBeInTheDocument();
  });

  it('shows a loading state while the capability check is in flight', () => {
    mockGetAdminEffectiveCapabilities.mockReturnValue(new Promise(() => undefined));
    renderDashboard();

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the forbidden message when the user lacks the admin capability', async () => {
    mockGetAdminEffectiveCapabilities.mockImplementation(forbidden);
    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to the class dashboard",
    );
    expect(mockGetAdminAgentUsage).not.toHaveBeenCalled();
  });

  /**
   * `access:admin` only means the capabilities endpoint answered. The nav link and this
   * view are both driven by `useAdminAccess`, so a helpdesk admin who lacks the
   * dashboard's own capabilities must be turned away here rather than at a 403.
   */
  it.each<[string, string[]]>([
    ['access:admin alone', ['access:admin']],
    ['read:users but not read:usage', ['access:admin', 'read:users']],
    ['read:usage but not read:groups', ['access:admin', 'read:usage']],
    ['read:groups but not read:usage', ['access:admin', 'read:groups']],
    ['no capabilities at all', []],
  ])('denies a user holding %s', async (_label, capabilities) => {
    mockGetAdminEffectiveCapabilities.mockResolvedValue({ capabilities });
    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have access to the class dashboard",
    );
    expect(mockGetAdminAgentUsage).not.toHaveBeenCalled();
    expect(mockGetAdminGroups).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('admits a professor granted manage:groups, which implies read:groups', async () => {
    mockGetAdminEffectiveCapabilities.mockResolvedValue({
      capabilities: ['access:admin', 'read:usage', 'manage:groups'],
    });
    renderDashboard();

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('warns that the class list is truncated when the server reports more', async () => {
    mockGetAdminGroups.mockResolvedValue({ ...groups, total: 412 });
    renderDashboard();

    expect(await screen.findByText(/Showing the first 1 of 412 classes/)).toBeInTheDocument();
  });

  it('shows no truncation warning when every class is listed', async () => {
    renderDashboard();
    await screen.findByRole('table');

    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it('renders agent usage once the data resolves', async () => {
    renderDashboard();

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /View student progress for Case Study Coach/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '96' })).toBeInTheDocument();
  });

  /**
   * DELETE is a separate permission bit from the EDIT that puts an agent in the dashboard's
   * scope, so the server reports `canDelete` per row. Rendering the control off anything else
   * hands the professor a button that comes back 403.
   */
  it('deletes an agent only after the confirm step, then refetches usage', async () => {
    renderDashboard();
    await userEvent.click(await screen.findByRole('button', { name: /Delete Case Study Coach/ }));
    expect(mockDeleteAgent).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(mockDeleteAgent).toHaveBeenCalledWith({ agent_id: 'agent_1' }));
    await waitFor(() => expect(mockGetAdminAgentUsage.mock.calls.length).toBeGreaterThan(1));
  });

  it('hides the delete control for an agent the caller cannot delete', async () => {
    mockGetAdminAgentUsage.mockResolvedValue({
      agents: [{ ...agentUsage.agents[0], canDelete: false }],
    });
    renderDashboard();

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Delete Case Study Coach/ }),
    ).not.toBeInTheDocument();
  });

  it('renders an empty state when the professor has no agents', async () => {
    mockGetAdminAgentUsage.mockResolvedValue({ agents: [] });
    renderDashboard();

    expect(await screen.findByText(/No agents yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an error state with a retry when agent usage fails', async () => {
    mockGetAdminAgentUsage.mockImplementation(serverError);
    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load agent activity.");

    mockGetAdminAgentUsage.mockResolvedValue(agentUsage);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('defaults to an unfiltered 30-day window and filters usage by the selected class', async () => {
    renderDashboard();
    await screen.findByRole('table');

    expect(mockGetAdminAgentUsage).toHaveBeenCalledWith({ days: 30 });
    expect(screen.getAllByText('All classes').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId('admin-class-select'));
    await userEvent.click(await screen.findByRole('option', { name: 'BADM 350' }));

    await waitFor(() =>
      expect(mockGetAdminAgentUsage).toHaveBeenCalledWith({ days: 30, groupId: 'group-1' }),
    );
  });

  it('drills into student progress and flags students with no activity', async () => {
    renderDashboard();

    await userEvent.click(
      await screen.findByRole('button', { name: /View student progress for Case Study Coach/ }),
    );

    expect(await screen.findByText(/Student progress/)).toBeInTheDocument();
    expect(
      screen.getByText('1 of 2 students have no activity in this window.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No activity')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'quiet@illinois.edu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share with class' })).toBeInTheDocument();
  });

  it('sorts the student table when a column header is activated', async () => {
    renderDashboard();

    await userEvent.click(
      await screen.findByRole('button', { name: /View student progress for Case Study Coach/ }),
    );
    await screen.findByText(/Student progress/);

    const messagesHeader = () => screen.getByRole('columnheader', { name: /Messages/ });
    expect(messagesHeader()).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(screen.getByRole('button', { name: /Messages/ }));

    await waitFor(() => expect(messagesHeader()).toHaveAttribute('aria-sort', 'descending'));
    const rowNames = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '');
    expect(rowNames[0]).toContain('Active Student');

    await userEvent.click(screen.getByRole('button', { name: /Messages/ }));
    await waitFor(() => expect(messagesHeader()).toHaveAttribute('aria-sort', 'ascending'));
    expect(screen.getAllByRole('row')[1].textContent ?? '').toContain('Quiet Student');
  });
  describe('analytics section', () => {
    it('renders the analytics panels above the agents table', async () => {
      renderDashboard();

      expect(await screen.findByText('How the class is using your agents')).toBeInTheDocument();
      expect(await screen.findByText('Students who used an agent')).toBeInTheDocument();
      expect(await screen.findByText('Conversation depth')).toBeInTheDocument();
    });

    it('shows the empty state when the window holds no activity', async () => {
      mockGetAdminAgentAnalytics.mockResolvedValue(emptyAnalytics);

      renderDashboard();

      expect(await screen.findByText('No agent activity in this window yet.')).toBeInTheDocument();
    });

    it('hides the analytics section on the per-student drill-down', async () => {
      renderDashboard();

      const agentLink = await screen.findByRole('button', {
        name: 'View student progress for Case Study Coach',
      });
      await userEvent.click(agentLink);

      await waitFor(() =>
        expect(screen.queryByText('How the class is using your agents')).not.toBeInTheDocument(),
      );
    });

    it('scales the conversation bar to the busiest agent in view', async () => {
      mockGetAdminAgentUsage.mockResolvedValue({
        agents: [
          { ...agentUsage.agents[0], agent_id: 'agent_1', conversationCount: 12 },
          {
            ...agentUsage.agents[0],
            agent_id: 'agent_2',
            name: 'Quiet Agent',
            conversationCount: 3,
          },
        ],
      });

      const { container } = renderDashboard();
      await screen.findByText('Quiet Agent');

      const bars = container.querySelectorAll('[data-usage-bar]');
      expect(bars).toHaveLength(2);
      expect((bars[0] as HTMLElement).style.width).toBe('100%');
      expect((bars[1] as HTMLElement).style.width).toBe('25%');
    });
  });

  /**
   * `Root` wraps every route in a fixed-height `overflow-hidden` shell, so a page with
   * no scroll container of its own has everything below the fold clipped outright —
   * the dashboard was only readable by zooming the browser out.
   */
  it('owns a vertical scroll container', async () => {
    renderDashboard();

    const scroller = await screen.findByTestId('admin-scroll');
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('h-full');
  });

  describe('agent card strip', () => {
    it('renders a card alongside the usage table', async () => {
      renderDashboard();

      expect(await screen.findByRole('list', { name: 'Agents you manage' })).toBeInTheDocument();
      expect(screen.getByText('Walks students through Harvard-style cases.')).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('drills into student progress when a card is clicked', async () => {
      renderDashboard();

      const list = await screen.findByRole('list', { name: 'Agents you manage' });
      const card = within(list).getByRole('button', { name: /Case Study Coach/ });
      await userEvent.click(card);

      expect(await screen.findByRole('heading', { name: /Case Study Coach/ })).toBeInTheDocument();
      expect(card).toHaveAttribute('aria-current', 'true');
    });

    it('shows the course in the usage table, and a dash when an agent has none', async () => {
      mockGetAdminAgentUsage.mockResolvedValue({
        agents: [
          agentUsage.agents[0],
          { ...agentUsage.agents[0], agent_id: 'agent_2', name: 'No Course Agent', course: null },
        ],
      });
      renderDashboard();

      const table = await screen.findByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Course' })).toBeInTheDocument();
      expect(within(table).getByText('BADM 350')).toBeInTheDocument();

      const row = within(table).getByText('No Course Agent').closest('tr') as HTMLElement;
      expect(within(row).getByText('None')).toBeInTheDocument();
    });

    it('keeps the strip visible during the drill-down', async () => {
      renderDashboard();

      const list = await screen.findByRole('list', { name: 'Agents you manage' });
      await userEvent.click(within(list).getByRole('button', { name: /Case Study Coach/ }));

      await waitFor(() => expect(mockGetAdminAgentStudentUsage).toHaveBeenCalled());
      expect(screen.getByRole('list', { name: 'Agents you manage' })).toBeInTheDocument();
    });
  });

  describe('editing an agent', () => {
    it('opens the builder on the agent whose pencil was clicked', async () => {
      renderDashboard();

      await userEvent.click(await screen.findByRole('button', { name: 'Edit Case Study Coach' }));

      const panel = await screen.findByTestId('agent-panel-switch');
      expect(panel).toHaveAttribute('data-initial-agent-id', 'agent_1');
      expect(panel).toHaveAttribute('data-hide-agent-select', 'true');
      expect(await screen.findByText('Edit agent · Case Study Coach')).toBeInTheDocument();
    });

    /**
     * The create path deliberately navigates to a new chat on success. An edit must not:
     * the professor is mid-review and would lose the class and window filters they set.
     */
    it('stays on the dashboard while editing', async () => {
      renderDashboard();

      await userEvent.click(await screen.findByRole('button', { name: 'Edit Case Study Coach' }));
      await screen.findByTestId('agent-panel-switch');
      await userEvent.keyboard('{Escape}');

      expect(await screen.findByRole('heading', { name: /class dashboard/i })).toBeInTheDocument();
    });

    it('refetches usage when the edit dialog closes so a rename shows up', async () => {
      renderDashboard();

      await userEvent.click(await screen.findByRole('button', { name: 'Edit Case Study Coach' }));
      await screen.findByTestId('agent-panel-switch');
      const callsBefore = mockGetAdminAgentUsage.mock.calls.length;

      await userEvent.keyboard('{Escape}');

      await waitFor(() =>
        expect(mockGetAdminAgentUsage.mock.calls.length).toBeGreaterThan(callsBefore),
      );
    });

    /**
     * Editing is authorised by the EDIT scope the server already applied to this list.
     * A professor who may not create agents may still revise the ones they own.
     */
    it('offers the pencil to a professor without create permission', async () => {
      mockUseHasAccess.mockReturnValue(false);
      renderDashboard();

      expect(
        await screen.findByRole('button', { name: 'Edit Case Study Coach' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /build an agent/i })).not.toBeInTheDocument();
    });

    it('offers the pencil even when the agent cannot be deleted', async () => {
      mockGetAdminAgentUsage.mockResolvedValue({
        agents: [{ ...agentUsage.agents[0], canDelete: false }],
      });
      renderDashboard();

      expect(
        await screen.findByRole('button', { name: 'Edit Case Study Coach' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Delete Case Study Coach/ }),
      ).not.toBeInTheDocument();
    });
  });
});
