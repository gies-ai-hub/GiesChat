import { useState } from 'react';
import { Globe, RefreshCw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Spinner, useToastContext } from '@librechat/client';
import { DynamicQueryKeys, EToolResources, FileSources } from 'librechat-data-provider';
import type { AdminWebsitePreviewResponse, TFile } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import {
  useGetAgentFiles,
  useDeleteFilesMutation,
  usePreviewAdminWebsiteMutation,
  useSaveAdminAgentWebsiteMutation,
} from '~/data-provider';
import { useAgentPanelContext } from '~/Providers';
import WebsitePreview from './WebsitePreview';
import { isEphemeralAgent } from '~/common';
import { useLocalize } from '~/hooks';

const ERROR_KEYS: Record<string, TranslationKeys> = {
  invalid_url: 'com_agents_websites_invalid',
  blocked: 'com_agents_websites_blocked',
  empty: 'com_agents_websites_empty',
};

export const isWebsiteFile = (file: TFile): boolean => Boolean(file.metadata?.sourceUrl);

const selectWebsites = (files: TFile[]) => files.filter(isWebsiteFile);
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');
const rowClass =
  'flex items-center gap-2.5 rounded-lg border border-border-light px-2.5 py-2 text-xs';
const iconButtonClass =
  'rounded p-1 text-text-tertiary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50';

function normalize(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function errorKey(error: unknown): TranslationKeys {
  const code = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return (code && ERROR_KEYS[code]) || 'com_agents_websites_failed';
}

/**
 * Dashboard-only builder section: a site is crawled, cleaned by GPT-6 Luna and saved as an
 * agent document. Before the agent exists, addresses wait in the panel and `AgentPanel`
 * saves them after Create.
 */
export default function Websites({ agent_id }: { agent_id: string }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const { pendingWebsites, setPendingWebsites } = useAgentPanelContext();
  const [input, setInput] = useState('');
  const [error, setError] = useState<TranslationKeys | null>(null);
  const [preview, setPreview] = useState<AdminWebsitePreviewResponse | null>(null);
  const isNew = isEphemeralAgent(agent_id);
  const { data: copies = [] } = useGetAgentFiles(agent_id, { select: selectWebsites });
  const test = usePreviewAdminWebsiteMutation();
  const save = useSaveAdminAgentWebsiteMutation();
  const remove = useDeleteFilesMutation({
    onSuccess: () => queryClient.invalidateQueries(DynamicQueryKeys.agentFiles(agent_id)),
  });

  const known = new Set([...copies.map((file) => file.metadata?.sourceUrl), ...pendingWebsites]);

  const validated = (): string | null => {
    const url = normalize(input);
    setError(null);
    if (!url) {
      setError('com_agents_websites_invalid');
      return null;
    }
    if (known.has(url)) {
      setError('com_agents_websites_duplicate');
      return null;
    }
    return url;
  };

  const saveUrl = (url: string) => {
    if (isNew) {
      setPendingWebsites((current) => [...current, url]);
      setInput('');
      setPreview(null);
      return;
    }
    save.mutate(
      { agentId: agent_id, url },
      {
        onSuccess: ({ website }) => {
          setInput('');
          setPreview(null);
          showToast({
            message: localize('com_agents_websites_saved_toast', {
              0: website.pages,
              1: new URL(website.url).host,
            }),
          });
        },
        onError: (err) => setError(errorKey(err)),
      },
    );
  };

  const onTest = () => {
    const url = validated();
    if (url) {
      test.mutate(url, { onSuccess: setPreview, onError: (err) => setError(errorKey(err)) });
    }
  };

  const onAdd = () => {
    if (save.isLoading) {
      return;
    }
    const url = validated();
    if (url) {
      saveUrl(url);
    }
  };

  const refreshing = save.isLoading ? save.variables?.url : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="agent-website-url"
        className="text-[11px] font-medium uppercase tracking-wide text-text-secondary"
      >
        {localize('com_agents_websites_label')}
      </label>
      <p className="text-xs text-text-tertiary">{localize('com_agents_websites_description')}</p>
      <div className="flex gap-2">
        <input
          id="agent-website-url"
          type="url"
          value={input}
          placeholder="https://…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        />
        <button
          type="button"
          onClick={onTest}
          disabled={test.isLoading}
          className="btn btn-neutral h-9 px-3 text-sm disabled:opacity-50"
        >
          {test.isLoading
            ? localize('com_agents_websites_testing')
            : localize('com_agents_websites_test')}
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={save.isLoading}
          className="btn btn-primary h-9 px-3 text-sm disabled:opacity-50"
        >
          {localize('com_agents_websites_add')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {localize(error)}
        </p>
      )}
      {preview && (
        <WebsitePreview
          preview={preview}
          isAdding={save.isLoading}
          onAdd={() => saveUrl(preview.url)}
          onClose={() => setPreview(null)}
        />
      )}
      <ul className="flex flex-col gap-1.5">
        {copies.map((file) => {
          const url = file.metadata?.sourceUrl ?? '';
          const busy = refreshing === url;
          return (
            <li key={file.file_id} className={rowClass}>
              <Globe className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-text-primary" title={url}>
                  {shortUrl(url)}
                </p>
                <p className="text-[11px] text-text-tertiary">
                  {busy
                    ? localize('com_agents_websites_reading')
                    : localize('com_agents_websites_checked', {
                        0: new Date(file.metadata?.checkedAt ?? Date.now()).toLocaleDateString(),
                      })}
                </p>
              </div>
              <span className="whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-[10.5px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                {localize('com_agents_websites_saved_badge', { 0: file.metadata?.pages ?? 0 })}
              </span>
              <button
                type="button"
                disabled={save.isLoading}
                onClick={() =>
                  save.mutate(
                    { agentId: agent_id, url },
                    { onError: (err) => setError(errorKey(err)) },
                  )
                }
                title={localize('com_agents_websites_refresh')}
                aria-label={localize('com_agents_websites_refresh')}
                className={iconButtonClass}
              >
                {busy ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                disabled={remove.isLoading}
                onClick={() =>
                  remove.mutate({
                    files: [
                      {
                        file_id: file.file_id,
                        filepath: file.filepath,
                        embedded: file.embedded,
                        source: file.source ?? FileSources.text,
                      },
                    ],
                    agent_id,
                    tool_resource: EToolResources.context,
                  })
                }
                aria-label={localize('com_agents_websites_remove')}
                className={iconButtonClass}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {pendingWebsites.map((url) => (
          <li key={url} className={rowClass}>
            <Globe className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate font-medium text-text-primary">{shortUrl(url)}</p>
            <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10.5px] font-semibold text-text-secondary">
              {localize('com_agents_websites_waiting')}
            </span>
            <button
              type="button"
              onClick={() =>
                setPendingWebsites((current) => current.filter((item) => item !== url))
              }
              aria-label={localize('com_agents_websites_remove')}
              className={iconButtonClass}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {isNew && pendingWebsites.length > 0 && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
          {localize('com_agents_websites_pending')}
        </p>
      )}
    </div>
  );
}
