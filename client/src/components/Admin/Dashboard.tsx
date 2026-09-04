import React, { useMemo, useState, useCallback } from 'react';
import { ArrowLeft, Bot } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import { QueryKeys, Permissions, PermissionTypes } from 'librechat-data-provider';
import type { AdminAgentUsage } from 'librechat-data-provider';
import type { Option } from '@librechat/client';
import AgentPanelSwitch from '~/components/SidePanel/Agents/AgentPanelSwitch';
import { useAdminAccess, useAdminGroupsQuery } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import StudentProgressTable from './StudentProgressTable';
import AgentUsageTable from './AgentUsageTable';
import ShareWithClass from './ShareWithClass';
import EmbedDialog from './EmbedDialog';
import AgentCards from './AgentCards';
import AnalyticsSection from './Analytics';

const DAY_WINDOWS = [7, 30, 90] as const;
/** Sentinel for "no class filter". Must be non-empty — `Dropdown` renders an empty label for `''`. */
const ALL_CLASSES = 'all';
const GROUP_PAGE_SIZE = 200;
/** Stamped on agents built here; the usage endpoint lists only these. Must match the server. */
const DASHBOARD_ORIGIN = 'dashboard';

export default function AdminDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAdminAccess, isLoading: isCheckingAccess, isDenied } = useAdminAccess();
  const canCreateAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.CREATE,
  });

  const [groupId, setGroupId] = useState<string>(ALL_CLASSES);
  const [days, setDays] = useState<number>(30);
  const [selectedAgent, setSelectedAgent] = useState<AdminAgentUsage | null>(null);
  const [editingAgent, setEditingAgent] = useState<AdminAgentUsage | null>(null);
  const [embeddingAgent, setEmbeddingAgent] = useState<AdminAgentUsage | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const { data: groupData, error: groupsError } = useAdminGroupsQuery(
    { limit: GROUP_PAGE_SIZE },
    { enabled: hasAdminAccess },
  );

  const classOptions = useMemo<Option[]>(() => {
    const groups = groupData?.groups ?? [];
    return [
      { value: ALL_CLASSES, label: localize('com_ui_admin_all_classes') },
      ...groups.map((group) => ({ value: group._id, label: group.name })),
    ];
  }, [groupData, localize]);

  /** ponytail: a hint, not pagination — add paging if anyone actually teaches 200+ classes. */
  const hasMoreClasses = (groupData?.total ?? 0) > (groupData?.groups.length ?? 0);

  const dayOptions = useMemo<Option[]>(
    () =>
      DAY_WINDOWS.map((window) => ({
        value: String(window),
        label: localize('com_ui_admin_last_days', { count: window }),
      })),
    [localize],
  );

  const handleDaysChange = useCallback((value: string) => {
    setDays(Number(value));
  }, []);

  /**
   * Closing the builder refetches usage so an agent created here appears in the table
   * straight away, rather than only after a manual reload.
   */
  const handleBuilderOpenChange = useCallback(
    (open: boolean) => {
      setIsBuilding(open);
      if (!open) {
        queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
      }
    },
    [queryClient],
  );

  /**
   * The builder does not close itself, so without this a freshly created agent sits
   * behind an open dialog and the list never refreshes — the usage query opts out of
   * refetch-on-mount, so only this invalidation brings it back.
   *
   * Creating an agent does not switch the conversation to it either: with
   * `modelSpecs.prioritize`, a new chat starts on the default spec, so a professor who
   * builds an agent and types straight away is talking to the default model and its
   * instructions never apply. `agent_id` is an honoured deep-link param, which avoids
   * depending on the chat providers this route sits outside of.
   */
  const handleAgentCreated = useCallback(
    (agentId: string) => {
      handleBuilderOpenChange(false);
      navigate(`/c/new?agent_id=${encodeURIComponent(agentId)}`);
    },
    [handleBuilderOpenChange, navigate],
  );

  /**
   * Reuses the builder's invalidation so a renamed or re-described agent refreshes in the
   * table on close. Unlike the create path, this must not navigate — the professor stays
   * on the dashboard.
   */
  const handleEditOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        return;
      }
      setEditingAgent(null);
      queryClient.invalidateQueries([QueryKeys.adminAgentUsage]);
    },
    [queryClient],
  );

  const handleBack = useCallback(() => setSelectedAgent(null), []);

  /** The tables treat an empty string as "unfiltered", which is what `all` means here. */
  const groupFilter = groupId === ALL_CLASSES ? '' : groupId;

  if (isCheckingAccess) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <p role="status" className="text-text-secondary">
          {localize('com_ui_loading')}
        </p>
      </main>
    );
  }

  if (isDenied || !hasAdminAccess) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="mb-2 text-xl font-semibold text-text-primary">
          {localize('com_ui_admin_dashboard')}
        </h1>
        <p role="alert" className="text-text-secondary">
          {localize('com_ui_admin_forbidden')}
        </p>
      </main>
    );
  }

  /**
   * `Root` gives every route a fixed-height `overflow-hidden` shell and expects the
   * route to own its scrolling, the way the marketplace does. Without this container
   * everything below the fold is clipped outright.
   */
  return (
    <main data-testid="admin-scroll" className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-text-primary">
              {localize('com_ui_admin_dashboard')}
            </h1>
            <p className="mt-1 text-text-secondary">
              {localize('com_ui_admin_dashboard_description')}
            </p>
          </div>
        </header>

        <section
          className="mb-6 flex flex-wrap items-center gap-3"
          aria-label={localize('com_ui_admin_filters')}
        >
          <Dropdown
            value={groupId}
            options={classOptions}
            onChange={setGroupId}
            ariaLabel={localize('com_ui_admin_class')}
            testId="admin-class-select"
          />
          <Dropdown
            value={String(days)}
            options={dayOptions}
            onChange={handleDaysChange}
            ariaLabel={localize('com_ui_admin_time_window')}
            testId="admin-days-select"
          />
          <div className="ml-auto flex items-center gap-2">
            {selectedAgent != null && (
              <ShareWithClass
                agentId={selectedAgent.agent_id}
                agentName={selectedAgent.name}
                key={selectedAgent.agent_id}
              />
            )}
            {canCreateAgents && (
              <Button variant="outline" onClick={() => handleBuilderOpenChange(true)}>
                <Bot className="mr-2 size-4" aria-hidden="true" />
                {localize('com_ui_admin_build_agent')}
              </Button>
            )}
          </div>
        </section>

        {groupsError != null && (
          <p role="alert" className="mb-4 text-sm text-text-secondary">
            {localize('com_ui_admin_classes_error')}
          </p>
        )}

        {hasMoreClasses && (
          <p role="status" className="mb-4 text-sm text-text-secondary">
            {localize('com_ui_admin_classes_truncated', {
              count: groupData?.groups.length ?? GROUP_PAGE_SIZE,
              total: groupData?.total ?? 0,
            })}
          </p>
        )}

        {/* Class-wide, so it belongs with the agent list rather than a single student's drill-down. */}
        {selectedAgent == null && <AnalyticsSection groupId={groupFilter} days={days} />}

        <section aria-labelledby="admin-agents-heading">
          <h2 id="admin-agents-heading" className="mb-3 text-lg font-medium text-text-primary">
            {localize('com_ui_admin_agents_heading')}
          </h2>
          <AgentCards
            groupId={groupFilter}
            days={days}
            selectedAgentId={selectedAgent?.agent_id ?? null}
            onSelectAgent={setSelectedAgent}
          />
          {selectedAgent == null && (
            <AgentUsageTable
              groupId={groupFilter}
              days={days}
              onSelectAgent={setSelectedAgent}
              onEditAgent={setEditingAgent}
              onEmbedAgent={setEmbeddingAgent}
            />
          )}
        </section>

        {selectedAgent != null && (
          <section aria-labelledby="admin-students-heading" className="mt-6">
            <Button variant="ghost" onClick={handleBack} className="mb-3 px-2">
              <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
              {localize('com_ui_admin_back_to_agents')}
            </Button>
            <h2 id="admin-students-heading" className="mb-3 text-lg font-medium text-text-primary">
              {localize('com_ui_admin_students_heading', { name: selectedAgent.name })}
            </h2>
            <StudentProgressTable
              agentId={selectedAgent.agent_id}
              agentName={selectedAgent.name}
              groupId={groupFilter}
              days={days}
            />
          </section>
        )}

        {canCreateAgents && (
          <OGDialog open={isBuilding} onOpenChange={handleBuilderOpenChange}>
            <OGDialogContent className="max-h-[90vh] w-11/12 max-w-lg overflow-y-auto">
              <OGDialogTitle>{localize('com_agents_create')}</OGDialogTitle>
              <AgentPanelSwitch createdVia={DASHBOARD_ORIGIN} onAgentCreated={handleAgentCreated} />
            </OGDialogContent>
          </OGDialog>
        )}

        <EmbedDialog
          agent={embeddingAgent}
          onOpenChange={(open) => {
            if (!open) {
              setEmbeddingAgent(null);
            }
          }}
        />

        {/* Not gated on canCreateAgents: editing is authorised by the EDIT scope the server
            already applied to this list, not by the CREATE permission. */}
        <OGDialog open={editingAgent != null} onOpenChange={handleEditOpenChange}>
          <OGDialogContent className="max-h-[90vh] w-11/12 max-w-lg overflow-y-auto">
            <OGDialogTitle>
              {localize('com_ui_admin_edit_agent_title', { name: editingAgent?.name ?? '' })}
            </OGDialogTitle>
            {editingAgent != null && (
              <AgentPanelSwitch
                key={editingAgent.agent_id}
                initialAgentId={editingAgent.agent_id}
                hideAgentSelect
              />
            )}
          </OGDialogContent>
        </OGDialog>
      </div>
    </main>
  );
}
