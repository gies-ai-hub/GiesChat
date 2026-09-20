import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { AdminAgentUsage, AdminAgentDraft } from 'librechat-data-provider';
import { usePostAdminAgentDraftMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

interface PostDraftDialogProps {
  agent: AdminAgentUsage;
  draft: AdminAgentDraft | null;
  onOpenChange: (open: boolean) => void;
}

/** The one irreversible-looking step gets a confirm; version history is the actual undo. */
export default function PostDraftDialog({ agent, draft, onOpenChange }: PostDraftDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const post = usePostAdminAgentDraftMutation();

  const confirm = () => {
    if (draft == null) {
      return;
    }
    post.mutate(
      { agentId: agent.agent_id, draftId: draft.draft_id },
      {
        onSuccess: (data) => {
          showToast({
            message: localize('com_ui_admin_draft_post_success', {
              owner: draft.owner.name,
              version: data.version,
            }),
            severity: NotificationSeverity.SUCCESS,
          });
          onOpenChange(false);
        },
        onError: () =>
          showToast({
            message: localize('com_ui_admin_draft_post_error'),
            severity: NotificationSeverity.ERROR,
          }),
      },
    );
  };

  return (
    <OGDialog open={draft != null} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogTitle>{localize('com_ui_admin_draft_post_title')}</OGDialogTitle>
        <p className="text-sm text-text-secondary">
          {localize('com_ui_admin_draft_post_body', {
            owner: draft?.owner.name ?? '',
            name: agent.name,
            version: agent.version + 1,
            current: agent.version,
          })}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={post.isLoading}>
            {localize('com_ui_cancel')}
          </Button>
          <Button onClick={confirm} disabled={post.isLoading}>
            {localize('com_ui_admin_draft_post')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
