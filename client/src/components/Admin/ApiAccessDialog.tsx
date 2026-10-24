import { useState, useMemo, useEffect } from 'react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { AdminAgentUsage, AdminApiKeyCreateResponse } from 'librechat-data-provider';
import {
  useAdminApiKeysQuery,
  useCreateAdminApiKeyMutation,
  useRevokeAdminApiKeyMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { formatLastActivity } from './activity';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ApiAccessDialogProps {
  agent: AdminAgentUsage | null;
  onOpenChange: (open: boolean) => void;
}

/** An Entra application (client) id; the server checks the same shape. */
const APP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 100;

const snippetFor = (key: string, agentId: string) => `from openai import OpenAI

client = OpenAI(base_url="${window.location.origin}/api/agents/v1", api_key="${key}")

response = client.responses.create(
    model="${agentId}",  # or an allowed model, e.g. "gpt-6.1-sol"
    input="Hello!",
    extra_headers={"X-GiesChat-User-Token": student_id_token},
)
print(response.output_text)
# Keep the conversation going: pass previous_response_id=response.id`;

const fieldClass = 'mt-1 w-full rounded-md border border-border-medium bg-surface-primary p-2';

/** One agent's keys: list, mint (shown once), revoke. Same dialog shape as Embed. */
export default function ApiAccessDialog({ agent, onOpenChange }: ApiAccessDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, error } = useAdminApiKeysQuery({ enabled: agent != null });
  const create = useCreateAdminApiKeyMutation();
  const revoke = useRevokeAdminApiKeyMutation();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState('');
  const [errors, setErrors] = useState<{ name?: boolean; audience?: boolean }>({});
  const [created, setCreated] = useState<AdminApiKeyCreateResponse | null>(null);

  useEffect(() => {
    setAdding(false);
    setName('');
    setAudience('');
    setErrors({});
    setCreated(null);
  }, [agent]);

  const keys = useMemo(
    () => (data?.keys ?? []).filter((key) => key.agentId === agent?.agent_id),
    [data, agent],
  );

  const fail = () =>
    showToast({
      message: localize('com_ui_admin_api_error'),
      severity: NotificationSeverity.ERROR,
    });

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() =>
      showToast({
        message: localize('com_ui_admin_api_copied'),
        severity: NotificationSeverity.SUCCESS,
      }),
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (agent == null) {
      return;
    }
    const trimmedName = name.trim();
    const trimmedAudience = audience.trim();
    const next = {
      name: trimmedName === '' || trimmedName.length > NAME_MAX,
      audience: !APP_ID_PATTERN.test(trimmedAudience),
    };
    setErrors(next);
    if (next.name || next.audience) {
      return;
    }
    create.mutate(
      { agentId: agent.agent_id, name: trimmedName, audience: trimmedAudience },
      {
        onSuccess: (result) => {
          setCreated(result);
          setAdding(false);
          setName('');
          setAudience('');
        },
        onError: fail,
      },
    );
  };

  const snippet = created != null && agent != null ? snippetFor(created.key, agent.agent_id) : '';
  const nameNoteId = errors.name ? 'api-key-name-error' : 'api-key-name-hint';
  const audienceNoteId = errors.audience ? 'api-key-audience-error' : 'api-key-audience-hint';
  const noteClass = (invalid?: boolean) =>
    cn('mt-1 text-xs', invalid ? 'text-red-700 dark:text-red-400' : 'text-text-secondary');

  return (
    <OGDialog open={agent != null} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogTitle>
          {localize('com_ui_admin_api_title', { name: agent?.name ?? '' })}
        </OGDialogTitle>
        <div className="flex flex-col gap-4 text-sm text-text-primary">
          <p className="text-text-secondary">{localize('com_ui_admin_api_intro')}</p>

          {created != null ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="font-medium">
                {localize('com_ui_admin_api_created')}
              </p>
              <pre className="whitespace-pre-wrap break-all rounded-md border border-border-light bg-surface-secondary p-3 font-mono text-xs">
                {created.key}
              </pre>
              <Button variant="outline" onClick={() => copy(created.key)}>
                {localize('com_ui_admin_api_copy_key')}
              </Button>
              <h3 className="text-xs font-semibold">{localize('com_ui_admin_api_quickstart')}</h3>
              <pre className="overflow-x-auto rounded-md border border-border-light bg-surface-secondary p-3 font-mono text-xs">
                {snippet}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => copy(snippet)}>
                  {localize('com_ui_admin_api_copy_snippet')}
                </Button>
                <Button onClick={() => setCreated(null)}>{localize('com_ui_admin_api_done')}</Button>
              </div>
            </div>
          ) : (
            <>
              {error != null && (
                <p role="alert" className="text-text-secondary">
                  {localize('com_ui_admin_api_list_error')}
                </p>
              )}
              {error == null && keys.length === 0 && (
                <p className="text-text-secondary">{localize('com_ui_admin_api_empty')}</p>
              )}
              {keys.length > 0 && (
                <ul className="flex flex-col divide-y divide-border-light rounded-lg border border-border-light">
                  {keys.map((key) => (
                    <li key={key.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{key.name}</p>
                        <p className="text-xs text-text-secondary">
                          <span className="font-mono">{key.keyPrefix}…</span>
                          {' · '}
                          {key.lastUsedAt
                            ? localize('com_ui_admin_api_last_used', {
                                date: formatLastActivity(key.lastUsedAt) ?? '',
                              })
                            : localize('com_ui_admin_api_never_used')}
                          {' · '}
                          {localize('com_ui_admin_api_requests', { count: key.requestCount })}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-700 dark:text-red-400"
                        disabled={revoke.isLoading}
                        aria-label={localize('com_ui_admin_api_revoke_key', { name: key.name })}
                        onClick={() => revoke.mutate(key.id, { onError: fail })}
                      >
                        {localize('com_ui_admin_api_revoke')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {adding ? (
                <form
                  className="flex flex-col gap-3 rounded-lg border border-border-light p-3"
                  onSubmit={submit}
                  noValidate
                >
                  <div>
                    <label htmlFor="api-key-name" className="text-xs font-semibold">
                      {localize('com_ui_admin_api_name')}
                    </label>
                    <input
                      id="api-key-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      aria-invalid={errors.name === true}
                      aria-describedby={nameNoteId}
                      className={fieldClass}
                    />
                    <p id={nameNoteId} className={noteClass(errors.name)}>
                      {localize(
                        errors.name ? 'com_ui_admin_api_name_error' : 'com_ui_admin_api_name_hint',
                      )}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="api-key-audience" className="text-xs font-semibold">
                      {localize('com_ui_admin_api_audience')}
                    </label>
                    <input
                      id="api-key-audience"
                      value={audience}
                      onChange={(event) => setAudience(event.target.value)}
                      aria-invalid={errors.audience === true}
                      aria-describedby={audienceNoteId}
                      className={cn(fieldClass, 'font-mono')}
                    />
                    <p id={audienceNoteId} className={noteClass(errors.audience)}>
                      {localize(
                        errors.audience
                          ? 'com_ui_admin_api_audience_error'
                          : 'com_ui_admin_api_audience_hint',
                      )}
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAdding(false)}
                      disabled={create.isLoading}
                    >
                      {localize('com_ui_cancel')}
                    </Button>
                    <Button type="submit" disabled={create.isLoading}>
                      {localize('com_ui_admin_api_create')}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex justify-end">
                  <Button onClick={() => setAdding(true)}>{localize('com_ui_admin_api_new')}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
