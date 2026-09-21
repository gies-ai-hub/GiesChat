import { useState, useEffect } from 'react';
import { X, Mail } from 'lucide-react';
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
  /** Addresses already invited and still waiting for a first sign-in. */
  pending: string[];
  onOpenChange: (open: boolean) => void;
}

/** Sign-in is Illinois SSO, so no other domain could ever claim an invite. */
const ILLINOIS_EMAIL = /^[a-z0-9][a-z0-9._%+-]*@illinois\.edu$/;

/** A person with a GiesChat account joins straight away; anyone else is invited by email. */
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
  pending,
  onOpenChange,
}: CollaboratorsDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateAdminAgentCollaboratorsMutation();
  const [people, setPeople] = useState<AdminUserRef[]>(collaborators);
  /** Addresses with no account yet: those already invited, plus ones added in this dialog. */
  const [invites, setInvites] = useState<string[]>(pending);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setPeople(collaborators);
    setInvites(pending);
    setDraft('');
    setInvalid(false);
  }, [collaborators, pending, agent?.agent_id]);

  const addEmail = (value: string) => {
    const email = value.trim().toLowerCase();
    if (email === '') {
      return;
    }
    if (!ILLINOIS_EMAIL.test(email)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft('');
    if (people.some((person) => person.email.toLowerCase() === email)) {
      return;
    }
    setInvites((current) => (current.includes(email) ? current : [...current, email]));
  };

  /** A directory pick without an account is an invitation, not a rejection. */
  const add = (principals: TPrincipal[]) => {
    const known = new Set(people.map((person) => person.id));
    const added: AdminUserRef[] = [];
    for (const principal of principals) {
      const ref = toUserRef(principal);
      if (ref != null && !known.has(ref.id)) {
        added.push(ref);
        continue;
      }
      if (ref == null && principal.email != null) {
        addEmail(principal.email);
      }
    }
    if (added.length > 0) {
      setPeople((current) => [...current, ...added]);
    }
  };

  const save = () => {
    if (agent == null) {
      return;
    }
    update.mutate(
      {
        agentId: agent.agent_id,
        userIds: people.map((person) => person.id),
        emails: invites,
      },
      {
        onSuccess: (data) => {
          const count = data.invited.length;
          showToast({
            message:
              count > 0
                ? localize(
                    count === 1
                      ? 'com_ui_admin_collaborators_invited_sent'
                      : 'com_ui_admin_collaborators_invited_sent_other',
                    { count },
                  )
                : localize('com_ui_admin_collaborators_saved'),
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

  const isEmpty = people.length === 0 && invites.length === 0;

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
        <div className="mt-3">
          <label
            htmlFor="collaborator-invite"
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
          >
            {localize('com_ui_admin_collaborators_invite_label')}
          </label>
          <div className="flex gap-2">
            <input
              id="collaborator-invite"
              type="email"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addEmail(draft);
                }
              }}
              placeholder={localize('com_ui_admin_collaborators_invite_placeholder')}
              aria-invalid={invalid}
              aria-describedby={invalid ? 'collaborator-invite-error' : undefined}
              className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
            />
            <Button variant="outline" onClick={() => addEmail(draft)}>
              {localize('com_ui_admin_collaborators_invite_add')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_ui_admin_collaborators_invite_hint')}
          </p>
          {invalid && (
            <p id="collaborator-invite-error" role="alert" className="mt-1 text-xs text-red-500">
              {localize('com_ui_admin_collaborators_invite_domain')}
            </p>
          )}
        </div>
        <ul className="mt-2 divide-y divide-border-light">
          {isEmpty && (
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
                onClick={() =>
                  setPeople((current) => current.filter((entry) => entry.id !== person.id))
                }
                aria-label={localize('com_ui_admin_collaborators_remove', { name: person.name })}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {invites.map((email) => (
            <li key={email} className="flex items-center gap-3 py-2 text-sm">
              <Mail className="size-4 flex-none text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text-primary">{email}</span>
                <span className="block text-xs text-text-secondary">
                  {localize(
                    pending.includes(email)
                      ? 'com_ui_admin_collaborators_invited_pending'
                      : 'com_ui_admin_collaborators_invited_new',
                  )}
                </span>
              </span>
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 text-[11px] font-semibold text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                {localize('com_ui_admin_collaborators_invited_chip')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setInvites((current) => current.filter((entry) => entry !== email))}
                aria-label={localize('com_ui_admin_collaborators_remove', { name: email })}
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
