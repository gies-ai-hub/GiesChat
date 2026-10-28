import React, { Fragment, useEffect, useCallback } from 'react';
import {
  Table,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableCaption,
} from '@librechat/client';
import type { AdminAgentUsage, AdminAgentDraft } from 'librechat-data-provider';
import type { AgentPeopleLists } from './Drafts/CollaboratorsDialog';
import type { AgentActionHandlers } from './AgentActions';
import { useAdminAgentUsageQuery } from '~/data-provider';
import { formatLastActivity } from './activity';
import AgentActions from './AgentActions';
import { DraftsPanel } from './Drafts';
import { useLocalize } from '~/hooks';
import QueryState from './QueryState';

interface AgentUsageTableProps extends AgentActionHandlers {
  groupId: string;
  days: number;
  /** The agent whose drafts row is open; the dashboard owns it so a card can open it too. */
  expandedId: string | null;
  onSelectAgent: (agent: AdminAgentUsage) => void;
  onEditDraft: (draftId: string, agent: AdminAgentUsage) => void;
  onTestLink: (draft: AdminAgentDraft, agent: AdminAgentUsage) => void;
  onOpenDraft: (draftId: string) => void;
  onManageCollaborators: (agent: AdminAgentUsage, people: AgentPeopleLists) => void;
}

export default function AgentUsageTable({
  groupId,
  days,
  expandedId,
  onSelectAgent,
  onEditDraft,
  onTestLink,
  onOpenDraft,
  onManageCollaborators,
  ...actions
}: AgentUsageTableProps) {
  const localize = useLocalize();
  const params = { days, ...(groupId ? { groupId } : {}) };
  const { data, isLoading, error, refetch } = useAdminAgentUsageQuery(params);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  /** A card's drafts icon opens a row further down the page, so bring it into view. */
  useEffect(() => {
    if (expandedId != null) {
      document.getElementById(`drafts-${expandedId}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [expandedId]);

  const agents = data?.agents ?? [];
  /** Ranks agents against the busiest one in view, so a chart repeating this column isn't needed. */
  const maxConversations = Math.max(1, ...agents.map((agent) => agent.conversationCount));

  return (
    <QueryState
      isLoading={isLoading}
      error={error}
      isEmpty={agents.length === 0}
      emptyKey="com_ui_admin_agents_empty"
      errorKey="com_ui_admin_agents_error"
      onRetry={handleRetry}
    >
      <Table>
        <TableCaption className="sr-only">{localize('com_ui_admin_agents_caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{localize('com_ui_admin_col_agent')}</TableHead>
            <TableHead scope="col">{localize('com_ui_admin_col_course')}</TableHead>
            <TableHead scope="col">{localize('com_ui_admin_col_status')}</TableHead>
            <TableHead scope="col" className="text-right">
              {localize('com_ui_admin_col_conversations')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {localize('com_ui_admin_col_students')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {localize('com_ui_admin_col_messages')}
            </TableHead>
            <TableHead scope="col">{localize('com_ui_admin_col_last_activity')}</TableHead>
            <TableHead scope="col" className="w-px text-right">
              <span className="sr-only">{localize('com_ui_admin_col_actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <Fragment key={agent.agent_id}>
              <TableRow>
                <TableCell>
                  <button
                    type="button"
                    className="rounded text-left font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-heavy"
                    aria-label={localize('com_ui_admin_view_progress', { name: agent.name })}
                    onClick={() => onSelectAgent(agent)}
                  >
                    {agent.name}
                  </button>
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {agent.course != null && agent.course !== ''
                    ? agent.course
                    : localize('com_ui_none')}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="rounded-full border border-green-200 bg-green-50 px-2 text-[11px] font-semibold text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
                      {localize('com_ui_admin_status_production', { version: agent.version })}
                    </span>
                    {agent.draftCount > 0 && (
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-2 text-[11px] font-semibold text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                        {localize(
                          agent.draftCount === 1
                            ? 'com_ui_admin_status_drafts_one'
                            : 'com_ui_admin_status_drafts_other',
                          { count: agent.draftCount },
                        )}
                      </span>
                    )}
                    {agent.isCoAdmin && (
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 text-[11px] font-semibold text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                        {localize('com_ui_admin_role_coadmin')}
                      </span>
                    )}
                    {agent.isCollaborator && (
                      <span className="rounded-full border border-border-light bg-surface-tertiary px-2 text-[11px] font-semibold text-text-primary">
                        {localize('com_ui_admin_status_collaborator')}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="flex items-center justify-end gap-2">
                    <span
                      className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-secondary"
                      aria-hidden="true"
                    >
                      <span
                        data-usage-bar
                        className="block h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                        style={{
                          width: `${(agent.conversationCount / maxConversations) * 100}%`,
                        }}
                      />
                    </span>
                    {agent.conversationCount}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{agent.userCount}</TableCell>
                <TableCell className="text-right tabular-nums">{agent.messageCount}</TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {formatLastActivity(agent.lastActivity) ?? localize('com_ui_none')}
                </TableCell>
                <TableCell className="text-right">
                  <AgentActions
                    agent={agent}
                    draftsExpanded={expandedId === agent.agent_id}
                    {...actions}
                  />
                </TableCell>
              </TableRow>
              {expandedId === agent.agent_id && (
                <TableRow id={`drafts-${agent.agent_id}`}>
                  <TableCell colSpan={8} className="bg-surface-secondary p-2">
                    <DraftsPanel
                      agent={agent}
                      onEditDraft={(draftId) => onEditDraft(draftId, agent)}
                      onTestLink={(draft) => onTestLink(draft, agent)}
                      onOpenInChat={onOpenDraft}
                      onManageCollaborators={onManageCollaborators}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </QueryState>
  );
}
