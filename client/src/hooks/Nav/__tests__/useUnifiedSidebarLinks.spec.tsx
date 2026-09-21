import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import type { TUser } from 'librechat-data-provider';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

const mockGetAdminEffectiveCapabilities = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAdminEffectiveCapabilities: () => mockGetAdminEffectiveCapabilities(),
    },
  };
});

jest.mock('librechat-data-provider/react-query', () => ({
  ...jest.requireActual('librechat-data-provider/react-query'),
  useUserKeyQuery: () => ({ data: { expiresAt: undefined } }),
}));

const mockUser = jest.fn<Partial<TUser> | undefined, []>();

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser() }),
  useShowMarketplace: () => false,
}));

jest.mock('~/hooks/Nav/useSideNavLinks', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('~/components/Brainstorm/BrainstormPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => null,
}));

/** `useAdminAccess` stays real — the gate under test is the request it does or does not fire. */
jest.mock('~/data-provider', () => ({
  useAdminAccess: jest.requireActual('~/data-provider/Admin/queries').useAdminAccess,
  useGetStartupConfig: () => ({ data: undefined }),
  useGetEndpointsQuery: () => ({ data: {} }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RecoilRoot>
  );
}

/**
 * Dashboard access is granted per user with the role left at USER, so the role a
 * client holds cannot predict the answer — the sidebar has to ask the server for
 * every signed-in user, and the self-scoped endpoint answers with an empty list.
 */
describe('useUnifiedSidebarLinks — admin capability gate', () => {
  beforeEach(() => {
    mockGetAdminEffectiveCapabilities.mockReset();
    mockGetAdminEffectiveCapabilities.mockResolvedValue({
      capabilities: ['access:admin', 'read:usage', 'read:groups'],
    });
  });

  it('shows the dashboard link for a default-role user holding the grants', async () => {
    mockUser.mockReturnValue({ id: 'u1', role: SystemRoles.USER });

    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() => expect(mockGetAdminEffectiveCapabilities).toHaveBeenCalled());
    await waitFor(() =>
      expect(result.current.some((link) => link.id === 'admin-dashboard')).toBe(true),
    );
  });

  it('hides the dashboard link when the user holds no capabilities', async () => {
    mockUser.mockReturnValue({ id: 'u1', role: SystemRoles.USER });
    mockGetAdminEffectiveCapabilities.mockResolvedValue({ capabilities: [] });

    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.some((link) => link.id === 'admin-dashboard')).toBe(false);
  });

  it('does not ask before the user is known', async () => {
    mockUser.mockReturnValue(undefined);

    renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() => expect(mockGetAdminEffectiveCapabilities).not.toHaveBeenCalled());
  });

  it('still asks, and shows the dashboard link, for an admin', async () => {
    mockUser.mockReturnValue({ id: 'u2', role: SystemRoles.ADMIN });

    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() => expect(mockGetAdminEffectiveCapabilities).toHaveBeenCalled());
    await waitFor(() =>
      expect(result.current.some((link) => link.id === 'admin-dashboard')).toBe(true),
    );
  });
});
