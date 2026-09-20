import { useState } from 'react';
import { Button } from '@librechat/client';
import { Link2, Pencil, Users, MessageSquare } from 'lucide-react';
import type { AdminUserRef, AdminAgentUsage, AdminAgentDraft } from 'librechat-data-provider';
import { useAdminAgentDraftsQuery, useOpenAdminAgentDraftMutation } from '~/data-provider';
import DeleteAgentButton from '~/components/Agents/DeleteAgentButton';
import { formatLastActivity } from '../activity';
import PostDraftDialog from './PostDraftDialog';
import QueryState from '../QueryState';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface DraftsPanelProps {
  agent: AdminAgentUsage;
  onEditDraft: (draftId: string) => void;
  onTestLink: (draft: AdminAgentDraft) => void;
  onOpenInChat: (draftId: string) => void;
  onManageCollaborators: (agent: AdminAgentUsage, collaborators: AdminUserRef[]) => void;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * The expanded row under a production agent. The author sees every open draft with
 * Post; a collaborator sees their own draft (or a Start button). Both see test links.
 */
export default function DraftsPanel({
  agent,
  onEditDraft,
  onTestLink,
  onOpenInChat,
  onManageCollaborators,
}: DraftsPanelProps) {
  const localize = useLocalize();
  const { data, isLoading, error, refetch } = useAdminAgentDraftsQuery(agent.agent_id);
  const openDraft = useOpenAdminAgentDraftMutation();
  const [posting, setPosting] = useState<AdminAgentDraft | null>(null);

  const drafts = data?.drafts ?? [];
  const version = data?.version ?? agent.version;
  const heading = agent.isAuthor
    ? localize('com_ui_admin_drafts_heading', { name: agent.name })
    : localize('com_ui_admin_your_draft');

  const startDraft = () =>
    openDraft.mutate(agent.agent_id, { onSuccess: (result) => onEditDraft(result.draft_id) });

  return (
    <div className="rounded-xl border border-border-light bg-surface-tertiary p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{heading}</h3>
        {agent.isAuthor && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onManageCollaborators(agent, data?.collaborators ?? [])}
          >
            <Users className="mr-1 size-4" aria-hidden="true" />
            {localize('com_ui_admin_collaborators_count', {
              count: data?.collaborators.length ?? 0,
            })}
          </Button>
        )}
      </div>
      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={false}
        emptyKey="com_ui_admin_drafts_empty"
        errorKey="com_ui_admin_drafts_error"
        onRetry={() => void refetch()}
      >
        {drafts.length === 0 && agent.isAuthor && (
          <p className="text-sm text-text-secondary">{localize('com_ui_admin_drafts_empty')}</p>
        )}
        {drafts.length === 0 && !agent.isAuthor && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-primary p-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_admin_start_draft_hint')}
            </p>
            <Button size="sm" onClick={startDraft} disabled={openDraft.isLoading}>
              {localize('com_ui_admin_start_draft')}
            </Button>
          </div>
        )}
        <ul className="flex flex-col gap-1.5">
          {drafts.map((draft) => {
            const stale = draft.draftBase < version;
            const edited = formatLastActivity(draft.updatedAt);
            const editedLine =
              edited == null ? '' : localize('com_ui_admin_draft_edited', { when: edited });
            return (
              <li
                key={draft.draft_id}
                className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg border border-border-light bg-surface-primary p-2"
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full bg-[#13294b] text-xs font-bold text-white"
                >
                  {initials(draft.owner.name)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-text-primary">{draft.owner.name}</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 text-[11px] font-semibold',
                        stale
                          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                          : 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300',
                      )}
                    >
                      {localize(
                        stale ? 'com_ui_admin_draft_stale' : 'com_ui_admin_draft_based_on',
                        { version: draft.draftBase },
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {draft.mine ? localize('com_ui_admin_your_draft_hint') : editedLine}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {draft.mine && (
                    <Button size="sm" onClick={() => onEditDraft(draft.draft_id)}>
                      <Pencil className="mr-1 size-4" aria-hidden="true" />
                      {localize('com_ui_admin_edit_draft')}
                    </Button>
                  )}
                  {(draft.mine || draft.embed != null) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onTestLink(draft)}
                      title={localize('com_ui_admin_draft_test_link_hint')}
                    >
                      <Link2 className="mr-1 size-4" aria-hidden="true" />
                      {localize('com_ui_admin_draft_test_link')}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onOpenInChat(draft.draft_id)}>
                    <MessageSquare className="mr-1 size-4" aria-hidden="true" />
                    {localize('com_ui_admin_draft_open_in_chat')}
                  </Button>
                  {agent.isAuthor && (
                    <Button size="sm" onClick={() => setPosting(draft)}>
                      {localize('com_ui_admin_draft_post')}
                    </Button>
                  )}
                  {draft.mine && (
                    <DeleteAgentButton
                      agentId={draft.draft_id}
                      agentName={agent.name}
                      confirmText={localize('com_ui_admin_discard_draft_confirm', {
                        name: agent.name,
                      })}
                      onDeleted={() => void refetch()}
                      variant="ghost"
                      size="sm"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
      <PostDraftDialog
        agent={agent}
        draft={posting}
        onOpenChange={(open) => !open && setPosting(null)}
      />
    </div>
  );
}
