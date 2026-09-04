import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  AgentEmbedSettings,
  AdminDashboardPanel,
  AdminAgentEmbedResponse,
  AdminDashboardLayoutResponse,
} from 'librechat-data-provider';

/**
 * Saves the caller's panel layout. On failure the layout query is invalidated so the
 * UI snaps back to what is actually stored rather than showing a layout that was
 * never saved.
 */
export const useUpdateAdminDashboardLayoutMutation = (): UseMutationResult<
  AdminDashboardLayoutResponse,
  unknown,
  AdminDashboardPanel[]
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (panels: AdminDashboardPanel[]) => dataService.updateAdminDashboardLayout(panels),
    {
      mutationKey: [MutationKeys.updateAdminDashboardLayout],
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.adminDashboardLayout], data);
      },
      onError: () => {
        queryClient.invalidateQueries([QueryKeys.adminDashboardLayout]);
      },
    },
  );
};

/** Both embed mutations refresh the usage list, which is where the row's embed state lives. */
export const useUpdateAdminAgentEmbedMutation = (): UseMutationResult<
  AdminAgentEmbedResponse,
  unknown,
  { agentId: string; settings: AgentEmbedSettings }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ agentId, settings }) => dataService.updateAdminAgentEmbed(agentId, settings),
    {
      mutationKey: [MutationKeys.updateAdminAgentEmbed],
      onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminAgentUsage]),
    },
  );
};

export const useRevokeAdminAgentEmbedMutation = (): UseMutationResult<
  AdminAgentEmbedResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((agentId: string) => dataService.revokeAdminAgentEmbed(agentId), {
    mutationKey: [MutationKeys.updateAdminAgentEmbed],
    onSuccess: () => queryClient.invalidateQueries([QueryKeys.adminAgentUsage]),
  });
};
