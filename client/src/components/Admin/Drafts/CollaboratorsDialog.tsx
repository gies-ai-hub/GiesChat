import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TPrincipal, AdminUserRef, AdminAgentUsage } from 'librechat-data-provider';
import UnifiedPeopleSearch from '~/components/Sharing/PeoplePicker/UnifiedPeopleSearch';
import { useUpdateAdminAgentCollaboratorsMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

interface CollaboratorsDialogProps {
  agent: AdminAgentUsage | null;
  collaborators: AdminUserRef[];
  onOpenChange: (open: boolean) => void;
}

/** A principal from the picker becomes a collaborator only once they have a local account (`id`). */
const toUserRef = (principal: TPrincipal): AdminUserRef | null =>
  principal.type === PrincipalType.USER && principal.id
    ? {
        id: principal.id,
        name: principal.name ?? principal.email ?? '',
        email: principal.email ?? '',
      }
    : null;

export default function CollaboratorsDialog({
  agent,
  collaborators,
  onOpenChange,
}: CollaboratorsDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateAdminAgentCollaboratorsMutation();
  const [people, setPeople] = useState<AdminUserRef[]>(collaborators);
  const [rejected, setRejected] = useState<string[]>([]);

  useEffect(() => {
    setPeople(collaborators);
    setRejected([]);
  }, [collaborators, agent?.agent_id]);

  const add = (principals: TPrincipal[]) => {
    const refs = principals.map((principal) => [principal, toUserRef(principal)] as const);
    setRejected(refs.filter(([, ref]) => ref == null).map(([principal]) => principal.name ?? ''));
    setPeople((current) => {
      const known = new Set(current.map((person) => person.id));
      const added = refs.flatMap(([, ref]) => (ref && !known.has(ref.id) ? [ref] : []));
      return [...current, ...added];
    });
  };

  const remove = (id: string) =>
    setPeople((current) => current.filter((person) => person.id !== id));

  const save = () => {
    if (agent == null) {
      return;
    }
    update.mutate(
      { agentId: agent.agent_id, userIds: people.map((person) => person.id) },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_ui_admin_collaborators_saved'),
            severity: NotificationSeverity.SUCCESS,
          });
          onOpenChange(false);
        },
        onError: () =>
          showToast({
            message: localize('com_ui_admin_collaborators_error'),
            severity: NotificationSeverity.ERROR,
          }),
      },
    );
  };

  return (
    <OGDialog open={agent != null} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogTitle>
          {localize('com_ui_admin_collaborators_title', { name: agent?.name ?? '' })}
        </OGDialogTitle>
        <p className="text-sm text-text-secondary">
          {localize('com_ui_admin_collaborators_intro')}
        </p>
        <UnifiedPeopleSearch
          onAddPeople={add}
          placeholder={localize('com_ui_admin_collaborators_search')}
          typeFilter={[PrincipalType.USER]}
          excludeIds={people.map((person) => person.id)}
        />
        {rejected.map((name) => (
          <p key={name} role="alert" className="text-xs text-text-secondary">
            {localize('com_ui_admin_collaborators_needs_account', { name })}
          </p>
        ))}
        <ul className="mt-2 divide-y divide-border-light">
          {people.length === 0 && (
            <li className="py-2 text-sm text-text-secondary">
              {localize('com_ui_admin_collaborators_empty')}
            </li>
          )}
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-primary">{person.name}</span>
                <span className="block truncate text-xs text-text-secondary">{person.email}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(person.id)}
                aria-label={localize('com_ui_admin_collaborators_remove', { name: person.name })}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isLoading}>
            {localize('com_ui_cancel')}
          </Button>
          <Button onClick={save} disabled={update.isLoading}>
            {localize('com_ui_save')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
