import React, { useRef } from 'react';
import { Shield } from 'lucide-react';
import type { AdminDashboardView } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export const VIEW_PANEL_ID = 'admin-view-panel';

const TABS: { view: AdminDashboardView | undefined; id: string; labelKey: TranslationKeys }[] = [
  { view: undefined, id: 'admin-view-mine', labelKey: 'com_ui_admin_view_mine' },
  { view: 'admin', id: 'admin-view-admin', labelKey: 'com_ui_admin_view_admin' },
];

export const viewTabId = (view: AdminDashboardView | undefined) =>
  TABS.find((tab) => tab.view === view)?.id ?? TABS[0].id;

/** My agents / Admin. Rendered only for `manage:agents` holders; arrow keys move between tabs. */
export default function Views({
  view,
  onChange,
}: {
  view: AdminDashboardView | undefined;
  onChange: (view: AdminDashboardView | undefined) => void;
}) {
  const localize = useLocalize();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return;
    }
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    refs.current[next]?.focus();
    onChange(TABS[next].view);
  };

  return (
    <div
      role="tablist"
      aria-label={localize('com_ui_admin_view_tabs')}
      className="mb-6 flex gap-1 border-b border-border-light"
    >
      {TABS.map((tab, index) => {
        const selected = tab.view === view;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={VIEW_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.view)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-heavy',
              selected
                ? 'border-[#d94f04] text-text-primary dark:border-[#ff5f05]'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {tab.view === 'admin' && <Shield className="size-4" aria-hidden="true" />}
            {localize(tab.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
