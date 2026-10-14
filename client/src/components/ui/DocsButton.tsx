import { BookOpen } from 'lucide-react';
import { useLocalize } from '~/hooks';

/** Opens the static docs site (`docs/site`, served at `/docs`) in a new tab. */
export default function DocsButton() {
  const localize = useLocalize();
  return (
    <a
      href="/docs/index.html"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={localize('com_ui_documentation')}
      title={localize('com_ui_documentation')}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-medium bg-surface-primary text-text-secondary transition-colors hover:border-[var(--illini-orange)] hover:text-[var(--illini-orange)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--illini-orange)]"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
