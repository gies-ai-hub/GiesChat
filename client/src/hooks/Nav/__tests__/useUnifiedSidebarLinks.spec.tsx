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

/** The Agent dashboard is open to every signed-in user, so the link needs no capability check. */
describe('useUnifiedSidebarLinks — Agent dashboard link', () => {
  beforeEach(() => {
    mockGetAdminEffectiveCapabilities.mockReset();
  });

  it('shows the dashboard link to a signed-in user with no capabilities', async () => {
    mockUser.mockReturnValue({ id: 'u1', role: SystemRoles.USER });

    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() =>
      expect(result.current.some((link) => link.id === 'admin-dashboard')).toBe(true),
    );
    expect(mockGetAdminEffectiveCapabilities).not.toHaveBeenCalled();
  });

  it('hides the dashboard link before the user is known', async () => {
    mockUser.mockReturnValue(undefined);

    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.some((link) => link.id === 'admin-dashboard')).toBe(false);
  });
});
