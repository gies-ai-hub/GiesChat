import { useCallback } from 'react';
import {
  Label,
  Button,
  OGDialog,
  TrashIcon,
  useToastContext,
  OGDialogTrigger,
  TooltipAnchor,
  OGDialogTemplate,
} from '@librechat/client';
import type { ButtonProps } from '@librechat/client';
import { useDeleteAgentMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

interface DeleteAgentButtonProps {
  agentId: string;
  agentName: string;
  confirmText: string;
  onDeleted?: () => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

/**
 * Standalone delete control for an agent, used by the class dashboard's agent table and by the
 * marketplace detail dialog under "My GPTs".
 *
 * The builder's own `DeleteButton` is bound to the agent form (`useFormContext`, the create
 * mutation, the selected-agent setter) and cannot render outside it, so this reuses the same
 * mutation and confirm-dialog template without that coupling. Callers decide when it is safe to
 * offer — DELETE is a separate permission bit from the EDIT that lists an agent.
 */
export default function DeleteAgentButton({
  agentId,
  agentName,
  confirmText,
  onDeleted,
  variant = 'ghost',
  size = 'sm',
}: DeleteAgentButtonProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const deleteAgent = useDeleteAgentMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_agent_deleted'), status: 'success' });
      onDeleted?.();
    },
    onError: () => {
      showToast({ message: localize('com_ui_agent_delete_error'), status: 'error' });
    },
  });

  const handleDelete = useCallback(
    () => deleteAgent.mutate({ agent_id: agentId }),
    [deleteAgent, agentId],
  );

  return (
    <OGDialog>
      <OGDialogTrigger asChild>
        <TooltipAnchor
          description={localize('com_ui_delete_agent')}
          render={
            <Button
              size={size}
              variant={variant}
              type="button"
              disabled={deleteAgent.isLoading}
              aria-label={localize('com_ui_delete_agent_named', { name: agentName })}
            >
              <TrashIcon className="size-4 text-red-500" />
            </Button>
          }
        />
      </OGDialogTrigger>
      <OGDialogTemplate
        title={localize('com_ui_delete_agent')}
        className="max-w-[450px]"
        main={
          <div className="grid w-full items-center gap-2">
            <Label htmlFor="delete-agent" className="text-left text-sm font-medium">
              {confirmText}
            </Label>
          </div>
        }
        selection={{
          selectHandler: handleDelete,
          selectClasses: 'bg-red-600 hover:bg-red-700 dark:hover:bg-red-800 text-white',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
  );
}
