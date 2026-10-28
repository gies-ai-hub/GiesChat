import React from 'react';
import { Code, Pencil, KeyRound, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import type { AdminAgentUsage } from 'librechat-data-provider';
import DeleteAgentButton from '~/components/Agents/DeleteAgentButton';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface AgentActionHandlers {
  onOpenAgent: (agent: AdminAgentUsage) => void;
  onEditAgent: (agent: AdminAgentUsage) => void;
  /** A collaborator's pencil: opens their own draft, creating it on first use. */
  onEditOwnDraft: (agent: AdminAgentUsage) => void;
  onEmbedAgent: (agent: AdminAgentUsage) => void;
  /** Opens the agent's API keys; offered to its author and co-admins only. */
  onApiAccess: (agent: AdminAgentUsage) => void;
  onToggleDrafts: (agent: AdminAgentUsage) => void;
  onDeleted: () => void;
}

interface AgentActionsProps extends AgentActionHandlers {
  agent: AdminAgentUsage;
  draftsExpanded: boolean;
  className?: string;
}

/**
 * The icon row shared by the usage table and the agent cards. Every listed agent is
 * author-or-EDIT scoped by the server, so the pencil needs no per-row flag; DELETE is a
 * narrower bit, hence `canDelete`.
 */
export default function AgentActions({
  agent,
  draftsExpanded,
  className,
  onOpenAgent,
  onEditAgent,
  onEditOwnDraft,
  onEmbedAgent,
  onApiAccess,
  onToggleDrafts,
  onDeleted,
}: AgentActionsProps) {
  const localize = useLocalize();
  return (
    <span className={cn('flex justify-end gap-1', className)}>
      <TooltipAnchor
        description={localize('com_ui_admin_tip_open')}
        render={
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => onOpenAgent(agent)}
            aria-label={localize('com_ui_admin_open_agent', { name: agent.name })}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      {/* A collaborator's pencil edits their own draft; production changes only when it is posted. */}
      <TooltipAnchor
        description={localize(
          agent.isCollaborator ? 'com_ui_admin_tip_edit_own_draft' : 'com_ui_admin_tip_edit',
        )}
        render={
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => (agent.isCollaborator ? onEditOwnDraft(agent) : onEditAgent(agent))}
            aria-label={localize(
              agent.isCollaborator ? 'com_ui_admin_edit_own_draft' : 'com_ui_admin_edit_agent',
              { name: agent.name },
            )}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <TooltipAnchor
        description={localize(agent.embed ? 'com_ui_admin_tip_embed_on' : 'com_ui_admin_tip_embed')}
        render={
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
        }
      />
      {(agent.isAuthor || agent.isCoAdmin) && (
        <TooltipAnchor
          description={localize('com_ui_admin_tip_api')}
          render={
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => onApiAccess(agent)}
              aria-label={localize('com_ui_admin_api_agent', { name: agent.name })}
            >
              <KeyRound className="size-4" aria-hidden="true" />
            </Button>
          }
        />
      )}
      {(agent.isAuthor || agent.isCoAdmin || agent.isCollaborator) && (
        <TooltipAnchor
          description={localize(
            draftsExpanded ? 'com_ui_admin_tip_drafts_hide' : 'com_ui_admin_tip_drafts',
          )}
          render={
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-expanded={draftsExpanded}
              aria-controls={`drafts-${agent.agent_id}`}
              aria-label={localize('com_ui_admin_drafts_toggle', { name: agent.name })}
              onClick={() => onToggleDrafts(agent)}
            >
              {draftsExpanded ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4" aria-hidden="true" />
              )}
            </Button>
          }
        />
      )}
      {agent.canDelete && (
        <DeleteAgentButton
          agentId={agent.agent_id}
          agentName={agent.name}
          confirmText={localize('com_ui_admin_delete_agent_confirm', { name: agent.name })}
          onDeleted={onDeleted}
        />
      )}
    </span>
  );
}
