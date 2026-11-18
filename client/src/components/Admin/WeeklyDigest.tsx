import { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Mail, X } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { AdminAgentUsage, AdminWeeklyDigest } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminWeeklyDigestQuery, useUpdateAdminWeeklyDigestMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { ILLINOIS_EMAIL } from '~/utils/email';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** The server accepts at most this many addresses; the dialog says so before it has to. */
const MAX_EMAILS = 10;
const EMAIL_INPUT_ID = 'weekly-digest-email';

type DigestAgent = Pick<AdminAgentUsage, 'agent_id' | 'name' | 'conversationCount'>;

interface WeeklyDigestProps {
  agents: DigestAgent[];
}

/** First open: agents with activity in the dashboard's window, or every agent when none has any. */
function defaultAgentIds(agents: DigestAgent[]): string[] {
  const active = agents.filter((agent) => agent.conversationCount > 0);
  return (active.length > 0 ? active : agents).map((agent) => agent.agent_id);
}

/** The Weekly email button and its dialog: pick agents, list Illinois addresses, save. */
export default function WeeklyDigest({ agents }: WeeklyDigestProps) {
  const localize = useLocalize();
  const user = useRecoilValue(store.user);
  const { showToast } = useToastContext();
  const { data: saved, isLoading } = useAdminWeeklyDigestQuery();
  const update = useUpdateAdminWeeklyDigestMutation();

  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<TranslationKeys | null>(null);

  const ownEmail = user?.email?.toLowerCase() ?? '';
  const isOn = (saved?.emails.length ?? 0) > 0;
  const needsAgent = emails.length > 0 && picked.size === 0;
  const message = error ?? (needsAgent ? 'com_ui_admin_digest_pick_agent' : null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (saved != null && isOn) {
        setEmails(saved.emails);
        setPicked(new Set(saved.agentIds));
      } else {
        setEmails(ILLINOIS_EMAIL.test(ownEmail) ? [ownEmail] : []);
        setPicked(new Set(defaultAgentIds(agents)));
      }
      setDraft('');
      setError(null);
    }
    setOpen(next);
  };

  const toggleAgent = (agentId: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(agentId)) {
        next.add(agentId);
      }
      return next;
    });

  const addEmail = () => {
    const email = draft.trim().toLowerCase();
    if (email === '') {
      return;
    }
    if (!ILLINOIS_EMAIL.test(email)) {
      setError('com_ui_admin_digest_illinois_only');
      return;
    }
    if (emails.includes(email)) {
      setError('com_ui_admin_digest_duplicate');
      return;
    }
    if (emails.length >= MAX_EMAILS) {
      setError('com_ui_admin_digest_limit');
      return;
    }
    setEmails([...emails, email]);
    setDraft('');
    setError(null);
  };

  const save = (settings: AdminWeeklyDigest) =>
    update.mutate(settings, {
      onSuccess: (result) => {
        showToast({
          message: localize(
            result.emails.length > 0 ? 'com_ui_admin_digest_saved' : 'com_ui_admin_digest_off',
          ),
          severity: NotificationSeverity.SUCCESS,
        });
        setOpen(false);
      },
      onError: () =>
        showToast({
          message: localize('com_ui_admin_digest_error'),
          severity: NotificationSeverity.ERROR,
        }),
    });

  const handleSave = () =>
    save({
      agentIds: agents.map((agent) => agent.agent_id).filter((id) => picked.has(id)),
      emails,
    });

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="outline" disabled={isLoading} onClick={() => handleOpenChange(true)}>
        <Mail className="mr-2 size-4" aria-hidden="true" />
        {localize('com_ui_admin_digest_button')}
        {isOn && (
          <span className="ml-2 rounded-full border border-green-600/40 bg-green-500/10 px-2 text-xs font-semibold text-green-700 dark:text-green-400">
            {localize('com_ui_admin_digest_on')}
          </span>
        )}
      </Button>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogTitle>{localize('com_ui_admin_digest_title')}</OGDialogTitle>
        <p className="text-sm leading-relaxed text-text-secondary">
          {localize('com_ui_admin_digest_description')}
        </p>

        <fieldset className="mt-2 rounded-lg border border-border-light px-3 pb-2">
          <legend className="px-1 text-sm font-medium text-text-primary">
            {localize('com_ui_admin_digest_agents')}
          </legend>
          {agents.map((agent) => (
            <label
              key={agent.agent_id}
              className="flex cursor-pointer items-center gap-2 py-1 text-sm text-text-primary"
            >
              <input
                type="checkbox"
                className="size-4"
                checked={picked.has(agent.agent_id)}
                onChange={() => toggleAgent(agent.agent_id)}
              />
              {agent.name}
            </label>
          ))}
        </fieldset>

        <label
          htmlFor={EMAIL_INPUT_ID}
          className="mt-3 block text-sm font-medium text-text-primary"
        >
          {localize('com_ui_admin_digest_send_to')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={EMAIL_INPUT_ID}
            type="email"
            value={draft}
            placeholder={localize('com_ui_admin_digest_placeholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addEmail();
              }
            }}
            className="flex-1 rounded-lg border border-border-medium bg-transparent px-3 py-2 text-sm text-text-primary"
          />
          <Button type="button" variant="outline" onClick={addEmail}>
            {localize('com_ui_admin_digest_add')}
          </Button>
        </div>
        <p role="alert" className="mt-1 min-h-5 text-sm text-text-destructive">
          {message != null ? localize(message) : ''}
        </p>

        <ul className="border-t border-border-light">
          {emails.length === 0 && (
            <li className="py-2 text-sm text-text-secondary">
              {localize('com_ui_admin_digest_empty')}
            </li>
          )}
          {emails.map((email) => (
            <li
              key={email}
              className="flex items-center justify-between border-b border-border-light py-2 text-sm text-text-primary"
            >
              <span className="truncate">
                {email}
                {email === ownEmail && (
                  <span className="ml-2 text-xs text-text-secondary">
                    {localize('com_ui_admin_digest_you')}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="rounded p-1 text-text-secondary hover:bg-surface-hover"
                aria-label={localize('com_ui_admin_digest_remove', { email })}
                onClick={() => setEmails(emails.filter((entry) => entry !== email))}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-secondary">{localize('com_ui_admin_digest_hint')}</p>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={update.isLoading}
            onClick={() => save({ agentIds: [], emails: [] })}
          >
            {localize('com_ui_admin_digest_turn_off')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {localize('com_ui_cancel')}
            </Button>
            <Button variant="submit" disabled={needsAgent || update.isLoading} onClick={handleSave}>
              {localize('com_ui_save')}
            </Button>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
