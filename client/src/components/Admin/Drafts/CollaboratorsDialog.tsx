import { useState, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { X, Mail, ChevronDown } from 'lucide-react';
import { PrincipalType } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type {
  TPrincipal,
  AdminUserRef,
  AdminAgentRole,
  AdminAgentUsage,
  AdminAgentDraftsResponse,
} from 'librechat-data-provider';
import UnifiedPeopleSearch from '~/components/Sharing/PeoplePicker/UnifiedPeopleSearch';
import { useUpdateAdminAgentCollaboratorsMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** The four people lists the drafts endpoint returns to the author. */
export type AgentPeopleLists = Pick<
  AdminAgentDraftsResponse,
  'collaborators' | 'pending' | 'coAdmins' | 'pendingCoAdmins'
>;

interface CollaboratorsDialogProps {
  agent: AdminAgentUsage | null;
  people: AgentPeopleLists;
  onOpenChange: (open: boolean) => void;
}

type Member = AdminUserRef & { role: AdminAgentRole };
type Invite = { email: string; role: AdminAgentRole };

/** Sign-in is Illinois SSO, so no other domain could ever claim an invite. */
const ILLINOIS_EMAIL = /^[a-z0-9][a-z0-9._%+-]*@illinois\.edu$/;
/** Long enough to read the spam reminder that follows an email going out. */
const EMAILED_TOAST_MS = 9000;
const ROLES: AdminAgentRole[] = ['collaborator', 'coAdmin'];
const ROLE_KEY = {
  coAdmin: 'com_ui_admin_role_coadmin',
  collaborator: 'com_ui_admin_role_collaborator',
} as const;

/** A person with a GiesChat account joins straight away; anyone else is invited by email. */
const toUserRef = (principal: TPrincipal): AdminUserRef | null =>
  principal.type === PrincipalType.USER && principal.id
    ? {
        id: principal.id,
        name: principal.name ?? principal.email ?? '',
        email: principal.email ?? '',
      }
    : null;

const membersFrom = (people: AgentPeopleLists): Member[] => [
  ...people.coAdmins.map((ref): Member => ({ ...ref, role: 'coAdmin' })),
  ...people.collaborators.map((ref): Member => ({ ...ref, role: 'collaborator' })),
];

const invitesFrom = (people: AgentPeopleLists): Invite[] => [
  ...people.pendingCoAdmins.map((email): Invite => ({ email, role: 'coAdmin' })),
  ...people.pending.map((email): Invite => ({ email, role: 'collaborator' })),
];

const withRole = <T extends { role: AdminAgentRole }>(list: T[], role: AdminAgentRole) =>
  list.filter((entry) => entry.role === role);

/**
 * The author's People dialog: everyone working on the agent with a role each. Co-admins
 * run it with the author; collaborators draft their own copy. Saving replaces all four
 * lists at once, so the server decides who gets an invite or a role-change email.
 */
export default function CollaboratorsDialog({
  agent,
  people,
  onOpenChange,
}: CollaboratorsDialogProps) {
  const localize = useLocalize();
  const user = useRecoilValue(store.user);
  const { showToast } = useToastContext();
  const update = useUpdateAdminAgentCollaboratorsMutation();
  const [members, setMembers] = useState<Member[]>(() => membersFrom(people));
  /** Addresses with no account yet: those already invited, plus ones added in this dialog. */
  const [invites, setInvites] = useState<Invite[]>(() => invitesFrom(people));
  const [draft, setDraft] = useState('');
  const [draftRole, setDraftRole] = useState<AdminAgentRole>('collaborator');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setMembers(membersFrom(people));
    setInvites(invitesFrom(people));
    setDraft('');
    setDraftRole('collaborator');
    setInvalid(false);
  }, [people, agent?.agent_id]);

  const alreadyInvited = new Set([...people.pending, ...people.pendingCoAdmins]);

  const addEmail = (value: string, role: AdminAgentRole) => {
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
    if (members.some((member) => member.email.toLowerCase() === email)) {
      return;
    }
    setInvites((current) =>
      current.some((invite) => invite.email === email) ? current : [...current, { email, role }],
    );
  };

  /** A directory pick without an account is an invitation, not a rejection. */
  const add = (principals: TPrincipal[]) => {
    const known = new Set(members.map((member) => member.id));
    const added: Member[] = [];
    for (const principal of principals) {
      const ref = toUserRef(principal);
      if (ref != null && !known.has(ref.id)) {
        added.push({ ...ref, role: 'collaborator' });
        continue;
      }
      if (ref == null && principal.email != null) {
        addEmail(principal.email, 'collaborator');
      }
    }
    if (added.length > 0) {
      setMembers((current) => [...current, ...added]);
    }
  };

  const setMemberRole = (id: string, role: AdminAgentRole) =>
    setMembers((current) =>
      current.map((member) => (member.id === id ? { ...member, role } : member)),
    );
  const setInviteRole = (email: string, role: AdminAgentRole) =>
    setInvites((current) =>
      current.map((invite) => (invite.email === email ? { ...invite, role } : invite)),
    );

  const save = () => {
    if (agent == null) {
      return;
    }
    update.mutate(
      {
        agentId: agent.agent_id,
        userIds: withRole(members, 'collaborator').map((member) => member.id),
        coAdminIds: withRole(members, 'coAdmin').map((member) => member.id),
        emails: withRole(invites, 'collaborator').map((invite) => invite.email),
        coAdminEmails: withRole(invites, 'coAdmin').map((invite) => invite.email),
      },
      {
        onSuccess: (data) => {
          const count = data.invited.length + data.roleChanged.length;
          showToast({
            message:
              count > 0
                ? localize(
                    count === 1
                      ? 'com_ui_admin_people_emailed'
                      : 'com_ui_admin_people_emailed_other',
                    { count },
                  )
                : localize('com_ui_admin_collaborators_saved'),
            severity: NotificationSeverity.SUCCESS,
            ...(count > 0 ? { duration: EMAILED_TOAST_MS } : {}),
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

  const roleSelect = (
    value: AdminAgentRole,
    label: string,
    onChange: (role: AdminAgentRole) => void,
  ) => (
    <span className="relative inline-flex flex-none items-center">
      <select
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as AdminAgentRole)}
        className="cursor-pointer appearance-none rounded-lg border border-border-light bg-surface-primary py-1 pl-2 pr-7 text-xs text-text-primary hover:bg-surface-hover"
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {localize(ROLE_KEY[role])}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 size-3.5 text-text-secondary"
        aria-hidden="true"
      />
    </span>
  );

  const removeButton = (name: string, onClick: () => void) => (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      aria-label={localize('com_ui_admin_collaborators_remove', { name })}
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );

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
          excludeIds={members.map((member) => member.id)}
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
                  addEmail(draft, draftRole);
                }
              }}
              placeholder={localize('com_ui_admin_collaborators_invite_placeholder')}
              aria-invalid={invalid}
              aria-describedby={invalid ? 'collaborator-invite-error' : undefined}
              className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
            />
            {roleSelect(draftRole, localize('com_ui_admin_invite_role'), setDraftRole)}
            <Button variant="outline" onClick={() => addEmail(draft, draftRole)}>
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
          {user != null && (
            <li className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-primary">{user.name}</span>
                <span className="block truncate text-xs text-text-secondary">{user.email}</span>
              </span>
              <span className="pr-2 text-xs text-text-secondary">
                {localize('com_ui_admin_role_owner')}
              </span>
            </li>
          )}
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-primary">{member.name}</span>
                <span className="block truncate text-xs text-text-secondary">{member.email}</span>
              </span>
              {roleSelect(
                member.role,
                localize('com_ui_admin_role_for', { name: member.name }),
                (role) => setMemberRole(member.id, role),
              )}
              {removeButton(member.name, () =>
                setMembers((current) => current.filter((entry) => entry.id !== member.id)),
              )}
            </li>
          ))}
          {invites.map((invite) => (
            <li key={invite.email} className="flex items-center gap-3 py-2 text-sm">
              <Mail className="size-4 flex-none text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text-primary">{invite.email}</span>
                <span className="block text-xs text-text-secondary">
                  {localize(
                    alreadyInvited.has(invite.email)
                      ? 'com_ui_admin_collaborators_invited_pending'
                      : 'com_ui_admin_collaborators_invited_new',
                  )}
                </span>
              </span>
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 text-[11px] font-semibold text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                {localize('com_ui_admin_collaborators_invited_chip')}
              </span>
              {roleSelect(
                invite.role,
                localize('com_ui_admin_role_for', { name: invite.email }),
                (role) => setInviteRole(invite.email, role),
              )}
              {removeButton(invite.email, () =>
                setInvites((current) => current.filter((entry) => entry.email !== invite.email)),
              )}
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
