import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { SystemCapabilities, hasImpliedCapability } from '@librechat/data-schemas/capabilities';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type {
  AdminUsageParams,
  AdminGroupListParams,
  AdminTopicsResponse,
  AdminAnalyticsResponse,
  AdminAgentUsageResponse,
  AdminGroupListResponse,
  AdminDashboardLayoutResponse,
  AdminAgentStudentUsageResponse,
  AdminEffectiveCapabilitiesResponse,
} from 'librechat-data-provider';
import { getResponseStatus } from '~/utils/errors';

const adminQueryConfig = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
} as const;

/**
 * Exactly what the dashboard route is gated on server-side: usage aggregation plus
 * the class rosters it reads. Holding `access:admin` alone is not enough — a helpdesk
 * admin must not be shown a nav link to a view that answers 403.
 */
const DASHBOARD_CAPABILITIES: string[] = [
  SystemCapabilities.READ_USAGE,
  SystemCapabilities.READ_GROUPS,
];

/**
 * Capabilities held by the caller. The endpoint is gated by `access:admin`, so a
 * 403 is the canonical "this user is not a professor" answer and must not be retried.
 */
export const useAdminEffectiveCapabilitiesQuery = (
  config?: UseQueryOptions<AdminEffectiveCapabilitiesResponse>,
): QueryObserverResult<AdminEffectiveCapabilitiesResponse> =>
  useQuery<AdminEffectiveCapabilitiesResponse>(
    [QueryKeys.adminEffectiveCapabilities],
    () => dataService.getAdminEffectiveCapabilities(),
    {
      ...adminQueryConfig,
      retry: false,
      ...config,
    },
  );

/**
 * Resolves whether the current user may open the professor dashboard. `isDenied` is
 * only true once the server has actually answered with a 403 — never while loading,
 * so callers do not flash a forbidden state at users who do have access.
 *
 * `enabled` lets a caller that already knows the user cannot hold the capabilities
 * skip the request entirely; a disabled hook reports neither loading nor denied.
 */
export const useAdminAccess = (
  enabled = true,
): {
  hasAdminAccess: boolean;
  isLoading: boolean;
  isDenied: boolean;
  error: unknown;
} => {
  const { data, isLoading, error } = useAdminEffectiveCapabilitiesQuery({ enabled });
  const status = getResponseStatus(error);

  return useMemo(
    () => ({
      hasAdminAccess:
        enabled &&
        data != null &&
        DASHBOARD_CAPABILITIES.every((capability) =>
          hasImpliedCapability(data.capabilities, capability),
        ),
      isLoading: enabled && isLoading,
      isDenied: enabled && (status === 403 || status === 401),
      error: error != null && status !== 403 && status !== 401 ? error : null,
    }),
    [enabled, data, isLoading, error, status],
  );
};

export const useAdminGroupsQuery = (
  params?: AdminGroupListParams,
  config?: UseQueryOptions<AdminGroupListResponse>,
): QueryObserverResult<AdminGroupListResponse> =>
  useQuery<AdminGroupListResponse>(
    [QueryKeys.adminGroups, params?.search ?? '', params?.limit ?? 0, params?.offset ?? 0],
    () => dataService.getAdminGroups(params),
    { ...adminQueryConfig, retry: false, ...config },
  );

export const useAdminAgentUsageQuery = (
  params?: AdminUsageParams,
  config?: UseQueryOptions<AdminAgentUsageResponse>,
): QueryObserverResult<AdminAgentUsageResponse> =>
  useQuery<AdminAgentUsageResponse>(
    [QueryKeys.adminAgentUsage, params?.groupId ?? '', params?.days ?? 0],
    () => dataService.getAdminAgentUsage(params),
    /**
     * Agents are created in a dialog on this page, so a stale list is the failure the
     * user actually hits. Refetching on focus makes a missed invalidation recoverable
     * without a full page reload.
     */
    { ...adminQueryConfig, refetchOnWindowFocus: true, retry: false, ...config },
  );

export const useAdminAgentAnalyticsQuery = (
  params?: AdminUsageParams,
  config?: UseQueryOptions<AdminAnalyticsResponse>,
): QueryObserverResult<AdminAnalyticsResponse> =>
  useQuery<AdminAnalyticsResponse>(
    [QueryKeys.adminAgentAnalytics, params?.groupId ?? '', params?.days ?? 0],
    () => dataService.getAdminAgentAnalytics(params),
    { ...adminQueryConfig, retry: false, ...config },
  );

/** Its own request: the model call behind it must never delay the numbers. */
export const useAdminAgentTopicsQuery = (
  params?: AdminUsageParams,
  config?: UseQueryOptions<AdminTopicsResponse>,
): QueryObserverResult<AdminTopicsResponse> =>
  useQuery<AdminTopicsResponse>(
    [QueryKeys.adminAgentTopics, params?.groupId ?? '', params?.days ?? 0],
    () => dataService.getAdminAgentTopics(params),
    { ...adminQueryConfig, retry: false, staleTime: 5 * 60 * 1000, ...config },
  );

/**
 * The caller's own panel layout. `retry: false` and a silent failure are deliberate:
 * a display preference must never be able to block the analytics behind it, so the
 * consumer falls back to the default layout when this errors.
 */
export const useAdminDashboardLayoutQuery = (
  config?: UseQueryOptions<AdminDashboardLayoutResponse>,
): QueryObserverResult<AdminDashboardLayoutResponse> =>
  useQuery<AdminDashboardLayoutResponse>(
    [QueryKeys.adminDashboardLayout],
    () => dataService.getAdminDashboardLayout(),
    { ...adminQueryConfig, retry: false, ...config },
  );

export const useAdminAgentStudentUsageQuery = (
  agentId: string | null | undefined,
  params?: AdminUsageParams,
  config?: UseQueryOptions<AdminAgentStudentUsageResponse>,
): QueryObserverResult<AdminAgentStudentUsageResponse> =>
  useQuery<AdminAgentStudentUsageResponse>(
    [QueryKeys.adminAgentStudentUsage, agentId ?? '', params?.groupId ?? '', params?.days ?? 0],
    () => dataService.getAdminAgentStudentUsage(agentId as string, params),
    {
      ...adminQueryConfig,
      retry: false,
      ...config,
      enabled: !!agentId && (config?.enabled ?? true),
    },
  );
