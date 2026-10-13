import { X } from 'lucide-react';
import type { AdminWebsitePreviewResponse, WebsiteSkipReason } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useLocalize } from '~/hooks';

const SKIP_KEYS: Record<WebsiteSkipReason, TranslationKeys> = {
  robots: 'com_agents_websites_skip_robots',
  offsite: 'com_agents_websites_skip_offsite',
  outside: 'com_agents_websites_skip_outside',
  not_html: 'com_agents_websites_skip_not_html',
  too_large: 'com_agents_websites_skip_too_large',
  limit: 'com_agents_websites_skip_limit',
  error: 'com_agents_websites_skip_error',
};

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

/** What a Test read: every page (expandable to its exact text) and every link left out. */
export default function WebsitePreview({
  preview,
  isAdding,
  onAdd,
  onClose,
}: {
  preview: AdminWebsitePreviewResponse;
  isAdding: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const words = preview.pages.reduce((total, page) => total + page.words, 0);
  /** Site menus put dozens of links outside the address; one count per reason keeps it readable. */
  const skippedByReason = preview.skipped.reduce<Partial<Record<WebsiteSkipReason, string[]>>>(
    (groups, item) => {
      (groups[item.reason] ??= []).push(item.url);
      return groups;
    },
    {},
  );
  const title = localize('com_agents_websites_preview_title', { 0: shortUrl(preview.url) });
  return (
    <section
      aria-label={title}
      className="mt-2 min-w-0 overflow-hidden rounded-xl border border-border-light bg-surface-primary-alt"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border-light bg-surface-tertiary px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text-primary">{title}</p>
          <p className="text-[11px] text-text-secondary">
            {localize('com_agents_websites_preview_stats', {
              0: preview.pages.length,
              1: preview.skipped.length,
              2: words.toLocaleString(),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={localize('com_agents_websites_close_preview')}
          className="rounded p-1 text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {preview.pages.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-secondary">
          {localize('com_agents_websites_empty')}
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          {preview.pages.map((page) => (
            <details key={page.url} className="border-b border-border-light bg-surface-primary">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                  {page.title}
                </span>
                <span className="min-w-0 max-w-[40%] truncate text-[11px] text-text-tertiary">
                  {new URL(page.url).pathname}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-text-secondary">
                  {localize('com_agents_websites_words', { 0: page.words.toLocaleString() })}
                  {!page.cleaned && ` · ${localize('com_agents_websites_plain')}`}
                </span>
              </summary>
              <pre className="mx-3 mb-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-orange-500 bg-surface-secondary-alt px-2 py-1.5 font-sans text-xs text-text-primary">
                {page.text}
              </pre>
            </details>
          ))}
        </div>
      )}
      {preview.skipped.length > 0 && (
        <div className="border-t border-border-light px-3 py-2 text-[11px] leading-5 text-text-secondary">
          <p className="font-semibold text-text-primary">
            {localize('com_agents_websites_skipped')}
          </p>
          {(Object.entries(skippedByReason) as [WebsiteSkipReason, string[]][]).map(
            ([reason, urls]) => (
              <details key={reason}>
                <summary className="cursor-pointer">
                  {`${localize(SKIP_KEYS[reason])} · ${urls.length}`}
                </summary>
                <ul className="mb-1 ml-3 break-all">
                  {urls.map((url) => (
                    <li key={url}>{shortUrl(url)}</li>
                  ))}
                </ul>
              </details>
            ),
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border-light bg-surface-primary px-3 py-2">
        <span className="text-[11px] text-text-tertiary">
          {localize('com_agents_websites_preview_hint')}
        </span>
        {preview.pages.length > 0 && (
          <button
            type="button"
            onClick={onAdd}
            disabled={isAdding}
            className="btn btn-primary h-8 px-3 text-xs disabled:opacity-50"
          >
            {localize('com_agents_websites_add_this')}
          </button>
        )}
      </div>
    </section>
  );
}
