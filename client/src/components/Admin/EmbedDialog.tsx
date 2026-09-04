import { useState, useEffect, useMemo } from 'react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { AdminAgentUsage, AgentEmbedAudience } from 'librechat-data-provider';
import {
  useUpdateAdminAgentEmbedMutation,
  useRevokeAdminAgentEmbedMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

interface EmbedDialogProps {
  agent: AdminAgentUsage | null;
  onOpenChange: (open: boolean) => void;
}

const defaultGreeting = (agent: AdminAgentUsage) =>
  `Hi! I'm ${agent.name}. ${agent.description?.trim() || 'Ask me anything.'}`;

const snippetFor = (key: string) =>
  `<iframe src="${window.location.origin}/embed/${key}" width="100%" height="600" style="border:0;border-radius:12px" allow="clipboard-write"></iframe>`;

/**
 * Settings first, snippet second. The row's live `embed` decides which view opens;
 * "Edit settings" goes back without touching the key, so a pasted link keeps working.
 */
export default function EmbedDialog({ agent, onOpenChange }: EmbedDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateAdminAgentEmbedMutation();
  const revoke = useRevokeAdminAgentEmbedMutation();

  /** The row snapshot the dialog opened with never changes, so the live state is kept here. */
  const [live, setLive] = useState(agent?.embed ?? null);
  const [editing, setEditing] = useState(live == null);
  const [audience, setAudience] = useState<AgentEmbedAudience>(live?.audience ?? 'public');
  const [greetingOn, setGreetingOn] = useState(live == null || live.greeting != null);
  const [greeting, setGreeting] = useState(live?.greeting ?? (agent ? defaultGreeting(agent) : ''));

  useEffect(() => {
    if (agent == null) {
      return;
    }
    const current = agent.embed;
    setLive(current);
    setEditing(current == null);
    setAudience(current?.audience ?? 'public');
    setGreetingOn(current == null || current.greeting != null);
    setGreeting(current?.greeting ?? defaultGreeting(agent));
  }, [agent]);

  const snippet = useMemo(() => (live ? snippetFor(live.key) : ''), [live]);
  const busy = update.isLoading || revoke.isLoading;

  const fail = () =>
    showToast({
      message: localize('com_ui_admin_embed_error'),
      severity: NotificationSeverity.ERROR,
    });

  const save = () => {
    if (agent == null) {
      return;
    }
    update.mutate(
      {
        agentId: agent.agent_id,
        settings: { audience, greeting: greetingOn ? greeting.trim() : null },
      },
      {
        onSuccess: (data) => {
          setLive(data.embed);
          setEditing(false);
        },
        onError: fail,
      },
    );
  };

  const handleRevoke = () => {
    if (agent == null) {
      return;
    }
    revoke.mutate(agent.agent_id, {
      onSuccess: () => {
        setLive(null);
        setEditing(true);
      },
      onError: fail,
    });
  };

  const copy = () => {
    void navigator.clipboard.writeText(snippet).then(() =>
      showToast({
        message: localize('com_ui_admin_embed_copied'),
        severity: NotificationSeverity.SUCCESS,
      }),
    );
  };

  const summary = [
    localize(
      audience === 'public'
        ? 'com_ui_admin_embed_audience_public'
        : 'com_ui_admin_embed_audience_illinois',
    ),
    greetingOn ? localize('com_ui_admin_embed_greeting_toggle') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <OGDialog open={agent != null} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogTitle>
          {localize('com_ui_admin_embed_title', { name: agent?.name ?? '' })}
        </OGDialogTitle>
        {editing || live == null ? (
          <div className="flex flex-col gap-4 text-sm text-text-primary">
            <p className="text-text-secondary">{localize('com_ui_admin_embed_intro')}</p>
            <fieldset className="rounded-lg border border-border-light p-3">
              <legend className="px-1 text-xs font-semibold">
                {localize('com_ui_admin_embed_audience')}
              </legend>
              {(['public', 'illinois'] as const).map((value) => (
                <label key={value} className="flex cursor-pointer items-start gap-2 py-1">
                  <input
                    type="radio"
                    name="embed-audience"
                    value={value}
                    checked={audience === value}
                    onChange={() => setAudience(value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">
                      {localize(
                        value === 'public'
                          ? 'com_ui_admin_embed_audience_public'
                          : 'com_ui_admin_embed_audience_illinois',
                      )}
                    </span>
                    <span className="block text-xs text-text-secondary">
                      {localize(
                        value === 'public'
                          ? 'com_ui_admin_embed_audience_public_hint'
                          : 'com_ui_admin_embed_audience_illinois_hint',
                      )}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="rounded-lg border border-border-light p-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={greetingOn}
                  onChange={(event) => setGreetingOn(event.target.checked)}
                />
                {localize('com_ui_admin_embed_greeting_toggle')}
              </label>
              {greetingOn && (
                <>
                  <textarea
                    aria-label={localize('com_ui_admin_embed_greeting_toggle')}
                    value={greeting}
                    onChange={(event) => setGreeting(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    className="mt-2 w-full rounded-md border border-border-medium bg-surface-primary p-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_admin_embed_greeting_hint')}
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {live != null && (
                <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                  {localize('com_ui_cancel')}
                </Button>
              )}
              <Button onClick={save} disabled={busy}>
                {localize(live == null ? 'com_ui_admin_embed_turn_on' : 'com_ui_admin_embed_save')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-text-primary">
            <p className="text-text-secondary">
              {localize('com_ui_admin_embed_snippet_intro')} <span>{summary}.</span>{' '}
              <button type="button" className="underline" onClick={() => setEditing(true)}>
                {localize('com_ui_admin_embed_edit_settings')}
              </button>
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-border-light bg-surface-secondary p-3 font-mono text-xs">
              {snippet}
            </pre>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_admin_embed_revoke_note')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                className="mr-auto text-red-600"
                onClick={handleRevoke}
                disabled={busy}
              >
                {localize('com_ui_admin_embed_revoke')}
              </Button>
              <Button onClick={copy}>{localize('com_ui_admin_embed_copy')}</Button>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
