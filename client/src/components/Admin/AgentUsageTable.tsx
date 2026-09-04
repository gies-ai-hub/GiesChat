import React, { useCallback } from 'react';
import { Code, Pencil } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import {
  Table,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableCaption,
} from '@librechat/client';
import type { AdminAgentUsage } from 'librechat-data-provider';
import DeleteAgentButton from '~/components/Agents/DeleteAgentButton';
import { useAdminAgentUsageQuery } from '~/data-provider';
import { formatLastActivity } from './activity';
import { useLocalize } from '~/hooks';
import QueryState from './QueryState';

interface AgentUsageTableProps {
  groupId: string;
  days: number;
  onSelectAgent: (agent: AdminAgentUsage) => void;
  onEditAgent: (agent: AdminAgentUsage) => void;
  onEmbedAgent: (agent: AdminAgentUsage) => void;
}

export default function AgentUsageTable({
  groupId,
  days,
  onSelectAgent,
  onEditAgent,
  onEmbedAgent,
}: AgentUsageTableProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const params = { days, ...(groupId ? { groupId } : {}) };
  const { data, isLoading, error, refetch } = useAdminAgentUsageQuery(params);

  const handleDeleted = useCallback(
    () => queryClient.invalidateQueries([QueryKeys.adminAgentUsage]),
    [queryClient],
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

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
            <TableRow key={agent.agent_id}>
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
                {/* Every listed row is author-or-EDIT scoped by the server, so the pencil
                    needs no per-row flag. DELETE is a narrower bit, hence canDelete. */}
                <span className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => onEditAgent(agent)}
                    aria-label={localize('com_ui_admin_edit_agent', { name: agent.name })}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => onEmbedAgent(agent)}
                    aria-label={localize('com_ui_admin_embed_agent', { name: agent.name })}
                    className={agent.embed ? 'text-[#d94f04] dark:text-[#ff5f05]' : undefined}
                  >
                    <Code className="size-4" aria-hidden="true" />
                  </Button>
                  {agent.canDelete && (
                    <DeleteAgentButton
                      agentId={agent.agent_id}
                      agentName={agent.name}
                      confirmText={localize('com_ui_admin_delete_agent_confirm', {
                        name: agent.name,
                      })}
                      onDeleted={handleDeleted}
                    />
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </QueryState>
  );
}
