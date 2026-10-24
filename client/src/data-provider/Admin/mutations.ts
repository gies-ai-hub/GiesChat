import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService, DynamicQueryKeys } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  AdminAgentPeople,
  AgentEmbedSettings,
  AdminApiKeyCreateParams,
  AdminApiKeyCreateResponse,
  AdminDashboardPanel,
  AdminModelTestRequest,
  AdminOpenDraftResponse,
  AdminPostDraftResponse,
  AdminModelTestResponse,
  AdminAgentEmbedResponse,
  AdminCollaboratorsResponse,
  AdminDashboardLayoutResponse,
  AdminWebsiteSaveResponse,
  AdminWebsitePreviewResponse,
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
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
        queryClient.invalidateQueries([QueryKeys.adminAgentDrafts]);
      },
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
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
      queryClient.invalidateQueries([QueryKeys.adminAgentDrafts]);
    },
  });
};

/** The full key is only in this response; the list query never sees it. */
export const useCreateAdminApiKeyMutation = (): UseMutationResult<
  AdminApiKeyCreateResponse,
  unknown,
  AdminApiKeyCreateParams & { agentId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ agentId, ...params }) => dataService.createAdminAgentApiKey(agentId, params),
    {
      mutationKey: [MutationKeys.createAdminApiKey],
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminApiKeys]);
      },
    },
  );
};

export const useRevokeAdminApiKeyMutation = (): UseMutationResult<
  { deleted: boolean },
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((keyId: string) => dataService.revokeAdminApiKey(keyId), {
    mutationKey: [MutationKeys.revokeAdminApiKey],
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminApiKeys]);
    },
  });
};

export const useUpdateAdminAgentCollaboratorsMutation = (): UseMutationResult<
  AdminCollaboratorsResponse,
  unknown,
  AdminAgentPeople & { agentId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ agentId, ...people }) => dataService.updateAdminAgentCollaborators(agentId, people),
    {
      mutationKey: [MutationKeys.updateAdminAgentCollaborators],
      onSuccess: (_data, { agentId }) => {
        queryClient.invalidateQueries([QueryKeys.adminAgentDrafts, agentId]);
      },
    },
  );
};

/** Nothing is cached or invalidated: a model test writes nothing. */
export const useRunAdminModelTestMutation = (): UseMutationResult<
  AdminModelTestResponse,
  unknown,
  AdminModelTestRequest
> =>
  useMutation((payload: AdminModelTestRequest) => dataService.runAdminModelTest(payload), {
    mutationKey: [MutationKeys.runAdminModelTest],
  });

export const useOpenAdminAgentDraftMutation = (): UseMutationResult<
  AdminOpenDraftResponse,
  unknown,
  string
> => {
  const queryClient = useQueryClient();
  return useMutation((agentId: string) => dataService.openAdminAgentDraft(agentId), {
    mutationKey: [MutationKeys.openAdminAgentDraft],
    onSuccess: (_data, agentId) => {
      queryClient.invalidateQueries([QueryKeys.adminAgentDrafts, agentId]);
      queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
    },
  });
};

/** Posting changes production's version and the draft's state, so both lists refresh. */
export const usePostAdminAgentDraftMutation = (): UseMutationResult<
  AdminPostDraftResponse,
  unknown,
  { agentId: string; draftId: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(({ agentId, draftId }) => dataService.postAdminAgentDraft(agentId, draftId), {
    mutationKey: [MutationKeys.postAdminAgentDraft],
    onSuccess: (_data, { agentId }) => {
      queryClient.invalidateQueries([QueryKeys.adminAgentDrafts, agentId]);
      queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
    },
  });
};

/** Test writes nothing, so nothing is cached or invalidated. */
export const usePreviewAdminWebsiteMutation = (): UseMutationResult<
  AdminWebsitePreviewResponse,
  unknown,
  string
> =>
  useMutation((url: string) => dataService.previewAdminWebsite(url), {
    mutationKey: [MutationKeys.previewAdminWebsite],
  });

/** A saved copy is an agent document, so the agent's file list is refetched. */
export const useSaveAdminAgentWebsiteMutation = (): UseMutationResult<
  AdminWebsiteSaveResponse,
  unknown,
  { agentId: string; url: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ agentId, url }: { agentId: string; url: string }) =>
      dataService.saveAdminAgentWebsite(agentId, url),
    {
      mutationKey: [MutationKeys.saveAdminAgentWebsite],
      onSuccess: (_data, { agentId }) => {
        queryClient.invalidateQueries(DynamicQueryKeys.agentFiles(agentId));
      },
    },
  );
};
